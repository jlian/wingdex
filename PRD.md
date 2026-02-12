# Bird-Dex: Personal Bird Life-List & Sighting Tracker

A mobile-first web application that helps birders track their sightings, maintain a life list, and stay synchronized with eBird through photo-based species identification using AI vision inference.

**Experience Qualities**:
1. **Effortless** - Upload multiple photos at once and let AI do the heavy lifting of species identification, requiring only confirmation from the user
2. **Scientific** - Precise data tracking with EXIF metadata extraction, GPS coordinates, timestamps, and eBird CSV compatibility for serious birding records
3. **Delightful** - Celebrate birding achievements with a Merlin-inspired life list that showcases beautiful bird photography and sighting milestones

**Complexity Level**: Complex Application (advanced functionality, likely with multiple views)
- Multi-screen workflow with photo upload, EXIF parsing, AI inference, data management, import/export, and synchronized state across multiple interconnected data models (Photos, Outings, Observations, Life List entries)

## Essential Features

### 1. GitHub Authentication & User Isolation
- **Functionality**: Authenticate users via GitHub Spark's built-in auth system; all data is scoped per GitHub user ID
- **Purpose**: Secure, zero-configuration authentication ensuring each birder's data remains private
- **Trigger**: Landing on the app when not authenticated
- **Progression**: App loads → User sees sign-in prompt → Click "Sign in with GitHub" → GitHub OAuth flow → Return to authenticated home
- **Success criteria**: User's GitHub avatar and username displayed; all data queries filtered by user.id; no data leakage between users

### 2. Multi-Photo Upload with EXIF Extraction
- **Functionality**: Native iOS/mobile file picker supporting multi-select; parse EXIF DateTimeOriginal and GPS coordinates; generate client-side thumbnails
- **Purpose**: Capture rich metadata automatically to reduce manual data entry and enable intelligent outing grouping
- **Trigger**: User taps "Add Photos" button on home screen
- **Progression**: Home → Tap "Add Photos" → Native picker opens → Select multiple photos → Photos load with progress indicator → EXIF parsed → Thumbnails generated → Photos displayed in review UI
- **Success criteria**: All selected photos loaded; EXIF timestamp and GPS extracted when present; thumbnails generated at ~400px width; file hash computed for de-duplication

### 3. Intelligent Outing Clustering
- **Functionality**: Group uploaded photos into logical "outings" using time + distance heuristics (within 4 hours AND 5km if GPS exists, time-only if GPS missing)
- **Purpose**: Automatically organize photos into checklists matching real-world birding sessions
- **Trigger**: After photos are uploaded and EXIF parsed
- **Progression**: Photos uploaded → Clustering algorithm runs → Proposed outings displayed → User reviews split → Option to merge/split manually → Confirm grouping
- **Success criteria**: Photos correctly grouped by temporal and spatial proximity; user can manually adjust groups; no photos lost in grouping

### 4. AI Species Identification (GitHub Models Vision)
- **Functionality**: Send each photo to GitHub Models vision API with location + month context; receive top 5 species candidates with confidence scores
- **Purpose**: Dramatically reduce manual species identification effort while maintaining accuracy through user confirmation
- **Trigger**: After outing grouping confirmed
- **Progression**: Outing created → Each photo queued for inference → Downscaled image sent to API with prompt → Response parsed → Species suggestions aggregated → Display top candidates with supporting photos
- **Success criteria**: Inference completes within 30s for typical outing (10-20 photos); suggestions ranked by confidence and frequency; user can confirm/reject/mark as "possible"

### 5. Observation Confirmation & Editing
- **Functionality**: Review AI-suggested species, see supporting photos, mark as Confirmed/Possible/Rejected, set count per species, choose representative photo
- **Purpose**: Maintain data accuracy by requiring human confirmation while preserving AI suggestions for learning
- **Trigger**: After species suggestions are generated
- **Progression**: Suggestions displayed → Tap species to expand → View supporting photos → Tap "Confirm" / "Possible" / "Reject" → Adjust count if needed → Select best photo → Save outing
- **Success criteria**: All confirmed species saved to outing; representative photos linked; counts accurate; rejected species not added to life list

### 6. Life List Management (Merlin-like UX)
- **Functionality**: Maintain per-user aggregate of all confirmed species with first seen date, last seen date, total sightings, total count, best photo
- **Purpose**: Provide a beautiful, searchable record of birding accomplishments over time
- **Trigger**: Navigate to "Life List" tab
- **Progression**: Tap Life List → Scrollable/searchable species list loads → Each entry shows species name + thumbnail + stats → Tap species → Detail view with timeline of all sightings + photos
- **Success criteria**: Life list updates in real-time as outings are saved; search filters species instantly; species detail shows complete history

### 7. eBird CSV Import
- **Functionality**: Upload eBird "My eBird Data" export CSV; parse species, date, location, count columns; show preview with conflict resolution; merge into Bird-Dex
- **Purpose**: Allow users to bring existing eBird history into Bird-Dex without re-entering data
- **Trigger**: User taps "Import from eBird" in settings/export screen
- **Progression**: Import screen → Choose file → CSV parsed → Show preview table → Map columns if needed → Resolve conflicts (prefer newer dates, skip exact duplicates) → Confirm import → Data merged into Life List and Outings
- **Success criteria**: Standard eBird CSV formats parsed correctly; life list first/last dates updated; imported outings created; no data loss or duplication

### 8. eBird CSV Export
- **Functionality**: Export any outing in eBird Record Format CSV (one row per species with date, time, location, count, comments)
- **Purpose**: Submit Bird-Dex sightings to eBird to maintain synchronized records across platforms
- **Trigger**: User taps "Export to eBird" on an outing detail screen
- **Progression**: Outing detail → Tap export icon → Choose "eBird Format" → CSV generated → Download/share dialog → File saved/shared
- **Success criteria**: Generated CSV matches eBird Record Format specification; imports successfully into eBird; all species, counts, and locations preserved

### 9. Saved Locations
- **Functionality**: Save frequently-visited birding spots with name + coordinates; quick-select when photos lack GPS
- **Purpose**: Speed up data entry for regular birding locations and maintain consistency
- **Trigger**: When setting location for an outing OR in settings screen
- **Progression**: Outing review (no GPS) → Prompt "Set location" → Option "Choose saved spot" or "Drop pin on map" → If saving: enter spot name → Save → Available for future outings
- **Success criteria**: Saved spots persist across sessions; easy to select; coordinates accurate

### 10. Outing History & Detail
- **Functionality**: Browse all past outings chronologically; view outing detail with map, photos, species list, notes
- **Purpose**: Review birding history and revisit memorable sightings
- **Trigger**: Navigate to "Outings" tab or tap a recent outing on home
- **Progression**: Outings tab → Scrollable list of outings (most recent first) → Tap outing → Detail view with header (date, location, map pin), photo strip, species list, notes field
- **Success criteria**: All outings displayed; detail view loads quickly; photos displayed in grid; notes editable

### 11. GitHub Gist Sync
- **Functionality**: Backup all Bird-Dex data (photos, outings, observations, life list, saved spots) to a GitHub Gist; supports public or private visibility; automatic or manual sync
- **Purpose**: Provide cloud backup, enable multi-device sync, and offer portable data storage outside the VM
- **Trigger**: User navigates to Settings and enables GitHub Sync
- **Progression**: Settings → Tap "Enable GitHub Sync" → Enter Personal Access Token → Choose public/private → Enable sync → Initial data push to Gist → Toggle auto-sync if desired → Use Push/Pull buttons for manual sync
- **Success criteria**: Gist created with all data in JSON format; data persists between sessions; pull merges remote data intelligently; push updates Gist with latest local data; visibility can be toggled; auto-sync pushes after each outing save

## Edge Case Handling

- **No EXIF data** - Prompt user to manually set date/time and location; use current time as default
- **No GPS in photos** - Prompt once per outing to choose saved spot or drop map pin; remember choice for session
- **Mixed GPS locations** - Use centroid of coordinates as outing location; show map with all photo pins
- **AI inference failure** - Show error message; allow manual species entry; retry option
- **Large photo files** - Client-side downscaling to max 1200px before inference; thumbnail generation at 400px
- **Network interruption** - Save partial outing state to KV store; resume on reconnection; show offline indicator
- **Duplicate photos** - Detect via fileHash + exifTime; show "Already imported" indicator; skip on import
- **Species name ambiguity** - Use common names matching eBird taxonomy; support search by common or scientific name
- **Import conflicts** - Show side-by-side comparison; prefer newer dates for last seen; ask user to resolve ambiguous matches
- **Empty outing** - Require at least one confirmed species before saving; show validation message
- **Tab suspension** - Persist upload state to KV; resume workflow on return
- **Token security** - Store GitHub token encrypted in KV store; never log or display token
- **Sync conflicts** - When pulling from Gist, merge intelligently (prefer newer dates, don't duplicate by ID, combine counts)
- **Large data export** - Warn user if data export exceeds 10MB (Gist limit is 100MB per file)

## Design Direction

The design should evoke the feeling of a trusted field guide combined with a scientist's lab notebook - organized, data-rich, yet celebrating the beauty of birds through prominent photography. The interface should feel like flipping through a well-worn naturalist's journal with precise annotations and stunning illustrations.

## Color Selection

A naturalistic palette inspired by field guides and outdoor observation, emphasizing earthy tones with vibrant accents for interactive elements.

- **Primary Color**: Deep Forest Green (oklch(0.45 0.08 155)) - Represents nature and outdoor observation; conveys trust and scientific rigor
- **Secondary Colors**: 
  - Warm Sand (oklch(0.88 0.03 85)) - Backgrounds and surfaces, reminiscent of field guide paper
  - Slate Blue-Gray (oklch(0.55 0.04 240)) - Supporting UI elements and muted text
- **Accent Color**: Vivid Tanager Red (oklch(0.58 0.22 25)) - CTAs and important actions, inspired by vibrant bird plumage
- **Foreground/Background Pairings**:
  - Background (Warm Sand oklch(0.88 0.03 85)): Dark text (oklch(0.25 0.02 155)) - Ratio 7.2:1 ✓
  - Primary (Deep Forest oklch(0.45 0.08 155)): White text (oklch(0.99 0 0)) - Ratio 6.8:1 ✓
  - Accent (Tanager Red oklch(0.58 0.22 25)): White text (oklch(0.99 0 0)) - Ratio 4.9:1 ✓
  - Card surfaces (oklch(0.97 0.01 85)): Dark text (oklch(0.25 0.02 155)) - Ratio 9.1:1 ✓

## Font Selection

Typography should balance scientific precision with approachable readability, using a pairing that evokes both field guides and modern naturalist apps.

- **Primary Font**: Inter - Clean, highly legible sans-serif for UI elements and body text
- **Accent Font**: Newsreader - Elegant serif for species names and headings, evoking field guide typography
- **Typographic Hierarchy**:
  - H1 (Screen Titles): Newsreader SemiBold / 32px / tight tracking (-0.02em)
  - H2 (Species Names): Newsreader SemiBold / 24px / normal tracking
  - H3 (Section Headers): Inter SemiBold / 18px / wide tracking (0.02em)
  - Body (UI Text): Inter Regular / 16px / line-height 1.5
  - Small (Metadata): Inter Medium / 14px / muted color
  - Tiny (Labels): Inter Medium / 12px / uppercase / wide tracking (0.05em)

## Animations

Animations should feel organic and nature-inspired, with gentle easing that mimics the movement of birds in flight. Use motion to guide attention during the multi-step upload workflow and celebrate life list milestones.

Key animation moments:
- Photo upload: Cards fade in with staggered timing (50ms offset), scale from 95% to 100%
- Species suggestions: Slide up from bottom with spring physics, confidence bars animate in
- Life list add: Confetti burst + gentle scale pulse when new species confirmed
- Outing transitions: Smooth page slides with momentum-based easing
- Loading states: Organic pulse (not mechanical spin) with subtle scale variation

## Component Selection

- **Components**:
  - **Card**: Outing cards, species cards, life list entries - add subtle shadow and hover lift effect
  - **Button**: Primary actions use solid accent color; secondary use outline style with primary color
  - **Dialog**: Outing review, species confirmation, import preview - full-height on mobile
  - **Sheet**: Bottom sheet for quick actions (merge outings, set location) - native feel on mobile
  - **Tabs**: Main navigation (Home, Outings, Life List, Settings) - sticky header on mobile
  - **Input** + **Textarea**: Location name, notes, counts - large touch targets (min 44px)
  - **Badge**: Species status (Confirmed/Possible), new species indicator - use accent color
  - **Progress**: Upload progress, inference progress - organic appearance with gradient
  - **Separator**: Section dividers - subtle, uses border color
  - **ScrollArea**: Photo strips, species lists - smooth momentum scrolling
  - **Avatar**: User profile display - GitHub avatar in top nav
  - **Calendar**: Date picker for manual date entry - if no EXIF
  - **Popover**: Quick menus (export options, outing actions)
  - **Alert**: Destructive actions (delete outing), errors - use destructive color
  
- **Customizations**:
  - **Photo Grid**: Custom masonry-style grid for variable photo sizes
  - **Map Component**: Custom Leaflet/Mapbox integration with marker clustering
  - **Species Autocomplete**: Custom combobox with fuzzy search and eBird taxonomy
  - **Import Preview Table**: Custom data grid with column mapping and conflict resolution UI
  - **Confidence Meter**: Custom horizontal bar with gradient fill representing AI confidence
  
- **States**:
  - Buttons: Clear hover (scale 102%, brightness boost), active (scale 98%), disabled (50% opacity)
  - Cards: Subtle hover elevation (shadow grows), selected state (accent border)
  - Inputs: Focus ring using accent color, error state with destructive color
  - Photos: Loading skeleton, error state (broken image icon), selected state (checkmark overlay)
  
- **Icon Selection**:
  - Upload: CloudArrowUp (primary action)
  - Camera: Camera (photo-related actions)
  - Location: MapPin (GPS and saved spots)
  - Check: CheckCircle (confirm species)
  - Question: Question (mark as possible)
  - Close: X (reject species)
  - List: List (life list, outings list)
  - Export: Download (export actions)
  - Import: Upload (import actions)
  - Settings: Gear (settings screen)
  - Calendar: Calendar (date selection)
  - Bird: Bird (app icon, species icon)
  
- **Spacing**:
  - Page padding: 4 (16px) on mobile, 6 (24px) on tablet+
  - Card padding: 4 (16px)
  - Section gaps: 6 (24px)
  - Element gaps: 3 (12px) for related items, 6 (24px) for sections
  - Photo grid gap: 2 (8px) for tight mosaic feel
  
- **Mobile**:
  - Bottom tab navigation with large touch targets (56px height)
  - Full-width cards with comfortable padding
  - Bottom sheets for modal interactions instead of centered dialogs
  - Horizontal photo scrollers with momentum
  - Pull-to-refresh on main screens
  - Safe area insets respected for iOS notch/home indicator
  - Fixed header with blur backdrop when scrolling
  - Collapsible sections to conserve vertical space
