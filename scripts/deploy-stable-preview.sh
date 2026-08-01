#!/usr/bin/env bash
# Build and force-push dist to gh-pages for the permanent GitHub Pages URL.
# https://lutherfergus.github.io/enamel-pin/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Building with GitHub Pages base path..."
GITHUB_PAGES=1 npm run build

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

cp -a dist/. "$WORK/"
cp "$WORK/index.html" "$WORK/404.html"
touch "$WORK/.nojekyll"

cd "$WORK"
git init -q
git checkout -b gh-pages
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-Cursor Agent}" \
  -c user.email="${GIT_AUTHOR_EMAIL:-cursoragent@cursor.com}" \
  commit -q -m "Deploy stable preview $(date -u +%Y-%m-%dT%H:%MZ)"
git remote add origin "$(cd "$ROOT" && git remote get-url origin)"
git push -f origin gh-pages

echo ""
echo "Published to gh-pages."
echo "Stable URL:"
echo "  https://lutherfergus.github.io/enamel-pin/"
