#!/usr/bin/env bash
# Merges upstream BentoPDF into a new branch and prints what to review before
# shipping: dependencies, vendored binaries, new external hosts, URL params.
# Usage (clean working tree): sync-upstream.sh
set -euo pipefail
git diff --quiet && git diff --cached --quiet || { echo "commit or stash first" >&2; exit 1; }
git remote get-url upstream >/dev/null 2>&1 \
  || git remote add upstream https://github.com/alam00000/bentopdf.git
git fetch -q upstream
BASE=$(git merge-base HEAD upstream/main)
NEW=$(git rev-list --count HEAD..upstream/main)
[ "$NEW" -gt 0 ] || { echo "Already up to date with upstream."; exit 0; }

echo "== $NEW upstream commits ($(git log -1 --format=%cs "$BASE") .. $(git log -1 --format=%cs upstream/main))"
echo "== package.json dependency changes"
git diff "$BASE" upstream/main -- package.json | grep -E '^[+-] +"' || echo "   none"
echo "== vendored binaries (compare sha256 with the build that produced them)"
git diff --name-only --diff-filter=AM "$BASE" upstream/main -- vendor/ | while read -r f; do
  echo "   $(git show "upstream/main:$f" | sha256sum | cut -c1-64)  $f"
done
echo "== external hosts added in app code"
git diff "$BASE" upstream/main -- src public/*.js public/workers nginx.conf scripts \
  | grep -E '^\+' | grep -oE 'https?://[a-zA-Z0-9.-]+' | sort | uniq -c | sort -rn || echo "   none"
echo "== new URL parameters read by app code"
git diff "$BASE" upstream/main -- src | grep -E '^\+.*(searchParams|params)\.get\(' || echo "   none"

BRANCH="sync-upstream-$(date +%F)"
git checkout -q -b "$BRANCH"
git merge --no-edit upstream/main
echo
echo "Merged into $BRANCH. Next: npm ci && npm run test:run, then"
echo "  bash .github/municipal/build-local.sh   # builds and verifies the image"
