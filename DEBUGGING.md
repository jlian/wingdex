# Bird-Dex Debugging & Testing Guide

## Recent Fixes Applied

### 1. Token Exhaustion Issue (gpt-4o → gpt-4o-mini)
**Problem**: The app was using `gpt-4o` which may have had token limits or availability issues.

**Fix**: Changed both AI inference calls to use `gpt-4o-mini`:
- Crop detection: `ai-inference.ts` line 51
- Bird identification: `ai-inference.ts` line 118

**Expected Result**: AI calls should complete successfully without token errors.

---

### 2. Crop Box Visibility
**Problem**: No visual indication when AI crops were applied to photos.

**Fix**: Enhanced visual feedback in `SpeciesConfirmation.tsx`:
- AI-cropped photos now have **accent-colored borders** (orange)
- Manual-cropped photos have **primary-colored borders** (green)
- Badge overlays show "🤖 AI" or "✂️ Manual"
- Hover text explains the crop system

**Expected Result**: You should clearly see which photos were AI-cropped vs manual/uncropped.

---

### 3. Location Detection Fix
**Problem**: Reverse geocoding was failing in `OutingReview.tsx`.

**Status**: The code uses `gpt-4o-mini` for location name lookup (line 65). This should work if the GPS coordinates are valid.

**Expected Result**: When photos have GPS data, the app should suggest a location name like "Central Park, New York, NY".

---

### 4. Enhanced Logging
**Problem**: Hard to debug what's happening during AI processing.

**Fix**: Added extensive console logging throughout the flow:

#### Console Log Flow (Check browser DevTools → Console):

```
🔍 Photo 1: Starting AI crop detection
📤 Sending crop detection request to Vision API...
📥 Crop detection response: {...}
✅ AI crop suggestion successful: {x, y, width, height, confidence}
✂️ Photo 1: Applying AI crop (confidence: 0.85)

🐦 Photo 1: Starting bird identification
📍 Context: The photo was taken at GPS coordinates ...
📤 Sending bird ID request to Vision API (gpt-4o-mini)...
📥 Bird ID raw response: {...}
📋 Parsed response: {...}
✅ Found 3 bird candidates: [...]

📊 Aggregating species suggestions from all photos...
✅ Aggregation complete: 1 species found
🎉 Species identified: ["Common Kingfisher (Alcedo atthis) (95%)"]
```

---

### 5. Lowered Confidence Threshold
**Problem**: AI crop was too conservative (0.6 threshold).

**Fix**: Changed threshold from 0.6 to 0.5 in `AddPhotosFlow.tsx` line 62.

**Expected Result**: AI should attempt cropping more often.

---

## Testing with bird-test.jpeg

### Location: `/src/assets/images/bird-test.jpeg`
This is a Kingfisher from Taiwan.

### Test Steps:

1. **Open the app** and sign in with GitHub
2. **Click "Add Photos"** button (floating button bottom-right or main CTA)
3. **Select** `/src/assets/images/bird-test.jpeg` from the file picker
4. **Open DevTools Console** (F12 → Console tab)
5. **Watch the logs** as the photo processes:
   - Should see EXIF extraction
   - Should see clustering (1 outing)
   - Should see location detection (if GPS in EXIF)
   - Should see crop detection
   - Should see bird identification
6. **Review the results**:
   - Photo should have colored border if AI cropped
   - Species suggestions should appear
   - Confidence scores should be visible

---

## Common Issues & Solutions

### Issue: "No birds identified"
**Possible causes**:
- Image is too large and AI times out
- AI couldn't detect a bird in the image
- LLM API is down or rate-limited

**Solution**:
- Check console for error messages
- Try manually cropping the photo (hover over photo, click crop icon)
- Ensure image has clear bird subject

---

### Issue: Location detection not working
**Possible causes**:
- Photo has no GPS EXIF data
- LLM API call failed
- Network issue

**Solution**:
- Check console for "📍 Context:" log - should show coordinates
- Check for errors in location fetch
- Manually enter location name if needed

---

### Issue: Crop box not visible
**Expected behavior**:
- After AI processing, photos with AI crops should have **accent-colored (orange) borders**
- Badge in top-right should say "🤖 AI"
- Hover should show crop button

**If not seeing**:
- Check if AI crop confidence was below 0.5 (check console logs)
- Photo may not have been cropped (which is okay)

---

## Expected Console Output (Successful Flow)

```
🔍 Photo 1: Starting AI crop detection
📤 Sending crop detection request to Vision API...
📥 Crop detection response: {"cropBox":{...}}
✅ AI crop suggestion successful: {x: 25, y: 30, width: 45, height: 40, confidence: 0.85}
✂️ Photo 1: Applying AI crop (confidence: 0.85)

🐦 Photo 1: Starting bird identification
📍 Context: The photo was taken at GPS coordinates 25.0330, 121.5654. The photo was taken in March.
📤 Sending bird ID request to Vision API (gpt-4o-mini)...
📥 Bird ID raw response: {"candidates":[{"species":"Common Kingfisher (Alcedo atthis)","confidence":0.95}]}
📋 Parsed response: {candidates: Array(1)}
✅ Found 1 bird candidates: [{species: "Common Kingfisher (Alcedo atthis)", confidence: 0.95}]

📊 Aggregating species suggestions from all photos...
✅ Aggregation complete: 1 species found
🎉 Species identified: ["Common Kingfisher (Alcedo atthis) (95%)"]
```

---

## Key Files Modified

1. **`/src/lib/ai-inference.ts`**
   - Changed `gpt-4o` → `gpt-4o-mini` (2 places)
   - Enhanced console logging

2. **`/src/components/flows/AddPhotosFlow.tsx`**
   - Enhanced console logging
   - Lowered crop threshold 0.6 → 0.5
   - Better toast notifications

3. **`/src/components/flows/SpeciesConfirmation.tsx`**
   - Enhanced crop box visual indicators
   - Colored borders (accent for AI, primary for manual)
   - Better badges and help text

---

## Next Steps

1. **Test the upload flow** with bird-test.jpeg
2. **Check console logs** to verify each step completes
3. **Verify crop indicators** appear on processed photos
4. **Confirm species identification** works and returns results

If you encounter errors, check the console first and share the error messages for further debugging.
