# WingDex

A photo-first bird identification and life list tracker built on Cloudflare Pages + D1. Upload your bird photos, let AI identify the species, and build your personal WingDex over time.

**[Try it →](https://wingdex.app)**

<img width="1150" height="1142" alt="image" src="https://github.com/user-attachments/assets/79c364ae-e4f3-49ba-9fed-6e5966470304" />

## What is WingDex?

WingDex is for **reverse birding**: people who take photos first and identify species later. Instead of checklists and field guides, you upload photos you already took, and AI handles the species identification. You just confirm with a tap.

**Your photos are never stored.** They're used only during identification and immediately discarded. Upload a whole day's worth of photos at once via the **batch upload wizard**, which clusters them into outings, identifies each bird, and lets you confirm results in one flow. Every species in your WingDex links back to the outings where you saw it, and every outing links to its species in the WingDex, so you can always **cross-reference between your WingDex and your field trips**.

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
3. **Review** the outing, confirm date, location (auto-geocoded), and notes
4. **AI identifies** each bird with ranked suggestions, confidence scores, and a crop box
5. **Confirm**, accept, mark as possible, pick an alternative, re-crop, or skip
6. **Saved** to your WingDex with species, count, and confidence

## Tech stack

| Layer | Technology |
|-------|------------|
| Platform | Cloudflare Pages + Pages Functions + D1 |
| Frontend | React 19, TypeScript, Vite 7 |
| Styling | Tailwind CSS 4, Radix UI primitives, Phosphor Icons |
| AI | GPT-4.1-mini (vision) via server-owned `/api/identify-bird` endpoint |
| Geocoding | OpenStreetMap Nominatim |
| Bird imagery | Wikipedia REST API |
| Testing | Vitest (unit), Playwright (e2e) |

## Development

### Prerequisites

Use Node 24+ (`node --version`) and install dependencies with `npm ci`.

### Running locally

```bash
git clone https://github.com/jlian/wingdex.git
cd wingdex
npm ci
npm run dev
```

`npm run dev` now starts both local API runtime (`wrangler dev` on `:8787`) and Vite HMR (`:5000`) in one command.

### Local auth modes

Local auth intentionally uses two different origins depending on the flow:

1. `localhost` for normal local web usage, passkeys, and Playwright e2e. This keeps the WebAuthn RP ID aligned with the page the browser is actually on.
2. `BETTER_AUTH_URL` for social OAuth flows that must present a hosted public callback URL to GitHub, Google, or Apple.

Operationally, that means:

1. Local web on `http://localhost:5000` keeps localhost semantics by default.
2. Hosted web on `https://localhost.wingdex.app` uses the hosted domain normally.
3. Mobile social OAuth started through `/api/auth/mobile/start` uses the hosted callback domain from `BETTER_AUTH_URL`, even during local dev.

If GitHub or Google reports an invalid redirect URI during local mobile testing, verify that:

1. `BETTER_AUTH_URL` matches the hosted callback domain registered with the provider.
2. The provider app allows `https://.../api/auth/callback/github` or `.../google` on that hosted domain.
3. You are not expecting plain localhost web social OAuth to use the hosted callback domain; that path still behaves like localhost web unless you test on the hosted site.

### AI provider setup (local)

AI calls run through the server endpoint (`/api/identify-bird`) via
[Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) and
require local env vars.

1. Copy `.dev.vars.example` to `.dev.vars`
2. Set `CF_ACCOUNT_ID` and `AI_GATEWAY_ID`
3. Fill `OPENAI_API_KEY` and (optionally) `OPENAI_MODEL`

```dotenv
CF_ACCOUNT_ID=...
AI_GATEWAY_ID=wingdex-prod
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

Optional per-user daily limits for AI endpoints (UTC day):

```dotenv
AI_DAILY_LIMIT_IDENTIFY=150
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
- Data separation is enforced server-side with authenticated session user IDs on all protected `/api/*` endpoints.
- Production/preview persistence uses D1 (with user-scoped queries) rather than client-only key partitioning.
- In local/dev fallback mode, some flows may use browser localStorage and should be treated as development-only data storage.
- If you need strong tenant isolation for sensitive data, use a backend that enforces per-user access server-side.

## License

[MIT](LICENSE)

