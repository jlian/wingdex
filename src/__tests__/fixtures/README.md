# AI Test Fixtures

Golden response fixtures for deterministic AI tests. No network calls needed in CI.

## Structure

```
fixtures/llm-responses/
  American_goldfinch_in_maple_at_Union_Bay_Natural_Area.json
  Anna's_hummingbird_in_Seattle_garden.json
  Chukar_partridge_near_Haleakala_summit_Maui.json
  Cormorants_on_navigation_marker_Skagit_Bay.json
  Dark-eyed_junco_in_foliage_Seattle_Arboretum.json
  Geese_in_misty_rice_paddies_Dehua_Fujian.json
  Pigeons_near_Museumplein_Amsterdam.json
  Stellers_Jay_eating_cherries_Seattle_backyard.json
```

Each fixture contains:
- `imageFile` — source image filename
- `context` — GPS/month/location passed to the prompt
- `rawResponse` — exact LLM response string
- `parsed` — parsed JSON (candidates, birdCenter, birdSize, multipleBirds)
- `model` — model used (e.g. `openai/gpt-4.1-mini`)
- `capturedAt` — ISO timestamp

## Refreshing fixtures

Requires `GITHUB_MODELS_TOKEN` (or `GITHUB_TOKEN`) with access to GitHub Models:

```bash
# Delete existing fixtures to force re-capture
rm src/__tests__/fixtures/llm-responses/*.json

# Capture fresh responses
GITHUB_MODELS_TOKEN=ghp_xxx node scripts/capture-llm-fixtures.mjs

# Or overwrite existing files in-place
FIXTURE_OVERWRITE=true GITHUB_MODELS_TOKEN=ghp_xxx node scripts/capture-llm-fixtures.mjs

# Optional tuning (defaults shown)
FIXTURE_RESIZE_MAX_DIM=640 FIXTURE_JPEG_QUALITY=70 GITHUB_MODELS_TOKEN=ghp_xxx node scripts/capture-llm-fixtures.mjs
```

The script skips fixtures that already exist. To add a new image, edit the
`IMAGES` array in `scripts/capture-llm-fixtures.mjs`.

## When to refresh

- After changing the vision prompt or parsing flow in `functions/lib/bird-id.ts`
- After updating the taxonomy (`src/lib/taxonomy.json`)
- After model upgrades (e.g. `gpt-5-nano` → `gpt-4.1-mini`)
- Periodically to catch model drift (quarterly suggested)

## Resize behavior note

Fixture capture resizes and converts to JPEG before send to mirror production/runtime bird ID behavior.
Defaults: `640px` max dimension and JPEG quality `70` (equivalent to runtime quality `0.7`).
