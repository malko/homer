#!/bin/bash
set -e

TYPE="${1:-patch}"

CURRENT=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT"

if [[ ! "$TYPE" =~ ^(major|minor|patch)$ ]]; then
  echo "Usage: $0 [major|minor|patch]"
  exit 1
fi

NEW_VERSION=$(npm version "$TYPE" --no-git-tag-version 2>/dev/null | grep -oP '\d+\.\d+\.\d+')

git add package.json
git commit -m "🔖 Bump version to $NEW_VERSION"
git tag "v$NEW_VERSION"

echo "Version $NEW_VERSION ready."
echo "Run 'git push && git push --tags' to publish."
