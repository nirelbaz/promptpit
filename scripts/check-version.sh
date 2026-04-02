#!/usr/bin/env bash
# Validates version/changelog consistency on PRs.
# Fails if package.json version changed but CHANGELOG.md has no matching entry,
# or if CHANGELOG.md has an entry not matching the current package.json version.
set -euo pipefail

BASE_REF="${1:-origin/main}"

# Ensure base ref exists (handles first PR or shallow clone)
if ! git rev-parse "$BASE_REF" >/dev/null 2>&1; then
  echo "Base ref $BASE_REF not found — skipping version check"
  exit 0
fi

CURRENT_VERSION=$(node -p "require('./package.json').version")
BASE_VERSION=$(git show "$BASE_REF:package.json" 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version" 2>/dev/null || echo "")

if [ -z "$BASE_VERSION" ]; then
  echo "Could not read base version — skipping version check"
  exit 0
fi

if [ "$CURRENT_VERSION" = "$BASE_VERSION" ]; then
  echo "Version unchanged ($CURRENT_VERSION) — no check needed"
  exit 0
fi

# Version changed — CHANGELOG must have an entry
if ! grep -q "^## $CURRENT_VERSION" CHANGELOG.md 2>/dev/null; then
  echo "::error::Version bumped to $CURRENT_VERSION but CHANGELOG.md has no '## $CURRENT_VERSION' entry"
  exit 1
fi

echo "Version $CURRENT_VERSION has matching CHANGELOG entry"
