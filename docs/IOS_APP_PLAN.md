# Native iOS App (SwiftUI) - Plan & Tracker

> Source: [Issue #131](https://github.com/jlian/wingdex/issues/131) - Last updated: 2026-03-01
>
> **Legend**: ✅ Done - ⏳ In Progress - _(unchecked)_ Not started
>
> **Depends on**: ~~#74 (Cloudflare migration)~~ ✅ Complete

---

## Overview

A native SwiftUI iOS app that shares the Cloudflare REST API with the web SPA. The server owns all business logic (bird ID, taxonomy search, eBird import, dex computation), so the iOS app is a thin UI client with zero business-logic duplication.

**Target**: iOS 26+ / Xcode 26+ / Swift 6 / SwiftUI lifecycle

**Estimated effort**: 4-6 weeks for initial build after scaffolding is done.

---

## Design Principles

The app should feel fully iOS-native, not a web wrapper. Key guidelines:

- **Apple HIG first** - follow the [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) for layout, navigation, typography, and interaction patterns
- **Liquid Glass** - use the iOS 26 liquid glass material system: standard SwiftUI components (TabView, NavigationStack, toolbars, sheets) adopt glass automatically when built with the iOS 26 SDK
- **Bottom tab bar** - four-tab TabView using the SwiftUI `Tab` API; no custom tab bar implementations
- **System typography** - use SF Pro / SF Rounded via SwiftUI's `.font()` modifiers; no custom fonts unless branding requires it
- **SF Symbols** - prefer Apple's symbol library over custom icons; use symbol effects (bounce, pulse) where appropriate
- **Native controls** - use system pickers, sheets, confirmations, and alerts rather than custom implementations
- **Dark mode** - full support via SwiftUI's automatic color scheme handling and semantic colors
- **Dynamic Type** - all text should scale with the user's preferred text size
- **Accessibility** - VoiceOver labels on all interactive elements; large content viewer support for key metrics

---

## Prerequisites

- [x] Cloudflare migration (#74) - server-side bird ID, taxonomy search, eBird import
- [x] `openapi.yaml` at repo root describing all API endpoints + schemas
- [x] Apple Developer account ($99/yr)
- [x] Sign in with Apple configured (backend already handles Apple OAuth)
- [x] Register App ID (`app.wingdex`) in Apple Developer portal
- [x] Xcode project in `ios/` directory

### Apple Developer Portal Checklist

These are one-time setup steps in the Apple Developer portal:

- [x] **Register App ID** - `app.wingdex` registered (Team Z8LQS5S492)
- [ ] **Create provisioning profile** - for Development (automatic signing in Xcode handles this, but explicit profiles needed for CI)
- [x] **Configure Associated Domains** - AASA file at `public/.well-known/apple-app-site-association`, entitlements with `webcredentials:wingdex.pages.dev`
- [ ] **App Store Connect** (later) - create the app listing when ready for TestFlight

> **Note**: You do NOT need to do anything in the portal right now for scaffolding. The Xcode project will use automatic signing, so just having the paid account is sufficient. Register the App ID when you're ready to run on a physical device or build for TestFlight.

---

## Auth Strategy: Cookies vs Bearer Tokens

The current backend uses cookie-based sessions via Better Auth. The iOS app needs to authenticate against the same API. Two approaches were evaluated:

### Option A: ASWebAuthenticationSession + Cookies (not chosen)

The iOS app opens the OAuth flow (GitHub/Apple) in a system browser sheet via `ASWebAuthenticationSession`. Better Auth sets session cookies in the response. The app captures those cookies and attaches them to all subsequent `URLSession` requests via a shared `HTTPCookieStorage`.

**Pros**:
- Zero backend changes required
- Cookie handling is automatic with `URLSession` and `HTTPCookieStorage`
- Web and iOS share identical session semantics
- `ASWebAuthenticationSession` automatically handles cookie capture from OAuth redirects

**Cons**:
- Cookies are domain-scoped; the iOS app must hit the exact same domain as the web app
- Cookie expiry is controlled server-side; the app cannot extend sessions unilaterally
- Debugging cookie issues is less transparent than inspecting a bearer header
- Some corporate proxies or VPNs can strip cookies (rare but possible)
- `WKWebView` cookie sharing requires extra care if ever needed

### Option B: Short-Lived Bearer Tokens (chosen)

Add server-side endpoints that issue short-lived access tokens (JWT, ~15 min) paired with long-lived refresh tokens (opaque, ~90 days). The iOS app stores tokens in Keychain and attaches the access token as `Authorization: Bearer <token>` on every request.

| Aspect | Detail |
|---|---|
| **Backend changes** | New `POST /api/auth/token` (exchange OAuth code for token pair), `POST /api/auth/token/refresh` (rotate access token), middleware update to accept `Authorization` header |
| **OAuth flow** | `ASWebAuthenticationSession` -> Better Auth OAuth -> redirect with authorization code -> app exchanges code for token pair via `/api/auth/token` |
| **Native Apple Sign-In** | `ASAuthorizationAppleIDProvider` gets Apple ID token -> POST to `/api/auth/token` with `grant_type=apple` -> receives token pair |
| **Token storage** | Access token: in-memory (short-lived). Refresh token: Keychain (long-lived, encrypted at rest) |
| **Token lifetime** | Access: ~15 min. Refresh: ~90 days. Access token is stateless (JWT); refresh token is server-validated. |
| **Passkeys** | `ASAuthorizationPlatformPublicKeyCredentialProvider` -> assertion sent to Better Auth passkey endpoint -> response includes token pair |
| **401 handling** | Intercept 401 -> attempt silent refresh via `/api/auth/token/refresh` -> if refresh fails, prompt re-auth |
| **Revocation** | Refresh tokens stored server-side, can be revoked instantly. Short-lived access tokens expire naturally. |

**Pros**:
- Explicit token lifecycle - app controls refresh timing
- Easier to inspect/debug (visible in request headers)
- Short-lived access tokens limit exposure window if leaked
- Refresh token rotation detects token theft (reuse invalidates the family)
- Works naturally with `URLSession` without cookie management
- More portable if the API is ever consumed by third-party clients
- Standard OAuth 2.0 pattern; well-understood security model

**Cons**:
- **Requires backend changes** - token exchange endpoint, refresh endpoint, middleware update
- Must implement token refresh logic on the client (auto-refresh on 401, retry original request)
- Adds server-side state for refresh tokens (a new DB table or Better Auth plugin)
- Slightly more complex than cookies for the initial setup

### Decision Rationale

Short-lived bearer tokens were chosen because:
1. **Security** - short-lived JWTs (~15 min) limit the damage window if a token is leaked; refresh token rotation detects theft
2. **Debuggability** - tokens are visible in request headers, making network debugging straightforward
3. **Native fit** - bearer tokens are the standard pattern for native mobile apps; no cookie domain or storage quirks
4. **Future flexibility** - the same token flow works for any future client (Android, CLI, third-party integrations)
5. **Offline resilience** - refresh tokens in Keychain survive app restarts; cookies can be cleared by the OS

### Server-Side Changes Required (Phase 1)

> **Simplified**: Instead of custom JWTs, we reuse Better Auth's session tokens
> as bearer tokens. This avoids new DB tables, JWT signing, and refresh logic.

- Middleware update: inject `Authorization: Bearer <session_token>` as a session cookie so `getSession` validates it (done)
- `GET /api/auth/mobile/callback` - bridge endpoint reads session cookie after OAuth, redirects to `wingdex://` custom scheme with token in URL (done)

---

## Architecture

```
ios/
  WingDex.xcodeproj/
  WingDex/
    App/                    <- SwiftUI App entry, TabView (liquid glass)
    Views/
      HomeView.swift
      OutingsView.swift
      OutingDetailView.swift
      WingDexView.swift
      SpeciesDetailView.swift
      SettingsView.swift
      AddPhotosFlow/        <- Multi-step wizard
        PhotoSelectionView.swift
        ReviewView.swift
        CropView.swift
        ConfirmView.swift
    ViewModels/             <- @Observable view models
    Models/                 <- Codable structs + convenience types
    Services/
      APIClient/            <- Generated by swift-openapi-generator
      AuthService.swift     <- ASWebAuthenticationSession + Keychain
      PhotoService.swift    <- EXIF extraction, compression, clustering
      CropService.swift     <- Crop box math
    Resources/
      taxonomy.json         <- Bundled eBird taxonomy for offline typeahead
    Generated/              <- swift-openapi-generator output (gitignored)
```

### API Client Auto-Generation

Using Apple's `swift-openapi-generator` Xcode build plugin:

1. `openapi.yaml` at repo root describes all `/api/*` endpoints + request/response schemas
2. Build plugin generates type-safe `Client` with methods like `client.identifyBird(...)`, `client.getAllData()`, etc.
3. When the API changes, `xcodebuild` auto-regenerates models - no manual Swift model updates

### What changes are "free" (no app release needed)

| Change type | iOS work |
|---|---|
| New API field (e.g., add `notes` to Observation) | Zero - codegen picks up model change |
| Backend logic change (e.g., better clustering, prompt tweak) | Zero |
| AI prompt improvement | Zero |
| Taxonomy update | Zero (server-side search); app bundle update for offline typeahead |

### What needs a native build

| Change type | iOS work |
|---|---|
| New data view (e.g., statistics chart) | Build SwiftUI view |
| New flow (e.g., social sharing) | Build SwiftUI flow + API calls |
| UI/UX changes | SwiftUI view updates |

---

## Phase 0 - Project Scaffold

Set up the Xcode project, OpenAPI spec, and CI. No functional code yet.

- [x] **Write `openapi.yaml`** - full spec covering all 20+ API endpoints with exact request/response schemas matching the TypeScript types
- [x] **Create Xcode project** - `ios/WingDex/` with SwiftUI App lifecycle, iOS 17 deployment target
- [x] **Configure SPM dependencies** - `swift-openapi-runtime`, `swift-openapi-urlsession`, `KeychainAccess`
- [ ] **Configure OpenAPI build plugin** - point at `openapi.yaml`, generated output in `Generated/` (deferred - requires separate swift-openapi-generator CLI or plugin setup)
- [x] **Create `TabView` shell** - 4 tabs (Home, Outings, WingDex, Settings) with placeholder views
- [x] **Stub all views** - every view file from the architecture, with stub content + `#Preview` macros
- [x] **Stub ViewModels** - `@Observable` classes with published properties and method stubs
- [x] **Stub services** - `AuthService`, `PhotoService`, `CropService` with method signatures + `// TODO`
- [x] **Bundle `taxonomy.json`** - copy from `src/lib/taxonomy.json` into app resources
- [x] **Add `.gitignore`** - `Generated/`, `*.xcuserdata`, `DerivedData/`, `build/`, `.swiftpm/`
- [x] **Add GitHub Actions CI** (`ios.yml`) - build on `macos-15`, validate OpenAPI spec, trigger on `ios/**` or `openapi.yaml` changes

**Verification**: `xcodebuild build` succeeds, CI green, all views render in Previews.

---

## Phase 1 - Auth

Implement bearer token auth so the app can make API calls.

> **Approach simplification**: Instead of custom JWT + refresh token infrastructure,
> we reuse Better Auth's existing session tokens as bearer tokens. The middleware
> injects the bearer token as a cookie so `getSession` validates it normally.
> A mobile callback bridge endpoint extracts the session token after OAuth and
> redirects to the app's custom URL scheme.

### Server-side (backend changes)
- [x] **Middleware update** - accept `Authorization: Bearer <token>` header alongside existing cookie auth (injects as session cookie for Better Auth)
- [x] **`GET /api/auth/mobile/callback`** - bridge endpoint: reads session cookie after OAuth, redirects to `wingdex://auth/callback?token=...` with session token + user info
- [ ] ~~`POST /api/auth/token`~~ - not needed; reusing Better Auth session tokens
- [ ] ~~`POST /api/auth/token/refresh`~~ - not needed; sessions have server-managed expiry
- [ ] ~~`POST /api/auth/token/revoke`~~ - not needed; sessions expire naturally; sign-out clears Keychain
- [ ] ~~Refresh token storage~~ - not needed; using Better Auth's session table

### iOS client
- [x] **AuthService - ASWebAuthenticationSession** - OAuth flow for GitHub and Apple via web OAuth + mobile callback bridge
- [x] **AuthService - Token management** - session token in Keychain via KeychainAccess, auto-restore on launch
- [x] **AuthService - Sign out** - clear Keychain + reset app state
- [x] **SignInView** - sign-in screen with GitHub + Apple buttons
- [x] **SettingsView - Auth UI** - user info display, confirmation dialogs for sign-out and data deletion
- [x] **AuthService - Native Apple Sign-In** - `ASAuthorizationAppleIDProvider` + POST idToken to Better Auth's sign-in/social endpoint
- [x] **Passkey sign-in** - `ASAuthorizationPlatformPublicKeyCredentialProvider` assertion flow with manual challenge cookie forwarding
- [x] **Passkey registration** - register new passkeys from Settings via platform credential registration
- [x] **Passkey management** - list and delete passkeys via `PasskeyManagementView`
- [ ] **AuthService - 401 handling** - intercept 401, prompt re-auth (deferred)

**Verification**: Can sign in via GitHub and Apple, tokens persist across app launches, sign-out clears state.

---

## Phase 2 - Core Data Views

Read-only views displaying data from the API.

- [ ] **HomeView** - species count, recent outings list, "Add Photos" CTA, pull-to-refresh
- [ ] **OutingsView** - chronological outing list with sort/filter, `NavigationStack` push transitions
- [ ] **OutingDetailView** - outing info, MapKit location pin, observation list, swipe-to-delete observations
- [ ] **WingDexView** - species life list with `.searchable`, sort options, `AsyncImage` for Wikimedia thumbnails
- [ ] **SpeciesDetailView** - species info, Wikimedia image, observation history, first/last seen dates
- [ ] **Data layer** - `WingDexDataService` backed by `/api/data/all`, local caching with SwiftData

**Verification**: All data views display real data from the API, navigation works, pull-to-refresh updates.

---

## Phase 3 - Add Photos Flow

The complex multi-step wizard: select photos, extract EXIF, cluster into outings, AI identify, review, confirm, save.

- [ ] **PhotoSelectionView** - `PhotosPicker` multi-select, load selected images
- [ ] **PhotoService - EXIF extraction** - `CGImageSource` for date/GPS metadata
- [ ] **PhotoService - Image compression** - `UIImage` -> JPEG at target quality
- [ ] **PhotoService - Outing clustering** - Haversine distance + time thresholds (2hr/3km), port of web `clustering.ts`
- [ ] **ReviewView** - AI identification results per photo, confirm/reject species, edit observations
- [ ] **CropView** - bird crop interaction with `CropService` math
- [ ] **ConfirmView** - final review of outings + observations, save to API
- [ ] **AddPhotosViewModel** - orchestrate the full flow, manage state between steps

**Verification**: Can select photos, see AI identifications, review/edit, confirm and see new outings in the app.

---

## Phase 4 - Import/Export & Settings

- [ ] **eBird CSV import** - file picker, upload to `/api/import/ebird-csv`, preview conflicts, confirm
- [ ] **Export sightings/dex** - download CSVs via share sheet
- [ ] **Export single outing** - share as eBird CSV
- [ ] **SettingsView** - saved locations, import/export actions, account management, delete account
- [ ] **Delete all data** - confirmation dialog, call `/api/data/clear`

**Verification**: Can import eBird CSV, export all formats, manage account settings.

---

## Phase 5 - Polish & App Store

- [ ] **Local cache** - SwiftData for instant launch + offline browsing of previously loaded data
- [ ] **Error handling** - network errors, server errors, graceful degradation
- [ ] **Haptic feedback** - on milestones (new species), confirmations, interactions
- [ ] **App icon** - design and add to `Assets.xcassets`
- [ ] **Launch screen** - simple branded launch screen
- [ ] **TestFlight** - internal testing build
- [ ] **App Store listing** - screenshots, description, keywords
- [ ] **App Store submission** - review and release

**Verification**: App is polished, handles edge cases, passes App Store review.

---

## Dependencies

| Package | Purpose |
|---|---|
| `swift-openapi-generator` | Apple's build plugin - generates typed API client from `openapi.yaml` |
| `swift-openapi-urlsession` | URLSession transport for the generated client |
| `KeychainAccess` | Secure token/cookie storage |
| SwiftData | Local cache (built into iOS 17+) |

No third-party UI libraries - pure SwiftUI + system frameworks.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| App Store review delays | Server-side logic means most "updates" don't need app releases |
| SwiftUI learning curve | SwiftUI 5+ (iOS 17) is mature; views are standard CRUD + list/detail patterns |
| Keeping OpenAPI spec in sync | CI validates spec against Swift build; `swift-openapi-generator` fails loudly on spec issues |
| Offline support complexity | Start with cache-on-read (SwiftData). Full offline-first (queued mutations) is a later enhancement |
| Bearer token implementation | Short-lived JWTs + refresh rotation is a well-understood OAuth 2.0 pattern; server changes are scoped to 3 new endpoints + middleware update |

---

## SwiftUI View Mapping

| Web Component | SwiftUI View | iOS-native enhancements |
|---|---|---|
| `HomePage.tsx` | `HomeView` | Widgets for species count, pull-to-refresh, haptic on milestones |
| `OutingsPage.tsx` | `OutingsView` + `OutingDetailView` | `NavigationStack` with push transitions, `MapKit` for location, swipe-to-delete |
| `WingDexPage.tsx` | `WingDexView` + `SpeciesDetailView` | `List` with sections, `.searchable`, `AsyncImage` for Wikimedia |
| `SettingsPage.tsx` | `SettingsView` | Native `Form` style, Sign in with Apple button, passkey registration |
| `AddPhotosFlow.tsx` | `AddPhotosFlow/` (multi-view) | `PhotosPicker`, native sheet transitions, haptic feedback |

---

## What the Server Gives for Free

| Concern | Server endpoint | iOS work |
|---|---|---|
| Bird identification | `POST /api/identify-bird` | Just upload a compressed image |
| Species typeahead | `GET /api/species/search?q=` | Just call the endpoint |
| Dex computation | SQL aggregate in mutation responses | Zero - server is authoritative |
| eBird CSV import | `POST /api/import/ebird-csv` -> preview/confirm | Just upload the file |
| eBird/dex export | `GET /api/export/*` | Just download |
| Auth | Better Auth (GitHub/Apple/passkeys) | `ASWebAuthenticationSession` + native Sign in with Apple |

## What Needs Native Implementation

| Concern | Why native | Effort |
|---|---|---|
| Photo selection | `PhotosPicker` (PhotosUI) - native multi-select grid | Trivial |
| EXIF extraction | `CGImageSource` / ImageIO - ~5 lines vs 210 lines of binary parsing on web | Trivial |
| Image compression | `UIImage` -> JPEG at target quality | Trivial |
| Photo clustering | Must run on-device where photos live; ~50 lines of Haversine + sort-merge | Trivial |
| Crop UI math | Coordinate mapping for image crop; ~50 lines | Trivial |
| 4 tab views | SwiftUI views calling the same API | Moderate |
| Add Photos flow | Multi-step wizard: select -> EXIF -> cluster -> identify -> review -> confirm | Moderate |
| Local cache | SwiftData for instant launch + offline browsing | Moderate |
