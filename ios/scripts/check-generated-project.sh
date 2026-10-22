#!/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
XCODEGEN_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/wingdex/xcodegen-2.46.0"
XCODEGEN="$XCODEGEN_ROOT/install/bin/xcodegen"

generated_paths=(
  ios/WingDex.xcodeproj/project.pbxproj
  ios/WingDex.xcodeproj/project.xcworkspace/contents.xcworkspacedata
  ios/WingDex.xcodeproj/xcshareddata/xcschemes/WingDex.xcscheme
)

snapshot() {
  local path
  for path in "${generated_paths[@]}"; do
    if [[ -f "$ROOT/$path" ]]; then
      printf '%s  %s\n' "$(shasum -a 256 "$ROOT/$path" | cut -d ' ' -f 1)" "$path"
    else
      printf 'missing  %s\n' "$path"
    fi
  done
}

before="$(snapshot)"

if [[ ! -x "$XCODEGEN" ]]; then
  "$ROOT/ios/scripts/install-xcodegen.sh"
fi

(
  cd "$ROOT/ios"
  "$XCODEGEN" generate
)

after="$(snapshot)"

if [[ "$before" != "$after" ]]; then
  echo "Generated Xcode project metadata is out of sync with ios/project.yml:" >&2
  diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") >&2 || true
  git -C "$ROOT" --no-pager diff -- "${generated_paths[@]}" >&2
  exit 1
fi

project_pins="$ROOT/ios/WingDex.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"
workspace_pins="$ROOT/ios/WingDex.xcworkspace/xcshareddata/swiftpm/Package.resolved"
if ! cmp -s "$project_pins" "$workspace_pins"; then
  echo "Project and standalone workspace Package.resolved files must stay in sync." >&2
  diff -u "$project_pins" "$workspace_pins" >&2 || true
  exit 1
fi
