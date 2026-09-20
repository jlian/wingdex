# App Store media

This contains the selected six-screenshot set, its inputs, and reusable screenshot
and App Preview generators. Video recordings, exports, and generated posters are
local-only and ignored by Git. No running app, account, backend, or session
workspace is needed to render; supply your own video recordings first.
Open `sentence-set.html` for screenshots; after rendering videos, use the local
server below for playback and seeking.

## How these were made

- Screenshots: real iOS app captures (`raw-*.png`) and five bird-photo crops
  (`photo-*.jpg`) are composed in `polished-artwork.html`. CSS supplies the cream
  and green background, Georgia headlines, supporting text, and phone frames.
  `render-artwork.cjs` uses Playwright Chromium to capture the composition.
  It renders the sentence direction, revision 1 for slides 01/02/05/06 and
  revision 2 for 03/04. Those last two are intentionally named `-sentences-v2`.
- Videos: the supplied A and B screen recordings are cut at original speed
  according to `preview-edit.json`. `preview-title-cards.swift` draws full-screen
  chapter cards with macOS AppKit. `render-previews.mjs` inserts the cards,
  scales/pads footage, converts to BT.709, and runs FFmpeg two-pass encoding.
  There is no music or recorded audio in the exports.

Only the chosen screenshot exports are included, not video media, old drafts,
contact sheets, ZIP duplicates, executable caches, reviewer contact details, or
submission notes. The checked-in video edit list is an example from the launch.

## Regenerate

Run these commands from the repository root. Requires Node 24+, the repository's
existing Playwright dependency and Chromium, Python 3 for the optional gallery
server, and macOS with Xcode command-line tools (`xcrun swiftc`) plus FFmpeg with
`libx264` and `ffprobe` for videos. Georgia and Arial must be available for the
original typography; they are system fonts, not redistributed here.

If project dependencies or Chromium are missing, follow the root README setup
and run `npx playwright install --only-shell chromium`.

```sh
# All six selected screenshots; no server required.
node design/app-store/render-artwork.cjs

# Put your recordings in this ignored directory as A.mp4 and B.mp4,
# or update the source paths in preview-edit.json.
mkdir -p design/app-store/sources
# Adjust each section's start/end times and titles for your new footage.

# Both videos and their gallery posters.
node design/app-store/render-previews.mjs

# Optional galleries, loopback only. Stop with Ctrl+C.
python3 design/app-store/serve-previews.py design/app-store --port 8765
# http://127.0.0.1:8765/sentence-set.html
# http://127.0.0.1:8765/preview-pair.html
```

The renderers overwrite exports by default. To compare a new render without
replacing the selected files:

```sh
node design/app-store/render-artwork.cjs design/app-store/.generated/check
node design/app-store/render-previews.mjs \
  design/app-store/preview-edit.json design/app-store/.generated/check
```

The optional screenshot output directory is the first argument. Video arguments
are the edit-list path followed by the output directory. Recording paths resolve
relative to the edit list, not the shell's working directory. Intermediate title
cards, compiler output, and encoding logs stay in an ignored `.generated/`
directory under the output directory. It is safe to remove `.generated/` and the
intermediate files after rendering. Keep your recordings separately backed up.

### Title cards without rendering video

Compile the generator, then render the standalone opening card:

```sh
mkdir -p design/app-store/.generated
xcrun swiftc -parse-as-library -O \
  "$PWD/design/app-store/preview-title-cards.swift" \
  -o design/app-store/.generated/preview-title-cards
design/app-store/.generated/preview-title-cards \
  design/app-store/brand-card.json design/app-store/.generated/brand
```

The opening card is `.generated/brand/preview-title-0-0.png`, 886 x 1920.
It uses a large app icon and centered title. Edit `brand-card.json` to change
the title. For chapter cards, use `preview-edit.json` instead and output to
`.generated`; those cards use a small icon instead of the old text wordmark.
To render just one chapter, supply a JSON with one preview and one section
containing only `title`. Use `\n` for explicit line breaks.

The generator reads `app-icon.png` beside the Swift source by default; an optional
third argument selects a different icon PNG. This transparent 1024 x 1024 image
is rendered from the actual iOS `AppIconView` and its four asset layers in light
mode. It preserves the in-app colors and gradients, not Icon Composer's Liquid
Glass effects or square background. To regenerate it after changing the app icon:

```sh
bash design/app-store/render-app-icon.sh
```

This uses macOS SwiftUI and Xcode's asset compiler; it does not build or run the
iOS app. Recompile the title-card generator after moving the repository because the
default icon path is resolved from the Swift source location at compile time.
The standalone opening card is not automatically inserted into the videos, so
existing cuts and durations remain unchanged. Rerender videos to apply the new
chapter icons to the MP4 exports.

### Recording storage

All of `sources/`, MP4/MOV/M4V files, and generated `*-poster.jpg` files in this
package are ignored. There is no need to split recordings or configure Git LFS.
A fresh checkout contains the video system, not the old footage or rendered
videos. The video gallery becomes usable after you provide recordings and render.

Copy new footage into `sources/`, then edit `preview-edit.json`: set each `source`
path, title, `cardSeconds`, source `start`/`end` times, and output `posterAt`.
The sample cuts below refer to the original launch recordings; they are not
automatically suitable for new footage. Keep each complete preview, including
title cards, between 15 and 30 seconds. Render again with the command above.
If you change output filenames, update the links in `preview-pair.html` too.

## Editing and output specifications

Edit layout, copy, captions, and capture filenames in `polished-artwork.html`.
Replace the raw capture or photo files to update the app visuals. The screenshot
gallery links to each exact source URL. The renderer pins the chosen revisions;
changing a different revision will not change the final outputs.

Edit video titles, cuts, card durations, and poster times in `preview-edit.json`.
Titles use explicit `\n` line breaks. Swift rejects over-wide or over-tall cards.
Edit the Swift source for title-card typography and the video renderer for
encoding settings. Times below are seconds in the unmodified original files:

| Export | Source ranges | Cards | Total |
|--------|---------------|-------|-------|
| `wingdex-preview-01-batch.mp4` | A: 0-5, 5-8.5, 8.5-11, 11-23 | 1.5s before each range | 29s |
| `wingdex-preview-02-history.mp4` | B: 2-9.5, 12-20 | 2s before each range | 19.5s |

- Screenshots: six opaque PNGs, 1320 x 2868 pixels, device scale factor 1.
- Videos: 886 x 1920, 30 fps constant frame rate, H.264 High profile level 4.0,
  yuv420p, BT.709 limited range, MP4 with fast start. Two-pass libx264 `slow`,
  11 Mbps target, 12 Mbps maximum, 24 Mbps buffer. Actual average bitrate varies
  with content and the encoder.
- Audio: silent AAC, 48 kHz stereo, 256 kbps requested (silence encodes smaller).
- Posters: JPEGs sampled at 13.5s and 8s respectively.

The video renderer checks duration, exact frame count, video/audio format,
dimensions, frame rate, and the 500 MB upload-size ceiling before replacing each
output. It enforces the 15-30 second duration window.

## Provenance, rights, and privacy

The PNG captures and photo crops are the inputs used in the original store
artwork. The video edit list originally used user-supplied recordings A and B,
which are not included in Git. This is not a scripted app-data setup or automated
recapture workflow. To show a newer app version, capture fresh screens/recordings
and replace the corresponding inputs.

The footage/captures include bird photos, reference imagery, outing locations,
dates, and app data. Check these for privacy and accuracy before redistributing
or submitting a new set. The app's reference bird imagery comes from Wikipedia;
individual image licensing and attribution requirements still apply. This
package does not establish ownership or grant additional rights to the photos,
reference imagery, Apple UI, or system fonts. No per-image rights ledger was
provided with these inputs; verify permission and any required attribution
before public reuse. Keep the offline/reference-image caveat in slide 05.

## Reproduction notes

The selected original screenshot exports are kept as the reference, rather than silently
replacing them with a new toolchain's output. Screenshot regeneration was checked
with Node 24.14.0, Playwright 1.62.1, and its installed Chromium on macOS: all six
PNGs reproduced byte-for-byte, including the revision-2 layouts. Other operating
systems, fonts, browser versions, or color-management implementations can change
rasterization. Video encoding and title-card rasterization can similarly vary
with FFmpeg, Swift, and macOS versions; compare decoded frames as well as output
metadata when changing the toolchain.

Both previews were also regenerated with FFmpeg 9.0.1 and Apple Swift 6.4. They
passed the export checks at 870 and 585 frames. They are not byte-identical to the
selected originals: decoded-video SSIM was 0.999791 (batch) and 0.999578 (history).
The original MP4s remain local-only. Gallery links, image loading, video
metadata, and HTTP byte-range playback were checked locally.
