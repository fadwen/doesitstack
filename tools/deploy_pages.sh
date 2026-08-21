#!/usr/bin/env bash
# Publish dist/ to the gh-pages branch as a single orphan commit, so the
# generated 30-odd MB of spell data never accumulates in the repo's history.
#
#   tools/deploy_pages.sh [remote]
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE="${1:-origin}"

# Refresh the item database first. A failure here is not fatal: the build falls
# back to whatever vendor/items.txt is already on disk, or to no item tags at all.
node tools/fetch_items.mjs || echo "item fetch failed - building with the item data already on disk" >&2

node tools/build.mjs --out dist
touch dist/.nojekyll                      # GitHub Pages would otherwise skip data/

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp -r dist/. "$WORK/"
git -C "$WORK" init -q -b gh-pages
git -C "$WORK" add -A
git -C "$WORK" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
    commit -qm "Build $(date -u +%Y-%m-%d) from spells_us.txt"
git -C "$WORK" push -qf "$(git remote get-url "$REMOTE")" gh-pages
echo "pushed dist/ to $REMOTE gh-pages"
