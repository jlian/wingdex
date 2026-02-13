# BirdDex

A mobile-first bird sighting tracker built on [GitHub Spark](https://githubnext.com/projects/github-spark). Upload photos, let AI identify the species, and build your life list.

**Live app:** [birddex--jlian.github.app](https://birddex--jlian.github.app)

## Features

- **Photo upload with EXIF extraction** — GPS coordinates, timestamps, and automatic outing clustering
- **AI bird detection & species ID** — Powered by GPT-4.1 vision via GitHub Models. Auto-crops to the bird, identifies species with confidence scores
- **Per-photo confirmation flow** — Review each photo individually: high-confidence IDs are auto-selected, low-confidence shows alternatives, no bird detected offers manual crop or skip
- **Life list** — Tracks every confirmed species with first/last seen dates, total sightings, and best photo
- **eBird import/export** — Import your existing eBird CSV data or export your life list
- **Per-user data isolation** — All data is scoped to your GitHub account via Spark's KV store

## Tech Stack

- **Platform:** GitHub Spark (KV storage, LLM proxy, GitHub auth)
- **Frontend:** React 19, TypeScript, Vite
- **Styling:** Tailwind CSS 4, Radix UI primitives, Phosphor Icons
- **AI:** OpenAI GPT-4.1 (vision) and GPT-4.1-mini (text) via `/_spark/llm`
- **Geocoding:** OpenStreetMap Nominatim API

## How It Works

1. **Upload** bird photos from your device
2. **EXIF data** is extracted (GPS, timestamp) and photos are clustered into outings by time and location
3. **Review the outing** — confirm date, location (auto-resolved from GPS via Nominatim), and notes
4. **Per-photo AI pipeline:**
   - AI detects and crops to the bird in each photo (25% padding)
   - If no bird found, you can manually crop or skip
   - Cropped image is sent for species identification with GPS/season context
   - You confirm, mark as "possible," pick an alternative, or skip
5. **Observations saved** to your life list with species, count, and confidence

## Project Structure

```
src/
  App.tsx                          - Main app shell, auth, hash routing, tab navigation
  components/
    flows/
      AddPhotosFlow.tsx            - Upload, outing review, per-photo ID flow
      OutingReview.tsx             - Outing metadata + location review
    pages/
      HomePage.tsx                 - Dashboard with stats + recent outings
      OutingsPage.tsx              - Outing list + detail view
      LifeListPage.tsx             - Species list + detail view
      SettingsPage.tsx             - Import/export, saved locations, data management
    ui/
      bird-row.tsx                 - Shared species row component
      stat-card.tsx                - Shared stat card component
      empty-state.tsx              - Shared empty state component
      ...                          - Radix-based UI primitives
  hooks/
    use-birddex-data.ts            - Per-user KV data layer
    use-kv.ts                      - Spark KV with localStorage fallback
  lib/
    ai-inference.ts                - Vision AI: crop detection, species ID
    clustering.ts                  - Time+distance outing clustering
    ebird.ts                       - eBird CSV import/export
    photo-utils.ts                 - EXIF parser, thumbnails, hashing
    types.ts                       - TypeScript interfaces
    utils.ts                       - Tailwind merge + species name helpers
  styles/
    theme.css                      - Design tokens
```

## Development

This is a GitHub Spark app. To develop:

1. Open in GitHub Spark's Codespace editor
2. The dev server starts automatically on port 5000
3. AI features (bird detection, species ID) only work within the Spark environment since they use the `/_spark/llm` proxy

### Running locally

You can clone and run `npm run dev`, but **AI features will not work** outside of Spark. The `/_spark/llm` endpoint is only available in the Spark runtime. Everything else (photo upload, EXIF parsing, outing management, life list) works normally.

## License

MIT

