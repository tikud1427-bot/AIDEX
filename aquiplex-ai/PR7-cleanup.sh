#!/usr/bin/env bash
#
# AQUIPLEX — E1/PR-7 repository cleanup
#
# WHY A SCRIPT AND NOT A TARBALL
# ------------------------------
# Every other PR in this epic shipped as an archive, because an archive can add
# and replace files. This PR REMOVES them, and an archive cannot do that. So the
# deletion is a script, and the thing that keeps it done is a test.
#
# WHY IT RE-VERIFIES INSTEAD OF TRUSTING THE LIST
# -----------------------------------------------
# The list below was derived from one snapshot of the repository. A snapshot is
# not the repository. Before removing anything, this script re-runs the
# reference check itself and REFUSES to delete a file that something imports —
# on the machine where the deletion actually happens, not on the machine where
# the list was written.
#
# That matters because two of the deletion candidates in the original audit
# turned out to be wrong:
#
#   evaluation/                       AQEval — a deliberate benchmark framework,
#                                     not cruft. KEPT.
#   aqua/src/files/evidenceValidator  audited as "dead code"; a test imports it.
#                                     KEPT.
#
# USAGE — from anywhere in the repo:
#   bash PR7-cleanup.sh --dry-run     # list what would go, change nothing
#   bash PR7-cleanup.sh               # verify, then delete
#
set -euo pipefail

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
ok()   { printf '%s✓%s %s\n' "$GRN" "$OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$YLW" "$OFF" "$*"; }
die()  { printf '%s✗%s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# ── Locate the repo root (the directory that CONTAINS aqua/) ────────────────
find_root() {
  local d; d=$(pwd -P)
  for _ in 1 2 3 4 5 6; do
    if [ -f "$d/aqua/package.json" ] && grep -q '"name": *"aqua-ai"' "$d/aqua/package.json" 2>/dev/null; then
      printf '%s' "$d"; return 0
    fi
    [ "$d" = "/" ] && break
    d=$(dirname "$d")
  done
  return 1
}
ROOT=$(find_root) || die "Could not find the repo root (a directory containing aqua/package.json)."
cd "$ROOT"
printf '%srepo    : %s%s\n' "$DIM" "$ROOT" "$OFF"

# ── What goes ───────────────────────────────────────────────────────────────

# Modules and their orphaned tests. Each is checked for references first.
CODE=(
  "src"                               # drifted duplicate provider tree + 1,363-line fossil chat.js
  "callGraph.js"
  "callGraph.test.js"
  "contextCompressor.js"
  "contextCompressor.test.js"
  "projectRetriever (1).js"           # DRIFTED from aqua/src/project (468 vs 491 lines)
  "projectRetriever.callgraph.test.js"
  "projectRetriever.digest.test.js"
  "symbolGraph (1).js"
  "symbolGraph.test.js"
  "symbolGraph.events-jobs.test.js"
  "apply.sh"                          # superseded by apply-pr.sh
  "how HEAD~1:package.json"           # a shell redirect that became a filename
)

# Build residue. No reference check — these are not modules.
GLOBS=(
  "*.diff"
  "*.patch"
  "*.tar.gz"
  ".fuse_hidden*"
  "*.migrated-to-datadir"
  ".*.migrated-to-datadir"   # the real ones are DOTFILES; a bare * never matches them
)

# ── Reference check — the safety gate ───────────────────────────────────────
#
# Searches the whole repo except node_modules, the aqua engine (which has its
# own copies and must never point at these), and the item itself.
referenced() {
  local item="$1" base stem pattern
  base=$(basename "$item")
  if [ "$item" = "src" ]; then
    pattern="require(['\"]\\./src/|from ['\"]\\./src/"
  else
    stem="${base%.js}"
    pattern="require\\(['\"]\\./${stem}(\\.js)?['\"]|from ['\"]\\./${stem}(\\.js)?['\"]"
  fi
  grep -rIlE --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=evaluation \
       --include='*.js' --include='*.mjs' --include='*.cjs' --include='*.ejs' --include='*.json' \
       "$pattern" . 2>/dev/null \
    | grep -v "^\./aqua/" | grep -v "^\./${base}$" | while read -r f; do
        # A file that is ITSELF scheduled for deletion is not a live reference.
        # These modules form a self-referential dead cluster: the only thing
        # importing callGraph.js is symbolGraph (1).js, which is also going.
        # Counting that as "still in use" would keep the whole cluster forever.
        local rel="${f#./}" doomed=0
        for c in "${CODE[@]}"; do [ "$rel" = "$c" ] && doomed=1 && break; done
        [ "$doomed" = 0 ] && echo "$f"
      done | grep -q . && return 0 || return 1
}

removed=0; kept=0; skipped=0

echo
echo "── modules and orphaned tests ──"
for item in "${CODE[@]}"; do
  if [ ! -e "$item" ]; then printf '  %s· already gone   %s%s\n' "$DIM" "$item" "$OFF"; skipped=$((skipped+1)); continue; fi
  if referenced "$item"; then
    warn "KEEPING $item — something still imports it"
    kept=$((kept+1)); continue
  fi
  if [ "$DRY" = 1 ]; then printf '  would remove   %s\n' "$item"
  else rm -rf -- "$item"; printf '  removed        %s\n' "$item"; fi
  removed=$((removed+1))
done

echo
echo "── build residue ──"
for g in "${GLOBS[@]}"; do
  # shellcheck disable=SC2231
  for f in $g; do
    [ -e "$f" ] || continue
    if [ "$DRY" = 1 ]; then printf '  would remove   %s\n' "$f"
    else rm -rf -- "$f"; printf '  removed        %s\n' "$f"; fi
    removed=$((removed+1))
  done
done

# ── Kept on purpose ─────────────────────────────────────────────────────────
echo
echo "── kept on purpose ──"
printf '  %-34s %s\n' "evaluation/"                         "AQEval — a deliberate benchmark framework, and E2's likely starting point"
printf '  %-34s %s\n' "blogs.js"                            "required by index.js"
printf '  %-34s %s\n' "aqua/src/files/evidenceValidator.js" "audited as dead; a test imports it"
printf '  %-34s %s\n' "apply-pr.sh"                         "the current apply script"
printf '  %-34s %s\n' "*.md"                                "architecture and phase records"

echo
if [ "$DRY" = 1 ]; then ok "dry run — $removed item(s) would be removed, $kept kept, $skipped already gone"
else ok "removed $removed item(s), kept $kept, $skipped already gone"; fi
[ "$kept" -gt 0 ] && warn "Items were kept because they are still referenced. Investigate before re-running."
exit 0
