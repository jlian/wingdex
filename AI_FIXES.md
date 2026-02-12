# AI Inference Fixes - Iteration 3

## Issues Fixed

### 1. Model Upgrade: gpt-4o → openai/gpt-4.1
**Problem**: The `gpt-4o` model was producing errors and is outdated on GitHub Models.

**Solution**:
- Switched all vision/AI tasks to `openai/gpt-4.1` (latest vision model on GitHub Models, free for Spark users)
- Switched text-only tasks (location lookup, API test) to `openai/gpt-4.1-mini` (faster, still free)
- Models are defined as constants `VISION_MODEL` and `TEXT_MODEL` in `ai-inference.ts` for easy updates

### 2. Robust JSON Parsing
**Problem**: LLM responses sometimes include markdown code blocks or extra text around JSON.

**Solution**:
- Added `safeParseJSON()` that tries direct parse, then extracts JSON from surrounding text
- Handles `{...}` extraction from markdown code blocks or prose

### 3. Retry Logic
**Problem**: Transient API failures (network, rate limits) caused the entire flow to fail.

**Solution**:
- Added `llmWithRetry()` with configurable retry count and exponential backoff
- Skips retry for client errors (400, 413, 422) that won't succeed on retry

### 4. Improved Prompts
**Problem**: Verbose prompts wasted tokens and sometimes confused the model.

**Solution**:
- Made all prompts significantly shorter and more direct
- Crop detection prompt reduced ~70%
- Bird ID prompt reduced ~60%
- Location lookup prompt reduced ~80%
- Image placed at END of prompt (after instructions) for better vision model performance

### 5. Removed Redundant Image Processing
**Problem**: Images were being compressed multiple times unnecessarily.

**Solution**:
- `identifyBirdInPhoto()` now handles all compression internally (768px max, 60% quality)
- `suggestBirdCrop()` handles its own compression (512px max, 50% quality)
- Removed redundant `downscaleForInference()` calls from AddPhotosFlow
- Removed double-threshold check for crop confidence

### 6. Better Crop Validation
**Problem**: AI crop suggestions with unreasonable bounds passed through.

**Solution**:
- Lowered confidence threshold from 0.5 to 0.4 for more crop attempts
- Added bounds validation (coordinates within 0-100%, minimum 5% size)
- EXIF data now logged during processing for debugging

## Model Selection Notes

- **`openai/gpt-4.1`**: Latest vision-capable model on GitHub Models (free for Spark users)
- **`openai/gpt-4.1-mini`**: Fast text model for non-vision tasks (free for Spark users)
- Models are accessed via `window.spark.llm()` which proxies to GitHub Models API
- No API keys needed — Spark handles authentication automatically

## Files Modified

- `src/lib/ai-inference.ts` — Complete rewrite: new model, retry logic, shorter prompts, safe JSON parsing
- `src/components/flows/AddPhotosFlow.tsx` — Removed redundant compression, fixed crop threshold
- `src/components/flows/OutingReview.tsx` — New model for location lookup, shorter prompt
- `src/components/pages/SettingsPage.tsx` — New model for API test

## Testing

1. Click "Load Test Image" on the home screen (Developer Test Mode card)
2. The Kingfisher image auto-loads and starts processing
3. Console logs show:
   - `📷` EXIF extraction results
   - `🔍` AI crop detection
   - `📐` Image compression stats
   - `📤` API requests to openai/gpt-4.1
   - `📥` API responses
   - `✅` Results
4. Expected: Common Kingfisher (Alcedo atthis) identified with high confidence
- ❌ = Error with details
