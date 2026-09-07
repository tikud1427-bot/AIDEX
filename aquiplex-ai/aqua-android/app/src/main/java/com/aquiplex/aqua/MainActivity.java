package com.aquiplex.aqua;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import java.security.SecureRandom;

/**
 * Native shell around the Aqua AI web app (https://aquiplex.com/aqua): launcher/adaptive
 * icon, splash screen, in-app back navigation, external-link handoff, file upload/download,
 * and load-error recovery. The web app itself is untouched — this class only manages the
 * container around it.
 */
public class MainActivity extends Activity {

    private static final String TAG = "AquaMainActivity";
    private static final String AQUA_URL = "https://aquiplex.com/aqua";
    private static final String AQUA_HOST = "aquiplex.com";
    private static final int FILE_CHOOSER_REQUEST_CODE = 51;
    /** Nonce lives in prefs, not a field: the process is routinely killed while the user is in Chrome. */
    private static final String AUTH_PREFS = "aqua_auth";
    private static final String KEY_OAUTH_NONCE = "oauth_nonce";

    private WebView webView;
    private FrameLayout rootLayout;
    private ProgressBar progressBar;
    private View errorView;
    private ValueCallback<Uri[]> pendingFileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Must run before super.onCreate() per the SplashScreen API contract.
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        rootLayout = new FrameLayout(this);

        webView = new WebView(this);
        configureWebView(webView);
        rootLayout.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        progressBar = buildProgressBar();
        rootLayout.addView(progressBar);

        setContentView(rootLayout);
        applyEdgeToEdgeInsets(rootLayout);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            // Cold start can itself be the OAuth return, if the process was killed while the
            // user was in Chrome. Ignoring getIntent() here is what dropped the callback before.
            String returnUrl = authReturnUrl(getIntent());
            webView.loadUrl(returnUrl != null ? returnUrl : AQUA_URL);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Keep getIntent() consistent for anything that reads it later.
        setIntent(intent);
        String returnUrl = authReturnUrl(intent);
        if (returnUrl != null) {
            webView.loadUrl(returnUrl);
        }
    }

    /**
     * Translates an inbound intent into the URL the WebView should load, or null to ignore it.
     * Delegates every decision to {@link AuthCallback} so the policy is unit-testable.
     */
    private String authReturnUrl(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            return null;
        }
        Uri data = intent.getData();
        if (data == null) {
            return null;
        }
        Log.i(TAG, "[AUTH] OAuth callback received"
                + " action=" + intent.getAction()
                + " scheme=" + data.getScheme()
                + " host=" + data.getHost()
                + " path=" + data.getPath()
                + " hasCode=" + (data.getQueryParameter("code") != null)
                + " error=" + (data.getQueryParameter("error") != null
                        ? data.getQueryParameter("error") : "none"));

        String expectedNonce = peekOauthNonce();
        String resolved = AuthCallback.resolveReturn(
                intent.getAction(), data.toString(), expectedNonce);

        if (resolved == null) {
            Log.w(TAG, "[AUTH] Callback rejected (host/path/nonce validation failed)");
            return null;
        }
        // Single-use: a replayed return must not be honoured.
        clearOauthNonce();

        if (resolved.startsWith(AuthCallback.COMPLETE_URL)) {
            Log.i(TAG, "[AUTH] Authorization result received; session exchange started");
        } else {
            Log.i(TAG, "[AUTH] Authorization result received: provider returned an error");
        }
        return resolved;
    }

    /**
     * Starts the OAuth leg in the external browser, tagged with a fresh nonce the server must
     * echo on the return hop.
     */
    private void beginAuthStart(Uri uri) {
        String nonce = newOauthNonce();
        String external = AuthCallback.externalAuthStartUrl(uri.toString(), nonce);
        Log.i(TAG, "[AUTH] Google OAuth started (external browser)");
        Log.i(TAG, "[AUTH] Redirect URI = https://" + AQUA_HOST + AuthCallback.RETURN_PATH);
        openExternally(Uri.parse(external));
    }

    private void openExternally(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "No app installed to handle: " + uri);
        }
    }

    private SharedPreferences authPrefs() {
        return getSharedPreferences(AUTH_PREFS, MODE_PRIVATE);
    }

    /** 128 bits of CSPRNG, URL-safe. Never logged: it is a CSRF token. */
    private String newOauthNonce() {
        byte[] bytes = new byte[16];
        new SecureRandom().nextBytes(bytes);
        String nonce = Base64.encodeToString(
                bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        authPrefs().edit().putString(KEY_OAUTH_NONCE, nonce).commit();
        return nonce;
    }

    private String peekOauthNonce() {
        return authPrefs().getString(KEY_OAUTH_NONCE, null);
    }

    private void clearOauthNonce() {
        authPrefs().edit().remove(KEY_OAUTH_NONCE).apply();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView webView) {
        // Settings below are unchanged from the previous implementation.
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        // New: required for target="_blank" / window.open() handling below.
        webView.getSettings().setSupportMultipleWindows(true);

        webView.setWebViewClient(new AquaWebViewClient());
        webView.setWebChromeClient(new AquaWebChromeClient());
        webView.setDownloadListener(this::startDownload);
    }

    private void startDownload(String url, String userAgent, String contentDisposition,
                                String mimeType, long contentLength) {
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setMimeType(mimeType);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) {
                request.addRequestHeader("Cookie", cookie);
            }
            request.addRequestHeader("User-Agent", userAgent);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

            DownloadManager downloadManager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (downloadManager != null) {
                downloadManager.enqueue(request);
            }
        } catch (Exception e) {
            Log.w(TAG, "Download hand-off failed for " + url, e);
        }
    }

    private void applyEdgeToEdgeInsets(View view) {
        ViewCompat.setOnApplyWindowInsetsListener(view, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // The session is an HttpOnly cookie. Without an explicit flush it can be lost if the
        // process is killed while the user is away in Chrome — which is exactly this flow.
        CookieManager.getInstance().flush();
        webView.onPause();
        webView.pauseTimers();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.resumeTimers();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        rootLayout.removeView(webView);
        webView.stopLoading();
        webView.setWebViewClient(null);
        webView.setWebChromeClient(null);
        webView.destroy();
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (pendingFileCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
                pendingFileCallback.onReceiveValue(results);
                pendingFileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /** In-app vs external navigation, plus load progress/error state for the main frame. */
    private class AquaWebViewClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUrl(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            // Kept alongside the WebResourceRequest overload above: that overload
            // requires API 24+, so minSdk-23 devices need this one too.
            return handleUrl(Uri.parse(url));
        }

        private boolean handleUrl(Uri uri) {
            String scheme = uri.getScheme();
            boolean isWebScheme = "http".equals(scheme) || "https".equals(scheme);
            if (isWebScheme && AQUA_HOST.equals(uri.getHost())) {
                // Same-origin, one exception: the Google OAuth leg has to run in the real
                // browser end to end. See AuthCallback#isAuthStart for why.
                if (AuthCallback.isAuthStart(uri.toString())) {
                    beginAuthStart(uri);
                    return true;
                }
                return false; // same-origin: let the WebView load it in place
            }
            openExternally(uri);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            progressBar.setVisibility(View.GONE);
            hideErrorView();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request.isForMainFrame()) {
                progressBar.setVisibility(View.GONE);
                showErrorView();
            }
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            super.onReceivedHttpError(view, request, errorResponse);
            if (request.isForMainFrame() && errorResponse.getStatusCode() >= 400) {
                progressBar.setVisibility(View.GONE);
                showErrorView();
            }
        }
    }

    /**
     * File-picker uploads and target="_blank" / window.open() pop-ups. JS alert/confirm/prompt
     * dialogs start working simply because a WebChromeClient is attached at all — WebChromeClient's
     * own defaults already show the native dialogs; no override needed for those.
     */
    private class AquaWebChromeClient extends WebChromeClient {

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
            pendingFileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST_CODE);
            } catch (ActivityNotFoundException e) {
                pendingFileCallback = null;
                return false;
            }
            return true;
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            // Load the new-window request in the same WebView instead of opening a second one.
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(view);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            super.onProgressChanged(view, newProgress);
            if (newProgress >= 100) {
                progressBar.setVisibility(View.GONE);
            }
        }
    }

    private ProgressBar buildProgressBar() {
        ProgressBar bar = new ProgressBar(this);
        bar.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        return bar;
    }

    private void showErrorView() {
        if (errorView == null) {
            errorView = buildErrorView();
            rootLayout.addView(errorView, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        webView.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
    }

    private void hideErrorView() {
        if (errorView != null) {
            errorView.setVisibility(View.GONE);
        }
        webView.setVisibility(View.VISIBLE);
    }

    private View buildErrorView() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setBackgroundColor(getColor(R.color.aqua_background));
        int pad = (int) (32 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);

        TextView message = new TextView(this);
        message.setText("Can't reach Aqua right now. Check your connection and try again.");
        message.setGravity(Gravity.CENTER);
        message.setTextSize(16);
        layout.addView(message, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button retry = new Button(this);
        retry.setText("Retry");
        retry.setOnClickListener(v -> {
            progressBar.setVisibility(View.VISIBLE);
            webView.reload();
        });
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        retryParams.topMargin = pad / 2;
        layout.addView(retry, retryParams);

        return layout;
    }
}
