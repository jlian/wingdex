# Issue #73 - Export should conform to what eBird can import

Source issue: https://github.com/jlian/wingdex/issues/73

## Goal
Make WingDex export files round-trip through the existing eBird CSV import flow so users can self-serve account consolidation via export/import.

## Success criteria
- Exported CSV from Settings is re-importable by `/api/import/ebird-csv`.
- Exported CSV from per-outing export is also re-importable.
- Date and time survive import -> export -> import without day drift.
- Existing import behavior for real eBird CSV remains intact.

## Implementation plan

### 1) Fix per-outing export format to be roundtrip-safe
- [x] In `functions/lib/ebird.ts`, keep official eBird Record Format columns (`Genus` + `Species`) in `exportOutingToEBirdCSV()`.
- [x] Ensure `parseEBirdCSV()` reconstructs full scientific names from `Genus` + `Species` for roundtrip imports.

### 2) Fix date format compatibility in both directions
- [x] In `functions/lib/ebird.ts`, keep export date format in `exportOutingToEBirdCSV()` as `MM/DD/YYYY` per eBird format requirements.
- [x] In `functions/lib/ebird.ts`, keep explicit `MM/DD/YYYY` parsing support in `normalizeDate()` for import compatibility.

### 3) Replace settings export with bulk sightings export
- [x] Add `functions/api/export/sightings.ts` to export all confirmed observations for the current user as one CSV.
- [x] Keep one header row and append per-outing rows generated via `exportOutingToEBirdCSV(..., false)`.
- [x] Switch Settings export action from `/api/export/dex` to `/api/export/sightings`.
- [x] Update filename and UI copy to indicate sightings CSV export.

### 4) Keep per-outing export aligned
- [x] Ensure `functions/api/export/outing/[id].ts` remains aligned by reusing updated `exportOutingToEBirdCSV()` output format.

### 5) Update and expand tests
- [x] Update `src/__tests__/ebird-csv.test.ts` expectations for `Scientific Name` header and `YYYY-MM-DD` dates.
- [x] Add explicit roundtrip test: `parseEBirdCSV -> groupPreviewsIntoOutings -> exportOutingToEBirdCSV -> parseEBirdCSV`.
- [x] Add coverage for `MM/DD/YYYY` parsing fallback.

### 6) Verify end-to-end and commit incrementally
- [x] Run targeted unit tests for eBird CSV parsing/export.
- [x] Run broader verification relevant to changed behavior.
- [x] Commit in logical chunks (plan/docs, library+API, UI, tests).

### 7) Add schema-first support for eBird checklist-level outing fields
- [x] Expand outing schema migration to include `protocol`, `numberObservers`, `allObsReported`, `effortDistanceMiles`, `effortAreaAcres`.
- [x] Thread new fields through outing create/patch/read APIs and import confirm endpoint.
- [x] Thread new fields through per-outing and bulk sightings export endpoints.
- [x] Parse checklist effort fields from import CSV (including km/ha fallback conversion) and persist for roundtrip export.

### 8) Infer region metadata without adding ingestion API calls
- [x] Reuse existing Nominatim responses in photo outing review flow to infer `stateProvince` and `countryCode`.
- [x] Persist inferred region metadata onto created/updated outings.
- [x] Keep graceful fallback behavior when region inference is unavailable.

## Decisions
- [x] Format choice: strict eBird Record Format (19 columns), including separate `Genus` and `Species` columns.
- [x] Scope choice: replace Settings aggregate export with importable sightings export.
- [x] Consistency choice: align per-outing export format with bulk export format.

## Verification checklist
- [x] Importing exported sightings CSV succeeds via `/api/import/ebird-csv`.
- [x] Re-import of unchanged exported sightings is conflict-detected as duplicates.
- [x] Date/time values remain stable across import-export-import for timezone-sensitive rows.
- [x] Existing import of fixture-style eBird CSV remains functional.
- [x] New checklist effort metadata roundtrips in unit tests.

## Execution log
- [x] Created branch `feat/ebird-roundtrip-export` from `main`.
- [x] Added this plan doc.
- [x] Updated this doc to match the detailed implementation plan from chat.
- [x] Implemented core export/import compatibility changes (library + API + UI + tests).
- [x] Audited against official eBird import documentation/template and corrected format drift.
- [x] Final verification and commit pass completed.
- [x] Renamed migration file to `migrations/0005_outing_ebird_fields.sql` to match expanded scope.
- [x] Implemented schema-first eBird checklist field support and no-extra-call geocode metadata reuse.
