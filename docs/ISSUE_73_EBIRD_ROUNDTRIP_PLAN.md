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
- [ ] In `functions/lib/ebird.ts`, replace `Genus` + `Species` columns with one `Scientific Name` column in `exportOutingToEBirdCSV()`.
- [ ] Emit full scientific binomial into `Scientific Name` so `parseEBirdCSV()` can reconstruct `Common Name (Scientific Name)` consistently.

### 2) Fix date format compatibility in both directions
- [ ] In `functions/lib/ebird.ts`, change export date format in `exportOutingToEBirdCSV()` from `MM/DD/YYYY` to `YYYY-MM-DD`.
- [ ] In `functions/lib/ebird.ts`, add explicit `MM/DD/YYYY` parsing fallback in `normalizeDate()` to preserve compatibility with real-world CSV variants.

### 3) Replace settings export with bulk sightings export
- [ ] Add `functions/api/export/sightings.ts` to export all confirmed observations for the current user as one CSV.
- [ ] Keep one header row and append per-outing rows generated via `exportOutingToEBirdCSV(..., false)`.
- [ ] Switch Settings export action from `/api/export/dex` to `/api/export/sightings`.
- [ ] Update filename and UI copy to indicate sightings CSV export.

### 4) Keep per-outing export aligned
- [ ] Ensure `functions/api/export/outing/[id].ts` remains aligned by reusing updated `exportOutingToEBirdCSV()` output format.

### 5) Update and expand tests
- [ ] Update `src/__tests__/ebird-csv.test.ts` expectations for `Scientific Name` header and `YYYY-MM-DD` dates.
- [ ] Add explicit roundtrip test: `parseEBirdCSV -> groupPreviewsIntoOutings -> exportOutingToEBirdCSV -> parseEBirdCSV`.
- [ ] Add coverage for `MM/DD/YYYY` parsing fallback.

### 6) Verify end-to-end and commit incrementally
- [ ] Run targeted unit tests for eBird CSV parsing/export.
- [ ] Run broader verification relevant to changed behavior.
- [ ] Commit in logical chunks (plan/docs, library+API, UI, tests).

## Decisions
- [ ] Format choice: eBird Record Format (compact), with `Scientific Name` replacing `Genus` + `Species` for parser compatibility.
- [ ] Scope choice: replace Settings aggregate export with importable sightings export.
- [ ] Consistency choice: align per-outing export format with bulk export format.

## Verification checklist
- [ ] Importing exported sightings CSV succeeds via `/api/import/ebird-csv`.
- [ ] Re-import of unchanged exported sightings is conflict-detected as duplicates.
- [ ] Date/time values remain stable across import-export-import for timezone-sensitive rows.
- [ ] Existing import of fixture-style eBird CSV remains functional.

## Execution log
- [x] Created branch `feat/issue-73-ebird-roundtrip-export` from `main`.
- [x] Added this plan doc.
- [x] Updated this doc to match the detailed implementation plan from chat.
- [ ] Implementation in progress.
