# AI Test Fixtures

Golden fixtures for deterministic replay tests in `src/__tests__/ai-fixture-replay.test.ts`.
No network calls are made in CI when replaying these files.

## Single tool: `scripts/capture-llm-fixtures.mjs`

All LLM fixture capture, benchmarking, analysis, and promotion is handled by
one script. It calls Cloudflare AI Gateway (same as production) and matches
production image resize logic (640px max, JPEG 70).

### Capture a single variant

```bash
node scripts/capture-llm-fixtures.mjs --model gpt-5.4-mini --reasoning none
# or: npm run fixtures -- --model gpt-5.4-mini --reasoning none
```

### Benchmark all 6 variants

```bash
npm run fixtures -- benchmark
```

Defined variants: gpt-4.1-mini, gpt-5-mini (low), gpt-5.4-mini (none),
gpt-5.4-mini (low), gpt-5.4-nano (none), gpt-5.4-nano (low).

### Analyze captured variants

```bash
npm run fixtures -- analyze
```

Prints a comparison table and writes `test-results/benchmark-analysis.json`.

### Promote a variant to golden baseline

```bash
npm run fixtures -- promote gpt-5.4-mini-reasoning-none
```

Copies that variant's fixtures to the root `llm-responses/` directory, which
is what `ai-fixture-replay.test.ts` reads.

## Directory structure

```
src/__tests__/fixtures/llm-responses/
  *.json                              # golden baseline (used by replay tests)
  gpt-4.1-mini/                       # variant captures
  gpt-5-mini-reasoning-low/
  gpt-5.4-mini-reasoning-none/
  gpt-5.4-mini-reasoning-low/
  gpt-5.4-nano-reasoning-none/
  gpt-5.4-nano-reasoning-low/
```

## Fixture fields

Each fixture contains:
- `imageFile`: source image filename
- `context`: GPS/month/location passed to prompt
- `rawResponse`: JSON string of LLM response
- `parsed`: parsed JSON (candidates, birdCenter, birdSize, multipleBirds)
- `model`: model used
- `requestConfig`: token param, reasoning effort, resize settings, dimensions
- `durationMs`: request latency
- `capturedAt`: ISO timestamp

## Required credentials

- `OPENAI_API_KEY` (env or `.dev.vars`)
- `CF_ACCOUNT_ID` + `AI_GATEWAY_ID` (env or `.dev.vars`, or `FIXTURE_API_URL`)

## When to refresh

- After prompt changes in `functions/lib/bird-id-prompt.js`
- After taxonomy updates in `src/lib/taxonomy.json`
- After model changes (`OPENAI_MODEL` / `OPENAI_MODEL_STRONG`)
- After runtime API behavior changes in `functions/api/identify-bird.ts` or `functions/lib/bird-id.ts`
