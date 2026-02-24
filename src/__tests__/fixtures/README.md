# AI Test Fixtures

Golden fixtures for deterministic replay tests in `src/__tests__/ai-fixture-replay.test.ts`.
No network calls are made in CI when replaying these files.

## Current refresh workflow (matrix-first)

Use the consolidated matrix capture first, then promote a stable baseline:

```bash
# 1) Run matrix capture (LLM + runtime x fast + strong x 3 runs)
npm run fixtures:matrix

# 2) Promote baseline fixtures (default source: llm, model: fast)
npm run fixtures:baseline:promote

# Optional: promote strong-tier baseline instead
npm run fixtures:baseline:promote:strong
```

This flow writes:
- matrix artifacts to `test-results/fixture-matrix/`
- promoted golden fixtures to `src/__tests__/fixtures/llm-responses/`

## Fixture fields

Each promoted fixture contains:
- `imageFile`: source image filename
- `context`: GPS/month/location passed to prompt/runtime
- `rawResponse`: JSON string of promoted response
- `parsed`: parsed JSON (candidates, birdCenter, birdSize, multipleBirds)
- `model`: model used for promoted baseline
- `requestConfig`: includes promotion metadata (`promotedFromMatrix`, source/model tier)
- `durationMs`: promoted request latency
- `capturedAt`: timestamp from selected matrix run
- `promotedAt`: timestamp when fixture was promoted

## Matrix configuration

`scripts/run-fixture-matrix.mjs` supports:
- `MATRIX_RUNS` (default `3`)
- `MATRIX_FIXTURE_LIMIT` (default `0` = all fixtures)
- `MATRIX_DELAY_MS` (default `300`)
- `FIXTURE_RESIZE_MAX_DIM` (default `640`)
- `FIXTURE_JPEG_QUALITY` (default `70`)

Required credentials/env for matrix capture:
- `OPENAI_API_KEY` (or `.dev.vars`)
- `CF_ACCOUNT_ID` + `AI_GATEWAY_ID` (or `FIXTURE_API_URL`)
- healthy local runtime API (auto-detected on `:5000`/`:8788`, or set `RUNTIME_BASE_URL`)

## When to refresh

- After prompt changes in `functions/lib/bird-id-prompt.js`
- After taxonomy updates in `src/lib/taxonomy.json`
- After model changes (`OPENAI_MODEL` / `OPENAI_MODEL_STRONG`)
- After runtime API behavior changes in `functions/api/identify-bird.ts` or `functions/lib/bird-id.ts`

## Notes

- Matrix files are analysis artifacts and include response variance; they are not direct golden fixtures.
- Golden fixtures should come from baseline promotion to keep replay tests stable.
