# BirdDex

A photo-first bird identification and life list tracker built on [GitHub Spark](https://githubnext.com/projects/github-spark). Upload your bird photos, let AI identify the species, and build your personal BirdDex over time.

**[Try it live →](https://birddex--jlian.github.app)**

![BirdDex home screen](screenshots/desktop-home.png)

## What is BirdDex?

BirdDex is for **reverse birders**: people who take photos first and identify species later. Instead of checklists and field guides, you upload photos you already took, and AI handles the species identification. You just confirm with a tap.

### Features

- **AI species identification** - A single GPT-4.1 vision call per photo returns ranked species candidates with confidence scores and a bounding box around the bird, using GPS coordinates and season as context. Species names are grounded against a bundled eBird taxonomy (~11,000 species)
- **Smart outing clustering** - Photos are automatically grouped into outings by time and GPS proximity (8hr / 10km thresholds), with merging into existing outings when sessions overlap. Duplicate photos are detected via SHA-256 hash
- **EXIF extraction** - GPS coordinates, timestamps, and thumbnails are parsed client-side from photo metadata
- **BirdDex life list** - Every confirmed species is tracked with first/last seen dates, total sightings, and Wikipedia reference imagery. Searchable and sortable by name, date, or sighting count
- **Species detail view** - Hero image, Wikipedia summary, sighting history across all outings, and external links to eBird, Wikipedia, and All About Birds
- **Outing management** - Editable location names and notes, manual species entry with taxonomy-backed autocomplete, per-observation delete, per-outing eBird CSV export, and Google Maps links for GPS coordinates
- **eBird integration** - Import your eBird CSV to create full outings grouped by date and location with confirmed observations, or export your life list and individual outings in eBird Record Format
- **Dark mode** - Light, dark, and system appearance modes with persistent preference
- **Saved locations** - Store frequently-visited birding spots with geolocation support, Google Maps links, and nearby outing counts
- **Dashboard** - Stat cards (species, outings, new this month, photos), recent species and outings, and highlights (most seen, first species, best outing)
- **Per-user isolation** - All data is scoped to your GitHub account via Spark's KV store. Photos are used only during identification and not persisted; bird imagery comes from Wikipedia

## How it works

1. **Upload** one or more bird photos from your device
2. **EXIF data** is extracted client-side (GPS, timestamp) and photos are clustered into outings
3. **Review the outing** - confirm date, location (auto-resolved via Nominatim geocoding), and notes
4. **AI identifies each photo** - a single vision call returns species candidates with confidence scores and a crop bounding box, using GPS and season as context
5. **Confirm each result** - accept the top suggestion, mark as "possible," pick an alternative, manually crop and retry, or skip
6. **Observations saved** to your BirdDex with species, count, and confidence

## Tech stack

| Layer | Technology |
|-------|------------|
| Platform | [GitHub Spark](https://githubnext.com/projects/github-spark) - KV storage, LLM proxy, GitHub auth |
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
| `npm run test:smoke` | Run smoke tests only |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with ESLint |
| `npm run preview` | Preview production build |

## License

[MIT](LICENSE)

