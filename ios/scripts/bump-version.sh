#!/bin/bash
# Bump MARKETING_VERSION and/or CURRENT_PROJECT_VERSION in project.yml.
#
# Usage:
#   ./scripts/bump-version.sh build          # bump build number only (1 -> 2)
#   ./scripts/bump-version.sh patch          # 0.1.0 -> 0.1.1, reset build to 1
#   ./scripts/bump-version.sh minor          # 0.1.0 -> 0.2.0, reset build to 1
#   ./scripts/bump-version.sh major          # 0.1.0 -> 1.0.0, reset build to 1
#   ./scripts/bump-version.sh set 0.5.0      # set exact version, reset build to 1
#   ./scripts/bump-version.sh set 0.5.0 3    # set exact version and build number
#
# Flags:
#   --quiet    Print only the new version string (for CI)

set -euo pipefail
cd "$(dirname "$0")/.."

QUIET=false
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--quiet" ]]; then
    QUIET=true
  else
    ARGS+=("$arg")
  fi
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

FILE="project.yml"

current_version=$(grep 'MARKETING_VERSION:' "$FILE" | head -1 | sed 's/.*"\(.*\)"/\1/')
current_build=$(grep 'CURRENT_PROJECT_VERSION:' "$FILE" | head -1 | awk '{print $2}')

[[ "$QUIET" == false ]] && echo "Current: v${current_version} (build ${current_build})"

IFS='.' read -r major minor patch <<< "$current_version"

case "${1:-build}" in
  build)
    new_version="$current_version"
    new_build=$((current_build + 1))
    ;;
  patch)
    new_version="${major}.${minor}.$((patch + 1))"
    new_build=1
    ;;
  minor)
    new_version="${major}.$((minor + 1)).0"
    new_build=1
    ;;
  major)
    new_version="$((major + 1)).0.0"
    new_build=1
    ;;
  set)
    if [[ -z "${2:-}" ]]; then
      echo "Usage: $0 set <version> [build]" >&2
      exit 1
    fi
    new_version="$2"
    new_build="${3:-1}"
    ;;
  *)
    echo "Usage: $0 {build|patch|minor|major|set <version> [build]}" >&2
    exit 1
    ;;
esac

sed_inplace() {
  if sed --version 2>/dev/null | grep -q GNU; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

sed_inplace "s/MARKETING_VERSION: \".*\"/MARKETING_VERSION: \"${new_version}\"/" "$FILE"
sed_inplace "s/CURRENT_PROJECT_VERSION: .*/CURRENT_PROJECT_VERSION: ${new_build}/" "$FILE"

# Regenerate .xcodeproj so pbxproj stays in sync with project.yml
if command -v xcodegen &> /dev/null; then
  [[ "$QUIET" == false ]] && echo "Running xcodegen..."
  xcodegen generate
else
  [[ "$QUIET" == false ]] && echo "Warning: xcodegen not found - run it manually to sync the .xcodeproj"
fi

if [[ "$QUIET" == true ]]; then
  echo "$new_version"
else
  echo "Updated: v${new_version} (build ${new_build})"
fi
