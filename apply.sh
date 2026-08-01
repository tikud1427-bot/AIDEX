#!/usr/bin/env bash
# Self-locating overlay — run from anywhere inside the repo.
# The last archive was extracted one level too deep and produced aqua/aqua/,
# so this finds the root itself instead of trusting the working directory.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$PWD"
while [ "$root" != "/" ] && [ ! -f "$root/aqua/router.js" ]; do root="$(dirname "$root")"; done
if [ ! -f "$root/aqua/router.js" ]; then
  echo "apply.sh: could not find the repo root (looking for aqua/router.js)" >&2; exit 1
fi
echo "repo root: $root"
cp -R "$here/aqua" "$root/"
[ -d "$here/aqua-frontend" ] && cp -R "$here/aqua-frontend" "$root/"
echo "applied. now:  cd $root/aqua && npm test"
