# Google OAuth Android Fix

This workspace contains the current AQUIPLEX server/frontend plus the patched native Android
shell in `aqua-android/`.

The native Android shell implements the browser -> verified App Link -> WebView session handoff.
The server implements:
- `/auth/google?native=1&nonce=...`
- native callback minting of a 120-second single-use code
- `/auth/native/return`
- `/auth/native/complete`
- `/.well-known/assetlinks.json`

## Required deployment setting

For Play-distributed builds, set `PLAY_APP_SIGNING_SHA256` on the AQUIPLEX server to the
SHA-256 fingerprint shown in Google Play Console under App integrity -> App signing key
certificate.

The server also publishes the known upload-key fingerprint by default for locally installed
release builds. Do not use a custom `aqua://` callback.

## Android build

Build from `aqua-android/` using its Gradle wrapper. Do not replace the current Android
project with a different wrapper while testing this fix.

## Verification

The pure-Java OAuth callback suite passes:
- `AuthCallbackHarness`: 31 checks
- `tools/verify-authcallback.sh --bite`: all 7 security guards are load-bearing

A full Gradle build could not be run in this environment because the Gradle wrapper needs
to download Gradle from services.gradle.org and network access is unavailable here.

After deploying the server and installing the release Android build, verify:
`adb shell pm get-app-links com.aquiplex.aqua`
and run the manual OAuth acceptance flow described in `aqua-android/docs/OAUTH_NATIVE_HANDOFF.md`.
