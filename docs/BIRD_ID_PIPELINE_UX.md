# Plan: Bird ID Pipeline & UX Improvements

**TL;DR**: Six issues across three work streams, all on `feat/bird-id-pipeline-ux`. Group 1 tackles bird ID performance (#183) and two-tier escalation (#125) together since they share the same pipeline. Group 2 fixes upload flow UX -- crop jank (#181), clustering (#187), post-ID toast/homepage (#185), and privacy messaging (#146). All changes converge in [src/components/flows/AddPhotosFlow.tsx](../src/components/flows/AddPhotosFlow.tsx) which is the central file.

---

## Group A: Bird ID Performance + Two-Tier Escalation (#183, #125)

**Steps**

- [x] **Remove the hard-coded 500ms delay** in [AddPhotosFlow.tsx](../src/components/flows/AddPhotosFlow.tsx#L117) -- `await new Promise(r => setTimeout(r, 500))` before every inference call. Instant 500ms win.

- [x] **Eliminate the double base64 round-trip** -- Currently: data URL (base64) -> `dataUrlToBlob()` in [ai-inference.ts](../src/lib/ai-inference.ts#L48-L59) -> FormData upload -> server re-encodes to base64 in [identify-bird.ts](../functions/api/identify-bird.ts#L11-L25). Instead, send the base64 data URL string directly (e.g., as a JSON body field) so the server can pass it straight to OpenAI's vision API without re-encoding.

- [x] **Add `VISION_MODEL_STRONG` constant** in [bird-id.ts](../functions/lib/bird-id.ts#L7) -- `gpt-5-mini` as the strong model, keep `gpt-4.1-mini` as the fast model. Both configurable via env vars (`OPENAI_MODEL` / `OPENAI_MODEL_STRONG`).

- [x] **Add optional `model` parameter to server endpoint** -- [identify-bird.ts](../functions/api/identify-bird.ts) accepts an optional `model` field (`"fast"` or `"strong"`, default `"fast"`) which selects the appropriate model constant.

- [x] **Implement dual-condition escalation in `runSpeciesId()`** -- In [AddPhotosFlow.tsx](../src/components/flows/AddPhotosFlow.tsx), after the first (fast) call:
   - Escalate if top confidence < 0.75 OR gap between top-2 candidates < 0.15
   - Second call uses `model: "strong"`
   - Update processing message to indicate re-analysis

- [x] **Tune the vision prompt for calibrated confidence** -- In [bird-id-prompt.js](../functions/lib/bird-id-prompt.js), require at least 2 candidates, add calibration anchors (0.30-0.49 for poor views, 0.50-0.74 for partial/ambiguous, cap at 0.80 for backlit/distant), and add overconfidence penalty rules per the existing plan in issue #125. Iterate until results match expected confidence distributions on the existing fixture set, then capture a new fixture set with the tuned prompt for future regression testing.

- [x] **Add timing to fixture capture + re-capture** -- In [capture-llm-fixtures.mjs](../scripts/capture-llm-fixtures.mjs), record `durationMs` per fixture. Re-capture all fixtures with the tuned prompt. Verify confidence distribution uses the full range and wrong answers score lower. Capture timing for both fast and strong models to verify the expected ~3s vs ~6s difference.

- [x] **Replace static progress bar with time-estimated animation** -- Exponential asymptotic curve `progress = 90 * (1 - e^(-t/tau))` with tau calibrated from matrix latency data: tau=1200ms (fast, reaches ~70% at p50=1773ms) and tau=4400ms (strong, reaches ~70% at p50=6627ms). Progress indicator has 300ms ease-out CSS transition for smooth snap to 100% on completion. Resets with fresh runKey on escalation.

- [x] **Update tests** -- [ai-fixture-replay.test.ts](../src/__tests__/ai-fixture-replay.test.ts) for new fixture format (>=2 candidates, `durationMs`), [ai-inference.test.ts](../src/__tests__/ai-inference.test.ts) for model parameter passthrough.

- [x] **Refresh the fixture capture README** -- Updated [src/__tests__/fixtures/README.md](../src/__tests__/fixtures/README.md) with matrix-first refresh flow, baseline promotion commands, updated env requirements, and fixture field semantics.

- [x] **Consolidate fixture workflows into one matrix run** -- Added [run-fixture-matrix.mjs](../scripts/run-fixture-matrix.mjs) to capture `LLM + runtime` x `fast + strong` x `N runs` and persist per-image files under [test-results/fixture-matrix/images](../test-results/fixture-matrix/images) plus a single aggregate report at [test-results/fixture-matrix/report.json](../test-results/fixture-matrix/report.json).

- [x] **Add baseline promotion from matrix** -- Added [promote-matrix-baseline.mjs](../scripts/promote-matrix-baseline.mjs) to promote stable fixtures from matrix outputs (default `llm:fast`) into [src/__tests__/fixtures/llm-responses](../src/__tests__/fixtures/llm-responses). Primary refresh flow is now:
    - `npm run fixtures:matrix`
    - `npm run fixtures:baseline:promote`

---

## Group B: Crop Jank (#181)

**Steps**

- [x] **Increase `initCrop()` padding** -- In [image-crop-dialog.tsx](../src/components/ui/image-crop-dialog.tsx#L44-L66), increase the padding multiplier from 10% to ~30-40% so the AI-suggested crop starts zoomed out more, compensating for the model's imprecise birdCenter/birdSize. Clamp to image bounds.

- [x] **Fix aspect ratio drift in `handleResize`** -- At [image-crop-dialog.tsx](../src/components/ui/image-crop-dialog.tsx#L168-L177), the resize handler treats width and height independently despite `initCrop` forcing a square. Ensure the resize maintains the square constraint and re-centers properly.

- [x] **Update crop math tests** -- [image-crop-dialog.test.ts](../src/__tests__/image-crop-dialog.test.ts) for the new padding and resize behavior.

---

## Group C: Upload Flow UX (#187, #185, #146)

**Steps**

- [x] **Tighten clustering thresholds** -- In [clustering.ts](../src/lib/clustering.ts), reduce `TIME_THRESHOLD_MS` from 5 hours to ~2 hours and `MAX_DISTANCE_KM` from 6 to ~3. Verify with [clustering.test.ts](../src/__tests__/clustering.test.ts) that split scenarios pass and existing reasonable groupings still hold.

- [x] **Fix location auto-fill on outing decline** -- In [OutingReview.tsx](../src/components/flows/OutingReview.tsx#L83-L91), add a `useEffect` watching `useExistingOuting`: when the user toggles it to `false` and GPS data is available, trigger `fetchLocationName(roundedLat, roundedLon)` so the location field auto-fills instead of falling back to `defaultLocationName`.

- [x] **Improve post-ID toast messages** -- In [AddPhotosFlow.tsx `saveOuting()`](../src/components/flows/AddPhotosFlow.tsx#L229-L245):
    - Include the outing location name and species names in the success toast
    - For new dex species, show which species are new (e.g., "New to your WingDex: American Robin, Blue Jay!")
    - Consider using `toast()` with a description field for richer content

- [x] **Highlight recent outing on homepage** -- In [HomePage.tsx](../src/components/pages/HomePage.tsx), after `onClose()` returns the user to the homepage, scroll to / visually highlight the just-updated outing. Options: pass a `highlightOutingId` via navigation state, or rely on the recently-sorted list naturally showing it first with a brief highlight animation.

- [x] **Clarify photo hash messaging** -- Update three locations:
    - [SettingsPage.tsx](../src/components/pages/SettingsPage.tsx#L649): Change "Your photos are never stored" to mention that a fingerprint hash is stored for duplicate detection but the actual image is not retained
    - [AddPhotosFlow.tsx](../src/components/flows/AddPhotosFlow.tsx#L489): Update "Used for ID, never saved" to be more precise
    - [PrivacyPage.tsx](../src/components/pages/PrivacyPage.tsx#L48-L49): Add a sentence about the file hash in Section 4

---

## Verification

- [x] `npm test` -- all unit tests pass including updated fixture replays, clustering, crop math
- [x] `npx playwright test` -- e2e smoke passes (36 passed, 0 failed)
- [ ] Manual test: upload photos, observe faster ID, verify progress bar animates smoothly, check escalation triggers on low-confidence photos
- [ ] Manual test: verify clustering produces tighter outings, declining outing merge auto-fills location
- [ ] Manual test: verify post-ID toast shows species names and homepage highlights the new outing
- [ ] Check privacy/settings pages for updated messaging

## Matrix Insights (latest run)

- Matrix config: 27 fixtures, 3 runs, 12 responses per image (2 sources x 2 models x 3 runs)
- Success counts:
    - `llm:fast` 81/81
    - `llm:strong` 81/81
    - `runtime:fast` 81/81
    - `runtime:strong` 80/81 (one transient `fetch failed` on `Unknown_bird_no_GPS`, run 1)
- Agreement:
    - fast top-1 match (LLM vs runtime): 75/81 = 92.59%
    - strong top-1 match (LLM vs runtime): 61/80 = 76.25%
    - multipleBirds agreement: 100% in both model tiers
- Latency (request ms medians):
    - `llm:fast` 1775 vs `runtime:fast` 1773
    - `llm:strong` 6604 vs `runtime:strong` 6731
- Tail behavior:
    - runtime strong max request latency reached 30533 ms (heavy-tail outlier)

## Remaining Work

- [x] **Progress bar calibration (#183/#125)** -- tau derived from matrix p50: 1200ms fast, 4400ms strong. Added 300ms ease-out transition for smooth completion snap.
- [x] **Fixture README update** -- documented in [src/__tests__/fixtures/README.md](../src/__tests__/fixtures/README.md).
- [x] **E2E verification** -- all 36 Playwright tests pass (fixed pre-existing broken assertions in csv-and-upload-integration e2e).
- [ ] **Strong-tier stability follow-up** -- investigate runtime strong outliers and the single transient runtime failure (non-blocking, tracked separately).
- [ ] **Manual verification** -- manual upload flow testing with real photos (post-merge).

## Decisions

- **Model tiers**: gpt-4.1-mini (fast) -> gpt-5-mini (strong), both env-configurable
- **Photo hash**: keep feature, clarify messaging (not remove or make opt-in)
- **Escalation triggers**: confidence < 0.75 OR gap between top-2 < 0.15
- **Clustering thresholds**: tighten from 5h/6km to ~2h/~3km (exact values to calibrate against existing tests)
- **Progress bar**: exponential asymptotic curve capping at 90% until completion
