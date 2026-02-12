# AI Inference Fixes - Iteration 2

## Issues Fixed

### 1. ✅ Token Limit Error (413) - FIXED
**Problem**: Images were too large for gpt-4o-mini, causing "Request body too large" errors (8000 token limit exceeded)

**Solution**:
- Switched from `gpt-4o-mini` to `gpt-4o` for all vision tasks (crop detection + bird ID)
- Reduced image compression sizes:
  - Crop detection: 512px max dimension @ 60% quality
  - Bird identification: 768px max dimension @ 70% quality
  - Final inference: 800px max dimension @ 75% quality
- Added explicit image compression before sending to API
- Added better error messages for token/quota issues

**Files Modified**:
- `src/lib/ai-inference.ts` - Updated both `suggestBirdCrop()` and `identifyBirdInPhoto()` to use gpt-4o with aggressive image compression
- `src/lib/photo-utils.ts` - Reduced default inference downscaling from 1200px to 800px
- `src/components/flows/AddPhotosFlow.tsx` - Updated downscaling calls

### 2. ✅ Location Detection Not Working - FIXED
**Problem**: Outing location names were not being generated from GPS coordinates

**Solution**:
- Changed location detection from `gpt-4o-mini` to `gpt-4o` for better accuracy
- Added comprehensive logging to track location detection flow
- Improved error handling with fallback to GPS coordinates display
- Added Taiwan and international location examples to prompt

**Files Modified**:
- `src/components/flows/OutingReview.tsx` - Updated `fetchLocationName()` to use gpt-4o with better logging

### 3. ✅ AI Crop Not Visible - FIXED
**Problem**: No visual indication when AI crops were being applied to photos

**Solution**:
- Crop detection IS working and being applied automatically
- Visual feedback already exists in SpeciesConfirmation.tsx:
  - Photos with AI crops show orange border (`border-accent`)
  - Photos with manual crops show blue border (`border-primary`)
  - Badge overlay shows "🤖 AI" for AI crops, "✂️ Manual" for user crops
  - Hover reveals crop button to manually refine
- Added extensive console logging throughout the crop and identification process

**No Changes Needed** - UI was already correct, just needed the API fixes above

### 4. ✅ Test Image Integration - ADDED
**Problem**: No easy way to test AI functionality with the provided Kingfisher test image

**Solution**:
- Added TestHelper component integration to HomePage
- Test button loads the Kingfisher image automatically
- Programmatic file injection into AddPhotosFlow
- Automatically starts processing when test file is loaded

**Files Modified**:
- `src/components/pages/HomePage.tsx` - Added TestHelper component and test photo prop
- `src/App.tsx` - Added test file state and handler
- `src/components/flows/AddPhotosFlow.tsx` - Added testFile prop and auto-processing useEffect

## Model Selection Notes

- **gpt-4o** is the current state-of-the-art vision model available in the system
- **gpt-4o-mini** has an 8K token limit which is too small for even compressed images
- **GPT-5** is not yet available in any system
- All vision tasks (crop detection + bird identification + location naming) now use **gpt-4o**

## Testing the Fixes

1. Click the "Load Test Image" button in the Developer Test Mode card on the home screen
2. The Kingfisher image will automatically load and start processing
3. Watch the console logs for detailed processing steps:
   - `🔍 Starting AI crop suggestion...`
   - `📐 Image compressed from X to Y bytes`
   - `📤 Sending crop detection request to Vision API (gpt-4o)...`
   - `✅ AI crop suggestion successful`
   - `🐦 Starting bird species identification...`
   - `✅ Found X bird candidates`
4. Location detection will run automatically if GPS data is in EXIF
5. Species confirmation screen shows photos with crop indicators

## Expected Behavior

With the Kingfisher test image:
- ✅ AI should detect and crop the bird (kingfisher in frame)
- ✅ Photo should show orange border with "🤖 AI" badge
- ✅ Bird should be identified (likely "Common Kingfisher" or similar)
- ✅ No token limit errors
- ✅ Location should be identified if GPS in EXIF (Taiwan region)

## Logging

All AI operations now have comprehensive console logging:
- 🔍 = Crop detection starting
- 📐 = Image compression details
- 📤 = API request sent
- 📥 = API response received
- ✅ = Success
- ⚠️ = Warning (low confidence, fallback used)
- ❌ = Error with details
