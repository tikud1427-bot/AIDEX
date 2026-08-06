#!/usr/bin/env bash
#
# AQUA — apply a blueprint PR tarball, from anywhere.
#
# WHY THIS EXISTS
# ---------------
# The PR tarballs are rooted at `aqua/`, so `tar xzf …` only lands correctly
# when run from the directory that CONTAINS aqua/. Run it from inside aqua/ —
# which is where you normally are — and tar happily creates `aqua/aqua/…`,
# touches nothing real, and reports success. Tests keep passing, `npm audit`
# keeps showing the old advisories, and nothing tells you the PR did not apply.
#
# That silent failure has now cost two rounds. This script removes the choice:
# it finds the package root itself, refuses to guess, and verifies afterwards.
#
# USAGE — from anywhere in the repo:
#   bash apply-pr.sh ~/Downloads/PR2-xlsx-swap.tar.gz
#   bash apply-pr.sh ~/Downloads/PR3-zip-guard.tar.gz
#
#   bash apply-pr.sh --check          # report current state, change nothing
#
set -euo pipefail

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GRN" "$OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$YLW" "$OFF" "$*"; }
die()  { printf '%s✗%s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }

# ── Locate the aqua package, whatever directory we were invoked from ─────────
find_pkg() {
  local d; d=$(pwd -P)
  for _ in 1 2 3 4 5 6; do
    if [ -f "$d/package.json" ] && grep -q '"name": *"aqua-ai"' "$d/package.json" 2>/dev/null; then
      printf '%s' "$d"; return 0
    fi
    if [ -f "$d/aqua/package.json" ] && grep -q '"name": *"aqua-ai"' "$d/aqua/package.json" 2>/dev/null; then
      printf '%s' "$d/aqua"; return 0
    fi
    [ "$d" = "/" ] && break
    d=$(dirname "$d")
  done
  return 1
}

PKG=$(find_pkg) || die "Could not find the aqua package (no package.json with \"name\": \"aqua-ai\" at or above $(pwd)). Run this from inside the repo."
ROOT=$(dirname "$PKG")   # the directory that CONTAINS aqua/ — the tarball root
say "${DIM}package : $PKG${OFF}"
say "${DIM}extract : $ROOT${OFF}"

# ── Warn about the damage the old instruction may already have done ──────────
if [ -d "$PKG/aqua" ]; then
  warn "Found $PKG/aqua — that is the nested directory a mis-run tar created."
  warn "It is inert, but delete it to avoid confusion:  rm -rf '$PKG/aqua'"
fi

report_state() {
  say ""
  say "── current state ──"
  local deps; deps=$(grep -E '"(xlsx|@e965/xlsx|adm-zip)":' "$PKG/package.json" | tr -d ' ",' || true)
  printf '%s\n' "$deps" | sed 's/^/  /'
  for marker in \
      "PR-1  AQUA_PARSER_BASELINE.md" \
      "PR-2  src/core/tests/dependencySafety.test.js" \
      "PR-3  src/upload/zipGuard.js" \
      "PR-4  src/upload/boundedParse.js" \
      "PR-5  src/core/untrustedContent.js" \
      "PR-6  ../middleware/csrf.js" \
      "PR-7  ../tests/platform/repoHygiene.test.js"; do
    local pr file; pr=${marker%%  *}; file=${marker##*  }
    # A leading ../ means the marker lives in the PLATFORM tree, not the engine.
    if [ -e "$PKG/$file" ]; then ok "$pr applied   ($file)"; else warn "$pr NOT applied ($file missing)"; fi
  done
}

if [ "${1:-}" = "--check" ]; then report_state; exit 0; fi

TARBALL="${1:-}"
[ -n "$TARBALL" ] || die "Usage: bash apply-pr.sh <path-to-PR-tarball.tar.gz>   (or --check)"
[ -f "$TARBALL" ] || die "No such file: $TARBALL"

# ── Sanity-check the tarball is rooted where we think ────────────────────────
# Listed ONCE into a variable. `tar tzf … | grep -q` looks obvious and is a
# trap: grep exits on first match, tar takes SIGPIPE, and `set -o pipefail`
# turns that into a false condition. That exact mistake made the first version
# of this script skip `npm ci` and then fail to boot.
LISTING=$(tar tzf "$TARBALL")
# Engine PRs are rooted at `aqua/`; platform PRs (E1/PR-6 onward) carry
# top-level paths like index.js and views/. Both extract into $ROOT, so the
# only thing worth refusing is a path that escapes it.
case "$LISTING" in
  *../*) die "Refusing a tarball containing a '..' path." ;;
esac
case "$LISTING" in
  aqua/*) TARGET="engine" ;;
  *)      TARGET="platform" ;;
esac
say "${DIM}target  : $TARGET${OFF}"

say ""
say "── applying $(basename "$TARBALL") ──"
printf '%s\n' "$LISTING" | sed 's/^/  /'
tar xzf "$TARBALL" -C "$ROOT"
ok "extracted into $ROOT"

# ── Install only when the manifest actually moved ────────────────────────────
# Engine PRs are verified from the aqua package; platform PRs from the repo
# root, where their own suites live.
if [ "$TARGET" = platform ]; then cd "$ROOT"; else cd "$PKG"; fi
if [[ "$LISTING" == *package.json* || "$LISTING" == *package-lock.json* ]]; then
  say ""
  say "── this PR changes dependencies — running npm ci ──"
  npm ci --no-audit --no-fund
  ok "dependencies installed"
fi

# ── Verify ───────────────────────────────────────────────────────────────────
say ""
say "── verifying ──"
if [ "$TARGET" = platform ]; then
  node --check index.js && ok "index.js parses" || die "index.js has a syntax error"
else
  node -e "import('./router.js').then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)})" \
    && ok "router boots" || die "router failed to boot"
fi

if [ "$TARGET" = platform ]; then
  npm run test:platform 2>&1 | grep -E '^# (tests|suites|pass|fail)' | sed 's/^/  platform  /'
  npm run test:account  2>&1 | grep -E '^# (tests|suites|pass|fail)' | sed 's/^/  account   /'
else
  npm test 2>&1 | tail -40 | grep -E '^# (tests|suites|pass|fail)' | sed 's/^/  /'
fi
say ""
npm audit 2>&1 | grep -E 'severity vulnerabilit|found 0 vulnerabilities' | sed 's/^/  /' || true

report_state
say ""
ok "done"
