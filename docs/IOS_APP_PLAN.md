# Native iOS App (SwiftUI) - Plan & Tracker

> Source: [Issue #131](https://github.com/jlian/wingdex/issues/131) - Last updated: 2026-03-04
>
> **Legend**: ✅ Done - ⏳ In Progress - _(unchecked)_ Not started
>
> **Source of truth**: The web app code is the sole source of truth for feature parity. There is no separate PRD.

---

## Overview

A native SwiftUI iOS app that shares the Cloudflare REST API with the web SPA. The server owns all business logic (bird ID, taxonomy search, eBird import, dex computation), so the iOS app is a thin UI client with zero business-logic duplication.

**Target**: iOS 26+ / Xcode 26+ / Swift 6 / SwiftUI lifecycle

---

## Design Principles

The app should feel fully iOS-native, not a web wrapper. Key guidelines:

- **Apple HIG first** - follow the [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) for layout, navigation, typography, and interaction patterns
- **Liquid Glass** - use the iOS 26 liquid glass material system: standard SwiftUI components (TabView, NavigationStack, toolbars, sheets) adopt glass automatically when built with the iOS 26 SDK
- **Bottom tab bar** - three content tabs (Home, WingDex, Outings) clustered left, plus a detached "+" upload button on the right (Apple Music-style layout); no Settings tab (settings accessed via avatar button in top-right navigation bar)
- **System typography** - use SF Pro / SF Rounded via SwiftUI's `.font()` modifiers; no custom fonts unless branding requires it
- **SF Symbols** - prefer Apple's symbol library over custom icons; use symbol effects (bounce, pulse) where appropriate
- **Native controls** - use system pickers, sheets, confirmations, and alerts rather than custom implementations
- **Dark mode** - full support via SwiftUI's automatic color scheme handling, semantic colors, and a user-facing Light/Dark/System toggle
- **Dynamic Type** - all text should scale with the user's preferred text size
- **Accessibility** - VoiceOver labels on all interactive elements; large content viewer support for key metrics
- **Match web vibe, not pixels** - same warm palette (beige page bg, green accent, muted borders) and overall feel as the web app, but using native controls and idioms rather than pixel-perfect clones
- **Shared color palette** - Xcode color assets derived from the web app's computed RGB values; if the web palette changes, update `Assets.xcassets` color sets to match
- **No custom button chrome** - use `.buttonStyle(.bordered)` / `.borderedProminent` and system tints instead of hand-drawn outlines or custom shapes

---

## Navigation Architecture

The app uses a tab bar + navigation bar layout inspired by Apple Music:

```text
┌─────────────────────────────────────────────────┐
│  ◀ Back    Page Title           [Avatar Button] │  <- Navigation bar (per-tab NavigationStack)
│                                                 │
│                 Content Area                    │
│                                                 │
├──────────────────────────────┬──────────────────┤
│  🏠 Home  🐦 WingDex  🔭 Outings │     [＋]      │  <- Tab bar: 3 tabs left, + button right
└──────────────────────────────┴──────────────────┘
```

### Tab Bar

- **Three content tabs clustered left**: Home, WingDex, Outings - these are standard `Tab` items in a `TabView`
- **Detached "+" button on the right**: An "Upload & Identify" action button visually separated from the three nav tabs (like Apple Music's "+" or Spotify's "Create" button). Tapping opens the Add Photos flow as a full-screen `.sheet`. This is NOT a tab destination - it triggers an action
- **No Settings tab**: Settings is accessed from the avatar button in the navigation bar, not from the tab bar

### Avatar / Settings Button

- **Position**: Top-right of the navigation bar (visible on all tabs), matching the web app's header layout and Apple Music's profile button
- **Appearance**: User's avatar image (emoji or social provider photo) rendered as a small circular button (~28pt). If no avatar, show a default person icon
- **Tap action**: Opens a card-style sheet (`.presentationDetents([.medium, .large])`) containing all settings content - Apple Music-style profile card that slides up from the bottom
- **Content**: The existing SettingsView content (account, avatar selection, appearance toggle, import/export, passkeys, data management, sign out) presented inside this card sheet rather than as a tab destination

### Files

- `WingDexApp.swift` - TabView with 3 tabs + toolbar avatar button + sheet for settings
- `SettingsView.swift` - content presented inside the avatar card sheet (no longer a tab)

---

## Prerequisites

- [x] Cloudflare migration (#74) - server-side bird ID, taxonomy search, eBird import
- [x] `openapi.yaml` at repo root describing all API endpoints + schemas
- [x] Apple Developer account ($99/yr)
- [x] Sign in with Apple configured (backend already handles Apple OAuth)
- [x] Register App ID (`app.wingdex`) in Apple Developer portal
- [x] Xcode project in `ios/` directory

### Apple Developer Portal Checklist

- [x] **Register App ID** - `app.wingdex` registered (Team Z8LQS5S492)
- [ ] **Create provisioning profile** - for Development (automatic signing handles simulator; explicit profiles needed for CI)
- [x] **Configure Associated Domains** - AASA file at `public/.well-known/apple-app-site-association`, entitlements with `webcredentials:wingdex.pages.dev`
- [ ] **App Store Connect** - create the app listing when ready for TestFlight

---

## Auth Strategy

The backend uses cookie-based sessions via Better Auth. Instead of custom JWT + refresh token infrastructure, we reuse Better Auth's existing session tokens as bearer tokens. The middleware injects the bearer token as a session cookie so `getSession` validates it normally. A mobile callback bridge endpoint extracts the session token after OAuth and redirects to the app's custom URL scheme.

### Server-Side (done)

- [x] Middleware update: accept `Authorization: Bearer <session_token>` header alongside existing cookie auth
- [x] `GET /api/auth/mobile/callback` - bridge endpoint reads session cookie after OAuth, redirects to `wingdex://auth/callback?token=...`
- [x] `GET /api/auth/mobile/start` - GET proxy for ASWebAuthenticationSession, internally POSTs to Better Auth sign-in/social

### iOS Client (done)

- [x] `ASWebAuthenticationSession` for GitHub and Apple OAuth
- [x] Native Apple Sign-In via `ASAuthorizationAppleIDProvider`
- [x] Passkey sign-in and registration via `ASAuthorizationPlatformPublicKeyCredentialProvider`
- [x] Session token stored in Keychain, auto-restored on launch
- [x] Sign out clears Keychain + resets app state

---

## Architecture

```text
ios/
  WingDex/
    App/                    <- SwiftUI App entry, TabView, navigation
    Views/
      HomeView.swift
      OutingsView.swift
      OutingDetailView.swift
      WingDexView.swift
      SpeciesDetailView.swift
      SettingsView.swift    <- Presented in avatar card sheet, not a tab
      SignInView.swift
      PasskeyManagementView.swift
      AddPhotosFlow/        <- Multi-step wizard (sheet)
        PhotoSelectionView.swift
        OutingReviewView.swift  <- NEW: reverse geocode, place search, outing matching
        PerPhotoConfirmView.swift <- NEW: per-photo confirm with Wikipedia ref
        CropView.swift
        ConfirmView.swift
    ViewModels/
      AddPhotosViewModel.swift
    Models/
      AppModels.swift
    Services/
      AuthService.swift
      DataService.swift
      DataStore.swift
      PhotoService.swift
      CropService.swift
      PasskeyService.swift
    Extensions/
      Theme.swift
      DateFormatting.swift
      Data+Base64URL.swift
    Resources/
      taxonomy.json
```

### What changes are "free" (no app release needed)

| Change type | iOS work |
| --- | --- |
| New API field (e.g., add `notes` to Observation) | Zero - update Codable model |
| Backend logic change (e.g., better clustering, prompt tweak) | Zero |
| AI prompt improvement | Zero |
| Taxonomy update | Zero (server-side search); app bundle update for offline typeahead |

### What needs a native build

| Change type | iOS work |
| --- | --- |
| New data view (e.g., statistics chart) | Build SwiftUI view |
| New flow (e.g., social sharing) | Build SwiftUI flow + API calls |
| UI/UX changes | SwiftUI view updates |

---

## Phase 0 - Project Scaffold ✅

- [x] Write `openapi.yaml` covering all 20+ API endpoints
- [x] Create Xcode project with SwiftUI App lifecycle
- [x] Configure SPM dependencies (`swift-openapi-runtime`, `swift-openapi-urlsession`, `KeychainAccess`)
- [x] Create `TabView` shell with placeholder views
- [x] Stub all views, ViewModels, and services
- [x] Bundle `taxonomy.json` for offline typeahead
- [x] Add `.gitignore` and GitHub Actions CI (`ios.yml`)

---

## Phase 1 - Auth ✅

- [x] `AuthService` - ASWebAuthenticationSession OAuth for GitHub and Apple
- [x] Token management - Keychain storage, auto-restore, sign out
- [x] `SignInView` - GitHub + Apple + Passkey buttons with mode toggle (sign up / log in)
- [x] Native Apple Sign-In via `ASAuthorizationAppleIDProvider`
- [x] Passkey sign-in, registration, and management (`PasskeyManagementView`)
- [x] SettingsView auth UI - user info, sign out, delete data confirmations
- [ ] **401 handling** - intercept 401, prompt re-auth (deferred to Phase 8)

---

## Phase 2 - Core Data Views ✅

- [x] `HomeView` - species count, recent species cards (horizontal scroll, gradient overlay), recent outings list, "Upload & Identify" CTA, pull-to-refresh, empty state
- [x] `OutingsView` - chronological outing list with search, sort (date/species/name), mini map previews (MapKit), pull-to-refresh
- [x] `OutingDetailView` - stats cards, MapKit map, confirmed/possible species sections, editable notes, delete outing
- [x] `WingDexView` - species life list with `.searchable`, sort by date/count/name, portrait-aware thumbnails, image cache (200 limit)
- [x] `SpeciesDetailView` - hero image with progressive load (blurred thumbnail -> full-res), Wikipedia extract + CC BY-SA attribution, external links (Wikipedia, eBird, All About Birds), sightings list
- [x] Data layer - `DataService` + `DataStore` backed by `/api/data/all`, environment injection

---

## Phase 2.5 - Styling & Layout ✅

- [x] Color assets - PageBackground, CardBackground, AccentColor from web's computed RGB values
- [x] Theme extension - `Color.pageBg`, `.cardBg`, `.mutedText`, `.foregroundText`, `.warmBorder`
- [x] Edge-to-edge layout - `UILaunchScreen: {}` for full-screen rendering
- [x] Native `List` + `.listStyle(.plain)` + `.scrollContentBackground(.hidden)` + `UITableViewCell.appearance().backgroundColor` = themed backgrounds with native press highlights
- [x] SignInView - native buttons with consistent height, mode toggle
- [x] Tab bar icon - separate `BirdTab` image set for liquid glass rendering

---

## Phase 3 - Add Photos Flow (Initial) ✅

Basic flow implemented, but needs significant rework to match web app (see Phase 3-R).

- [x] `PhotoSelectionView` - `PhotosPicker` multi-select, load images
- [x] `PhotoService` - EXIF extraction (date/GPS), JPEG compression, thumbnail generation, SHA-256 hash, Haversine clustering (2hr/3km)
- [x] `ReviewView` - AI identification results per photo, confirm/reject
- [x] `CropView` - crop interaction with `CropService` math
- [x] `ConfirmView` - final review + save to API
- [x] `AddPhotosViewModel` - orchestrate flow, manage state between steps

---

## Phase 3.5 - Navigation & SignIn Rework

The current iOS app uses a 4-tab layout (Home, WingDex, Outings, Settings) with an "Upload" button in the top-right nav bar. This needs to migrate to the new navigation architecture defined above, and the SignInView needs significant rework to match the web's auth modal.

### 3.5.1: Tab Bar & Navigation Migration

Migrate from the current 4-tab layout to the new architecture: 3 tabs left + detached "+" button right + avatar settings sheet.

- [ ] **Remove Settings tab**: Delete the 4th tab from `TabView`. Three content tabs remain: Home, WingDex, Outings
- [ ] **Cluster tabs left**: Position the three tabs on the left side of the tab bar
- [ ] **Add detached "+" button**: Place an "Upload & Identify" action button on the right side of the tab bar, visually separated from the three tabs (Apple Music-style). Tapping opens the AddPhotos flow as a `.sheet`. This replaces the current top-right nav bar upload button
- [ ] **Avatar button in nav bar**: Add a small circular avatar button (~28pt) to the top-right of the navigation bar, visible on all tabs. Shows user's emoji avatar or social provider photo; falls back to `person.circle.fill` SF Symbol. Tapping presents `SettingsView` in a card-style sheet with `.presentationDetents([.medium, .large])`
- [ ] **Update BirdLogo and BirdTab assets**: Replace the current Phosphor-style bird SVGs with the new app icon artwork (updated March 2026 on web: `public/favicon.svg`, `public/icon-192.png`, `public/icon-512.png`). Ensure the tab icon and sign-in logo use the new design

**Files**: `WingDexApp.swift`, `SettingsView.swift`, `Assets.xcassets` (BirdLogo, BirdTab image sets)

### 3.5.2: SignInView Rework

The current iOS SignInView is a full-screen `ScrollView` with a single passkey button that changes label based on signup/login mode. The web's auth modal has a different structure that should be matched:

- [ ] **Remove unnecessary ScrollView**: The sign-in content should not be scrollable on normal device sizes. Use a centered `VStack` within a `GeometryReader` without wrapping in `ScrollView`. Only allow scrolling if Dynamic Type pushes content beyond the viewport
- [ ] **Title**: Change from "Sign up" / "Log in" to "Start your WingDex" (matching web's `DialogTitle`)
- [ ] **Social buttons first**: GitHub and Apple buttons at the top (matching web order: social providers above passkey)
- [ ] **Passkey section with border**: Wrap the passkey area in a bordered, lightly tinted container (matching web's `rounded-lg border border-border/70 bg-muted/20 px-3 py-3`). Show a centered header: Key icon + "Continue with a Passkey"
- [ ] **Two passkey buttons side-by-side**: Replace the single mode-switching passkey button with two buttons in a horizontal grid (matching web's `grid-cols-2`): "Log in" (primary/filled) and "Sign up" (outlined). Both always visible regardless of mode
- [ ] **Remove mode toggle**: Since the passkey section now has both Log in and Sign up buttons, the "Already have a WingDex? Log in" / "New to WingDex? Sign up" toggle is no longer needed. Remove it entirely
- [ ] **Error display**: Keep the red error text below the passkey section
- [ ] **Demo data toggle** (DEBUG only): Add a toggle switch matching web's demo data toggle: label "Demo data", subtitle "Preview WingDex with sample sightings", bordered container
- [ ] **Loading state**: Show `ProgressView` overlay and disable all buttons when `isSigningIn` is true

**Files**: `SignInView.swift`
**Reference**: `src/hooks/use-auth-gate.tsx` (auth modal JSX)

---

## Phase 3-R - Add Photos Flow Rework

The iOS flow is ~60% feature-complete vs the web app. The web wizard is a 9-step flow with per-photo confirmation, two-tier AI, crop retry, and outing review. The iOS flow needs fundamental restructuring to match.

**Web flow**: upload -> extracting -> outing-review -> photo-processing -> \[manual-crop\] -> photo-confirm -> \[multi-cluster loop\] -> save -> done

**Current iOS flow**: selectPhotos -> processing -> review (batch) -> confirm -> done

**Target iOS flow**: selectPhotos -> processing -> outingReview -> photoProcessing -> perPhotoConfirm (with crop-retry loop) -> confirm -> done

### 3-R.1: Outing Review Step

Does not exist on iOS. This is a NEW step inserted after photo extraction/clustering and BEFORE AI identification.

After photos are extracted and clustered, the user reviews each cluster as a potential outing:

- [ ] **Reverse geocoding**: Call Nominatim API with cluster center coordinates to detect location name (priority: parks/reserves -> natural features -> neighborhoods -> cities)
- [ ] **Location display**: Show detected location name with GPS coordinates, or "Unknown Location" if no GPS
- [ ] **Date/time display**: Show cluster start time extracted from EXIF, formatted with timezone
- [ ] **Manual date/time override**: User can tap date/time to edit via native `DatePicker`
- [ ] **Place search**: Nominatim autocomplete - user can search for any location name, select from suggestions to override coordinates and location name
- [ ] **State/country extraction**: Automatically extract ISO 3166-2 state/province code and country code from geocoding result (stored on the outing for eBird compatibility)
- [ ] **Existing outing matching**: Check if cluster overlaps an existing outing (time +/-2 hours, distance <=3 km; relaxed to 50 km if times nearly match <=30 min). If match found, show "Add to existing outing?" toggle. If adding to existing, expand outing's time range and fill missing fields
- [ ] **Per-cluster navigation**: If multiple clusters, navigate between them (e.g., "Outing 1 of 3" with next/prev)

**New file**: `OutingReviewView.swift` in `AddPhotosFlow/`
**Updates**: `AddPhotosViewModel.swift` - new step in flow state machine, Nominatim API calls, `findMatchingOuting` logic
**Reference**: `src/components/flows/OutingReview.tsx`, `src/lib/clustering.ts` (`findMatchingOuting`, `clusterPhotosIntoOutings`)

### 3-R.2: Two-Tier AI Identification

iOS currently sends one `model: "fast"` request per photo. The web uses a fast-then-strong escalation strategy.

- [ ] **Fast model first**: Send each photo to `POST /api/identify-bird` with `model: "fast"` (~1.2s timeout)
- [ ] **Escalation logic**: If confidence of top candidate < 0.75, OR gap between top-2 candidates < 0.15, re-send the same photo with `model: "strong"` (~4.4s timeout)
- [ ] **User feedback**: Show status messages during processing - "Identifying species..." for fast model, "Re-analyzing with enhanced model..." when escalating to strong
- [ ] **Progress**: Show "Photo X of N" counter with progress bar (exponential animation to ~90% before completion)

**Updates**: `AddPhotosViewModel.swift` - `identifySpecies` method needs escalation logic
**Reference**: `src/lib/ai-inference.ts` (`identifyBirdInPhoto` function with fast/strong model switching)

### 3-R.3: Per-Photo Confirmation UI

iOS currently batch-confirms all photos. The web does per-photo confirmation with a rich comparison UI.

Replace the current batch `ReviewView` with a sequential per-photo confirmation flow:

- [ ] **Side-by-side comparison**: Display the user's photo next to a Wikipedia reference image of the identified species (fetched via Wikimedia Summary API). This lets users visually verify the AI's suggestion
- [ ] **Color-coded confidence bar**: Horizontal progress bar showing AI confidence percentage. Green (>=80%), yellow (50-79%), red (<50%)
- [ ] **High confidence (>=80%)**: Auto-select the top candidate. Show "Confirm" (primary) and "Possible" (secondary) buttons. User can tap "Confirm" to mark as confirmed, or "Possible" if uncertain
- [ ] **Low confidence (<80%)**: Show all candidates as a tappable list. No auto-selection. User must choose a candidate or skip
- [ ] **"Back" button**: Navigate to the previous photo's decision to revise it (undo previous confirmation and re-show that photo)
- [ ] **"Crop & Retry" button**: Opens `CropView` for manual cropping, then re-submits the cropped image to the AI. Use AI-suggested `cropBox` as the initial crop position when available
- [ ] **"Skip" button**: Reject this photo entirely (certainty = "rejected", excluded from final save)
- [ ] **Alternative candidates**: List of all AI candidates with confidence percentages. Tap any candidate to select it instead of the top suggestion
- [ ] **Count field**: Allow user to adjust observation count (default 1) if multiple individuals of same species visible

**New file**: `PerPhotoConfirmView.swift` in `AddPhotosFlow/`
**Updates**: `AddPhotosViewModel.swift` - per-photo state machine, back navigation, crop-retry loop
**Reference**: `src/components/flows/AddPhotosFlow.tsx` (`PerPhotoConfirm` component)

### 3-R.4: Crop & Retry Integration

`CropView` and `CropService` exist but are disconnected from the AI retry pipeline.

Wire the existing crop UI into the identification retry flow:

- [ ] **Auto-prompt on multi-bird**: When AI returns `multipleBirds: true`, automatically open `CropView` and prompt: "Multiple birds detected - crop to one bird"
- [ ] **Auto-prompt on no detection**: When AI returns 0 candidates from the full image, automatically open `CropView` and prompt: "No bird detected - try cropping to the bird"
- [ ] **Manual crop from confirm UI**: "Crop & Retry" button in `PerPhotoConfirmView` opens `CropView` at any time
- [ ] **AI cropBox as initial position**: When the AI response includes a `cropBox` (percentage coordinates), use it as the initial crop rectangle position with padding (0.65x ratio, matching web's `paddedSquareCrop`)
- [ ] **Re-identification after crop**: After user confirms crop, generate a new compressed JPEG from the cropped region and re-submit to `POST /api/identify-bird`. Do NOT re-prompt for crop after a user-initiated crop (prevent infinite loop)

**Updates**: Wire `CropView.swift` and `CropService.swift` into the `PerPhotoConfirmView` flow
**Reference**: `src/components/flows/ImageCropDialog.tsx`

### 3-R.5: Certainty Level Support

iOS currently marks ALL confirmed photos as `certainty: "confirmed"`.

- [ ] **"Confirm" button**: Sets observation `certainty` to `"confirmed"` - species is added to WingDex
- [ ] **"Possible" button**: Sets observation `certainty` to `"possible"` - species is recorded but NOT added to WingDex (matches web behavior where only confirmed species appear in the dex)
- [ ] **"Skip" button**: Sets `certainty` to `"rejected"` or excludes the photo entirely from the final save
- [ ] **Auto-selection rule**: Only auto-select the top candidate when confidence >= 0.80 - but the user must still tap "Confirm" or "Possible" to proceed (no silent auto-confirmation)

**Updates**: `AddPhotosViewModel.swift`, `PerPhotoConfirmView.swift`

### 3-R.6: GPS Context Toggle

The web has a "Use GPS & date for better ID" toggle that controls whether location context is sent to the AI.

- [ ] **Toggle location**: Add a toggle to the photo selection step or the outing review step
- [ ] **When enabled**: Send `lat`, `lon`, `month`, and `locationName` fields in the `POST /api/identify-bird` request body alongside the image
- [ ] **When disabled**: Send only the `imageDataUrl`, `imageWidth`, `imageHeight` fields (no location context)
- [ ] **Default**: Enabled (GPS context improves accuracy significantly)

**Updates**: `PhotoSelectionView.swift` or `AddPhotosViewModel.swift`

### 3-R.7: Duplicate Photo Detection UI

SHA-256 file hash computation exists in `PhotoService`, but there is no UI to handle detected duplicates.

- [ ] **Hash comparison**: After extracting EXIF and computing file hashes, compare each hash against existing photos in `DataStore.photos`
- [ ] **Duplicate found**: Show a confirmation dialog: "This photo was previously uploaded. Reimport or skip?"
- [ ] **"Reimport"**: Process the photo normally (creates new observation)
- [ ] **"Skip"**: Exclude the photo from the current batch
- [ ] **Batch handling**: If multiple duplicates found, show them together or one-by-one with a "Skip All Duplicates" option

**Updates**: `AddPhotosViewModel.swift`, `DataStore.swift` (lookup by file hash)

### 3-R Verification

Select 5+ photos from library -> see outing review with reverse-geocoded location and date -> AI identifies one-at-a-time with fast model, escalates to strong when uncertain -> per-photo confirm shows user photo alongside Wikipedia reference image with confidence bar -> can tap Back to revisit previous photo -> crop & retry auto-prompts on multi-bird and works manually -> certainty selection (Confirm/Possible/Skip) -> GPS toggle works -> duplicates detected -> save creates correct outings with state/country codes and proper certainty values.

---

## Phase 4 - Settings & Profile Parity

Settings is now accessed via the avatar button in the navigation bar (not a tab) per Phase 3.5. Content is presented in a card-style sheet (Apple Music-style). All features below match the web's SettingsPage.

### 4.1: Display Name Editing

iOS shows the name read-only. The web has an inline pencil edit button.

- [ ] **Pencil icon**: Show a pencil (SF Symbol `pencil`) button next to the "Welcome, {name}" text
- [ ] **Edit flow**: Tap pencil -> present an alert with a `TextField` pre-filled with the current name (or use inline editing with Save/Cancel buttons)
- [ ] **Save**: Call the profile update API with the new name. Immediately refresh the UI including the avatar button in the nav bar
- [ ] **Validation**: Trim whitespace, reject empty names

**Files**: `SettingsView.swift`
**Reference**: `SettingsPage.tsx` (name editing section with `window.prompt()`)

### 4.2: Random Bird Nickname Generator

Does not exist on iOS. The web has a circular arrows button that generates a bird-themed display name + emoji avatar.

- [ ] **Button**: Circular arrows icon (SF Symbol `arrow.clockwise`) next to the name
- [ ] **Logic**: Port `generateBirdName()` from `src/lib/fun-names.ts` - combines bird adjectives + species names (e.g., "Cheerful Kingfisher") and picks a random emoji avatar from the 8-emoji set
- [ ] **Auto-save**: Immediately saves the generated name + emoji avatar to the profile API
- [ ] **New file**: `FunNames.swift` utility with the bird name/adjective arrays and generation logic

**Files**: `SettingsView.swift`, new `FunNames.swift`
**Reference**: `src/lib/fun-names.ts` (`generateBirdName`, `BIRD_ADJECTIVES`, `BIRD_NOUNS`, `BIRD_EMOJIS`)

### 4.3: Avatar Emoji Selection

Does not exist on iOS. The web has a row of 8 emoji buttons.

- [ ] **Emoji grid**: Row of 8 circular buttons: 🐦 🦉 🦜 🐧 🦆 🦩 🦅 🐤
- [ ] **Selected state**: Currently selected emoji gets a highlighted ring (`ring-2 ring-primary ring-offset-2` equivalent)
- [ ] **Tap selected emoji**: Restore the original social provider avatar (or clear to default)
- [ ] **Tap unselected emoji**: Apply that emoji as the avatar + auto-save to profile API
- [ ] **Avatar format**: Store as emoji data-URL to match web format (the web encodes emojis as small canvas-rendered data URLs)
- [ ] **Background color**: Port `getEmojiAvatarColor()` from `src/lib/fun-names.ts` - each emoji gets a consistent background color for the avatar circle
- [ ] **Disabled during save**: All buttons disabled while profile save is in flight

**Files**: `SettingsView.swift`, port avatar utilities from `src/lib/fun-names.ts`
**Reference**: `SettingsPage.tsx` (avatar section)

### 4.4: Appearance Toggle (Light/Dark/System)

Does not exist on iOS. The web uses `next-themes` with three buttons.

- [ ] **Three-button toggle**: Sun icon (Light), Moon icon (Dark), Monitor icon (System) using SF Symbols (`sun.max`, `moon`, `desktopcomputer`)
- [ ] **Selected state**: Selected button uses default/filled variant; unselected buttons use outline variant
- [ ] **Persistence**: Store preference in `UserDefaults` (key: `appearance`)
- [ ] **Apply**: Override all window scenes' `overrideUserInterfaceStyle` via `UIApplication.shared.connectedScenes`
- [ ] **"System" mode**: Sets `overrideUserInterfaceStyle = .unspecified`, following the iOS system preference
- [ ] **Immediate effect**: Changing the toggle applies instantly without requiring app restart

**Files**: `SettingsView.swift`, `Theme.swift` (appearance management), `WingDexApp.swift` (restore on launch)

### 4.5: eBird CSV Import with Timezone Picker

Stub exists (button present, marked TODO). Needs full implementation matching the web's import flow.

- [ ] **Import button**: Opens a sheet with the timezone selection + file picker flow
- [ ] **Timezone dropdown**: Picker with 15 preset timezones + "None (times already local)" option. Each timezone shows its current DST-aware UTC offset (e.g., "UTC-10:00 - Hawaii", "UTC-05:00 - Eastern"). The timezone list matches the web's `TIMEZONE_PRESETS` array exactly
- [ ] **Help section**: Collapsible "How to export from eBird" with 3-step instructions: (1) Go to ebird.org/downloadMyData and sign in, (2) Click Submit to request download, (3) Receive email with CSV, upload here. Plus a note: "WingDex will create outings grouped by date and location"
- [ ] **File picker**: `.fileImporter` with `.csv` UTType. On file selection, read the CSV data
- [ ] **Preview API**: Call `POST /api/import/ebird-csv` with the CSV content and selected timezone. Server returns preview with conflict detection (new / duplicate / update_dates)
- [ ] **Conflict display**: Show duplicates from existing data. Auto-select non-duplicate previews. Let user toggle individual items
- [ ] **Confirm import**: Call `POST /api/import/ebird-csv/confirm` with selected preview IDs and timezone
- [ ] **Success feedback**: Toast with counts ("Imported eBird data across N outings") + confetti animation if new species were added

**Files**: `SettingsView.swift`, new `EBirdImportView.swift` sheet, `DataService.swift` (import API calls)
**Reference**: `SettingsPage.tsx` (import section), `functions/api/import/`

### 4.6: Export Sightings CSV

Stub exists (button present, marked TODO). Needs implementation.

- [ ] **Export button**: Disabled if `dex.length == 0`. Tap triggers `GET /api/export/sightings`
- [ ] **Save**: Present `UIActivityViewController` (share sheet) with the downloaded CSV data
- [ ] **Filename**: `wingdex-sightings-YYYY-MM-DD.csv`
- [ ] **Feedback**: Toast "Sightings CSV exported" on success

**Files**: `SettingsView.swift`, `DataService.swift` (export API call)

### 4.7: Data Privacy Card

Does not exist on iOS.

- **Static informational card** matching the web's "Data Storage & Privacy" section:
  - **Photos**: "Your photos are not retained. Compressed images are sent to AI for identification, then discarded. A file hash is stored for duplicate detection."
  - **Records**: "Birding records are saved to a Cloudflare-backed database, scoped to your account."
  - **Third-party**: "Location lookups via OpenStreetMap Nominatim. Species images from Wikimedia Commons."
  - **Links**: Tappable links to Privacy Policy and Terms of Use (already served at `public/privacy.html` and `public/terms.html`)

**Files**: `SettingsView.swift`

### 4.8: Delete Account & All Data (Two-Stage Confirmation)

iOS only has "Delete All Data" (single confirmation). The web has a separate "Delete Account & All Data" with a two-stage confirmation flow.

- [ ] **First confirmation**: Alert titled "Delete your entire account?" with a list of what gets deleted: all outings and observations, entire WingDex species list, passkeys and login credentials, account and profile. Warning: "There is no way to recover your data after this." Secondary button leads to stage 2
- [ ] **Second confirmation**: Alert titled "Are you absolutely sure?" with destructive button "Delete my account forever"
- [ ] **Execution**: Call account deletion API, clear all local state (DataStore, Keychain), sign out, dismiss settings sheet
- [ ] **Feedback**: Toast "Account deleted"

**Files**: `SettingsView.swift`, `DataService.swift`, `AuthService.swift`

### 4.9: Remove "Saved Locations" Stub

iOS has a placeholder "No saved locations" section that references a feature the web app removed.

- Delete the "Saved Locations" section from `SettingsView.swift` entirely

**Files**: `SettingsView.swift`

### Phase 4 Verification

Edit name (pencil), generate nickname (arrows), pick emoji avatar (8 grid) -> appearance toggle switches between Light/Dark/System immediately -> import eBird CSV with timezone picker works end-to-end with conflict display -> export sightings CSV via share sheet -> privacy card shows correct disclosures -> delete account requires 2 confirmations then signs out -> no "Saved Locations" section.

---

## Phase 5 - Outing Detail Editing Parity

The iOS `OutingDetailView` is read-only except for notes editing and outing deletion. The web supports full editing. Five capabilities are missing.

### 5.1: Edit Location Name

iOS shows the location name as a static title. The web has a pencil icon that opens an autocomplete input.

- [ ] **Pencil icon**: SF Symbol `pencil` in the header area next to the location name
- [ ] **Edit mode**: Tap pencil -> replace the title with a `TextField` pre-filled with the current name. Show Save and Cancel buttons
- [ ] **Autocomplete**: As the user types, show suggestions filtered from all existing outing location names (client-side filter from `DataStore.outings`)
- [ ] **Save**: Call `PATCH /api/data/outings/{id}` with the new `locationName`. Update local state immediately
- [ ] **Empty name**: Resets to the default geocoded location name (or "Unknown Location")

**Files**: `OutingDetailView.swift`
**Reference**: `OutingsPage.tsx` (edit location name section)

### 5.2: Delete Individual Species/Observation

iOS can only delete entire outings. The web has per-species delete with confirmation.

- [ ] **Delete trigger**: Trailing swipe action on each species row (trash icon, destructive style), or a trash icon button visible on each row
- [ ] **Confirmation dialog**: "Remove {species name} from outing?" with Cancel and Remove buttons
- [ ] **Execution**: Call `PATCH /api/data/observations` to mark the observation as `certainty: "rejected"` (soft delete matching web behavior)
- [ ] **UI update**: Remove the species from the visible list immediately

**Files**: `OutingDetailView.swift`
**Reference**: `OutingsPage.tsx` (delete observation section)

### 5.3: Add Species Manually

Does not exist on iOS. The web has an "+ Add Species" button with taxonomy autocomplete.

- [ ] **"+ Add Species" button**: Toggle button in the species list section header. When active, shows an inline form; when inactive, shows the button label
- [ ] **Species name input**: Text field with autocomplete dropdown powered by server-side taxonomy search (`GET /api/species/search?q=...&limit=8`). Debounce input by 150ms before sending search request
- [ ] **Add action**: Tap "Add" creates a new observation with `count: 1`, `certainty: "confirmed"`, linked to this outing
- [ ] **Feedback**: Toast "{species name} added". Clear input, close form
- [ ] **Keyboard navigation**: Autocomplete results navigable with tap (no hardware keyboard expected on iOS, but support standard list selection)

**Files**: `OutingDetailView.swift`, `DataService.swift` (species search API call)
**Reference**: `OutingsPage.tsx` (add species section)

### 5.4: Export Individual Outing as eBird CSV

Does not exist on iOS. The web has an "Export eBird CSV" button per outing.

- [ ] **Button**: "Export eBird CSV" with download icon, placed in the action buttons area at the bottom of the detail view
- [ ] **Disabled state**: Greyed out if the outing has no confirmed observations
- [ ] **Execution**: Fetch `GET /api/export/outing/{id}`, receive CSV data
- [ ] **Save**: Present `UIActivityViewController` (share sheet) with the CSV file
- [ ] **Feedback**: Toast "Outing exported in eBird Record CSV format"

**Files**: `OutingDetailView.swift`, `DataService.swift`

### 5.5: Tappable Coordinates / Map Link

iOS shows an embedded MapKit view but has no external link. The web shows clickable coordinates that open Google Maps.

- [ ] **Tappable coordinates**: Below or alongside the embedded map, show coordinates as tappable text: "(lat, lon)" formatted to 4 decimal places
- [ ] **Tap action**: Open in Apple Maps via `MKMapItem.openMaps()` with the coordinates, or offer a choice between Apple Maps and Google Maps
- [ ] **Apple Maps URL**: `maps://?q={lat},{lon}`

**Files**: `OutingDetailView.swift`

### Phase 5 Verification

Tap outing -> edit location name with autocomplete from past outings -> add species via taxonomy search -> delete species (swipe, confirmation, soft delete) -> export outing eBird CSV via share sheet -> tap coordinates opens Apple Maps.

---

## Phase 6 - Species Detail & WingDex Parity

Five gaps between the iOS and web species/WingDex views.

### 6.1: eBird Code API Lookup

iOS currently constructs the eBird URL by hardcoding the common name into the URL path. The web uses an API call with algorithmic fallback.

- [ ] **API call**: Fetch `GET /api/species/ebird-code?name={speciesName}` to get the accurate eBird species code
- [ ] **Fallback**: If API call fails, construct the code algorithmically (lowercase, replace spaces with underscores, etc.)
- [ ] **Cache**: Cache the result per species in memory to avoid repeated API calls
- [ ] **URL**: Use the code to build the correct eBird URL: `https://ebird.org/species/{ebirdCode}`

**Files**: `SpeciesDetailView.swift`, `DataService.swift` (new API call)
**Reference**: `WingDexPage.tsx` (`fetchEBirdCode` function)

### 6.2: Certainty Badges in Sightings List

iOS shows sightings without any certainty indicator. The web shows "confirmed" or "possible" badges.

- [ ] **Badge**: Show a subtle text badge ("confirmed" or "possible") next to each sighting in the sightings list
- [ ] **Styling**: "Possible" badge uses a muted/warning color to distinguish from confirmed sightings

**Files**: `SpeciesDetailView.swift`

### 6.3: Observation Count in Sightings

iOS doesn't show the count per sighting. The web shows `xN` when count > 1.

- [ ] **Count display**: Show `x{count}` next to the species name in each sighting row when the observation count is greater than 1

**Files**: `SpeciesDetailView.swift`

### 6.4: Species Notes Display

iOS doesn't display notes for species. The web shows a "Notes" section at the bottom of the species detail view.

- [ ] **Notes section**: If `dexEntry.notes` is non-empty, show a "Notes" section heading with the notes text below in italic
- [ ] **Read-only**: Notes are displayed but not editable from the species detail view (they can be edited on the web)

**Files**: `SpeciesDetailView.swift`

### 6.5: WingDex Family Sort

iOS has 3 sort options (date, count, name). The web has a 4th: Family (taxonomic).

- [ ] **New sort option**: Add "Family" sort (leaf icon, SF Symbol `leaf`) to the sort menu in `WingDexView`
- [ ] **Taxonomy order data**: Lazy-load taxonomy order data (taxonomic sort order from the bundled `taxonomy.json` or a derived lookup table). Port logic from `src/lib/taxonomy-order.ts`
- [ ] **Sort behavior**: Group and sort species by their taxonomic family. Default direction: ascending (A-Z by family then by taxonomic order within family)

**Files**: `WingDexView.swift`
**Reference**: `WingDexPage.tsx` (family sort), `src/lib/taxonomy-order.ts`

### Phase 6 Verification

Species detail eBird link opens correct species page (API-verified code) -> sightings show "confirmed"/"possible" badges + count when > 1 -> notes section visible when present -> WingDex Family sort groups species by taxonomic family.

---

## Phase 7 - Celebrations & Feedback

The web shows confetti + lifer toasts when new species are added. iOS has none of this.

### 7.1: Confetti Animation

- [ ] **Trigger**: Fire confetti animation when `newSpeciesCount > 0` after AddPhotos save, or after eBird import adds new species
- [ ] **Implementation**: Native SwiftUI particle effect or lightweight confetti modifier. Duration ~1.4s matching web
- [ ] **Reduce Motion**: If `UIAccessibility.isReduceMotionEnabled`, skip confetti and show a subtle fade-in banner instead

**Files**: New `ConfettiModifier.swift` or similar, applied in `AddPhotosFlow` (done screen) and `SettingsView` (after eBird import)

### 7.2: Lifer Toast

- [ ] **Message**: "Species added to your WingDex" banner when a species is first recorded (new to the user's life list)
- [ ] **Implementation**: SwiftUI toast/banner overlay (environment-based) that auto-dismisses after ~3 seconds
- [ ] **Haptic**: Pair with `.sensoryFeedback(.success)` haptic

**Files**: Toast/notification overlay system (environment-based, reusable across the app)

### 7.3: Haptic Feedback

- **Success haptic** (`.sensoryFeedback(.success)`): On save confirmations (AddPhotos, outing edit, species add, import)
- **Impact haptic** (`.sensoryFeedback(.impact)`): On milestones (new species, first outing)
- [ ] **Selection haptic**: On sort/filter changes, tab switches

**Files**: Various views where save/milestone actions occur

### Phase 7 Verification

Add photos with a new species -> confetti animation fires + lifer toast with haptic -> import eBird CSV with new species -> confetti fires -> no confetti when Reduce Motion is on.

---

## Phase 8 - Dark Mode, Auth Fixes & Error Handling

### 8.1: Define Dark Color Palette

iOS has light mode colors only.

- [ ] **Web dark colors**: Background `#262e29`, card darker variant, lighter text, adjusted borders
- [ ] **Color assets**: Add dark mode variants to all custom `Color` extensions in `Theme.swift` and color sets in `Assets.xcassets`
- [ ] **Verify semantic usage**: Ensure all views use `Color.pageBg`, `Color.cardBg`, etc. and never hardcoded color values

**Files**: `Theme.swift`, `Assets.xcassets` color sets

### 8.2: Appearance Toggle Wiring

Depends on Phase 4.5 (appearance toggle UI).

- [ ] **UserDefaults**: Store preference as `"light"`, `"dark"`, or `"system"` in UserDefaults
- [ ] **Apply**: On launch and on toggle change, set `overrideUserInterfaceStyle` on all connected window scenes
- [ ] **System mode**: `overrideUserInterfaceStyle = .unspecified` follows iOS system setting

**Files**: `Theme.swift`, `WingDexApp.swift`

### 8.3: Full Dark Mode Visual Audit

- Every view, every shared component in both light and dark
- Check contrast ratios and text legibility (especially text overlaid on images with gradient)
- Verify `UITableViewCell.appearance().backgroundColor` and other UIAppearance overrides work correctly in dark mode
- Verify map styling (`.standard` map with dark scheme)

### 8.4: Fix 401 on API Calls ✅

Fixed. Root cause: middleware injected bearer token with wrong cookie name on HTTPS (`better-auth.session_token` vs `__Secure-better-auth.session_token`). Fix: inject both prefixed and non-prefixed cookie names so it works regardless of the `useSecureCookies` setting.

- [x] **Dual cookie injection**: Middleware now injects both `better-auth.session_token` and `__Secure-better-auth.session_token`
- [x] **Mobile callback cookie extraction**: Reads both prefixed and non-prefixed cookie names

### 8.5: 401 Auto-Retry

- [ ] **Intercept**: When any API call returns HTTP 401, intercept the response in `DataService`
- [ ] **Re-auth prompt**: Present the sign-in sheet (via a published property or notification)
- [ ] **Retry**: After successful re-authentication, retry the original API request that triggered the 401

**Files**: `DataService.swift` or a shared API middleware layer

### 8.6: Session Expiry Handling

- [ ] **Foreground check**: When the app returns to foreground (`scenePhase == .active`), check the stored token's age
- [ ] **Near expiry**: If the token is close to expiring, make a silent validation request to the server (`GET /api/auth/get-session`)
- [ ] **Expired**: If validation fails, prompt re-auth

**Files**: `AuthService.swift`, `WingDexApp.swift`

### 8.7: Error Handling Overhaul (iOS)

Currently errors are either silently ignored or show raw `localizedDescription` strings which are often unhelpful (e.g., "(null)" for ASAuthorization errors). Needs a systematic pass across the entire iOS app.

- [ ] **Typed error mapping**: Create a central `AppError` enum that maps network errors, auth errors, passkey errors, and API errors to user-friendly messages. All `catch` blocks should map through this instead of using raw `localizedDescription`
- [ ] **User-facing error alerts**: Show `.alert` or banner for errors that need user action (auth failure, network unreachable). Show inline error text for recoverable errors (form validation, import conflicts)
- [ ] **Network error handling**: Detect no-connectivity (`URLError.notConnectedToInternet`) and show a clear offline banner. Detect timeouts and offer retry. Detect server errors (500) with generic "Something went wrong" message
- [ ] **Rate limit feedback**: When `POST /api/identify-bird` returns 429, show "AI identification limit reached (150/day). Try again tomorrow." with the daily limit from `Config.aiDailyRateLimit`
- [ ] **Passkey error messages**: Map all `ASAuthorizationError` codes to clear messages - `.canceled` (silent dismiss), `.notHandled` ("Passkey not available for this domain"), `.failed` ("Authentication failed")
- [ ] **Pull-to-refresh retry**: On data load failure, show the error message and let pull-to-refresh retry the request
- [ ] **Toast/banner system**: Create a reusable toast overlay (environment-based) for success and error messages. Auto-dismiss after 3-5 seconds. Used across settings saves, imports, exports, species additions

**Files**: New `AppError.swift`, update `SignInView.swift`, `DataStore.swift`, `SettingsView.swift`, all views with error states

### 8.8: Logging Overhaul (iOS + Server)

Part of [#222](https://github.com/jlian/wingdex/issues/222). Ensure consistent, structured logging across all layers.

- [ ] **iOS Logger audit**: Verify all services use `Logger` with appropriate subsystem/category. Ensure `.debug` for routine operations (request/response), `.info` for state changes (sign-in, data load), `.error` for failures. Remove any credential values from log messages
- [ ] **iOS request/response timing**: Add elapsed time logging to `DataService` API calls (time between request start and response) for performance monitoring
- [ ] **Server DEBUG flag**: All API route handlers log request entry and error details when `env.DEBUG` is set. Already implemented in middleware; extend to all `functions/api/` route files
- [ ] **Server structured format**: Use `JSON.stringify({ method, path, status, ... })` consistently for easy filtering in Wrangler terminal and Cloudflare log tailing
- [ ] **Web client debug logger**: Add a `debugLog()` utility gated on `import.meta.env.DEV` using `console.debug()`. Cover auth state changes, API calls, data mutations, flow transitions
- [ ] **No credentials in logs**: Audit all log statements across iOS, server, and web to ensure tokens, keys, and user data are never logged (log token length and presence, not values)

**Files**: All service files (iOS), all `functions/api/*.ts` files (server), new web debug utility

### Phase 8 Verification

Toggle appearance Light/Dark/System -> every screen renders correctly in dark mode -> sign in via GitHub -> all API calls succeed (no 401) -> background the app for 24+ hours -> return -> session still valid or re-auth prompted gracefully -> errors shown as user-friendly messages, not raw strings -> no credentials in any log output -> server logs structured JSON when DEBUG=1.

---

## Phase 9 - iOS-Native Enhancements

Features leveraging iOS platform APIs that the web cannot access. These go beyond parity - they make the iOS app feel like a first-class citizen on the platform.

### Category A: Sharing & Export

#### A1. Share Extension

- Share photos directly to the WingDex AddPhotos flow via a Share Extension (ShareLink API), support single or multiple photos
- Share species or outing details via the system share sheet with deep links to the app
- Implement via `ShareLink` for in-app sharing and a custom Share Extension target for receiving shared content from other apps
- For incoming shares, parse the shared content (images, text) and pre-fill the AddPhotos flow or create a new outing/species entry as appropriate
- Example: user shares a bird photo from the Photos app -> "Share to WingDex" -> opens AddPhotos with that photo pre-loaded for identification

#### A2. Home Screen Quick Actions (3D Touch / Long Press on App Icon)

- "Upload Photos" quick action -> launches straight into AddPhotos flow sheet
- "View WingDex" quick action -> opens the WingDex tab
- Implement via `UIApplicationShortcutItem` entries in Info.plist or programmatic dynamic shortcuts

### Category B: Context Menus & Swipe Actions

#### B1. Context Menus (Long-Press)

- Species row (WingDex, Home, Outing Detail): "View Details", "Share", "Open in eBird", "Open in Wikipedia"
- Outing row (Outings, Home): "Edit Location", "Export eBird CSV", "Delete Outing", "Share Summary"
- Species detail hero image: "Share Image", "Save to Photos" (via `UIImageWriteToSavedPhotosAlbum`)
- Photo in AddPhotos flow: "Remove Photo", "Re-identify"
- Implemented via SwiftUI `.contextMenu { }` modifier

#### B2. Swipe Actions on List Rows

- Outing row: leading swipe "Export" (eBird CSV), trailing swipe "Delete" (with confirmation)
- Species in outing detail: trailing swipe "Remove" (marks as rejected)
- Passkey row in passkey management: trailing swipe "Delete"
- Implemented via `.swipeActions(edge:)` modifier

### Category C: App Intents, Shortcuts & Siri

#### C1. App Intents (Shortcuts App Integration)

- `UploadPhotosIntent` - open the AddPhotos flow
- `ViewWingDexIntent` - open WingDex tab, optionally with a species name filter parameter
- `ViewOutingsIntent` - open Outings tab
- `GetSpeciesCountIntent` - return the user's total species count as an integer (useful for Shortcuts automations)
- `GetRecentSpeciesIntent` - return a list of recent species names
- `ExportSightingsIntent` - trigger CSV export and return the file
- All implemented via the AppIntents framework with `AppShortcutsProvider`

#### C2. Siri Phrases (App Shortcuts)

- "Show my WingDex" -> opens WingDex tab
- "How many birds have I seen?" -> returns species count via `GetSpeciesCountIntent`
- "Upload bird photos" -> opens AddPhotos flow
- "What was my last bird?" -> returns the most recently observed species name
- Registered via `AppShortcutsProvider.appShortcuts` with natural language phrases

#### C3. Action Button Support

- Register `UploadPhotosIntent` as an Action button action so users can assign "Upload Photos" to the hardware Action button on iPhone 15 Pro+

### Category D: Spotlight & Search

#### D1. Spotlight Indexing

- Index all species in the user's WingDex as `CSSearchableItem` entries:
  - Title: common name, description: scientific name + stats ("X seen, Y outings, first seen {date}")
  - Thumbnail: Wikimedia bird image (cached locally)
  - Content type: species/birding
- Index all outings: title = location name, description = date + species list preview
- Update index incrementally on data changes (add/delete outing, new species)
- Deep link from Spotlight search result directly to species detail or outing detail view

#### D2. NSUserActivity Donations

- When user views a species detail, donate an `NSUserActivity` for "viewed species"
- When user views an outing detail, donate an `NSUserActivity` for "viewed outing"
- Powers "Siri Suggestions" on the Lock Screen and in system Search (frequently viewed species surface automatically)

#### D3. Handoff

- Set `NSUserActivity` with `isEligibleForHandoff = true` for the current view
- Enables continuing the current view on another Apple device (future-proofs for iPad/Mac Catalyst)

### Category E: Widgets (WidgetKit)

#### E1. Species Count Widget (Small)

- Large species count number displayed in the warm palette color scheme
- Tap opens the WingDex tab
- Timeline provider: update every 4 hours or on app data change via `WidgetCenter.shared.reloadTimelines`

#### E2. Recent Species Widget (Medium)

- Grid of 2-4 recently observed species with Wikimedia thumbnails and common names
- Tap on an individual species opens the species detail view
- Timeline: updates on new species observation or every 4 hours

#### E3. Recent Outing Widget (Medium)

- Displays the most recent outing: location name, date, species count, and a mini species name list
- Tap opens the outing detail view

#### E4. Lock Screen Widgets (Accessory)

- Accessory Circular: species count as a large number
- Accessory Rectangular: "X species - Last: {species name}"
- Accessory Inline: "WingDex: X species"

#### E5. Control Center Control

- "Upload Photos" button in Control Center (WidgetKit Controls API, iOS 18+)
- Opens the app directly to the AddPhotos flow

### Category F: Camera Integration

#### F1. Direct Camera Capture

- Add a "Take Photo" option alongside "Choose from Library" in the photo selection step of AddPhotos
- Implement via `UIImagePickerController` with `.camera` source type, or the modern Camera framework
- GPS: Request location permission and use `CLLocationManager` for the capture location (since camera photos don't have EXIF GPS by default in the picker)
- Timestamp: Use the capture time as the EXIF time
- The captured photo feeds into the same extraction -> clustering -> identification pipeline as library photos

### Category G: Notifications & Background

#### G1. Local Notifications

- Weekly summary push: "You saw X new species this week!" (only if `newSpeciesCount > 0`)
- Milestone notifications: "Congratulations! You reached 50/100/200/500 species!"
- User-configurable: on/off toggle in Settings
- Scheduled via `UNUserNotificationCenter` with appropriate triggers

#### G2. Background App Refresh

- Register a `BGAppRefreshTask` to periodically sync data from the server
- On sync completion: update widget timelines (`WidgetCenter.shared.reloadAllTimelines`), update Spotlight index
- Keeps widgets and Spotlight results current even when the app hasn't been opened recently

### Category H: Map Enhancements

#### H1. Full Map View (All Outings)

- Dedicated full-screen map showing ALL outings as annotation pins
- Cluster annotations when zoomed out (`MKClusterAnnotation`)
- Tap a pin or cluster -> show outing info callout -> tap callout to navigate to outing detail
- Filter controls: by date range, by species (show only outings containing a specific species)
- Accessible from the Outings tab via a "Map" toggle or button

#### H2. Species Range Map

- On the species detail view, show a map of all sighting locations for that species
- Display sighting count per location cluster
- Gives the user a visual sense of where they've seen this species

### Category I: TipKit Onboarding

#### I1. Contextual Tips

- First launch / empty state: "Upload your bird photos to get started" (points to the + button)
- First species viewed: "Tap a species to see details and sighting history"
- WingDex sort: "Use sort options to organize your species list by date, count, name, or family"
- AddPhotos crop: "The AI works best with clear, centered bird photos"
- Settings passkey: "Add a passkey for secure, passwordless sign-in on all your devices"
- Implemented via TipKit framework. Tips auto-dismiss after the user performs the hinted action

### Category J: Visual Intelligence (iOS 26)

#### J1. Visual Intelligence Integration

- Register species from the user's WingDex as searchable entities for Visual Intelligence
- When the user points the camera at a bird (via Camera Control or Visual Intelligence), show "Search in WingDex" as a result option if a matching species is found in their data
- Implemented via `IntentValueQuery` protocol conformance on the species entity type
- Returns matching species with name, thumbnail, and sighting stats for the search results

### Category K: Accessibility

#### K1. VoiceOver

- Descriptive labels on all interactive elements: species images ("Photo of American Robin"), stats ("Species count: 42"), buttons ("Upload and Identify photos")
- Custom accessibility actions on complex rows (e.g., species row: "View details", "Share", "Open in eBird")
- Group related elements with appropriate traits

#### K2. Dynamic Type

- Verify all text scales correctly at every Dynamic Type size (from xSmall to AX5)
- Test layout at the largest accessibility sizes - ensure nothing overflows, truncates badly, or overlaps
- Use `.dynamicTypeSize(...)` range if specific views break at extreme sizes

#### K3. Reduce Motion

- Respect `UIAccessibility.isReduceMotionEnabled` throughout the app
- When enabled: skip confetti animation (use a simple fade-in banner instead), reduce map animations, minimize spring animations
- When enabled: tab transitions and sheet presentations should not use custom animations

### Category L: Data & Sync

#### L1. Local Cache (SwiftData)

- Cache all user data (outings, observations, dex entries) locally using SwiftData for instant launch and offline browsing
- On app launch: display cached data immediately, then fetch fresh data from the API in the background
- Conflict resolution: server wins (server is the authoritative data source)
- Cache invalidation: refresh after mutations (add/delete/edit) and on pull-to-refresh

#### L2. Offline Mutation Queue

- When the device is offline, queue mutations (create outing, delete observation, etc.) locally
- When connectivity returns, replay the queue against the server in order
- Show a "pending" indicator on queued items (e.g., a small clock icon or subtle banner)
- Handle conflicts if server state diverged while offline

### Category M: iPad & Multi-Window (future)

#### M1. iPad Adaptive Layout

- Use `NavigationSplitView` for two-column layout on iPad: list in the sidebar, detail in the main content area
- Full-width content takes advantage of the larger screen

#### M2. Multi-Window Support

- `UIScene`-based multi-window support so users can compare species or outings in side-by-side windows on iPad

---

## Phase 10 - Polish & App Store

### 10.1: Error Handling Audit

- Network errors: show user-friendly alerts with "Retry" button, not raw error messages
- Server errors (500): "Something went wrong. Please try again."
- Rate limit (429): Show "AI identification limit reached (150/day). Try again tomorrow." with remaining count
- Offline: Graceful degradation - show cached data (Phase 9 L1) or a clear "No connection" banner

### 10.2: Accessibility Final Pass

- VoiceOver audit on every screen
- Dynamic Type verification at largest sizes
- Large Content Viewer support for key metrics (species count, outing stats)
- Color contrast check (WCAG AA minimum)

### 10.3: App Icon & Launch Screen

- [ ] **App icon**: Export the new bird icon (updated March 2026 on web: `public/icon-512.png`, `public/favicon.svg`) as a 1024x1024 PNG and add to `Assets.xcassets/AppIcon.appiconset`. The current AppIcon slot is empty - Xcode auto-generates all required sizes from the single 1024x1024 source
- [ ] **Launch screen**: Simple branded launch screen matching the warm color palette (beige background, centered new bird icon)

### 10.4: TestFlight

- Internal testing build
- Fix any remaining signing/provisioning issues (register physical test devices or use App Store Connect automatic distribution)
- First round of real-device testing on various iPhone sizes

### 10.5: App Store Listing

- [ ] **Screenshots**: Capture on multiple device sizes (iPhone 15 Pro Max, iPhone SE)
- [ ] **Description**: Concise pitch highlighting photo-first bird ID, AI identification, eBird compatibility
- [ ] **Keywords**: birding, bird identification, life list, WingDex, eBird, bird photos
- [ ] **Category**: Reference or Lifestyle
- [ ] **Privacy nutrition labels**: Match the web privacy policy disclosures (no data sold, photos not retained, etc.)

### 10.6: App Store Submission

- Review Apple's App Store Review Guidelines for compliance
- Ensure demo account or demo data available for reviewer
- Submit for review

---

## Dependencies

| Package | Purpose |
| --- | --- |
| `swift-openapi-runtime` | Type-safe API response handling |
| `swift-openapi-urlsession` | URLSession transport for API client |
| `KeychainAccess` | Secure token storage |
| SwiftData (built-in) | Local cache for offline browsing |
| WidgetKit (built-in) | Home screen and Lock Screen widgets |
| AppIntents (built-in) | Siri, Shortcuts, Spotlight integration |
| TipKit (built-in) | Contextual onboarding tips |
| ActivityKit (built-in) | Live Activities (future, if needed) |

No third-party UI libraries - pure SwiftUI + system frameworks.

---

## Key File References

### Web (source of truth for parity)

| File | Purpose |
| --- | --- |
| `src/components/flows/AddPhotosFlow.tsx` | Full add-photos wizard, `PerPhotoConfirm` component |
| `src/components/flows/OutingReview.tsx` | Outing review step: Nominatim, place search, existing outing matching |
| `src/components/flows/ImageCropDialog.tsx` | Interactive crop dialog UI |
| `src/components/pages/SettingsPage.tsx` | All settings features: name, avatar, appearance, import/export, delete |
| `src/components/pages/OutingsPage.tsx` | Outing detail editing: location name, add/delete species, export |
| `src/components/pages/WingDexPage.tsx` | Species detail, family sort, eBird code lookup |
| `src/components/pages/HomePage.tsx` | Home page layout, recent species cards, recent outings |
| `src/lib/ai-inference.ts` | Two-tier AI model escalation logic (fast -> strong) |
| `src/lib/clustering.ts` | Photo clustering + `findMatchingOuting` for existing outing detection |
| `src/lib/timezone.ts` | Offset-aware time handling, timezone conversion |
| `src/lib/fun-names.ts` | Bird nickname generator, emoji avatar system, `getEmojiAvatarColor` |
| `src/lib/taxonomy-order.ts` | Taxonomic family sort order |
| `src/lib/photo-utils.ts` | EXIF extraction, thumbnail generation, SHA-256 file hash |

### iOS (files to modify/create)

| File | Status | Changes needed |
| --- | --- | --- |
| `WingDexApp.swift` | Modify | Restructure: 3 tabs + detached "+" button + avatar toolbar button (Phase 3.5) |
| `SignInView.swift` | Rework | Match web auth modal: title, two passkey buttons, remove mode toggle (Phase 3.5) |
| `SettingsView.swift` | Modify | Adapt for sheet presentation; add all Phase 4 features |
| `AddPhotosViewModel.swift` | Major rework | Two-tier AI, per-photo flow, outing review step, crop retry, certainty |
| `AddPhotosFlow/OutingReviewView.swift` | New | Nominatim geocoding, place search, existing outing matching |
| `AddPhotosFlow/PerPhotoConfirmView.swift` | New | Per-photo confirm with Wikipedia ref, confidence bar, crop retry |
| `AddPhotosFlow/ReviewView.swift` | Rework | Replace batch review with per-photo flow orchestration |
| `OutingDetailView.swift` | Modify | Edit location, add species, delete species, export CSV, map link |
| `SpeciesDetailView.swift` | Modify | eBird API lookup, certainty badges, count, notes |
| `WingDexView.swift` | Modify | Family sort option |
| `Theme.swift` | Modify | Dark mode palette, appearance management |
| `AuthService.swift` | Modify | Fix 401, session expiry handling |
| `DataService.swift` | Modify | New API calls: species search, eBird code, import, export |
| `FunNames.swift` | New | Bird nickname generator ported from web |
| `EBirdImportView.swift` | New | eBird import sheet with timezone picker |
| `ConfettiModifier.swift` | New | Confetti animation modifier |
| Widget extension | New | WidgetKit extension with species count, recent species, outing widgets |
| App Intents | New | AppShortcutsProvider, intent definitions |

---

## Phase Summary & Status

| Phase | Description | Status |
| --- | --- | --- |
| 0 | Project Scaffold | ✅ Done |
| 1 | Auth (OAuth, Passkeys, Keychain) | ✅ Done |
| 2 | Core Data Views (Home, WingDex, Outings, Details) | ✅ Done |
| 2.5 | Styling & Layout (colors, edge-to-edge, List theming) | ✅ Done |
| 2.6 | Auth UX, Tab Icon, Session Fixes | ✅ Done |
| 3 | Add Photos Flow (initial, needs rework) | ✅ Done (basic) |
| 3.5 | **Navigation & SignIn Rework** (3-tab + "+" layout, avatar settings sheet, SignInView matching web modal) | Not started |
| 3-R | **Add Photos Flow Rework** (outing review, per-photo confirm, two-tier AI, crop retry, certainty) | Not started |
| 4 | **Settings & Profile Parity** (name, avatar, appearance, import/export, delete account) | Not started |
| 5 | **Outing Detail Editing** (edit location, add/delete species, export, map link) | Not started |
| 6 | **Species Detail & WingDex Parity** (eBird lookup, badges, count, notes, family sort) | Not started |
| 7 | **Celebrations & Feedback** (confetti, lifer toast, haptics) | Not started |
| 8 | **Dark Mode, Auth Fixes & Error Handling** (palette, toggle, visual audit, 401 fix, error/logging overhaul) | Not started |
| 9 | **iOS-Native Enhancements** (sharing, context menus, shortcuts, Spotlight, widgets, camera, tips, etc.) | Not started |
| 10 | **Polish & App Store** (errors, accessibility, icon, TestFlight, listing, submission) | Not started |
