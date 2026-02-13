# UX Fixes Tracker

## High Priority

- [x] **1. Crop overlay misaligned on non-square images** — now uses `getRenderedImageRect()` to compute actual letterbox offset, positions overlay in px relative to rendered image
- [x] **2. No way to go back to previous photo** — added Back button + `onBack` prop to `PerPhotoConfirm`, removes last result and re-runs species ID
- [x] **3. Crop dialog image area can collapse to zero height** — added `min-h-[200px]` to image container

## Medium Priority

- [x] **4. GPS toggle is not accessible** — replaced hand-rolled div with Radix `<Switch>` + `<Label>` with proper `htmlFor`/`id` binding
- [x] **5. Cancel on crop skips photo with no confirmation** — now returns to confirm screen (showing no-results state) instead of silently skipping
- [x] **6. AI zoom CSS can distort on extreme aspect ratios** — clamped `paddingBottom` to max 150%
- [x] **7. Complete step auto-closes too fast** — increased from 1.5s to 3.5s
- [x] **8. Loading splash shows fake "Sign in" button** — replaced with spinner + "Loading..." text
- [x] **9. Duplicate close button in AddPhotosFlow** — removed custom X button, using shadcn DialogContent's built-in close
- [x] **10. HomePage badge pluralization dead code** — removed pointless ternary, just shows "species"
- [x] **11. ErrorFallback rethrows in dev** — changed to `console.error` to avoid cascade crash
