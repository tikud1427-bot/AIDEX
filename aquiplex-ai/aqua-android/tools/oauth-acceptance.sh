#!/usr/bin/env bash
# Acceptance harness for the Google OAuth return hop, run against a real device or
# emulator with the RELEASE build installed (not debug — App Link verification depends
# on the signing certificate, so a debug build proves nothing about production).
#
#   tools/oauth-acceptance.sh gate      App Link verification + injection checks (automated)
#   tools/oauth-acceptance.sh watch     stream [AUTH] diagnostics while you drive the flow
#   tools/oauth-acceptance.sh manual    print the manual acceptance checklist
#
# Why the happy path is manual: Google's consent screen cannot be automated, and the
# return hop is bound to a per-flow nonce the app generates and never logs. Synthesising
# a "successful" return from the shell would only prove the nonce check works — which the
# unit spec already proves. What must be exercised by hand is the real browser round trip.
set -euo pipefail

PKG="com.aquiplex.aqua"
HOST="aquiplex.com"
RETURN="https://$HOST/auth/native/return"

require_device() {
  adb get-state >/dev/null 2>&1 || { echo "no device: start an emulator or plug in a phone"; exit 1; }
  adb shell pm list packages | grep -q "$PKG" || { echo "$PKG not installed"; exit 1; }
}

fire() { adb shell am start -a android.intent.action.VIEW -d "$1" "$PKG" >/dev/null 2>&1 || true; }

case "${1:-gate}" in

gate)
  require_device
  fail=0

  echo "== App Link verification =="
  # Without this, Android silently leaves the callback with Chrome and the bug is unchanged.
  out="$(adb shell pm get-app-links "$PKG" 2>/dev/null || true)"
  echo "$out"
  if echo "$out" | grep -qi "$HOST: *verified"; then
    echo "   ok   $HOST is verified"
  else
    echo "   FAIL $HOST is NOT verified -- check /.well-known/assetlinks.json"
    echo "        remember the Play App Signing SHA-256, not just the upload key"
    fail=1
  fi

  echo
  echo "== hostile intent injection =="
  # MainActivity is an exported launcher activity: any installed app can fire ACTION_VIEW
  # at it. Each of these must be refused and must not navigate the WebView.
  adb logcat -c
  fire "$RETURN?code=attacker&nonce=attacker"
  fire "https://evil.example/auth/native/return?code=attacker&nonce=attacker"
  fire "http://$HOST/auth/native/return?code=attacker&nonce=attacker"
  fire "https://$HOST/anything?code=attacker&nonce=attacker"
  sleep 2
  rejected="$(adb logcat -d -s AquaMainActivity | grep -c 'Callback rejected' || true)"
  accepted="$(adb logcat -d -s AquaMainActivity | grep -c 'session exchange started' || true)"
  echo "   rejected=$rejected  accepted=$accepted"
  if [[ "$accepted" -eq 0 && "$rejected" -ge 1 ]]; then
    echo "   ok   injected callbacks refused"
  else
    echo "   FAIL an injected callback was accepted -- login-CSRF is open"
    fail=1
  fi

  echo
  echo "== single instance =="
  # Test 3/4 depend on launchMode=singleTask: a second MainActivity would reload
  # AQUA_URL and drop the callback.
  count="$(adb shell dumpsys activity activities | grep -c "$PKG/.MainActivity" || true)"
  echo "   MainActivity records: $count"
  [[ "$count" -le 2 ]] && echo "   ok   no duplicate task" || { echo "   FAIL duplicate instance"; fail=1; }

  echo
  [[ $fail -eq 0 ]] && echo "PASS  gate checks" || echo "FAIL  gate checks"
  exit $fail
  ;;

watch)
  require_device
  adb logcat -c
  echo "streaming [AUTH] diagnostics -- drive the flow on the device, Ctrl-C to stop"
  adb logcat -s AquaMainActivity | grep --line-buffered '\[AUTH\]'
  ;;

manual)
  cat <<'CHECKLIST'
Run each against the RELEASE build. Keep `tools/oauth-acceptance.sh watch` running in
another terminal. Expected diagnostic sequence for a successful sign-in:

    [AUTH] Google OAuth started (external browser)
    [AUTH] Redirect URI = https://aquiplex.com/auth/native/return
    [AUTH] OAuth callback received action=... host=aquiplex.com path=/auth/native/return hasCode=true error=none
    [AUTH] Authorization result received; session exchange started

Acceptance condition throughout: the AQUA APP shows the signed-in user. Chrome showing
a signed-in Aqua proves nothing — that was the original bug.

T1  New Google user
    Fresh install, no account. Continue with Google -> new Google account -> authenticate.
    PASS: returns to Aqua, Aqua is authenticated, account created once.

T2  Existing Google user
    Repeat with an account that already has Aqua.
    PASS: returns authenticated as that account, no duplicate created.

T3  App already running (foreground)
    App open -> Continue with Google -> complete in Chrome.
    PASS: authenticated, and `adb shell dumpsys activity activities | grep MainActivity`
    shows one instance. A second instance means singleTask regressed.

T4  App backgrounded / process killed
    Start the flow, then while in Chrome:
      adb shell am force-stop com.aquiplex.aqua
    Complete authentication in Chrome.
    PASS: Aqua cold-starts straight into the authenticated state. This exercises the
    onCreate(getIntent()) path and the nonce surviving in SharedPreferences.

T5  Logout then log in again
    Authenticated -> log out in Aqua -> Continue with Google.
    PASS: authenticated again. If it silently returns the OLD account without a chooser,
    Chrome still holds a session: the server needs prompt=select_account on the native leg.

T6  Cancelled / invalid
    a) Start the flow, press Back / Cancel on Google's consent screen.
       PASS: Aqua stays logged out, shows the cancellation state, no session cookie.
    b) Run `tools/oauth-acceptance.sh gate` for the injection cases.
       PASS: every injected callback logged as rejected.
CHECKLIST
  ;;

*) echo "usage: $0 {gate|watch|manual}"; exit 2 ;;
esac
