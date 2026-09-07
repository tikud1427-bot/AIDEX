package com.aquiplex.aqua;

/**
 * Executable spec for {@link AuthCallback}. No JUnit, no Android SDK, no network: plain
 * {@code javac} + {@code java}. Run via {@code ./gradlew checkAuthCallback}, or directly with
 * {@code tools/verify-authcallback.sh}. Exits non-zero on any failure.
 *
 * <p>Deliberately not a JUnit test in {@code src/test}: the AGP unit-test variant needs a test
 * framework on the classpath, and duplicating these cases across two files guarantees drift.
 * One file, one source of truth, runnable anywhere a JDK exists.
 *
 * <p><b>Bite check (blueprint L16).</b> Each case tagged {@code [bite:X]} must fail when guard X
 * is removed from {@link AuthCallback}. {@code tools/verify-authcallback.sh --bite} performs
 * those mutations automatically and asserts the suite goes red for each one.
 */
public final class AuthCallbackHarness {

    private static final String NONCE = "n0nce-AAAAAAAAAAAAAAAA";
    private static int failures = 0;
    private static int checks = 0;

    public static void main(String[] args) {
        resolveReturnCases();
        isAuthStartCases();
        externalAuthStartUrlCases();

        System.out.println();
        System.out.println(failures == 0
                ? "PASS  " + checks + " checks"
                : "FAIL  " + failures + " of " + checks + " checks");
        System.exit(failures == 0 ? 0 : 1);
    }

    // ---------------------------------------------------------------- resolveReturn

    private static void resolveReturnCases() {
        section("resolveReturn");

        // Acceptance test 1/2/3/4 — a legitimate return maps to the in-WebView completion URL.
        // This is the whole point: the cookie must be set by a request the WebView makes.
        eq("valid return -> complete url",
                "https://aquiplex.com/auth/native/complete?code=abc123",
                resolve("https://aquiplex.com/auth/native/return?code=abc123&nonce=" + NONCE));

        // Acceptance test 6 — cancelled/denied leaves the app logged out with a visible reason.
        eq("provider error -> app url with auth_error",
                "https://aquiplex.com/aqua?auth_error=access_denied",
                resolve("https://aquiplex.com/auth/native/return?error=access_denied&nonce=" + NONCE));

        eq("code is url-encoded on the way out",
                "https://aquiplex.com/auth/native/complete?code=a%2Fb%2Bc%3D",
                resolve("https://aquiplex.com/auth/native/return?code=a%2Fb%2Bc%3D&nonce=" + NONCE));

        // ---- security guards ----

        isNull("[bite:host] foreign host rejected",
                resolve("https://evil.example/auth/native/return?code=abc123&nonce=" + NONCE));

        isNull("[bite:host] lookalike host rejected",
                resolve("https://aquiplex.com.evil.example/auth/native/return?code=abc&nonce=" + NONCE));

        isNull("[bite:scheme] http downgrade rejected",
                resolve("http://aquiplex.com/auth/native/return?code=abc123&nonce=" + NONCE));

        isNull("[bite:path] other path rejected",
                resolve("https://aquiplex.com/anything?code=abc123&nonce=" + NONCE));

        isNull("[bite:path] path prefix is not enough",
                resolve("https://aquiplex.com/auth/native/return/extra?code=abc&nonce=" + NONCE));

        isNull("[bite:port] non-443 port rejected",
                resolve("https://aquiplex.com:8443/auth/native/return?code=abc&nonce=" + NONCE));

        isNull("[bite:userinfo] userinfo form rejected",
                resolve("https://evil.example@aquiplex.com/auth/native/return?code=abc&nonce=" + NONCE));

        // Login-CSRF: MainActivity is an exported launcher activity, so any installed app can
        // fire ACTION_VIEW at it. Without the nonce, a hostile app hands us a code minted for
        // its own Google account and Aqua silently signs the user into the attacker's account.
        isNull("[bite:nonce] nonce mismatch rejected",
                resolve("https://aquiplex.com/auth/native/return?code=abc&nonce=wrong-nonce"));

        isNull("[bite:nonce] missing nonce rejected",
                resolve("https://aquiplex.com/auth/native/return?code=abc"));

        isNull("[bite:nonce] no flow in progress rejected",
                AuthCallback.resolveReturn(AuthCallback.ACTION_VIEW,
                        "https://aquiplex.com/auth/native/return?code=abc&nonce=" + NONCE, null));

        isNull("[bite:nonce] replay after consumption rejected",
                AuthCallback.resolveReturn(AuthCallback.ACTION_VIEW,
                        "https://aquiplex.com/auth/native/return?code=abc&nonce=" + NONCE, ""));

        // ---- shape guards ----

        isNull("neither code nor error rejected",
                resolve("https://aquiplex.com/auth/native/return?nonce=" + NONCE));

        isNull("empty code rejected",
                resolve("https://aquiplex.com/auth/native/return?code=&nonce=" + NONCE));

        isNull("non-VIEW action rejected",
                AuthCallback.resolveReturn("android.intent.action.MAIN",
                        "https://aquiplex.com/auth/native/return?code=abc&nonce=" + NONCE, NONCE));

        isNull("null data rejected",
                AuthCallback.resolveReturn(AuthCallback.ACTION_VIEW, null, NONCE));

        isNull("malformed uri rejected",
                resolve("https://aquiplex.com/auth/native/return?code=a b&nonce=" + NONCE));

        isNull("opaque uri rejected",
                resolve("mailto:someone@aquiplex.com"));
    }

    // ---------------------------------------------------------------- isAuthStart

    private static void isAuthStartCases() {
        section("isAuthStart");

        isTrue("oauth start goes to the browser",
                AuthCallback.isAuthStart("https://aquiplex.com/auth/google"));

        isTrue("oauth start with query goes to the browser",
                AuthCallback.isAuthStart("https://aquiplex.com/auth/google?next=%2Faqua"));

        // The single most damaging false positive: if the completion hop left for the browser,
        // Set-Cookie would land in Chrome's jar again and the bug would be unchanged.
        isFalse("[bite:start] completion hop stays in the WebView",
                AuthCallback.isAuthStart("https://aquiplex.com/auth/native/complete?code=abc"));

        isFalse("[bite:start] return hop stays in the WebView",
                AuthCallback.isAuthStart("https://aquiplex.com/auth/native/return?code=abc"));

        // If this regressed, every ordinary page load would be ejected to Chrome.
        isFalse("[bite:start] app url stays in the WebView",
                AuthCallback.isAuthStart("https://aquiplex.com/aqua"));

        isFalse("foreign host is not an auth start",
                AuthCallback.isAuthStart("https://accounts.google.com/o/oauth2/v2/auth"));

        isFalse("null is not an auth start", AuthCallback.isAuthStart(null));
    }

    // ---------------------------------------------------------------- externalAuthStartUrl

    private static void externalAuthStartUrlCases() {
        section("externalAuthStartUrl");

        eq("appends query when none present",
                "https://aquiplex.com/auth/google?native=1&nonce=" + NONCE,
                AuthCallback.externalAuthStartUrl("https://aquiplex.com/auth/google", NONCE));

        eq("extends an existing query",
                "https://aquiplex.com/auth/google?next=%2Faqua&native=1&nonce=" + NONCE,
                AuthCallback.externalAuthStartUrl(
                        "https://aquiplex.com/auth/google?next=%2Faqua", NONCE));

        eq("nonce is url-encoded",
                "https://aquiplex.com/auth/google?native=1&nonce=a%2Fb%3D",
                AuthCallback.externalAuthStartUrl("https://aquiplex.com/auth/google", "a/b="));

        // Round trip: whatever we send out must be accepted back.
        String started = AuthCallback.externalAuthStartUrl("https://aquiplex.com/auth/google", NONCE);
        isTrue("round trip: started url still classifies as an auth start",
                AuthCallback.isAuthStart(started));
    }

    // ---------------------------------------------------------------- plumbing

    private static String resolve(String url) {
        return AuthCallback.resolveReturn(AuthCallback.ACTION_VIEW, url, NONCE);
    }

    private static void section(String name) {
        System.out.println();
        System.out.println("-- " + name);
    }

    private static void eq(String name, String expected, String actual) {
        record(name, expected.equals(actual), "expected <" + expected + "> got <" + actual + ">");
    }

    private static void isNull(String name, String actual) {
        record(name, actual == null, "expected null, got <" + actual + ">");
    }

    private static void isTrue(String name, boolean actual) {
        record(name, actual, "expected true, got false");
    }

    private static void isFalse(String name, boolean actual) {
        record(name, !actual, "expected false, got true");
    }

    private static void record(String name, boolean ok, String detail) {
        checks++;
        if (ok) {
            System.out.println("   ok   " + name);
        } else {
            failures++;
            System.out.println("   FAIL " + name + "  -- " + detail);
        }
    }

    private AuthCallbackHarness() {
    }
}
