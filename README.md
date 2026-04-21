# WingDex

A photo-first bird identification and life list tracker built on Cloudflare Workers + D1. Upload your bird photos, let AI identify the species, and build your personal WingDex over time.

**[Try it ->](https://wingdex.app)**

<img width="1150" height="1142" alt="image" src="https://github.com/user-attachments/assets/79c364ae-e4f3-49ba-9fed-6e5966470304" />

## What is WingDex?

WingDex is for **reverse birding**: people who take photos first and identify species later. Instead of checklists and field guides, you upload photos you already took, and AI handles the species identification. You just confirm with a tap.

**Your photos are never stored.** They're used only during identification and immediately discarded. Upload a whole day's worth of photos at once via the **batch upload wizard**, which clusters them into outings, identifies each bird, and lets you confirm results in one flow. Every species in your WingDex links back to the outings where you saw it, and every outing links to its species in the WingDex, so you can always **cross-reference between your WingDex and your field trips**.

### Features

- **Privacy-first** - Photos are never stored; all bird imagery comes from Wikipedia
- **Batch upload** - Drop a day's photos; they're auto-grouped into outings by time/GPS proximity, merged with existing sessions, and deduplicated by hash
- **EXIF extraction** - GPS, timestamps, and thumbnails parsed client-side
- **AI species ID** - GPT-5.4-mini vision returns ranked candidates with confidence scores and bounding boxes, grounded against ~11,000 eBird species via range-prior filtering
- **WingDex life list** - First/last seen, total sightings, Wikipedia imagery; searchable and sortable
- **Species detail** - Hero image, Wikipedia summary, sighting history, and links to eBird / All About Birds
- **Outing management** - Editable locations/notes, taxonomy autocomplete, per-observation delete, eBird CSV export, Google Maps links
- **eBird integration** - Import/export checklists and life lists in eBird Record Format
- **Auth** - Anonymous sessions, passkeys (WebAuthn), and social OAuth (GitHub, Google, Apple)
- **Dark mode** - Light, dark, and system themes
- **Saved locations** - Bookmark birding spots with geolocation and nearby outing counts
- **Dashboard** - Stats, recent activity, and highlights at a glance
- **iOS app** - Native companion app (see `ios/`)

## How it works

1. **Upload** bird photos from your device
2. **EXIF** GPS and timestamps are extracted and photos are clustered into outings
3. **Review** the outing, confirm date, location (auto-geocoded), and notes
4. **AI identifies** each bird with ranked suggestions, confidence scores, and a crop box
5. **Confirm**, accept, mark as possible, pick an alternative, re-crop, or skip
6. **Saved** to your WingDex with species, count, and confidence

## Tech stack

| Layer | Technology |
|-------|------------|
| Platform | Cloudflare Workers, D1 (SQLite), R2 (range priors), AI Gateway |
| Frontend | React 19, TypeScript, Vite 8 |
| Styling | Tailwind CSS 4, Radix UI primitives, Phosphor Icons |
| Auth | better-auth (anonymous, passkeys, GitHub/Google/Apple OAuth) |
| AI | GPT-5.4-mini (vision) via Cloudflare AI Gateway |
| Geocoding | OpenStreetMap Nominatim |
| Bird imagery | Wikipedia REST API |
| Testing | Vitest (unit), Playwright (e2e) |
| iOS | Swift, XcodeGen |

## Development

### Prerequisites

- Node 24+ (`node --version`)

### Running locally

```bash
git clone https://github.com/jlian/wingdex.git
cd wingdex
npm install
npm run dev
```

`npm run dev` starts both the local API runtime (`wrangler dev` on `:8787`) and Vite HMR (`:5000`) in one command. On first run it auto-builds the worker bundle and creates `.dev.vars` from the example file.

The first time you visit the app, run `npm run db:migrate` to create the local D1 database tables.

**Optional:** Run `npx wrangler login` to enable AI identification and range-prior filtering. The app works without it - those features just won't be available.

### AI provider setup

AI identification runs through `/api/identify-bird` via [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/). To enable it locally, fill in the AI section of your `.dev.vars` (see [.dev.vars.example](.dev.vars.example) for all options).

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local dev: API (`:8787`) + Vite HMR (`:5000`) |
| `npm start` | Production-like build + serve on `:5000` |
| `npm stop` | Stop all dev processes |
| `npm run build` | Type-check and production build |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run lint` | Lint with ESLint |
| `npm run typecheck` | Type-check with TypeScript |
| `npm test` | Run all Vitest tests |
| `npm run test:e2e` | Playwright e2e tests (skips `@live` tests) |
| `npm run test:e2e:live` | Playwright e2e tests that require AI credentials |
| `npm run check` | Quick gate: lint + typecheck + test |
| `npm run check:all` | Full gate: check + e2e + build |
| `npm run db:migrate` | Apply D1 migrations to local database |
| `npm run fixtures` | LLM fixture tools (`-- benchmark`, `-- analyze`, `-- promote`) |
| `npm run taxonomy` | Taxonomy pipeline (`-- ebird`, `-- hydrate`, `-- validate`) |

To run `@live` tests (require AI credentials): `npm run test:e2e:live`

### Releases

PR titles must follow Conventional Commits (e.g., `feat: add outing merge UX`, `fix: handle wiki 404 fallback`). On merge to `main`, Release Please calculates the next version, updates `CHANGELOG.md`, and creates a Git tag.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

