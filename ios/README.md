# WingDex iOS

Native SwiftUI companion app for [WingDex](https://wingdex.app). Shares the same Cloudflare REST API as the web app - the server owns all business logic, so the iOS app is a thin UI client.

**Target:** iOS 26+ / Xcode 26+ / Swift 6

## Architecture

- **SwiftUI lifecycle** with tab bar navigation (Home, WingDex, Outings) and a detached upload button
- **OpenAPI-generated client** via `swift-openapi-generator` from the shared `openapi.yaml`
- **Auth:** anonymous sessions, passkeys (WebAuthn), and social OAuth (GitHub, Google, Apple) via Better Auth bearer tokens
- **Strict concurrency** (`SWIFT_STRICT_CONCURRENCY: complete`)

## Prerequisites

- Xcode 26.3+
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

Then run the iOS app in the simulator pointing at `http://localhost:5000`.

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

## CI

iOS builds and tests run via `.github/workflows/ios.yml` on PRs that touch `ios/`, `openapi.yaml`, or `functions/`. Releases are handled by `.github/workflows/ios-release.yml`.

To publish a deliberate milestone version without marking a commit as breaking, dispatch the release workflow with an exact version:

```bash
gh workflow run ios-release.yml --ref main -f release_version=1.0.0
```

The override must be greater than the latest `ios-v*` tag. It keeps the existing successful-iOS-check gate and rebuilds the archive with the requested marketing version.
