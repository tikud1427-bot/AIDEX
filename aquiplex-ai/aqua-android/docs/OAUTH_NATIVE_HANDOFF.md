# Native Google OAuth handoff — contract

The Android app is a WebView shell around `https://aquiplex.com/aqua`. Authentication is
entirely server-side (Passport + `express-session`), so the "session" is an HttpOnly cookie
scoped to `aquiplex.com`. There is no token for the app to hold.

The bug this contract fixes: OAuth completed in **Chrome**, so `Set-Cookie` landed in Chrome's
cookie jar. The WebView has a separate jar. Two sessions, one authenticated, and the app was
looking at the wrong one.

The fix is not to share cookies — that is neither possible nor safe. It is to end the browser
leg with a short-lived one-time code, hand that code to the app via a verified App Link, and
let the **WebView itself** redeem it, so the cookie is set on a request the WebView made.

## Flow

```
WebView   tap "Continue with Google" -> https://aquiplex.com/auth/google
          shell intercepts (AuthCallback.isAuthStart) and opens it in the browser
          with ?native=1&nonce=<app-generated>
Browser   /auth/google?native=1&nonce=N  -> session A, OAuth state stored in session A
Browser   accounts.google.com -> user authenticates
Browser   /auth/google/callback -> state matches (same client) -> Passport logs in session A
Server    mint one-time code -> 302 https://aquiplex.com/auth/native/return?code=C&nonce=N
Android   verified App Link -> MainActivity.onNewIntent (or onCreate on cold start)
App       validates host/path/nonce, then webView.loadUrl(/auth/native/complete?code=C)
Server    burn code, session.regenerate(), req.login(user) -> 302 /aqua
WebView   now holds connect.sid -> SPA boots authenticated
```

Why the shell must start the leg in the browser rather than letting the WebView follow the
redirect out: Google rejects embedded WebViews (`disallowed_useragent`), and more importantly
the OAuth `state` is stored in the session belonging to whichever client requested
`/auth/google`. If the WebView requests it and Chrome finishes it, the callback arrives with a
different session and Passport's state check cannot match. The whole browser leg must be one
client.

## Endpoints to implement

### `GET /auth/google`

```
if (req.query.native === '1') {
    req.session.nativeReturn = true;
    req.session.nativeNonce  = String(req.query.nonce || '').slice(0, 64);
}
passport.authenticate('google', { scope: [...] })
```

Reject or ignore a missing/oversized nonce. Do not log it.

### `GET /auth/google/callback`

Existing web behaviour is unchanged when `req.session.nativeReturn` is absent.

```
passport.authenticate('google', ...)
if (!req.session.nativeReturn) -> existing redirect, unchanged

code = crypto.randomBytes(32).toString('base64url')
store {
    codeHash:  sha256(code),          // store the hash, not the code
    userId:    req.user.id,
    expiresAt: now + 120s,            // Mongo TTL index
    usedAt:    null
}
nonce = req.session.nativeNonce
delete req.session.nativeReturn; delete req.session.nativeNonce
302 -> https://aquiplex.com/auth/native/return?code=<code>&nonce=<nonce>
```

The nonce **must** be echoed. The app rejects any return whose nonce does not match the one it
generated when it started the flow; that is what stops a hostile app from firing a callback at
Aqua's exported activity and signing the user into an attacker-controlled account.

### `GET /auth/native/return`

Normally intercepted by the App Link and never served. It must still exist, because App Link
verification can fail (see below) and because the URL can be opened on desktop.

Serve a minimal page: "Open the Aqua app to finish signing in", with a link to the same URL.
Do not render the code into visible text.

### `GET /auth/native/complete?code=<code>`

```
lookup sha256(code)
reject if: not found | usedAt != null | expiresAt < now
atomic findOneAndUpdate({ codeHash, usedAt: null }, { $set: { usedAt: now } })   // race-safe
req.session.regenerate()      // session fixation
req.login(user)
302 -> /aqua

any failure -> 302 /aqua?auth_error=invalid_code    (generic; do not say which check failed)
```

Constraints: single use, ≤120s TTL, 256 bits CSPRNG, stored hashed, never logged, never
rendered. Cookie flags unchanged — keep `HttpOnly`, `Secure`, `SameSite=Lax`. `Lax` is
sufficient because `/auth/native/complete` is reached by a top-level GET navigation.

### Account switching

`/auth/logout` clears the WebView's session but Chrome keeps its own. The next Google login can
then complete silently as the previous user. When the user explicitly logs out or switches
accounts, add `prompt=select_account` to the native leg.

## `https://aquiplex.com/.well-known/assetlinks.json`

Required. Without it the App Link is unverified, Android leaves the callback with Chrome, and
the bug looks unfixed.

Must return HTTP 200, `Content-Type: application/json`, over HTTPS, **with no redirect**
(including no `www.` redirect), publicly readable, no auth.

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.aquiplex.aqua",
      "sha256_cert_fingerprints": [
        "PLAY_APP_SIGNING_SHA256_GOES_HERE",
        "15:F7:A9:A8:72:79:D4:39:1F:DE:E5:5A:7E:02:B0:D2:9D:56:57:CB:AC:17:F0:CA:0F:ED:61:F4:B1:40:1C:2B"
      ]
    }
  }
]
```

The second fingerprint is the **upload key** from `keystore.properties`, extracted from the
shipped `app-release.aab`. It covers locally installed and internal-test builds.

The first must be the **app signing key** fingerprint from
Play Console → Test and release → App integrity → App signing key certificate. Under Play App
Signing the certificate users actually receive is Google's, not yours. Omitting it is the single
most common reason App Link verification passes in debug and fails in production.

Verify on a device with the release build installed:

```bash
adb shell pm get-app-links com.aquiplex.aqua        # expect: aquiplex.com: verified
adb shell pm verify-app-links --re-verify com.aquiplex.aqua
```

`tools/oauth-acceptance.sh gate` runs this as a release gate.

## Google Cloud Console

No change expected. The authorized redirect URI stays:

```
https://aquiplex.com/auth/google/callback
```

Do not add `aqua://` or any custom scheme — Google's *Web application* client type does not
accept them, and a custom scheme is claimable by any installed app (RFC 8252 §8.1). Do not
create an Android OAuth client type. The client secret stays server-side, which the current
architecture already gets right.

## Frontend check

One thing to confirm in the web app: how the "Continue with Google" control navigates.
`AquaWebChromeClient.onCreateWindow` funnels `window.open` / `target="_blank"` back into the same
WebView, which would bypass the browser handoff. It must be a same-tab navigation to
`/auth/google`.
