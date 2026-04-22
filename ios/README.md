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

## Build scripts

| Script | Purpose |
|--------|---------|
| `scripts/gen-git-info.sh` | Generate `GitInfo.swift` with commit hash and branch |
| `scripts/bump-version.sh` | Bump marketing version or build number |
| `scripts/fix-icon-ref.sh` | Fix Xcode project icon references after generation |

## CI

iOS builds and tests run via `.github/workflows/ios.yml` on PRs that touch `ios/`, `openapi.yaml`, or `functions/`. Releases are handled by `.github/workflows/ios-release.yml`.
