# WingDex

A photo-first bird identification and life list tracker built on [GitHub Spark](https://github.com/features/spark). Upload your bird photos, let AI identify the species, and build your personal WingDex over time.

**[Try it →](https://wingdex--jlian.github.app)**

<img width="1232" height="1187" alt="image" src="https://github.com/user-attachments/assets/b0963b71-bec5-4210-b8b5-009b53e85359" />

## What is WingDex?

WingDex is for **reverse birding**: people who take photos first and identify species later. Instead of checklists and field guides, you upload photos you already took, and AI handles the species identification. You just confirm with a tap.

**Your photos are never stored.** They're used only during identification and immediately discarded. Upload a whole day's worth of photos at once via the **batch upload wizard**, which clusters them into outings, identifies each bird, and lets you confirm results in one flow. Every species in your WingDex links back to the outings where you saw it, and every outing links to its species in the WingDex — so you can always **cross-reference between your WingDex and your field trips**.

### Features

- **Privacy-first** - Photos are never stored; all bird imagery comes from Wikipedia
- **Batch upload** - Drop a day's photos; they're auto-grouped into outings by time/GPS proximity, merged with existing sessions, and deduplicated by hash
- **EXIF extraction** - GPS, timestamps, and thumbnails parsed client-side
- **AI species ID** - GPT-4.1 vision returns ranked candidates with confidence scores and bounding boxes, grounded against ~11,000 eBird species
- **WingDex Life list** - First/last seen, total sightings, Wikipedia imagery; searchable and sortable
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
6. **Saved** to your WingDex with species, count, and confidence

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
git clone https://github.com/jlian/wingdex.git
cd wingdex
npm ci
npm run dev
```

For reproducible installs and stable lockfile output, use `Node 22.16.x` and `npm 10.9.x`.

`npm run dev` now starts both local API runtime (`wrangler pages dev` on `:8788`) and Vite HMR (`:5000`) in one command.

### AI provider setup (local)

AI calls run through server endpoints (`/api/identify-bird`, `/api/suggest-location`) and require local env vars.

1. Copy `.dev.vars.example` to `.dev.vars`
2. Choose provider with `LLM_PROVIDER=openai|azure|github`
3. Fill provider credentials and (optionally) model

OpenAI:

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

Azure OpenAI:

```dotenv
LLM_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT=gpt-4.1-mini
# optional
AZURE_OPENAI_API_VERSION=2024-10-21
```

GitHub Models:

```dotenv
LLM_PROVIDER=github
GITHUB_MODELS_TOKEN=...
# optional (defaults shown)
GITHUB_MODELS_MODEL=openai/gpt-4.1-mini
GITHUB_MODELS_ENDPOINT=https://models.github.ai/inference/chat/completions
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start full local dev loop: Functions API (`:8788`) + Vite HMR (`:5000`) |
| `npm run dev:vite` | Start Vite only |
| `npm run dev:cf` | Start Cloudflare Pages Functions runtime only |
| `npm run build` | Type-check and production build |
| `npm run test` | Run all tests (Vitest) |
| `npm run test:unit` | Run unit tests only |
| `npm run test:e2e` | Run end-to-end tests (Playwright) |
| `npm run setup:playwright` | Install Playwright Chromium + Linux deps |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with ESLint |
| `npm run preview` | Preview production build |

In Codespaces, `.vscode/tasks.json` runs `bootstrap-workspace` on folder open to bootstrap ephemeral environments. It installs Playwright dependencies and only starts `npm run dev` when nothing is already serving `http://localhost:5000`. If prompted, allow automatic tasks for this workspace.

### Releases (automated semver + tags)

- PR titles must follow semantic commit style (for example `feat: add outing merge UX` or `fix: handle wiki 404 fallback`).
- On push to `main`, Release Please opens/updates a release PR and calculates the next semantic version:
  - `feat` → minor
  - `fix`/`perf`/`refactor` and other non-breaking types → patch
  - `!` or `BREAKING CHANGE:` → major
- Merging the release PR updates `package.json`, updates `CHANGELOG.md`, and creates the Git tag/release (for example `v1.3.0`).

## Security notes

- WingDex is designed for **low-sensitivity personal birding data** (outings, observations, notes).
- Data separation is implemented with **user-scoped storage keys** (for example `u123_photos`) and app-level runtime checks.
- In hosted Spark runtime, WingDex requires a valid Spark user session and does not fall back to a shared dev identity.
- In local/dev runtime, storage uses browser localStorage and should be treated as development-only data storage.
- If you need strong tenant isolation for sensitive data, use a backend that enforces per-user access server-side.

## License

[MIT](LICENSE)

