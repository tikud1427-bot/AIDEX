#!/usr/bin/env bash
# Compiles and runs the AuthCallback executable spec with a plain JDK.
# No Android SDK, no Gradle, no network.
#
#   tools/verify-authcallback.sh          run the suite
#   tools/verify-authcallback.sh --bite   additionally prove each guard is load-bearing
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/app/src/main/java/com/aquiplex/aqua/AuthCallback.java"
HARNESS="$ROOT/app/src/harness/java/com/aquiplex/aqua/AuthCallbackHarness.java"

run_suite() {
  local src_dir="$1" out
  out="$(mktemp -d)"
  javac -nowarn -d "$out" "$src_dir/AuthCallback.java" "$HARNESS" 2>&1
  java -cp "$out" com.aquiplex.aqua.AuthCallbackHarness
}

if [[ "${1:-}" != "--bite" ]]; then
  work="$(mktemp -d)"; cp "$SRC" "$work/"
  run_suite "$work"
  exit $?
fi

# ---- bite mode -------------------------------------------------------------
# Delete one guard at a time; the suite MUST go red. A guard whose removal keeps
# the suite green is untested (blueprint L16).
echo "== baseline =="
work="$(mktemp -d)"; cp "$SRC" "$work/"
run_suite "$work" >/dev/null || { echo "BASELINE ALREADY RED"; exit 1; }
echo "   baseline green"
echo

# name -> needle -> replacement. Most guards are neutered by making the condition
# unreachable; the auth-start classifier is neutered by making it always false.
declare -A NEEDLE=(
  [host]='if (!HOST.equalsIgnoreCase(uri.getHost())) {'
  [scheme]='if (!"https".equalsIgnoreCase(uri.getScheme())) {'
  [path]='if (!RETURN_PATH.equals(uri.getPath())) {'
  [port]='if (uri.getPort() != -1 && uri.getPort() != 443) {'
  [userinfo]='if (uri.getUserInfo() != null) {'
  [nonce]='if (!nonceMatches(expectedNonce, param(uri.getRawQuery(), "nonce"))) {'
  [start]='return path != null && path.startsWith(START_PREFIX);'
)
declare -A REPLACEMENT=(
  [host]='if (false) {'
  [scheme]='if (false) {'
  [path]='if (false) {'
  [port]='if (false) {'
  [userinfo]='if (false) {'
  [nonce]='if (false) {'
  [start]='return path != null;'
)

fail=0
for name in "${!NEEDLE[@]}"; do
  work="$(mktemp -d)"
  python3 - "$SRC" "$work/AuthCallback.java" "${NEEDLE[$name]}" "${REPLACEMENT[$name]}" <<'PY'
import sys
src, dst, needle, repl = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
text = open(src).read()
assert needle in text, "guard not found: " + needle
open(dst, "w").write(text.replace(needle, repl))
PY
  if run_suite "$work" >/dev/null 2>&1; then
    echo "   NO BITE  removing '$name' guard left the suite green"
    fail=1
  else
    echo "   bites    $name"
  fi
done

echo
[[ $fail -eq 0 ]] && echo "PASS  every guard is load-bearing" || echo "FAIL  untested guard(s)"
exit $fail
