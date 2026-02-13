# BirdDex

A photo-first bird identification and life list tracker built on [GitHub Spark](https://github.com/features/spark). Upload your bird photos, let AI identify the species, and build your personal BirdDex over time.

**[Try it →](https://birddex--jlian.github.app)**

<img width="1133" height="913" alt="image" src="https://github.com/user-attachments/assets/86636186-bef4-45cb-becc-3760ff9951c2" />

## What is BirdDex?

BirdDex is for **reverse birding**: people who take photos first and identify species later. Instead of checklists and field guides, you upload photos you already took, and AI handles the species identification. You just confirm with a tap.

**Your photos are never stored.** They're used only during identification and immediately discarded. Upload a whole day's worth of photos at once via the **batch upload wizard**, which clusters them into outings, identifies each bird, and lets you confirm results in one flow. Every species in your BirdDex links back to the outings where you saw it, and every outing links to its species in the BirdDex — so you can always **cross-reference between your BirdDex and your field trips**.

### Features

- **Privacy-first** - Photos are never stored; all bird imagery comes from Wikipedia
- **Batch upload** - Drop a day's photos; they're auto-grouped into outings by time/GPS proximity, merged with existing sessions, and deduplicated by hash
- **EXIF extraction** - GPS, timestamps, and thumbnails parsed client-side
- **AI species ID** - GPT-4.1 vision returns ranked candidates with confidence scores and bounding boxes, grounded against ~11,000 eBird species
- **BirdDex Life list** - First/last seen, total sightings, Wikipedia imagery; searchable and sortable
- **Species detail** - Hero image, Wikipedia summary, sighting history, and links to eBird / All About Birds
- **Outing management** - Editable locations/notes, taxonomy autocomplete, per-observation delete, eBird CSV export, Google Maps links
- **eBird integration** - Import/export checklists and life lists in eBird Record Format
- **Dark mode** - Light, dark, and system themes
- **Saved locations** - Bookmark birding spots with geolocation and nearby outing counts
- **Dashboard** - Stats, recent activity, and highlights at a glance

## How it works

1. **Upload** bird photos from your device
2. **EXIF** GPS & timestamps are extracted and photos are clustered into outings
3. **Review** the outing — confirm date, location (auto-geocoded), and notes
4. **AI identifies** each bird with ranked suggestions, confidence scores, and a crop box
5. **Confirm** — accept, mark as possible, pick an alternative, re-crop, or skip
6. **Saved** to your BirdDex with species, count, and confidence

## Tech stack

| Layer | Technology |
|-------|------------|
| Platform | [GitHub Spark](https://github.com/features/spark) - hosting, KV storage, LLM proxy, GitHub auth |
| Frontend | React 19, TypeScript, Vite 7 |
| Styling | Tailwind CSS 4, Radix UI primitives, Phosphor Icons |
| AI | GPT-4.1 (vision) via Spark's `/_spark/llm` proxy |
| Geocoding | OpenStreetMap Nominatim |
| Bird imagery | Wikipedia REST API |
| Testing | Vitest (unit), Playwright (e2e) |

## Development

### Prerequisites

This is a GitHub Spark app. The recommended way to develop is inside Spark's Codespace editor, where the dev server starts automatically on port 5000.

### Running locally

```bash
git clone https://github.com/jlian/birddex.git
cd birddex
npm install
npm run dev
```

> **Note:** AI features (bird detection, species ID) require the `/_spark/llm` proxy and will not work outside of the Spark runtime. Everything else (photo upload, EXIF parsing, outing management, BirdDex browsing) works normally.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (port 5000) |
| `npm run build` | Type-check and production build |
| `npm run test` | Run all tests (Vitest) |
| `npm run test:unit` | Run unit tests only |
| `npm run test:e2e` | Run end-to-end tests (Playwright) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with ESLint |
| `npm run preview` | Preview production build |

## Security notes

- BirdDex is designed for **low-sensitivity personal birding data** (outings, observations, notes).
- Data separation is implemented with **user-scoped storage keys** (for example `u123_photos`) and app-level runtime checks.
- In hosted Spark runtime, BirdDex requires a valid Spark user session and does not fall back to a shared dev identity.
- In local/dev runtime, storage uses browser localStorage and should be treated as development-only data storage.
- If you need strong tenant isolation for sensitive data, use a backend that enforces per-user access server-side.

## License

[MIT](LICENSE)

