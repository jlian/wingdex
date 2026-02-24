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

### 9) Harden API endpoints for partial-migration safety
- [x] Centralize PRAGMA `table_info` helpers into `functions/lib/schema.ts` (`getTableColumnNames`, `getOutingColumnNames`, `hasObservationColumn`) with module-scoped cache per isolate.
- [x] Gate PATCH outing columns behind `columnNames.has()` checks in `functions/api/data/outings/[id].ts`.
- [x] Gate POST outing response fields (`stateProvince`, `countryCode`, `protocol`, `effort*`) behind schema capability flags.
- [x] Gate POST observation response `speciesComments` behind `hasObservationColumn` check.
- [x] Bind empty string (not `null`) for `observation.notes` in import confirm to satisfy `NOT NULL` constraint.
- [x] Remove duplicated PRAGMA helpers from 6 endpoint files in favor of shared module.

### 10) CI pipeline and E2E stabilization
- [x] Add "Apply D1 migrations to preview DB" step to `.github/workflows/ci.yml` before preview deploy.
- [x] Fix strict mode violation from stacked per-outing toasts (`.first()` on toast assertions).
- [x] Switch Playwright config to `dev:full:restart` with `reuseExistingServer: false` so tests always get a healthy server.
- [x] Make WebAuthn CDP teardown best-effort (`.catch()`) to avoid crashes when page closes early.
- [x] Make passkey promotion helper skip gracefully when "Log in" button is absent.
- [x] Harden passkey-upgrade spec assertions for environment-agnostic behavior.

## Decisions
- [x] Format choice: strict eBird Record Format (19 columns), including separate `Genus` and `Species` columns.
- [x] Scope choice: replace Settings aggregate export with importable sightings export.
- [x] Consistency choice: align per-outing export format with bulk export format.
- [x] Unit system: export targets eBird Record Format (miles/acres), not "My eBird Data" download format (km/ha). Import auto-detects and converts both.

## Verification checklist
- [x] Importing exported sightings CSV succeeds via `/api/import/ebird-csv`.
- [x] Re-import of unchanged exported sightings is conflict-detected as duplicates.
- [x] Date/time values remain stable across import-export-import for timezone-sensitive rows.
- [x] Existing import of fixture-style eBird CSV remains functional.
- [x] New checklist effort metadata roundtrips in unit tests.
- [x] API responses never echo fields that were not persisted to the DB on partial migrations.
- [x] Full E2E suite passes locally (38 passed, 1 skipped) and in CI.
- [x] All Copilot PR review threads addressed and resolved.

## Execution log
- [x] Created branch `feat/ebird-roundtrip-export` from `main`.
- [x] Added this plan doc.
- [x] Updated this doc to match the detailed implementation plan from chat.
- [x] Implemented core export/import compatibility changes (library + API + UI + tests).
- [x] Audited against official eBird import documentation/template and corrected format drift.
- [x] Final verification and commit pass completed.
- [x] Renamed migration file to `migrations/0005_outing_ebird_fields.sql` to match expanded scope.
- [x] Implemented schema-first eBird checklist field support and no-extra-call geocode metadata reuse.
- [x] Fixed upload flow bugs: region field persistence, photo write race, observation id collisions, toast stacking.
- [x] Added CI migration step for preview DB and fixed E2E strict mode toast assertion.
- [x] Centralized PRAGMA schema helpers into `functions/lib/schema.ts` with per-isolate cache.
- [x] Gated PATCH/POST response payloads behind schema capability checks across all data endpoints.
- [x] Stabilized local E2E suite: fresh server startup, resilient WebAuthn teardown, robust passkey promotion.
- [x] Addressed and resolved all 4 Copilot PR review threads across 2 review rounds.
- [x] PR #196 CI green (lint + unit + e2e + preview deploy). Ready to merge.
