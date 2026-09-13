#!/bin/bash
set -e

TYPE="${1:-patch}"

if [[ ! "$TYPE" =~ ^(major|minor|patch)$ ]]; then
  echo "Usage: $0 [major|minor|patch]"
  exit 1
fi

# The git tag is the source of truth for what's actually been released —
# package.json has drifted from it before (workspace packages were never
# bumped at all, and the root one lagged behind for a few releases), so
# don't trust it blindly.
LATEST_TAG=$(git tag --list 'v*' --sort=-v:refname | head -1)
if [ -n "$LATEST_TAG" ]; then
  CURRENT="${LATEST_TAG#v}"
else
  CURRENT=$(node -p "require('./package.json').version")
fi
echo "Current version: $CURRENT"

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
case "$TYPE" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac
NEW_VERSION="$MAJOR.$MINOR.$PATCH"

# Set the exact version (not a relative bump) across root + every workspace,
# so they all land on the same NEW_VERSION regardless of what each was
# previously stuck at. Goes through real npm tooling so each workspace's own
# package-lock.json (server/ and web/ each have their own, this repo doesn't
# use a single hoisted lockfile) is updated in sync rather than hand-edited.
npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version --workspaces --include-workspace-root >/dev/null

git add package.json package-lock.json server/package.json server/package-lock.json web/package.json web/package-lock.json
git commit -m "🔖 Bump version to $NEW_VERSION"
git tag "v$NEW_VERSION"

echo "Version $NEW_VERSION ready."
echo "Run 'git push && git push --tags' to publish."
