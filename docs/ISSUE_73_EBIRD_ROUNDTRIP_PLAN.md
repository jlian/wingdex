# Issue #73 - Export should conform to what eBird can import

Source issue: https://github.com/jlian/wingdex/issues/73

## Goal
Make WingDex export files round-trip through the existing eBird CSV import flow so users can self-serve account consolidation via export/import.

## Success criteria
- Exported CSV from Settings is re-importable by `/api/import/ebird-csv`.
- Exported CSV from per-outing export is also re-importable.
- Date and time survive import -> export -> import without day drift.
- Existing import behavior for real eBird CSV remains intact.

## Plan checklist
- [ ] Replace non-roundtrip export headers in `exportOutingToEBirdCSV` (`Genus` + `Species`) with `Scientific Name`.
- [ ] Standardize exported dates to `YYYY-MM-DD` and keep parser support for both `YYYY-MM-DD` and `MM/DD/YYYY`.
- [ ] Add a bulk sightings export endpoint for all outings and observations.
- [ ] Switch Settings export button to bulk sightings export endpoint.
- [ ] Keep per-outing export aligned to the same roundtrip-safe format.
- [ ] Update unit tests in `src/__tests__/ebird-csv.test.ts` for header/date expectations.
- [ ] Add a true parse -> export -> parse roundtrip test.
- [ ] Run targeted tests, then broader verification.
- [ ] Commit locally in small, logical increments.

## Execution log
- [x] Created branch `feat/issue-73-ebird-roundtrip-export` from `main`.
- [x] Added this plan doc.
- [ ] Implementation in progress.
