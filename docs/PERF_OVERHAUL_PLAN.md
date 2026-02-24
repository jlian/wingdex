# Performance Overhaul Plan

Tracking checklist for [#105](https://github.com/jlian/wingdex/issues/105) and its sub-issues.

Status legend: **Done** = merged, **Obsolete** = no longer applicable, unchecked = still open.

---

## Phase 1 -- Low-risk, high-confidence wins

No behavioral change; pure dead-code removal and render optimizations.

- [x] **#106 -- Lazy-load routes** \
  `React.lazy` + `Suspense` already applied to OutingsPage, WingDexPage, SettingsPage, TermsPage, PrivacyPage, AddPhotosFlow in `src/App.tsx`. \
  _Closed._

- [x] **#107 -- Remove `TabsContent forceMount`** \
  No `forceMount` prop found anywhere in the codebase. \
  _Closed._

- [x] **#114 -- Remove unused dependencies and scaffold files** \
  Delete 7 unused dependencies from `package.json`:
  - [x] `cmdk`
  - [x] `embla-carousel-react`
  - [x] `input-otp`
  - [x] `react-day-picker`
  - [x] `react-hook-form`
  - [x] `react-resizable-panels`
  - [x] `recharts`

  Delete 7 corresponding scaffold UI files:
  - [x] `src/components/ui/carousel.tsx`
  - [x] `src/components/ui/form.tsx`
  - [x] `src/components/ui/command.tsx`
  - [x] `src/components/ui/calendar.tsx`
  - [x] `src/components/ui/resizable.tsx`
  - [x] `src/components/ui/chart.tsx`
  - [x] `src/components/ui/input-otp.tsx`

  Run `npm install` to sync lockfile. \
  Verify: `npm run build` succeeds and bundle size decreases. \
  _Done in `6796a16`._

- [x] **#112 -- Add `loading="lazy"` to bird thumbnail images** \
  Add `loading="lazy"` to the `<img>` element in `src/components/ui/wiki-bird-thumbnail.tsx`. \
  Verify: `npm run typecheck`. \
  _Done in `85fc8fa`._

- [x] **#109 -- Wrap `BirdRow` in `React.memo`** \
  Wrap the `BirdRow` export in `src/components/ui/bird-row.tsx` with `React.memo`. Props are strings + ReactNode + callback, so memo will skip re-renders when individual row data hasn't changed. \
  Verify: `npm run test`. \
  _Done in `de75836`._

- [ ] **#111 -- Memoize derived data on HomePage** \
  Wrap `recentOutings`, `recentSpecies`, `newThisMonth`, and `totalPhotos` in `useMemo` in `src/components/pages/HomePage.tsx` (lines 49-65). WingDexPage and OutingsPage are already memoized. \
  Verify: `npm run test`.

---

## Phase 2 -- Moderate complexity, clear implementation

- [ ] **#108 -- Build `observationsByOuting` Map index** \
  In `src/hooks/use-wingdex-data.ts`:
  - [ ] Build `Map<outingId, Observation[]>` via `useMemo` keyed on `payload.observations`
  - [ ] Build `Map<outingId, Photo[]>` via `useMemo` keyed on `payload.photos`
  - [ ] Build `Map<speciesName, DexEntry>` via `useMemo` keyed on `payload.dex`
  - [ ] Replace the linear `.filter()` in `getOutingObservations`, `getOutingPhotos`, and `.find()` in `getDexEntry` with O(1) Map lookups

  Verify: `npm run test` -- especially outing detail view tests.

- [ ] **#110 -- Stabilize inline arrow handlers with `useCallback`** \
  In `src/App.tsx`, wrap remaining inline arrow props with `useCallback`:
  - [ ] `onAddPhotos` (lines 468, 503)
  - [ ] `onSelectOuting` (lines 470, 483)
  - [ ] `onSelectSpecies` (lines 471, 484, 501)
  - [ ] `onNavigate` (line 472)

  Note: only effective in combination with #109 (`React.memo` on `BirdRow`). \
  Verify: `npm run typecheck`.

- [ ] **#113 -- Persist Wikipedia REST cache in `localStorage`** \
  In `src/lib/wikimedia.ts`:
  - [ ] On startup, hydrate `restCache` Map from `localStorage.getItem('wiki-rest-cache')`
  - [ ] After each new cache entry, debounce-write the Map back to `localStorage`
  - [ ] Cap at ~200 entries (LRU eviction by insertion order)
  - [ ] Wrap in try/catch for quota errors

  Verify: manual browser test (DevTools > Application > Local Storage) + `npm run test`.

- [ ] **#118 -- Self-host Google Fonts** \
  - [ ] Download Inter (woff2, weights 400/500/600/700) and Newsreader (woff2, weights 400/600/700) into `public/fonts/`
  - [ ] Add `@font-face` declarations in `src/main.css` with `font-display: swap`
  - [ ] Remove the Google Fonts `<link>` and `<link rel="preconnect">` tags from `index.html`

  Verify: `npm run build` + Lighthouse font audit.

---

## Phase 3 -- Higher effort / defer

These are lower priority given existing mitigations. Re-scope on the parent issue.

- [ ] **#115 -- Virtualize long lists** \
  The current incremental "load more" pagination in WingDexPage and OutingsPage already caps visible DOM nodes at 40 + 40n. Full virtualization (`@tanstack/react-virtual`) is only worth doing if users report jank with 500+ species. \
  _Re-scope: defer unless profiling proves necessary._

- [ ] **#116 -- Web Worker for image compression** \
  `compressImage` in `src/lib/ai-inference.ts` uses main-thread canvas. Only runs during the bird-ID upload flow (max ~5 images). Moving to `OffscreenCanvas` in a Worker would unblock the main thread but the current volume doesn't cause frame drops. \
  _Re-scope: defer unless profiling shows frame drops during upload._

---

## Close as obsolete

- [x] **#117 -- Split `taxonomy.json` for smaller client bundle** \
  Client-side `src/lib/taxonomy.ts` was already deleted during the Cloudflare migration. Taxonomy is now served exclusively from `functions/lib/taxonomy.ts` server-side. The ~876 KB client bundle cost is gone. \
  _Close as obsolete._

---

## Recommended execution order

```
Phase 1 (single PR, pure refactoring):
  1. #114  Remove unused deps & scaffold files
  2. #112  loading="lazy" on bird thumbnails
  3. #109  React.memo on BirdRow
  4. #111  useMemo on HomePage derived data

Phase 2 (one PR each):
  5. #108  Map index in use-wingdex-data store
  6. #110  useCallback for App.tsx handlers
  7. #113  localStorage Wikipedia cache
  8. #118  Self-host fonts

Phase 3 (deferred):
  9. #115  Virtualize lists
 10. #116  Web Worker image compression
```
