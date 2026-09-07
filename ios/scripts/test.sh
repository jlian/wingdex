#!/bin/bash
# Local and CI entry point. Never reuse or erase a developer's simulator.
set -euo pipefail
cd "$(dirname "$0")/.."

lane=${1:-all}
case "$lane" in
  core) targets=(-only-testing:WingDexTests -only-testing:WingDexUITests) ;;
  accessibility|accessibility-deep) targets=(-only-testing:WingDexAccessibilityUITests) ;;
  all) targets=(-only-testing:WingDexTests -only-testing:WingDexUITests -only-testing:WingDexAccessibilityUITests) ;;
  *) echo "Usage: ios/scripts/test.sh [all|core|accessibility|accessibility-deep] [xcodebuild test selectors...]" >&2; exit 2 ;;
esac
if [[ $# -gt 0 ]]; then shift; fi
for selector in "$@"; do
  case "$selector" in -only-testing:*) targets=(); break ;; esac
done
for selector in "$@"; do
  case "$selector" in
    -only-testing:*|-skip-testing:*) targets+=("$selector") ;;
    *) echo "Expected an -only-testing: or -skip-testing: selector: $selector" >&2; exit 2 ;;
  esac
done
command -v xcodegen >/dev/null || { echo "Install XcodeGen: brew install xcodegen" >&2; exit 1; }

started=$SECONDS
run_id=$(uuidgen)
output="build/test-results/$lane-$run_id"
mkdir -p "$output"
simulator=""
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n "$simulator" ]]; then
    xcrun simctl shutdown "$simulator" >> "$output/simulator.log" 2>&1 || true
    if ! xcrun simctl delete "$simulator" >> "$output/simulator.log" 2>&1; then
      echo "Could not delete test simulator $simulator; see ios/$output/simulator.log" >&2
      if [[ "$status" == 0 ]]; then status=1; fi
    fi
  fi
  if [[ -f "$output/generate.log" ]]; then
    # Restore the normal resource graph for the next direct Xcode Run/Archive.
    if ! WINGDEX_SKIP_APP_ICON=0 xcodegen generate >> "$output/generate.log" 2>&1; then
      echo "Could not restore the Xcode project; see ios/$output/generate.log" >&2
      if [[ "$status" == 0 ]]; then status=1; fi
    fi
  fi
  echo "Total: $((SECONDS - started))s; exit: $status; diagnostics: ios/$output" | tee -a "$output/timing.txt"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then cat "$output/timing.txt" >> "$GITHUB_STEP_SUMMARY"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

xcodebuild -version | tee "$output/toolchain.log"
xcrun --find lldb >> "$output/toolchain.log"
sysctl hw.memsize hw.ncpu >> "$output/toolchain.log"
WINGDEX_SKIP_APP_ICON=1 xcodegen generate 2>&1 | tee "$output/generate.log"
common=(-project WingDex.xcodeproj -scheme WingDex
  -derivedDataPath build/DerivedData
  -parallel-testing-enabled NO
  CODE_SIGNING_ALLOWED=NO)
architecture=$(uname -m)
sdk_version=$(xcrun --sdk iphonesimulator --show-sdk-version)
test_run="build/DerivedData/Build/Products/WingDex_iphonesimulator${sdk_version}-${architecture}.xctestrun"
phase=$SECONDS
# Build before booting: overlapping the two caused severe disk/memory
# contention on GitHub's 7 GB macOS VMs, even with a restored build cache.
# A generic destination still builds the same host-architecture test products.
NSUnbufferedIO=YES xcodebuild build-for-testing "${common[@]}" "${targets[@]}" \
  -destination "generic/platform=iOS Simulator" ARCHS="$architecture" \
  -onlyUsePackageVersionsFromResolvedFile -skipPackagePluginValidation \
  ASSETCATALOG_COMPILER_APPICON_NAME="" ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS=NO \
  2>&1 | tee "$output/build.log"
echo "Build: $((SECONDS - phase))s" | tee -a "$output/timing.txt"
if [[ ! -f "$test_run" ]]; then
  echo "Build did not produce the expected test manifest: ios/$test_run" >&2
  exit 1
fi
phase=$SECONDS
# Select an installed iPhone runtime, not a user's existing device.
runtime=$(xcrun simctl list runtimes -j | python3 -c '
import json, sys
r = [r for r in json.load(sys.stdin)["runtimes"]
     if r["isAvailable"] and ".iOS-" in r["identifier"] and int(r["version"].split(".")[0]) >= 26]
if not r: sys.exit("Install an iOS 26+ simulator runtime in Xcode Settings > Components")
print(max(r, key=lambda r: tuple(map(int, r["version"].split("."))))["identifier"])
')
device_type=${IOS_TEST_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro}
simulator=$(xcrun simctl create "WingDex tests $run_id" "$device_type" "$runtime")
echo "Simulator: $simulator ($runtime)" | tee "$output/simulator.log"
xcrun simctl boot "$simulator" >> "$output/simulator.log" 2>&1
xcrun simctl bootstatus "$simulator" -b 2>&1 | tee -a "$output/simulator.log"
echo "Simulator setup: $((SECONDS - phase))s" | tee -a "$output/timing.txt"
xcrun simctl ui "$simulator" appearance light

phase=$SECONDS
set +e
# Use the compiled manifest, not another project/package-resolution pass.
NSUnbufferedIO=YES TEST_RUNNER_WINGDEX_DEEP_AUDITS="$([[ "$lane" == accessibility-deep ]] && echo 1 || echo 0)" \
  xcodebuild test-without-building -xctestrun "$test_run" "${targets[@]}" \
  -parallel-testing-enabled NO \
  -destination "platform=iOS Simulator,id=$simulator" \
  -test-timeouts-enabled YES -default-test-execution-time-allowance 120 \
  -maximum-test-execution-time-allowance 180 \
  -collect-test-diagnostics never \
  -resultBundlePath "$output/Tests.xcresult" 2>&1 | tee "$output/tests.log"
status=${PIPESTATUS[0]}
set -e
echo "Tests: $((SECONDS - phase))s" | tee -a "$output/timing.txt"
if [[ -d "$output/Tests.xcresult" ]]; then
  xcrun xcresulttool get test-results summary --path "$output/Tests.xcresult" --compact \
    | tee "$output/summary.json"
fi
exit "$status"
