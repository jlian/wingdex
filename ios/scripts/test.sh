#!/bin/bash
# Local and CI entry point. Local mode reuses one dedicated simulator; CI owns
# a fresh simulator for each run.
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
command -v python3 >/dev/null || { echo "Install Python 3" >&2; exit 1; }

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  mode=ci
else
  mode=local
fi

scheme=${SCHEME:-WingDex}
destination_override=${DESTINATION:-}
derived_data_path=${DERIVED_DATA_PATH:-}
if [[ ${XCODEBUILD_ARGS+x} ]]; then
  xcodebuild_args_text=$XCODEBUILD_ARGS
else
  xcodebuild_args_text=CODE_SIGNING_ALLOWED=NO
fi
read -r -a xcodebuild_args <<< "$xcodebuild_args_text"

latest_runtime() {
  xcrun simctl list runtimes -j | python3 -c '
import json
import sys

runtimes = [
    runtime for runtime in json.load(sys.stdin)["runtimes"]
    if runtime["isAvailable"]
    and runtime["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")
    and int(runtime["version"].split(".")[0]) >= 26
]
if not runtimes:
    raise SystemExit(
        "Install an iOS 26+ simulator runtime in Xcode Settings > Components"
    )
print(max(runtimes, key=lambda runtime: tuple(map(int, runtime["version"].split("."))))["identifier"])
'
}

find_local_simulator() {
  local name="$1"
  local device_type="$2"
  xcrun simctl list devices -j | python3 -c '
import json
import sys

name, device_type = sys.argv[1:]
devices = json.load(sys.stdin)["devices"]
candidates = []
for runtime_id, runtime_devices in devices.items():
    if not runtime_id.startswith("com.apple.CoreSimulator.SimRuntime.iOS-"):
        continue
    version = tuple(
        int(part) for part in runtime_id.split("iOS-", 1)[1].split("-")
    )
    if not version or version[0] < 26:
        continue
    for device in runtime_devices:
        if (
            device.get("name") == name
            and device.get("deviceTypeIdentifier") == device_type
            and device.get("isAvailable", True)
        ):
            candidates.append((version, device["udid"]))
if candidates:
    print(max(candidates)[1])
' "$name" "$device_type"
}

started=$SECONDS
run_id=$(uuidgen)
output="build/test-results/$lane-$run_id"
mkdir -p "$output"
simulator=""
created_simulator=0
generation_attempted=0
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ "$mode" == ci && "$created_simulator" == 1 && -n "$simulator" ]]; then
    xcrun simctl shutdown "$simulator" >> "$output/simulator.log" 2>&1 || true
    if ! xcrun simctl delete "$simulator" >> "$output/simulator.log" 2>&1; then
      echo "Could not delete test simulator $simulator; see ios/$output/simulator.log" >&2
      if [[ "$status" == 0 ]]; then status=1; fi
    fi
  fi
  if [[ "$mode" == ci && "$generation_attempted" == 1 ]]; then
    # Restore the normal resource graph for the next direct Xcode Run/Archive.
    if ! WINGDEX_SKIP_APP_ICON=0 xcodegen generate >> "$output/generate.log" 2>&1; then
      echo "Could not restore the Xcode project; see ios/$output/generate.log" >&2
      if [[ "$status" == 0 ]]; then status=1; fi
    fi
  fi
  echo "Mode: $mode; total: $((SECONDS - started))s; exit: $status; diagnostics: ios/$output" \
    | tee -a "$output/timing.txt"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then cat "$output/timing.txt" >> "$GITHUB_STEP_SUMMARY"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Mode: %s\nScheme: %s\n' "$mode" "$scheme" | tee "$output/timing.txt"
xcodebuild -version | tee "$output/toolchain.log"
xcrun --find lldb >> "$output/toolchain.log"
sysctl hw.memsize hw.ncpu >> "$output/toolchain.log"
generation_attempted=1
if [[ "$mode" == ci ]]; then
  # Hosted CI does not need the home-screen icon and Icon Composer is expensive
  # there. CI regenerates the normal project during cleanup.
  WINGDEX_SKIP_APP_ICON=1 xcodegen generate 2>&1 | tee "$output/generate.log"
else
  # XcodeGen's cache avoids rewriting the project when its spec is unchanged.
  WINGDEX_SKIP_APP_ICON=0 xcodegen generate --use-cache 2>&1 | tee "$output/generate.log"
fi

deep_audits=0
[[ "$lane" == accessibility-deep ]] && deep_audits=1
if [[ "$mode" == ci ]]; then
  common=(-project WingDex.xcodeproj -scheme "$scheme"
    -derivedDataPath "${derived_data_path:-build/DerivedData}"
    -parallel-testing-enabled NO
    -onlyUsePackageVersionsFromResolvedFile -skipPackagePluginValidation)
  app_icon_args=(
    ASSETCATALOG_COMPILER_APPICON_NAME=""
    ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS=NO
  )
  architecture=$(uname -m)
  sdk_version=$(xcrun --sdk iphonesimulator --show-sdk-version)
  test_run="${derived_data_path:-build/DerivedData}/Build/Products/${scheme}_iphonesimulator${sdk_version}-${architecture}.xctestrun"
  phase=$SECONDS
  # Build before booting: overlapping the two caused severe disk/memory
  # contention on GitHub's 7 GB macOS VMs, even with a restored build cache.
  # A generic destination still builds the same host-architecture test products.
  NSUnbufferedIO=YES xcodebuild build-for-testing "${common[@]}" "${targets[@]}" \
    -destination "generic/platform=iOS Simulator" "${xcodebuild_args[@]}" ARCHS="$architecture" \
    "${app_icon_args[@]}" \
    2>&1 | tee "$output/build.log"
  echo "Build: $((SECONDS - phase))s" | tee -a "$output/timing.txt"
  if [[ ! -f "$test_run" ]]; then
    echo "Build did not produce the expected test manifest: ios/$test_run" >&2
    exit 1
  fi
  phase=$SECONDS
  # Select an installed iPhone runtime, not a user's existing device.
  runtime=$(latest_runtime)
  device_type=${IOS_TEST_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro}
  simulator=$(xcrun simctl create "WingDex tests $run_id" "$device_type" "$runtime")
  created_simulator=1
  echo "Simulator: $simulator ($runtime)" | tee "$output/simulator.log"
  xcrun simctl boot "$simulator" >> "$output/simulator.log" 2>&1
  xcrun simctl bootstatus "$simulator" -b 2>&1 | tee -a "$output/simulator.log"
  echo "Simulator setup: $((SECONDS - phase))s" | tee -a "$output/timing.txt"
  xcrun simctl ui "$simulator" appearance light

  phase=$SECONDS
  set +e
  # Use the compiled manifest, not another project/package-resolution pass.
  # Hosted runners can spend over a minute establishing the first automation
  # session. Keep a bounded allowance without failing a test that then passes.
  NSUnbufferedIO=YES TEST_RUNNER_WINGDEX_DEEP_AUDITS="$deep_audits" \
    xcodebuild test-without-building -xctestrun "$test_run" "${targets[@]}" \
    -parallel-testing-enabled NO \
    -destination "platform=iOS Simulator,id=$simulator" \
    -test-timeouts-enabled YES -default-test-execution-time-allowance 240 \
    -maximum-test-execution-time-allowance 300 \
    -collect-test-diagnostics never \
    -resultBundlePath "$output/Tests.xcresult" 2>&1 | tee "$output/tests.log"
  status=${PIPESTATUS[0]}
  set -e
  echo "Tests: $((SECONDS - phase))s" | tee -a "$output/timing.txt"
else
  common=(-project WingDex.xcodeproj -scheme "$scheme"
    -parallel-testing-enabled NO
    -onlyUsePackageVersionsFromResolvedFile -skipPackagePluginValidation)
  if [[ -n "$derived_data_path" ]]; then
    common+=(-derivedDataPath "$derived_data_path")
  fi
  if [[ -n "$destination_override" ]]; then
    destination=$destination_override
    printf 'Destination override: %s\n' "$destination" | tee "$output/simulator.log"
  else
    device_type=${IOS_TEST_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro}
    local_device_name=${IOS_TEST_DEVICE_NAME:-WingDex Local Tests}
    simulator=$(find_local_simulator "$local_device_name" "$device_type")
    if [[ -z "$simulator" ]]; then
      runtime=$(latest_runtime)
      simulator=$(xcrun simctl create "$local_device_name" "$device_type" "$runtime")
      echo "Created persistent simulator: $simulator ($local_device_name, $runtime)" \
        | tee "$output/simulator.log"
    else
      echo "Reusing persistent simulator: $simulator ($local_device_name)" \
        | tee "$output/simulator.log"
    fi
    destination="platform=iOS Simulator,id=$simulator"
  fi

  phase=$SECONDS
  set +e
  # Match Xcode's normal build-and-test flow. xcodebuild boots the selected
  # destination as needed; a local simulator is intentionally left reusable.
  NSUnbufferedIO=YES TEST_RUNNER_WINGDEX_DEEP_AUDITS="$deep_audits" \
    xcodebuild test "${common[@]}" "${targets[@]}" "${xcodebuild_args[@]}" \
    -destination "$destination" \
    -resultBundlePath "$output/Tests.xcresult" 2>&1 | tee "$output/tests.log"
  status=${PIPESTATUS[0]}
  set -e
  echo "Test (build + run): $((SECONDS - phase))s" | tee -a "$output/timing.txt"
fi

if [[ -d "$output/Tests.xcresult" ]]; then
  set +e
  xcrun xcresulttool get test-results summary --path "$output/Tests.xcresult" --compact \
    | tee "$output/summary.json"
  summary_status=${PIPESTATUS[0]}
  set -e
  if [[ "$summary_status" != 0 && "$status" == 0 ]]; then
    echo "Could not read the test result summary; see ios/$output/Tests.xcresult" >&2
    status=1
  fi
fi
exit "$status"
