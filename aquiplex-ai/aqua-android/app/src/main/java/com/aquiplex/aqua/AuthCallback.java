package com.aquiplex.aqua;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.net.URLEncoder;

/**
 * OAuth return-hop policy for the native shell.
 *
 * <p>Deliberately contains no Android imports so the whole decision surface runs under a plain
 * JVM unit test. {@link MainActivity} owns the Android side (intents, WebView, storage); this
 * class owns "given an inbound URL, what — if anything — should the WebView load".
 *
 * <p>Security notes:
 * <ul>
 *   <li>Every accepted input maps to one of two <em>hardcoded</em> destinations
 *       ({@link #COMPLETE_URL} or {@link #APP_URL}). No caller-supplied URL is ever loaded,
 *       so this cannot become an open redirect into the WebView.</li>
 *   <li>{@code MainActivity} is an exported launcher activity, so any installed app can send it
 *       an {@code ACTION_VIEW} intent. Validation here is load-bearing, not decoration.</li>
 *   <li>The {@code nonce} check defeats login-CSRF: without it a malicious app could hand us a
 *       code minted for <em>its</em> Google account and silently sign the user into it.</li>
 * </ul>
 */
final class AuthCallback {

    /** Mirrors {@code android.content.Intent.ACTION_VIEW} without importing Android. */
    static final String ACTION_VIEW = "android.intent.action.VIEW";

    static final String HOST = "aquiplex.com";
    static final String APP_URL = "https://aquiplex.com/aqua";
    static final String COMPLETE_URL = "https://aquiplex.com/auth/native/complete";
    static final String RETURN_PATH = "/auth/native/return";
    static final String START_PREFIX = "/auth/google";

    private AuthCallback() {
    }

    /**
     * True when a same-host navigation begins the Google OAuth leg.
     *
     * <p>That leg must run in the real browser, not the WebView: Google rejects embedded
     * WebViews outright ({@code disallowed_useragent}), and — more subtly — the entire browser
     * leg has to be performed by one HTTP client so the server's OAuth {@code state}, stored in
     * the session that requested {@code /auth/google}, is present when {@code /auth/google/callback}
     * comes back. Letting the WebView start the leg and the browser finish it splits it across
     * two sessions and the state check cannot match.
     */
    static boolean isAuthStart(String url) {
        URI uri = parse(url);
        if (uri == null) {
            return false;
        }
        if (!HOST.equalsIgnoreCase(uri.getHost())) {
            return false;
        }
        String path = uri.getPath();
        return path != null && path.startsWith(START_PREFIX);
    }

    /**
     * The URL to hand to the external browser for the OAuth leg: the original navigation plus
     * {@code native=1} (tells the server to finish with the native return hop) and the nonce
     * the server must echo back.
     */
    static String externalAuthStartUrl(String url, String nonce) {
        StringBuilder out = new StringBuilder(url);
        out.append(url.indexOf('?') < 0 ? '?' : '&');
        out.append("native=1&nonce=").append(encode(nonce));
        return out.toString();
    }

    /**
     * Maps an inbound intent to the URL the WebView should load, or {@code null} if the intent
     * is not a legitimate Aqua auth return and must be ignored.
     *
     * @param action        the intent action
     * @param dataUrl       the intent data, as a string
     * @param expectedNonce the nonce persisted when this app started the OAuth leg;
     *                      {@code null} when no flow is in progress
     */
    static String resolveReturn(String action, String dataUrl, String expectedNonce) {
        if (!ACTION_VIEW.equals(action) || dataUrl == null) {
            return null;
        }
        URI uri = parse(dataUrl);
        if (uri == null) {
            return null;
        }
        // Reject anything that is not exactly our HTTPS return endpoint.
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            return null;
        }
        if (!HOST.equalsIgnoreCase(uri.getHost())) {
            return null;
        }
        if (uri.getPort() != -1 && uri.getPort() != 443) {
            return null;
        }
        if (uri.getUserInfo() != null) {
            return null;
        }
        if (!RETURN_PATH.equals(uri.getPath())) {
            return null;
        }

        // Bind the return to a flow this app actually started.
        if (!nonceMatches(expectedNonce, param(uri.getRawQuery(), "nonce"))) {
            return null;
        }

        String error = param(uri.getRawQuery(), "error");
        if (error != null && !error.isEmpty()) {
            return APP_URL + "?auth_error=" + encode(error);
        }

        String code = param(uri.getRawQuery(), "code");
        if (code == null || code.isEmpty()) {
            return null;
        }
        return COMPLETE_URL + "?code=" + encode(code);
    }

    private static boolean nonceMatches(String expected, String actual) {
        if (expected == null || expected.isEmpty() || actual == null) {
            return false;
        }
        return constantTimeEquals(expected, actual);
    }

    private static URI parse(String url) {
        if (url == null) {
            return null;
        }
        try {
            return new URI(url);
        } catch (URISyntaxException e) {
            return null;
        }
    }

    private static String param(String rawQuery, String name) {
        if (rawQuery == null) {
            return null;
        }
        for (String pair : rawQuery.split("&")) {
            int eq = pair.indexOf('=');
            String key = decode(eq < 0 ? pair : pair.substring(0, eq));
            if (!name.equals(key)) {
                continue;
            }
            return eq < 0 ? "" : decode(pair.substring(eq + 1));
        }
        return null;
    }

    private static String decode(String value) {
        try {
            return URLDecoder.decode(value, "UTF-8");
        } catch (UnsupportedEncodingException | IllegalArgumentException e) {
            return value;
        }
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            return value;
        }
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a.length() != b.length()) {
            return false;
        }
        int diff = 0;
        for (int i = 0; i < a.length(); i++) {
            diff |= a.charAt(i) ^ b.charAt(i);
        }
        return diff == 0;
    }
}
