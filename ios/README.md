# WingDex iOS

Native SwiftUI companion app for [WingDex](https://wingdex.app). Shares the same Cloudflare REST API as the web app - the server owns all business logic, so the iOS app is a thin UI client.

**Target:** iOS 26+ / Xcode 27+ / Swift 6

## Architecture

- **SwiftUI lifecycle** with tab bar navigation (Home, WingDex, Outings) and a detached upload button
- **OpenAPI-generated client** via `swift-openapi-generator` from the shared `openapi.yaml`
- **Auth:** anonymous sessions, passkeys (WebAuthn), and social OAuth (GitHub, Google, Apple) via Better Auth bearer tokens
- **Strict concurrency** (`SWIFT_STRICT_CONCURRENCY: complete`)

## Photo and outing behavior

- **Camera saving:** Settings → Camera → Save Camera Photos defaults to On. Accepting a camera capture saves its full-resolution JPEG and capture metadata to Photos independently of identification, even if identification is later canceled. Retakes, canceled captures, and library selections do not create copies. Saving requests add-only Photos access; turning the preference off skips both saving and authorization. Denied access or a save failure never blocks identification, and Settings provides a recovery link when access is denied.
- **Outing-local time:** EXIF `OffsetTimeOriginal` takes precedence. Photos with only a local EXIF clock use the outing timezone once reverse geocoding or location search resolves it; otherwise they retain the EXIF/device fallback. The review date picker and outgoing timestamps use the resolved timezone. API responses and eBird CSV exports localize legacy UTC (`Z`) outing timestamps with valid coordinates without rewriting historical data or moving their instants. Explicit offsets and records without reliable coordinates remain unchanged.
- **Outing actions:** Rename, Share Summary, eBird CSV export (registered accounts), and Delete live in the detail toolbar menu. Rename uses a native sheet with explicit Save/Cancel; failed saves retain the draft. Outing rows only open/preview details and have no swipe actions. Species-row actions are unchanged. File exports present the system activity controller directly rather than inside another SwiftUI sheet, keeping nested activities such as Messages in UIKit's presentation lifecycle. Completion, cancellation, and presenter removal clean up the temporary export.
- **Review location:** The row under Date & Time shows a green location icon, source label, and four-decimal coordinates, or an orange no-GPS label when coordinates are missing. Cancel and retry controls stay in that row. The Location section has a compact, single-line name and Edit control directly below the map. During reverse geocoding, a small spinner and "Looking up location..." replace the fallback name in that location row. Tap the name or Edit to open a swipe-dismissible sheet. Full names and source/lookup status remain available to VoiceOver. Native search stays at the top, below the title and Close button. Selecting a place or using an entered name applies it and dismisses the sheet; Close or swipe-down discards unselected text. Manual names retain existing coordinates. Current location is offered only when coordinates are missing and requests permission only after a tap. Live place search uses the existing provider with debounce, cancellation, and rate-limit recovery; manual entry remains available offline.
- **Review map:** A full-width map within the location card previews the accepted location, or the inherited location when adding to an existing outing. Tap to inspect a map-only overlay sheet with pan, zoom, and Recenter without changing the outing's coordinates. A floating Liquid Glass button opens Apple Maps; there is no bottom information panel. The name, coordinates, and source remain available through Recenter's accessibility description. Map tiles and location lookups never make a location mandatory.
- **Review photos:** Tap a carousel thumbnail to open a swipe-dismissible photo sheet at that photo, then swipe horizontally to browse the outing's photos. The viewer loads screen-sized previews from the originals without changing the photos or interrupting location lookup. Close or swipe down to return; long-press removal remains in the carousel. The top-right chevron continues the review and is announced as "Continue" by VoiceOver.
- **Queued shares:** Photos shared while an ID session is open wait for that session to finish. Confirming or discarding the current session starts the next queued share after dismissal and cleanup, without requiring another app activation. Discard only applies to the current session; account changes still stop automatic queue continuation.
- **Identification controls:** The bottom toolbar groups outing details, crop, possible, and skip. Possible and Skip ask for confirmation. The map button opens a read-only sheet with the outing's location and local date/time. Back revisits the previous photo, or outing review from the first photo.
- **Manual crop:** Drag and pinch beneath the fixed square, then tap Done to apply. Back cancels the crop. The crop screen has no upload-close, reset, skip, or separate zoom controls.

The implementation uses Apple's documented `UIImagePickerController.InfoKey.mediaMetadata`, `PHAssetCreationRequest`, `PHAccessLevel.addOnly`, and SwiftUI form, menu, and focus APIs. It leaves the native library picker unchanged.

For device validation, check camera acceptance versus Retake/Cancel, denied Photos permission, Settings recovery, saving with location access on/off, image orientation, and identification canceled after a capture. Simulator tests cover metadata, save deduplication, timezone resolution, rename behavior, outing actions, and preference persistence; they cannot exercise a physical camera.

## Prerequisites

- Xcode 27+
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)
- Apple Developer account (for device builds and Sign in with Apple)

## Setup

```bash
cd ios
xcodegen generate
open WingDex.xcodeproj
```

The Xcode project is generated from `project.yml`. SPM dependencies (swift-openapi-runtime, KeychainAccess) resolve automatically on first build.

The app connects to the web API. For local development, start the web backend first:

```bash
# From the repo root
npm run dev
```

The `Localhost` app scheme uses `https://localhost.wingdex.app`, through the LAN
reverse proxy described in the root README. This is only for interactive backend
development; **none of the iOS tests require that host or a running backend**.

## Builds

```bash
make -C ios build                       # unsigned simulator app, no tests or simulator boot
make -C ios build SCHEME=Localhost      # local backend configuration
make -C ios build SCHEME=Production     # production configuration
```

The build target generates the Xcode project and runs `xcodebuild build`, including
the app icon and share extension. It defaults to the `WingDex` scheme and
`generic/platform=iOS Simulator`, reusing `ios/build/DerivedData`.
Override `DESTINATION` and `DERIVED_DATA_PATH` when needed. `XCODEBUILD_ARGS`
defaults to `CODE_SIGNING_ALLOWED=NO`; for a signed device build, replace it:

```bash
make -C ios build SCHEME=Localhost DESTINATION='generic/platform=iOS' XCODEBUILD_ARGS=''
```

Device builds require the normal signing setup. Plain `make -C ios` still runs
tests. Run builds and tests serially because they share the generated project and
build cache.

## Tests

From the repository root:

```bash
npm run test:ios                      # all required unit, UI and accessibility tests
make -C ios                           # the same default, without Node/npm
make -C ios core                      # unit tests and native interaction smoke tests
make -C ios accessibility             # deterministic structural accessibility audits
make -C ios accessibility-deep        # opt-in OS-sensitive full audits

# A selector replaces the lane's default target selection:
make -C ios core TESTS=-only-testing:WingDexTests/AuthTransportTests
```

The Makefile is the shared local/CI entry point; `scripts/test.sh` owns the one
simulator/build lifecycle underneath it. `npm run test:ios -- core` also works.
Install Xcode and XcodeGen, then
run it; do not boot a simulator, launch a server, choose an API URL, or generate
the project first. It uses the selected Xcode (`DEVELOPER_DIR` is respected) and
the newest installed iOS 26+ runtime. `IOS_TEST_DEVICE_TYPE` optionally overrides
the default `com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro`.

The runner first builds for `generic/platform=iOS Simulator` with the host
architecture, without waiting for a particular simulator to become ready. It then
creates a uniquely named simulator, boots it, waits for `simctl bootstatus`, and
runs tests serially on that UDID. Build and boot are intentionally separate to
avoid compiler/simulator memory and disk contention on smaller hosted machines.
`test-without-building` reads the generated SDK/architecture-specific `.xctestrun`
directly, avoiding a second project/package-resolution pass. This split is
documented in Apple's [command-line testing guide](https://developer.apple.com/library/archive/technotes/tn2339/_index.html)
and the installed `xcodebuild` man page.

Cleanup shuts down/deletes only the UDID the runner created, including on ordinary
failure or interruption. It never erases or deletes a developer's simulator.
A force-killed process or powered-off Mac cannot
run cleanup; the recorded `Simulator:` UDID identifies that run's device if manual
cleanup is needed. Builds reuse `ios/build/DerivedData`; simulator state never
does. Raw logs, toolchain versions, elapsed times, JSON summary, and `.xcresult`
remain in `ios/build/test-results/<lane>-<uuid>/`. Xcode's exit status is retained.
Run one iOS lane at a time on a local Mac because the build cache/project is shared.

CI's compiled-cache fallback can reuse another lane's SwiftPM/DerivedData cache
when Xcode, OS and architecture match, rather than cold-building core after an
accessibility lane already built the same targets. Content-keyed generated Bird
ID assets and the pinned XcodeGen executable are cached separately. These caches
reuse build inputs/products, never simulator state or test results; tests still
run on a fresh device.
The runner disables Xcode's optional **verbose system diagnostics**. Failed
assertions, screenshots, UI hierarchies, raw stderr and result bundles remain.
Export attachments without `--only-failures`: Xcode can mark a failed test's
attachments as not directly associated with its assertion. On the local beta,
one failed assertion otherwise spawned
`simctl diagnose --timeout=600` after all tests had already finished, adding
minutes with no test progress. This is the documented
`xcodebuild -collect-test-diagnostics never` option, not a log filter.

For simulator tests the script omits the home-screen Icon Composer asset, which
is not under test and added almost two minutes on hosted runners. Cleanup
regenerates the normal project, including that asset, for direct Run/Archive.
Normal Xcode generation and release archives do not omit it.

### Xcode Test navigator

Open `ios/WingDex.xcodeproj` after `cd ios && xcodegen generate`, select an iPhone
Simulator, and click any test diamond, including
`test://com.apple.xcode/WingDex/WingDexAccessibilityUITests`. The canonical
`WingDex` scheme contains all three required test targets. `Localhost`, `Dev`,
and `Production` also contain them; their API build settings do not affect test
fixtures. `Dev CI` was removed: it offered no different coverage, and disabling
its debugger did not prevent the launch-snapshot diagnostic below. Ordinary Run,
Profile and Archive behavior of the development/release schemes is unchanged.

No launch arguments, server, backend-selection step, Cloudflare login, or special
test scheme are required in Xcode. Fixtures are selected in test code, so running
one test does not require running another test first. The CLI owns a fresh
simulator; Xcode uses your chosen simulator. Prefer a dedicated test simulator
there too, since UI tests sign out and replace the app's account with fixtures.

### Coverage and runtime policy

| Layer | Responsibility |
|-------|----------------|
| Unit | Native bearer transport, session rejection and token handling, auth/passkey parsing, view-model state and cancellation, offline persistence, RAW/JPEG/HEIF handling, real Core ML inference and web/native golden-vector parity |
| Core UI | Sessionless photo/share entry, share failure and relaunch, crop gestures, missing-GPS permission intent/manual entry, native sheet/search/map/photo gestures, outing actions/rename retry, camera preference persistence |
| Accessibility | Hit regions, sufficient descriptions and traits on populated/empty tabs, settings/deletion, sign-in, outing review, search, map and photo sheets |
| Deep accessibility | The same journeys with full requested audit categories, including screenshot contrast, text clipping, element detection and Dynamic Type resizing |

The previous 26 bird-flow UI tests repeated location-state permutations already
covered by `OutingLocationReviewModelTests` and `OutingLocationSearchModelTests`.
They are now seven native wiring/lifecycle tests. In particular, the former
64.9-second manual-location cancellation journey is a continuation-controlled
unit test of both late current-location and reverse-lookup responses, with no
11-second inverted UI waits. Six outing UI launches become two journeys; five
visual journeys become three, keeping real camera movement and photo paging.
Single-photo/index/removal semantics remain in `PhotoReviewCarouselTests`,
`PhotoFlowStoreTests` and `AddPhotosViewModelTests`. The repeated light/large-text
journey is consolidated into the large-text native interaction test.

Eight live `AuthIntegrationTests` mostly retested Worker HTTP CRUD/auth behavior.
Four `AuthTransportTests` instead exercise the real native `AuthService` and
`DataService` with an injected ephemeral `URLSession`/`URLProtocol`: anonymous
identity and signed/raw tokens, bearer headers, no cookies, trace propagation,
session validation/sign-out, unauthorized data, sessionless calls and failed
sign-in. Server behavior stays in the web/Worker suites. UI auth transport is a
Debug-only, explicitly enabled in-process fixture that rejects unknown requests
rather than falling through to a real backend. Real model inference is not
repeated through UI: the accuracy unit test keeps all eight real photos and their
former JPEG derivatives, reusing each original result instead of inferring it
twice. Missing accuracy fixtures now fail instead of silently skipping.

All UI existence/disappearance waits first read `.exists` synchronously, then
fall back to XCTest's native wait only when needed. Value/camera predicates also
check their current value first. No private XCTest polling or quiescence settings
are used; Apple does not guarantee the waiter's polling interval.

Required CI lanes target **under 10 minutes each**, not a 10-minute kill switch.
Unit, photo/camera UI, outing-list UI, location/photo gestures, and structural
accessibility run on separate Xcode 27 ARM images, using the
same fresh iPhone 17 Pro default
as local runs. Smaller SE displays did not improve hosted runtime consistently
and introduced tight-viewport scrolling failures, so CI does not override the
device type.
The 15-minute infrastructure ceiling still leaves failure diagnostics time to
finish. CI calls these exact repo commands; it does not deploy/select a backend
or manage a second simulator lifecycle. Backend-only changes no longer trigger
native UI builds. Full visual/font audits run nightly or via the workflow's
`deep_audits` input as an explicitly advisory job, not a merge gate. Run failures,
including infrastructure timeouts, remain failures in the logs and `.xcresult`;
they are not converted to passes/skips or swallowed with a generic issue filter.
The default structural checks remain required. Full audits supplement, not
replace, manual VoiceOver, contrast, dark appearance and Dynamic Type checks.

Local verification on 2026-09-07, Xcode 27/iOS 27, iPhone 17 Pro,
fresh simulators and a warm build cache:

| Command | Total, including build and simulator | Result |
|---------|--------------------------------------|--------|
| `make -C ios` | **6m 24s** | 447 passed, 0 skipped |
| `make -C ios accessibility-deep` | **3m 22s** | 8 passed, 0 skipped |

These runs used the generic build and direct `.xctestrun` lifecycle; deep-audit
mode remained active without another package-resolution pass. Three targeted
large-text/share regressions also passed on an SE simulator in 2m 37s.
These are local measurements, not a claim about hosted Xcode performance.
The pre-change hosted run `34140285029` took about 22 minutes for core and
12 minutes for accessibility. Hosted runs must include cache restore, simulator
setup, diagnostics and job cleanup when evaluating the lane budget.

The initial deep run failed in two places; both are fixed without dropping audit
categories or increasing timeouts:

- The search-screen audit completed around 30s, but the following result/map taps
  each waited 60s for an app-animation completion notification that never arrived.
  It was not the map audit taking too long: that audit was never reached. Outing
  review, search and map now have independent launches and terminal audits,
  following Apple's [per-screen audit guidance](https://developer.apple.com/videos/play/wwdc2023/10035/).
  The same real search/map navigation remains covered by the separate UI flow.
  No missing-animation waits appeared in the passing full run.
- Settings' "Contrast nearly passed" attachment identified **Log Out**, whose
  destructive red text measured about 3.20:1 against white. Ordinary logout is
  reversible and the web button is non-destructive; the native button now uses
  its standard role and existing app tint. The genuinely destructive pending-upload
  discard confirmation keeps its destructive role. This follows Apple's
  [destructive-role guidance](https://developer.apple.com/documentation/swiftui/buttonrole/destructive)
  and [4.5:1 requirement for normal-size text](https://developer.apple.com/design/human-interface-guidelines/accessibility).
  Simulator screenshots measured approximately 5.82:1 in light appearance and
  5.21:1 in dark appearance.
- Auditing the complete Settings footer also exposed low-contrast version text
  and the manually red **Delete Data...** navigation label. Footer text now uses
  the existing foreground palette. `DestructiveText` preserves the web's red hue,
  with a lighter dark variant for elevated native Form surfaces. Actual deletion
  and discard buttons retain their native destructive roles. The navigation label
  measured 4.69:1 in light appearance and 5.99:1 in dark appearance.

The full Settings audit passed in light (27.7s) and dark (26.2s) appearance.
The footer is audited at the end of the Form, with Log Out and the version
link asserted hittable, before a fresh launch audits the other Settings screens.
Two precisely bounded iOS 27 audit artifacts remain documented in the handlers:

- The decorative footer separator is reported as "Contrast failed" even with
  `accessibilityHidden(true)` and measured 10.30:1 foreground/background contrast.
  Only `.contrast` for identifier `settings.footerSeparator` and label `·` is
  excluded. It conveys no information and is also exempt under
  [WCAG's decorative-text rule](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
  Neither footer link nor any other text is excluded.
- At the bottom of the Form, XCTest reads **Use Location and Time** through the
  glass navigation bar: its label spans y=113.5...133.8, while the bar spans
  y=78...132. The footer-only handler requires that exact static-text label,
  `.contrast`, and its center inside the Settings navigation bar. Its unobscured
  contrast is still audited in the initial Settings view. Screen-coordinate
  comparison follows the documented
  [`XCUIElementAttributes.frame`](https://developer.apple.com/documentation/xcuiautomation/xcuielementattributes/frame)
  contract, also verified in the installed SDK.

Simulator MCP observations also confirmed the button remains readable and
unclipped at the largest accessibility text size in both appearances. This
installation lacks SimulatorKit's HID support, so a temporary native XCTest
helper performed the scrolling before MCP captured the screenshots; that helper
is not part of the suite. No Xcode MCP/preview renderer was available, so the
affected preview could not be rendered separately from the installed app.

### Xcode debugger-version diagnostic

The baseline CI run `34140285029` emitted
`IDELaunchParametersSnapshot` / `DebuggerLLDB.DebuggerVersionStore.StoreError`
and `no debugger version` even with `Dev CI`'s debugger disabled. This is emitted
by Xcode's launch metadata capture, not by WingDex or a failed assertion.
On the installed Xcode 27 RC (`27A5252f`), UI launches give a more specific
message: `debugger version lookup failed for path '<nil>': noURL`, while
`xcrun lldb --version` succeeds. This demonstrates a missing debugger URL in that
launch snapshot, **not** a missing LLDB installation. Apple has not published a
root-cause/fix for the older `StoreError error 0` message; do not infer corrupted
DerivedData, an app crash, or a backend problem from those two lines alone.

The script records `xcodebuild -version` and `xcrun --find lldb`; additionally
check `xcrun lldb --version`. Ensure `DEVELOPER_DIR`/`xcode-select` select the intended complete
Xcode installation. If those fail, repair/select Xcode before testing. If they
succeed, inspect the actual test exit status and `.xcresult`, and report a
reproducing launch log to Apple if needed. Do not delete simulators/preferences,
disable useful test debugging, or filter stderr to make this warning disappear.
The runner intentionally preserves it and all real build, launch and test errors.
Unsigned simulator runs can also report keychain entitlement warnings; they do
not validate physical-device provisioning or credential persistence.

### Apple references and SDK verification

- [Wait for existence](https://developer.apple.com/documentation/xcuiautomation/xcuielement/waitforexistence(timeout:))
  and [XCUIElement](https://developer.apple.com/documentation/xcuiautomation/xcuielement):
  snapshot properties versus bounded native synchronization.
- [Perform accessibility audits](https://developer.apple.com/documentation/xcuiautomation/xcuiapplication/performaccessibilityaudit(for:_:))
  and [WWDC23: Perform accessibility audits for your app](https://developer.apple.com/videos/play/wwdc2023/10035/):
  audit types, narrowly scoped issue handlers, per-screen coverage, and manual
  assistive-technology testing. Returning `true` from the handler ignores an
  issue; an audit infrastructure failure is distinct from an accessibility issue.
- [URLSessionConfiguration.protocolClasses](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/protocolclasses):
  per-session transport injection, not supported for background sessions.
- [Running tests and interpreting results](https://developer.apple.com/documentation/xcode/running-tests-and-interpreting-results):
  Test navigator and result-based diagnosis.

Verified against the installed Xcode 27 RC simulator SDK:
`XCUIAutomation.framework/Headers/XCUIElement.h`, `XCUIApplication.h`,
`XCUIAccessibilityAuditTypes.h`, its `arm64-apple-ios-simulator.swiftinterface`,
and Foundation's `NSURLSession.h`. These confirm the native waits, audit
availability since iOS 17, throwing audit API with **no timeout parameter**, and
ephemeral session protocol injection. Hosted-runner measurements must still be
distinguished from local results.

## Debug sign-in

Automatic anonymous sign-in is available in Debug builds only.

In Xcode:

1. Select the `Dev` scheme and an iPhone Simulator.
2. Open **Product > Scheme > Edit Scheme > Run > Arguments**.
3. Add and enable `--auto-sign-in`.
4. Run the app.

`--auto-sign-in` creates an anonymous account against `https://dev.wingdex.app`.
Use the `Localhost` scheme instead if the local backend is running.

The equivalent command-line launch for an already-built Debug app is:

```bash
xcrun simctl launch --terminate-running-process booted app.wingdex \
	--auto-sign-in
```

Build and install the `Dev Debug` configuration first when the Simulator does not
already contain the current app. Release and Production builds intentionally ignore
these arguments.

## Project structure

| Path | Purpose |
|------|---------|
| `App/` | App entry point (`WingDexApp.swift`) |
| `Views/` | SwiftUI views (Home, WingDex, Outings, Settings, Species, etc.) |
| `ViewModels/` | View models and state management |
| `Models/` | Data models (mirrors TypeScript types + OpenAPI schema) |
| `Services/` | AuthService, DataService, DataStore |
| `Extensions/` | Swift extensions |
| `Resources/` | App icon, assets |
| `scripts/` | Build helpers (version bump, icon fix, git info generation) |

## Photo import formats

Photos controls which resource a RAW+JPEG or JPEG+RAW asset exports. Its
automatic and most-compatible settings are preferences, not guarantees that
the app receives JPEG. WingDex keeps the received file unchanged for metadata
and duplicate detection. For RAW formats supported by the OS, it renders the
active photo from its file URL before identification and cropping; dropping the
filename first can make ImageIO mistake Sony ARW data for ordinary TIFF.
JPEG and HEIF exports pass through without another conversion.

This follows Apple's [file representation guidance](https://developer.apple.com/documentation/coretransferable/filerepresentation):
copy the temporary received file during the importing closure and process it
on demand. The received file is not necessarily the untouched camera original;
Photos can convert it or remove metadata according to the person's choices.
Apple describes [compatible encoding](https://developer.apple.com/documentation/photosui/phpickerconfiguration-swift.struct/assetrepresentationmode/compatible)
as best-effort, and [ImageIO image creation](https://developer.apple.com/documentation/imageio/cgimagesourcecreateimageatindex(_:_:_:))
can fail even when the container is recognized. Native RAW support therefore
depends on the camera variant and OS decoder, not just the extension. WingDex
does not scan native RAW sensor data or silently substitute a small embedded
thumbnail for the full image; undecodable photos need a JPEG/HEIF export.
Import failures are counted without discarding readable photos, including after
duplicate resolution. Unavailable files remain retryable; decoding failures
offer export or skip rather than repeatedly decoding the same unsupported file.

`PhotoServiceTests` exercises RAW normalization, orientation, identification,
and crop retry with a generated Bayer DNG, plus real JPEG/HEIF decoding.
Regenerate the non-photographic fixture with
`swift ios/WingDexTests/Fixtures/generate-synthetic-dng.swift` from the repo root.
The DNG covers RAW rendering, not Sony's filename-dependent type detection.

When checking picker behavior on a new iOS release, import standalone RAW,
RAW+JPEG with RAW as the selected original, JPEG+RAW with JPEG selected, and
HEIF through both automatic and most-compatible export. Confirm that each
selection produces one photo, retains its date/location, identifies, and can
be cropped and re-identified. This requires real Photos assets, not JPEG files
renamed with RAW extensions. Compare stable and beta OS versions separately.

## Build scripts

| Script | Purpose |
|--------|---------|
| `scripts/gen-git-info.sh` | Generate `GitInfo.swift` with commit hash and branch |
| `scripts/bump-version.sh` | Bump marketing version or build number |
| `scripts/fix-icon-ref.sh` | Fix Xcode project icon references after generation |
| `scripts/test.sh` | Generate, build and test on a disposable simulator, locally or in CI |

## CI

iOS builds and tests run via `.github/workflows/ios.yml` on PRs that touch the native
app or its shared OpenAPI/Bird ID inputs. Backend-only changes are covered by the
web/Worker suites. Releases are handled by `.github/workflows/ios-release.yml`.

To publish a deliberate milestone version without marking a commit as breaking, dispatch the release workflow with an exact version:

```bash
gh workflow run ios-release.yml --ref main -f release_version=1.0.0
```

The override must be greater than the latest `ios-v*` tag. It keeps the existing successful-iOS-check gate and rebuilds the archive with the requested marketing version.
