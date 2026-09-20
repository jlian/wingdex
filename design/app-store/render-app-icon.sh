#!/bin/bash
set -euo pipefail

directory="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$directory/../.." && pwd)"
work="$directory/.generated/app-icon"
bundle="$work/RenderAppIcon.app"
mkdir -p "$work/Assets.xcassets" "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
for name in IconBody IconLowerWing IconUpperWing IconEye; do
  cp -R "$root/ios/WingDex/Assets.xcassets/$name.imageset" "$work/Assets.xcassets/"
done
xcrun actool "$work/Assets.xcassets" --compile "$bundle/Contents/Resources" \
  --platform macosx --minimum-deployment-target 14.0
xcrun swiftc -parse-as-library -O \
  "$root/ios/WingDex/Views/AppIconView.swift" "$directory/render-app-icon.swift" \
  -o "$bundle/Contents/MacOS/RenderAppIcon"
"$bundle/Contents/MacOS/RenderAppIcon" "$directory/app-icon.png"
