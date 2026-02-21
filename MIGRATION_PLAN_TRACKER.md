# WingDex Migration Plan & Tracker

> Source: [Issue #74 comment](https://github.com/jlian/wingdex/issues/74#issuecomment-3906820357) · Last updated: 2026-02-21
>
> **Legend**: ✅ Done · ⚠️ Done with deviation · ⏳ Pending · _(empty)_ Not started
>
> **Extra work outside plan steps**: storage-key format fix for UUID-based user IDs (`storage-keys.ts`, `use-kv.ts`); D1 adapter wiring via Kysely + kysely-d1 (Better Auth doesn't accept raw D1 bindings); full-stack local dev orchestration scripts (`dev:full`, `dev:full:restart`, macOS-safe `kill`); local auth/session hardening for HTTP localhost + in-app UX smoothing (no hard-reload import/sign-out).

---

## Comprehensive Migration Plan: WingDex from GitHub Spark to Cloudflare (D1-first)

### TL;DR

> **Phase 2 status**: ⚠️ Mostly aligned through data/API migration; auth provider parity (GitHub/Apple/Google UI+config) and server-owned AI endpoints remain outside completed Phase 2 scope.

WingDex has **5 Spark integration points**: auth (`window.spark.user()`), KV persistence (`/_spark/kv`), LLM proxy (`/_spark/llm`), Spark runtime bootstrap (`@github/spark/spark`), and Spark Vite plugins. All live in a small number of files and use standard patterns — this is a platform-integration migration, not a rewrite.

**Target stack**: Cloudflare Pages (SPA hosting) + Pages Functions (API routes) + D1/SQLite (all data — auth + app) + Better Auth (GitHub/Apple/Google + passkeys) + AI Gateway (LLM). Fresh start, no data migration.

**Design principle**: The API layer is the product's brain — bird ID, taxonomy search, dex computation, eBird import logic all live server-side. Clients (web SPA now, native iOS later) are thin UI shells that upload images, display results, and render data. This means adding a native iOS app later requires zero business-logic duplication — just new SwiftUI views calling the same endpoints.

---

### Architecture

> **Phase 2 status**: ⚠️ Core data/import/export/species API architecture is implemented; `/api/identify-bird` and `/api/suggest-location` are now implemented (Phase 3 completed for code scope), and auth providers currently differ from planned social-provider setup.

```
Cloudflare Pages
├── dist/                          ← Vite SPA build output
└── functions/                     ← Pages Functions (Workers runtime)
    ├── _middleware.ts             ← session validation
    └── api/
        ├── auth/[...path].ts     ← Better Auth (GitHub, Apple, Google, passkeys)
        ├── data/
        │   ├── all.ts            ← GET: load all user data
        │   ├── outings.ts        ← POST: create outing
        │   ├── outings/[id].ts   ← PATCH/DELETE: update/delete outing
        │   ├── photos.ts         ← POST: bulk insert photos
        │   ├── observations.ts   ← POST/PATCH: create/update observations
        │   ├── dex.ts            ← GET: computed dex; PATCH: update notes/bestPhoto
        │   ├── seed.ts           ← POST: load demo data
        │   └── clear.ts         ← DELETE: wipe all user data
        ├── identify-bird.ts      ← POST: image + context → species candidates (smart endpoint)
        ├── suggest-location.ts   ← POST: GPS coords → location name suggestion
        ├── import/
        │   └── ebird-csv.ts      ← POST: upload CSV → previews; POST /confirm → insert
        ├── export/
        │   ├── outing/[id].ts    ← GET: export outing as eBird CSV
        │   └── dex.ts            ← GET: export dex as CSV
        └── species/
            └── search.ts         ← GET: taxonomy typeahead search

Bindings:
  DB  → D1 database (users, sessions, outings, photos, observations, dex_meta)
  AI  → Workers AI (optional, for native inference)
```

---

### Current Spark Dependency Map

> **Phase 2 status**: ⚠️ Spark KV/runtime/plugin dependencies are removed from active paths; Spark LLM proxy usage has been removed from active AI flows.

| Concern | Current Code | Spark API | Files Affected |
|---|---|---|---|
| **Auth** | `window.spark.user()` → `UserInfo{login, avatarUrl, email, id, isOwner}` | Spark runtime global | App.tsx, dev-user.ts |
| **KV** | `fetch('/_spark/kv/{key}')` GET/POST/DELETE, keys like `u12345_photos` | Spark KV proxy | use-kv.ts, storage-keys.ts, use-wingdex-data.ts |
| **LLM** | `POST /api/identify-bird` + `POST /api/suggest-location` | Cloudflare Functions API | ai-inference.ts, functions/api/* |
| **Runtime** | `await import('@github/spark/spark')` (conditional on `*.github.app` hostname) | Spark bootstrap | main.tsx |
| **Vite plugins** | `sparkPlugin()`, `createIconImportProxy()` | Build tooling | vite.config.ts |
| **Config** | runtime.config.json, spark.meta.json | Deployment metadata | Root files |
| **DOM** | `<div id="spark-app">`, `getDefaultPortalContainer()` | Mount point | index.html, portal-container.ts |
| **Type decls** | `GITHUB_RUNTIME_PERMANENT_NAME`, `BASE_KV_SERVICE_URL` | Build-time globals | src/vite-env.d.ts |
| **Package** | `@github/spark: 0.44.19` | npm dependency | package.json |

---

### Multi-Platform API Design

> **Phase 2 status**: ✅ Data, import/export, taxonomy, and bird-ID/location AI flows are API-first after Phase 3 endpoint rollout.

The migration is an opportunity to move business logic server-side so that any future client (iOS, Android, CLI) gets the same behavior for free. The current web app has ~1,730 lines of client-side business logic across 8 files. After migration:

| Logic | Current location | Post-migration location | Why |
|---|---|---|---|
| **Bird ID pipeline** (prompt, LLM call, taxonomy grounding, crop-box) | Client (ai-inference.ts, ~230 lines) | **Server** (`/api/identify-bird`) | Prompt changes = server deploy, not app updates. No API key on client. Zero duplication for iOS. |
| **Taxonomy search** (11K species, fuzzy matching) | Client (taxonomy.ts, ~175 lines + 300KB JSON) | **Server** (`/api/species/search`) | One implementation. No need to bundle 300KB JSON in every client. |
| **eBird CSV parsing & conflict detection** | Client (ebird.ts, ~466 lines) | **Server** (`/api/import/ebird-csv`) | Data processing with no UI dependency. Server has D1 access for conflict detection. |
| **Dex aggregation** (`buildDexFromState`) | Client (use-wingdex-data.ts, ~150 lines) | **Server** (SQL aggregate) | Already planned — SQL replaces the JS aggregation. |
| **Location name suggestion** (text LLM call) | Client (ai-inference.ts `textLLM`) | **Server** (`/api/suggest-location`) | Same reasoning as bird ID — server owns all LLM interactions. |
| **Photo EXIF extraction, thumbnails, clustering** | Client | **Client** (stays) | Must run on-device where the photos live. Each platform uses native APIs (Canvas/ImageIO). |
| **Crop UI math** | Client (crop-math.ts, ~105 lines) | **Client** (stays) | Inherently UI interaction logic. Trivial to port (~50 lines of Swift). |

After this migration, **adding an iOS app means**: build SwiftUI views that call the same REST endpoints. No prompt duplication, no taxonomy bundle, no eBird parser rewrite. The only client-side logic to port is EXIF extraction (simpler in Swift via `ImageIO`), photo clustering (~50 lines), and crop math (~50 lines).

---

### D1 Schema Design

> **Phase 2 status**: ✅ Implemented and active. Core app tables, indexes, and SQL-based dex aggregation are in place and used by `/api/data/*` routes.

The current model stores 4 JSON arrays per user in flat KV keys. Moving to D1 means proper relational tables with foreign keys, indexes, and cascading deletes.

**Entities**: `Photo`, `Outing`, `Observation`, `DexMeta` (user-managed dex metadata). The full `DexEntry` is **computed via SQL** from outings + observations, joined with `dex_meta` for user-edited fields.

**Key type change**: `user.id` changes from `number` (GitHub numeric ID) to `string` (Better Auth UUID). This affects all references to userId throughout the app.

```sql
-- ============================================================
-- Better Auth tables (auto-generated by `npx @better-auth/cli generate`)
-- Shown here for reference; exact schema comes from Better Auth
-- ============================================================

CREATE TABLE "user" (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image      TEXT,
  createdAt  TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE session (
  id         TEXT PRIMARY KEY,
  userId     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expiresAt  TEXT NOT NULL,
  ipAddress  TEXT,
  userAgent  TEXT,
  createdAt  TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE account (
  id                    TEXT PRIMARY KEY,
  userId                TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  accountId             TEXT NOT NULL,          -- provider's user ID (GitHub numeric ID, Apple sub, etc.)
  providerId            TEXT NOT NULL,          -- 'github', 'apple', 'google', 'credential'
  accessToken           TEXT,
  refreshToken          TEXT,
  accessTokenExpiresAt  TEXT,
  refreshTokenExpiresAt TEXT,
  scope                 TEXT,
  idToken               TEXT,
  password              TEXT,
  createdAt             TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE verification (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expiresAt  TEXT NOT NULL,
  createdAt  TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Better Auth passkey plugin
CREATE TABLE passkey (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  publicKey    TEXT NOT NULL,
  userId       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  credentialID TEXT NOT NULL UNIQUE,
  counter      INTEGER NOT NULL DEFAULT 0,
  deviceType   TEXT,
  backedUp     INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,
  createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- WingDex application tables
-- ============================================================

CREATE TABLE outing (
  id                  TEXT PRIMARY KEY,       -- client-generated UUID
  userId              TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  startTime           TEXT NOT NULL,          -- ISO 8601 with offset
  endTime             TEXT NOT NULL,
  locationName        TEXT NOT NULL,
  defaultLocationName TEXT,                   -- AI-suggested name before user edit
  lat                 REAL,
  lon                 REAL,
  notes               TEXT NOT NULL DEFAULT '',
  createdAt           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE photo (
  id        TEXT PRIMARY KEY,                 -- client-generated UUID
  outingId  TEXT NOT NULL REFERENCES outing(id) ON DELETE CASCADE,
  userId    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  dataUrl   TEXT NOT NULL DEFAULT '',         -- base64 data URL (ephemeral, may be empty after session)
  thumbnail TEXT NOT NULL DEFAULT '',         -- base64 thumbnail (ephemeral)
  exifTime  TEXT,                             -- ISO 8601
  gpsLat    REAL,
  gpsLon    REAL,
  fileHash  TEXT NOT NULL,
  fileName  TEXT NOT NULL
);

CREATE TABLE observation (
  id                   TEXT PRIMARY KEY,      -- client-generated UUID
  outingId             TEXT NOT NULL REFERENCES outing(id) ON DELETE CASCADE,
  userId               TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  speciesName          TEXT NOT NULL,          -- e.g. "Northern Cardinal"
  count                INTEGER NOT NULL DEFAULT 1,
  certainty            TEXT NOT NULL DEFAULT 'pending'
                       CHECK(certainty IN ('confirmed','possible','pending','rejected')),
  representativePhotoId TEXT REFERENCES photo(id) ON DELETE SET NULL,
  aiConfidence         REAL,
  notes                TEXT NOT NULL DEFAULT ''
);

-- User-managed dex metadata (not derivable from outings/observations)
CREATE TABLE dex_meta (
  userId      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  speciesName TEXT NOT NULL,
  addedDate   TEXT,                           -- wall-clock time when species first added to dex
  bestPhotoId TEXT REFERENCES photo(id) ON DELETE SET NULL,
  notes       TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (userId, speciesName)
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX idx_outing_userId            ON outing(userId);
CREATE INDEX idx_photo_outingId           ON photo(outingId);
CREATE INDEX idx_photo_userId             ON photo(userId);
CREATE INDEX idx_observation_outingId     ON observation(outingId);
CREATE INDEX idx_observation_userId       ON observation(userId);
CREATE INDEX idx_observation_species      ON observation(speciesName, userId);
CREATE INDEX idx_dex_meta_userId          ON dex_meta(userId);
CREATE INDEX idx_session_token            ON session(token);
CREATE INDEX idx_account_userId           ON account(userId);
```

**Dex computation query** (replaces client-side `buildDexFromState()`):

```sql
SELECT
  obs.speciesName,
  MIN(o.startTime)          AS firstSeenDate,
  MAX(o.startTime)          AS lastSeenDate,
  dm.addedDate,
  COUNT(DISTINCT obs.outingId) AS totalOutings,
  SUM(obs.count)            AS totalCount,
  dm.bestPhotoId,
  COALESCE(dm.notes, '')    AS notes
FROM observation obs
JOIN outing o ON obs.outingId = o.id
LEFT JOIN dex_meta dm ON dm.userId = obs.userId AND dm.speciesName = obs.speciesName
WHERE obs.userId = ?1 AND obs.certainty = 'confirmed'
GROUP BY obs.speciesName
ORDER BY obs.speciesName;
```

**Why D1 over KV**:
- The app already has clear relational entities with foreign keys (Photo → Outing, Observation → Outing, Observation → Photo)
- Cascading deletes (delete outing → delete its photos + observations) are handled for free by SQL
- Dex is a materialized view computable via SQL aggregate — no need to maintain a separate denormalized blob
- Per-record CRUD (update one observation, delete one outing) instead of read-modify-write entire arrays
- Strong consistency (no 60-second propagation delay like KV)
- D1 pricing is generous (5M rows read + 100K written/day free)

**Design notes**:
- `Photo.dataUrl`/`Photo.thumbnail` — per the PRD, user photos are "ephemeral, used only during the identification session." These fields store base64 blobs during the session but may be empty strings when loaded later. Bird imagery in the UI comes from Wikimedia Commons, not stored photos. If persistent photo storage is needed later, use Cloudflare R2 (S3-compatible blob storage) and store a URL reference in D1.
- `Photo.gps` — flattened from `{lat, lon}` object to two columns `gpsLat`/`gpsLon` for SQL friendliness.
- `Outing.userId` — currently a string already in the type definition, set to `'seed'` for demo data or the user's ID. Will use Better Auth's string user ID directly.
- Client-generated IDs — the app already generates UUIDs for outings/photos/observations client-side. D1 accepts these as primary keys.

---

### Auth: Better Auth + D1

> **Phase 2 status**: ⚠️ Better Auth + D1 wiring is implemented, but current runtime/provider behavior deviates from this section's social-provider target (currently passkey + anonymous flow).

**Why Better Auth**: Native Cloudflare Workers adapter with D1 support. Provides GitHub, Apple, Google, generic OIDC out of the box. WebAuthn/passkey plugin. ~50 lines of config vs ~300+ rolling your own with multi-provider + passkey support. Also works seamlessly with native iOS auth (`ASWebAuthenticationSession`) since it's standard OAuth — no web-specific coupling.

**Setup**:

```typescript
// functions/lib/auth.ts
import { betterAuth } from "better-auth"
import { d1Adapter } from "better-auth/adapters/d1"
import { passkey } from "better-auth/plugins/passkey"

export function createAuth(env: Env) {
  return betterAuth({
    database: d1Adapter(env.DB),
    baseURL: env.BETTER_AUTH_URL,             // e.g. "https://wingdex.example.com"
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
      apple: {
        clientId: env.APPLE_CLIENT_ID,
        clientSecret: env.APPLE_CLIENT_SECRET,
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins: [passkey()],
    session: {
      cookieCache: { enabled: true, maxAge: 60 * 5 }, // 5-min client-side cache
    },
  })
}
```

**Client-side** (`src/lib/auth-client.ts`):
```typescript
import { createAuthClient } from "better-auth/client"
import { passkeyClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_AUTH_URL || "",
  plugins: [passkeyClient()],
})
```

**Auth handler** (`functions/api/auth/[...path].ts`):
```typescript
export const onRequest: PagesFunction<Env> = async (context) => {
  const auth = createAuth(context.env)
  return auth.handler(context.request)
}
```

**Middleware** (`functions/_middleware.ts`):
```typescript
export const onRequest: PagesFunction<Env> = async (context) => {
  // Skip auth for /api/auth/* routes (Better Auth handles its own auth)
  if (new URL(context.request.url).pathname.startsWith('/api/auth')) {
    return context.next()
  }
  // Validate session for all other /api/* routes
  const auth = createAuth(context.env)
  const session = await auth.api.getSession({ headers: context.request.headers })
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }
  context.data.user = session.user
  context.data.session = session.session
  return context.next()
}
```

**UserInfo mapping** — current `UserInfo` shape vs Better Auth:

| Current (`window.spark.user()`) | Better Auth (`session.user`) | Notes |
|---|---|---|
| `id: number` | `id: string` (UUID) | **Type change** — all userId references update from `number` → `string` |
| `login: string` | `name: string` | Display name (GitHub username, Apple name, etc.) |
| `avatarUrl: string` | `image: string \| null` | May be null for passkey-only users |
| `email: string` | `email: string` | Always present |
| `isOwner: boolean` | N/A | Drop — was Spark-specific |

**Login UI** — replace `AuthErrorShell` ("Sign-in required") with a proper login page:
- "Sign in with Apple" button
- "Sign in with Google" button
- "Sign in with passkey" button
- "Sign in with GitHub" button
- "Register passkey" option

**OAuth app registration** required:
- **GitHub**: Create OAuth App at github.com/settings/developers. Callback URL: `https://wingdex.example.com/api/auth/callback/github`
- **Apple**: Create Service ID at developer.apple.com. Callback URL: `https://wingdex.example.com/api/auth/callback/apple`. Requires paid Apple Developer account ($99/yr).
- **Google**: Create OAuth 2.0 Client at console.cloud.google.com. Callback URL: `https://wingdex.example.com/api/auth/callback/google`

---

### Bird ID & AI: Smart Server Endpoint

> **Phase 2 status**: ✅ Implemented. Client now uses server-owned `/api/identify-bird` and `/api/suggest-location` endpoints.

Instead of a thin LLM proxy (which would force every client to reimplement prompt construction, taxonomy grounding, and crop-box computation), the server owns the entire bird identification pipeline. Clients upload an image with context and receive structured results.

**Client contract** — identical for web and any future native client:

```
POST /api/identify-bird
Content-Type: multipart/form-data

Fields:
  image: <binary JPEG/PNG, client pre-compressed to ≤800px>
  lat?: number
  lon?: number
  month?: number
  locationName?: string

Response 200:
{
  candidates: [
    {
      species: "Northern Cardinal",
      scientificName: "Cardinalis cardinalis",
      confidence: 0.92,
      wikiTitle: "Northern cardinal"
    }
  ],
  cropBox?: { x: number, y: number, width: number, height: number },
  multipleBirds?: boolean
}
```

**Server-side pipeline** (`functions/api/identify-bird.ts`):
1. Accept multipart upload, validate image size/type
2. Resize image server-side if needed (Cloudflare Image Resizing or `@cf/image/...`)
3. Construct the ornithologist prompt (with GPS/month/location context)
4. Call LLM backend (selectable via `env.LLM_PROVIDER` — see options below)
5. Parse JSON response from LLM
6. Ground candidate species names against taxonomy via `findBestMatch()` (taxonomy.json loaded in the Worker)
7. Compute crop box from LLM's `birdCenter`/`birdSize` percentages
8. Return structured response with `wikiTitle` included for each candidate

**Location name suggestion** (`functions/api/suggest-location.ts`):
```
POST /api/suggest-location
Body: { lat: number, lon: number, existingNames?: string[] }

Response 200:
{ name: "Central Park, New York" }
```

This replaces the client-side `textLLM()` call used for location name suggestion.

**LLM backend options** (selectable via `env.LLM_PROVIDER`):

#### Option A — AI Gateway → OpenAI (recommended for production)

Cloudflare AI Gateway proxies requests to OpenAI with added caching, rate limiting, logging, and fallback:

- **Pros**: Keeps GPT-4.1-mini quality for bird ID. Request caching saves cost on repeated/similar images. Logging dashboard for observability.
- **Cons**: Requires OpenAI API key + pay-per-use (~$0.40/M input tokens, $1.60/M output for GPT-4.1-mini). Not fully Cloudflare-native.
- **Setup**: Create AI Gateway in Cloudflare dashboard → get `AI_GATEWAY_ID`. Add `OPENAI_API_KEY` as a secret.

#### Option B — Workers AI (fully Cloudflare-native)

Use Cloudflare's on-edge GPU inference with `@cf/meta/llama-3.2-11b-vision-instruct` (vision) or `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (text):

- **Pros**: Free tier (10,000 neurons/day). Fully Cloudflare-native. No external API keys. Low latency (runs on edge).
- **Cons**: Bird ID accuracy will likely degrade vs GPT-4.1-mini. Open-source vision models are weaker on specialized species identification.
- **Cost**: Free: 10,000 neurons/day. Paid: $0.011/1,000 neurons.

#### Option C — Hybrid (recommended long-term)

AI Gateway with Workers AI fallback. AI Gateway supports declarative fallback configuration in the dashboard — no code needed. Consider a user-facing "Free mode" toggle in Settings that routes to Workers AI only (lower quality, zero cost).

**Frontend change** — `ai-inference.ts` gets **significantly simplified** (from ~230 lines to ~30 lines):
- Remove `compressImage()`, `loadImage()` (browser-only canvas stuff — server handles resizing)
- Remove prompt template, `safeParseJSON`, `findBestMatch` call, crop-box computation
- Remove `sparkVisionLLM()` / `sparkTextLLM()` wrappers
- Replace with: compress image client-side to ≤800px → `POST /api/identify-bird` with `FormData` → return structured response
- Location suggestion: `POST /api/suggest-location` with coords → return name string

---

### Species Search: Server-Side Taxonomy

> **Phase 2 status**: ✅ Implemented. Species autocomplete now queries server endpoint (`/api/species/search`) with auth guard; client-side taxonomy search dependency is removed from active typeahead flow.

The ~11K-species eBird taxonomy currently ships as a 300KB+ JSON bundle in the SPA and is searched client-side. Moving search server-side means any client gets instant typeahead without bundling the taxonomy:

```
GET /api/species/search?q=robin&limit=8

Response 200:
{
  results: [
    { common: "American Robin", scientific: "Turdus migratorius", ebirdCode: "amerob", wikiTitle: "American robin" },
    { common: "European Robin", scientific: "Erithacus rubecula", ebirdCode: "eurrob1", wikiTitle: "European robin" },
    ...
  ]
}
```

**Server implementation** (`functions/api/species/search.ts`):
- Load `taxonomy.json` once into the Worker's module scope (cached across requests)
- Port the existing `searchSpecies()` logic (prefix → substring ranked search)
- Also expose `GET /api/species/:code` for individual species details (ebirdCode, wikiTitle, scientific name)
- Response time target: <50ms on Cloudflare edge (the taxonomy is in-memory, no D1 query needed)

**Frontend change** — species typeahead in AddPhotosFlow and WingDexPage switches from local `searchSpecies()` to `fetch('/api/species/search?q=...')` (debounced at 150ms). The 300KB `taxonomy.json` import is removed from the client bundle, reducing initial load.

---

### Data Layer: Refactoring `useWingDexData`

> **Phase 2 status**: ⚠️ Implemented as API-first with optimistic updates and localStorage fallback; minor planned/actual deltas are documented in Phase 2 tracker rows.

The biggest refactor is replacing the KV-backed `useKV` hook with D1-backed API calls. The current flow is:

```
useWingDexData(userId: number)
  ├── useKV('u123_photos', [])        → loads entire Photo[] array from KV
  ├── useKV('u123_outings', [])       → loads entire Outing[] array from KV
  ├── useKV('u123_observations', [])  → loads entire Observation[] array from KV
  └── useKV('u123_dex', [])           → loads entire DexEntry[] array from KV
  
  Mutations: update React state + fire-and-forget write entire array back to KV
```

The new flow:

```
useWingDexData(userId: string)  // userId is now string
  ├── Initial load: GET /api/data/all → { photos, outings, observations, dex }
  │   (server-side: 4 SQL queries + dex computation joined from observations+outings+dex_meta)
  │
  ├── React state: useState for each array (same as before)
  │
  └── Mutations: update React state (optimistic) + await API call + apply server response
      │
      │  All observation-mutating endpoints return { ..., dexUpdates: DexEntry[] }
      │  so the client never needs to recompute the dex locally.
      │
      ├── addOuting(outing)        → POST /api/data/outings       body: outing
      ├── updateOuting(id, patch)  → PATCH /api/data/outings/:id  body: patch
      ├── deleteOuting(id)         → DELETE /api/data/outings/:id  (cascades in DB)
      │                              response: { dexUpdates: DexEntry[] }
      ├── addPhotos(photos)        → POST /api/data/photos         body: photos[]
      ├── addObservations(obs)     → POST /api/data/observations   body: obs[]
      │                              response: { observations, dexUpdates: DexEntry[] }
      ├── updateObservation(id, p) → PATCH /api/data/observations  body: {id, ...patch}
      │                              response: { observation, dexUpdates: DexEntry[] }
      ├── bulkUpdateObservations() → PATCH /api/data/observations  body: {ids, patch}
      │                              response: { observations, dexUpdates: DexEntry[] }
      ├── updateDex(outingId, obs) → POST /api/data/dex            body: {outingId, observations}
      │                              (server recomputes dex from DB, upserts dex_meta)
      │                              response: { dexUpdates: DexEntry[] }
      ├── importDexEntries(entries)→ POST /api/data/dex/import      body: entries[]
      ├── clearAllData()           → DELETE /api/data/clear
      └── loadSeedData(o, obs, d)  → POST /api/data/seed           body: {outings, observations, dex}
```

**Dex updates in mutation responses**: Every endpoint that modifies observations recomputes the affected dex entries via the SQL aggregate query and returns `dexUpdates: DexEntry[]`. The client applies these to local state. This eliminates `buildDexFromState()` as a client-side requirement — future iOS/native clients get correct dex state without reimplementing the aggregation logic.

**Local dev mode**: Keep a localStorage-based fallback. The `useWingDexData` hook checks `isCloudflareDeployed()` (hostname check) and uses either API calls or localStorage. The localStorage path can be simplified from the current `useKV` implementation since we no longer need the Spark KV code path.

**Server-side data endpoint example** (`functions/api/data/all.ts`):

```typescript
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const userId = context.data.user.id
  const db = context.env.DB

  const [outings, photos, observations] = await Promise.all([
    db.prepare('SELECT * FROM outing WHERE userId = ? ORDER BY startTime DESC').bind(userId).all(),
    db.prepare('SELECT * FROM photo WHERE userId = ?').bind(userId).all(),
    db.prepare('SELECT * FROM observation WHERE userId = ?').bind(userId).all(),
  ])

  // Compute dex via SQL
  const dex = await db.prepare(`
    SELECT obs.speciesName, MIN(o.startTime) AS firstSeenDate, MAX(o.startTime) AS lastSeenDate,
           dm.addedDate, COUNT(DISTINCT obs.outingId) AS totalOutings, SUM(obs.count) AS totalCount,
           dm.bestPhotoId, COALESCE(dm.notes, '') AS notes
    FROM observation obs
    JOIN outing o ON obs.outingId = o.id
    LEFT JOIN dex_meta dm ON dm.userId = obs.userId AND dm.speciesName = obs.speciesName
    WHERE obs.userId = ?1 AND obs.certainty = 'confirmed'
    GROUP BY obs.speciesName ORDER BY obs.speciesName
  `).bind(userId).all()

  // Transform photo gpsLat/gpsLon back to {lat, lon} object for frontend compatibility
  const photosTransformed = photos.results.map((p: any) => ({
    ...p,
    gps: p.gpsLat != null ? { lat: p.gpsLat, lon: p.gpsLon } : undefined,
  }))

  return Response.json({
    outings: outings.results,
    photos: photosTransformed,
    observations: observations.results,
    dex: dex.results,
  })
}
```

**Server-side delete outing with dex recomputation** (`functions/api/data/outings/[id].ts`):

```typescript
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const userId = context.data.user.id
  const outingId = context.params.id as string
  const db = context.env.DB

  // CASCADE handles photos + observations automatically
  const result = await db
    .prepare('DELETE FROM outing WHERE id = ? AND userId = ?')
    .bind(outingId, userId)
    .run()
  if (result.meta.changes === 0) return new Response('Not found', { status: 404 })

  // Recompute full dex and return it
  const dex = await db.prepare(`
    SELECT obs.speciesName, MIN(o.startTime) AS firstSeenDate, MAX(o.startTime) AS lastSeenDate,
           dm.addedDate, COUNT(DISTINCT obs.outingId) AS totalOutings, SUM(obs.count) AS totalCount,
           dm.bestPhotoId, COALESCE(dm.notes, '') AS notes
    FROM observation obs
    JOIN outing o ON obs.outingId = o.id
    LEFT JOIN dex_meta dm ON dm.userId = obs.userId AND dm.speciesName = obs.speciesName
    WHERE obs.userId = ?1 AND obs.certainty = 'confirmed'
    GROUP BY obs.speciesName ORDER BY obs.speciesName
  `).bind(userId).all()

  return Response.json({ dexUpdates: dex.results })
}
```

**Authorization**: Every data endpoint validates `userId` matches the authenticated session. The middleware injects `context.data.user`; endpoints always use `WHERE userId = ?` bound to the session user. No cross-user data access is possible.

---

### eBird Import: Server-Side Two-Step Flow

> **Phase 2 status**: ✅ Implemented. Preview/confirm import and CSV export flows now run through server endpoints used by Settings/Outings UI.

Instead of parsing CSV and detecting conflicts client-side (which would require reimplementing ~400 lines of CSV/timezone/grouping logic for iOS), the server handles the full pipeline:

**Step 1 — Preview** (`POST /api/import/ebird-csv`):
```
Content-Type: multipart/form-data
Fields:
  file: <CSV file>
  profileTimezone?: string    (eBird profile timezone for offset correction)

Response 200:
{
  previews: ImportPreview[],   // each with conflictStatus: 'new' | 'duplicate' | 'update_dates'
  summary: { total: number, new: number, duplicates: number, updates: number }
}
```

Server parses the CSV (porting the existing `parseEBirdCSV()` logic), groups rows into outings via `groupPreviewsIntoOutings()`, and runs conflict detection against D1 (`SELECT speciesName, firstSeenDate, lastSeenDate FROM ...`). The client displays the preview and lets the user select which imports to confirm.

**Step 2 — Confirm** (`POST /api/import/ebird-csv/confirm`):
```
Body: { previewIds: string[] }

Response 200:
{
  imported: { outings: number, observations: number, newSpecies: number },
  dexUpdates: DexEntry[]
}
```

Server inserts the selected outings + observations via D1 batch transaction and returns the recomputed dex.

**eBird Export** — also server-side for consistency:
- `GET /api/export/outing/:id?format=ebird` → returns eBird Record Format CSV
- `GET /api/export/dex?format=csv` → returns dex CSV

**Frontend change**: `ebird.ts` client-side parsing functions are removed. The eBird import UI in SettingsPage changes from "parse locally → show preview → bulk POST" to "upload CSV → GET preview from server → confirm selection."

---

### Top-Half Design Conformance (Phase 2 Status)

| Design Section | Phase 2 Status | Note |
|---|---|---|
| TL;DR / Overall Migration Direction | ⚠️ | Core Spark→Cloudflare migration for data + AI paths is complete; auth provider parity remains pending. |
| Architecture | ✅ | `/api/data/*`, import/export, species, and AI routes (`/api/identify-bird`, `/api/suggest-location`) are implemented. |
| Current Spark Dependency Map | ✅ | Spark KV/runtime/plugin/LLM dependencies are removed from active app paths. |
| Multi-Platform API Design | ✅ | Data, taxonomy, and bird-ID/location AI server centralization implemented. |
| D1 Schema Design | ✅ | Relational schema and SQL dex aggregation are implemented and used in production code paths. |
| Auth: Better Auth + D1 | ⚠️ | Better Auth + D1 is wired; implementation currently uses passkey + anonymous flow instead of full planned social-provider parity. |
| Bird ID & AI: Smart Server Endpoint | ✅ | Implemented in Phase 3 with provider-aware server runtime and client API calls. |
| Species Search: Server-Side Taxonomy | ✅ | Implemented via authenticated `/api/species/search`; active typeahead now server-backed. |
| Data Layer: Refactoring `useWingDexData` | ⚠️ | API-first refactor complete with local fallback; minor deltas are documented in Phase 2 tracker row statuses. |
| eBird Import: Server-Side Two-Step Flow | ✅ | Implemented and integrated into Settings/Outings flows. |

---

### Phased Implementation

#### Phase 0 — Scaffolding (no behavior change) ✅

> **Status snapshot (2026-02-20)**: ✅ Implemented.
> **Confidence**: High.
> **Validation**: `npm run build` ✅, `npx wrangler pages functions build functions --outfile /tmp/functions-worker.mjs` ✅, local D1 migrations apply cleanly ✅.

| Step | What | Details | Status |
|---|---|---|---|
| 0.1 | Add `wrangler.toml` | D1 binding `DB`, AI binding `AI`, env vars | ✅ |
| 0.2 | Add `wrangler` devDependency | `npm install -D wrangler` | ✅ |
| 0.3 | Add npm scripts | `"dev:cf": "wrangler pages dev dist"`, `"deploy": "npm run build && wrangler pages deploy dist"`, `"db:migrate": "wrangler d1 migrations apply wingdex-db"` | ✅ |
| 0.4 | Create `functions/` directory | File-based routing structure (see Architecture above) | ✅ |
| 0.5 | Create `functions/env.d.ts` | Type definitions for `Env` (D1, AI bindings, env vars) | ✅ |
| 0.6 | Create `migrations/0001_initial.sql` | Full D1 schema (Better Auth tables + app tables + indexes) | ✅ |
| 0.7 | Create D1 database | `wrangler d1 create wingdex-db` → add binding ID to `wrangler.toml` | ✅ |
| 0.8 | Apply migrations | `wrangler d1 migrations apply wingdex-db` | ✅ |

**`wrangler.toml`**:
```toml
name = "wingdex"
compatibility_date = "2026-02-01"
pages_build_output_dir = "dist"

[[d1_databases]]
binding = "DB"
database_name = "wingdex-db"
database_id = "<from wrangler d1 create>"
migrations_dir = "migrations"

[ai]
binding = "AI"

[vars]
BETTER_AUTH_URL = "https://wingdex.example.com"
# Secrets (set via `wrangler secret put`):
# BETTER_AUTH_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET,
# APPLE_CLIENT_ID, APPLE_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
# OPENAI_API_KEY, CF_ACCOUNT_ID, AI_GATEWAY_ID
```

---

#### Phase 1 — Auth (Better Auth) 🟡

> **Status snapshot (2026-02-20)**: ⚠️ Core auth migration implemented (session middleware + Better Auth client/server + passkey/anonymous flow); social OAuth provider registration still pending (`1.12`).
> **Confidence**: Medium-High.
> **Validation**: Auth guard unit tests ✅, authenticated API smoke flow (`npm run smoke:api`) establishes session via `/api/auth/sign-in/anonymous` and returns non-null `/api/auth/get-session` ✅, Playwright API smoke (`npx playwright test e2e/api-smoke.spec.ts --project=chromium`) ✅, manual sign-out verification confirms in-app transition without hard reload ✅.

| Step | What | Details | Status |
|---|---|---|---|
| 1.1 | `npm install better-auth` | Add as dependency | ✅ |
| 1.2 | Generate Better Auth schema | `npx @better-auth/cli generate` → merge into `migrations/0001_initial.sql` | ⚠️ Schema written manually in SQL migration instead of CLI generation |
| 1.3 | Create `functions/lib/auth.ts` | Better Auth config (GitHub + Apple + Google + passkey plugin, D1 adapter) | ✅ |
| 1.4 | Create `functions/api/auth/[...path].ts` | Catch-all handler delegating to Better Auth | ⚠️ Used `[[path]].ts` (Cloudflare Pages naming convention) |
| 1.5 | Create `functions/_middleware.ts` | Session validation, inject `context.data.user` for `/api/*` routes | ✅ |
| 1.6 | Create `src/lib/auth-client.ts` | Better Auth client SDK config with passkey plugin | ✅ |
| 1.7 | Update `UserInfo` interface in [App.tsx](src/App.tsx) | `id: number` → `id: string`, drop `isOwner`, `login` → `name` | ✅ |
| 1.8 | Update [App.tsx](src/App.tsx) auth flow | Replace `window.spark.user()` with `authClient.useSession()` or `fetch('/api/auth/get-session')`. Keep `getStableDevUserId()` fallback for local dev (change return type to `string`). | ✅ |
| 1.9 | Update [dev-user.ts](src/lib/dev-user.ts) | Return `string` instead of `number`. Generate a UUID-like string instead of a 9-digit integer. | ✅ |
| 1.10 | Create login page component | Replace `AuthErrorShell` with sign-in buttons (GitHub, Apple, Google, passkey). Style to match the naturalistic theme. | ✅ |
| 1.11 | Update `SettingsPage` | `user.id: number` → `string`, `user.login` → `user.name`. Add "Register passkey" button using `authClient.passkey.addPasskey()`. Add "Sign out" using `authClient.signOut()` with local anonymous re-bootstrap in-app (no hard reload). | ✅ |
| 1.12 | Register OAuth apps | GitHub, Apple (if desired — requires paid dev account), Google | ⏳ |

**userId type cascade** — changing `id` from `number` to `string` touches:
- [src/App.tsx](src/App.tsx): `UserInfo.id`, `getFallbackUser()`, `useWingDexData(user.id)`, `AddPhotosFlow userId=`
- [src/hooks/use-wingdex-data.ts](src/hooks/use-wingdex-data.ts): `useWingDexData(userId: number)` → `string`
- [src/lib/storage-keys.ts](src/lib/storage-keys.ts): `getUserStorageKey(userId: number, ...)` → `string` (for localStorage fallback)
- [src/lib/dev-user.ts](src/lib/dev-user.ts): return type `number` → `string`
- [src/components/pages/SettingsPage.tsx](src/components/pages/SettingsPage.tsx): `SettingsPageProps.user.id: number` → `string`
- [src/components/flows/AddPhotosFlow.tsx](src/components/flows/AddPhotosFlow.tsx): `AddPhotosFlowProps.userId: number` → `string`
- [src/lib/ebird.ts](src/lib/ebird.ts): `groupPreviewsIntoOutings(previews, userId: string)` — already `string`, but callers pass `` `u${user.id}` `` which needs updating to just `user.id`

---

#### Phase 2 — Data Layer (D1) + Species Search ✅

> **Status snapshot (2026-02-20)**: ✅ Implemented with documented deviations in rows `2.16–2.19`.
> **Confidence**: High.
> **Validation**: `npm run lint` ✅ (no errors), `npm run typecheck` ✅, `npm run test:unit` ✅ (430 tests), `npm run smoke:api` ✅ (authenticated `/api/data/all` + `/api/data/outings` write/read loop), `npm run smoke:api:seeded` ✅ (realistic eBird CSV preview/confirm), `npx playwright test e2e/api-smoke.spec.ts --project=chromium` ✅, targeted Playwright UI flows for CSV import + full photo upload ✅, functions compile ✅.

| Step | What | Details | Status |
|---|---|---|---|
| 2.1 | Create `functions/api/data/all.ts` | `GET`: Load all user data (4 queries + dex computation), return `{photos, outings, observations, dex}` | ✅ |
| 2.2 | Create `functions/api/data/outings.ts` | `POST`: Insert one outing | ✅ |
| 2.3 | Create `functions/api/data/outings/[id].ts` | `PATCH`: Update outing fields. `DELETE`: Delete outing (CASCADE) + return `{ dexUpdates }` | ✅ |
| 2.4 | Create `functions/api/data/photos.ts` | `POST`: Bulk insert photos | ✅ |
| 2.5 | Create `functions/api/data/observations.ts` | `POST`: Bulk insert observations + return `{ observations, dexUpdates }`. `PATCH`: Update observation(s) + return `{ dexUpdates }` | ✅ |
| 2.6 | Create `functions/api/data/dex.ts` | `GET`: Computed dex (SQL aggregate). `PATCH`: Update dex_meta (notes, bestPhotoId, addedDate) | ✅ |
| 2.7 | Create `functions/api/import/ebird-csv.ts` | `POST`: Accept CSV upload → parse, group, detect conflicts → return `{ previews, summary }`. `POST /confirm`: Insert selected previews → return `{ imported, dexUpdates }` | ✅ |
| 2.8 | Create `functions/api/export/outing/[id].ts` | `GET`: Export outing as eBird CSV | ✅ |
| 2.9 | Create `functions/api/export/dex.ts` | `GET`: Export dex as CSV | ✅ |
| 2.10 | Create `functions/api/data/seed.ts` | `POST`: Insert seed data (outings, observations), compute dex | ✅ |
| 2.11 | Create `functions/api/data/clear.ts` | `DELETE`: Delete all user data (`DELETE FROM outing WHERE userId = ?` — CASCADE handles the rest, then `DELETE FROM dex_meta WHERE userId = ?`) | ✅ |
| 2.12 | Create `functions/api/species/search.ts` | `GET`: Load taxonomy.json into Worker module scope, implement `searchSpecies()` server-side. Accept `?q=&limit=` params. | ✅ |
| 2.13 | Create shared `functions/lib/dex-query.ts` | Extract the dex SQL aggregate query into a shared helper used by all endpoints that return `dexUpdates`. | ✅ |
| 2.14 | Move eBird parsing to `functions/lib/ebird.ts` | Port `parseEBirdCSV()`, `groupPreviewsIntoOutings()`, and export formatters from `src/lib/ebird.ts` to run in the Worker. | ✅ |
| 2.15 | Move taxonomy to `functions/lib/taxonomy.ts` | Port `searchSpecies()`, `findBestMatch()`, `getWikiTitle()`, `getEbirdCode()` to the Worker. The taxonomy.json file is loaded once at module scope. | ✅ |
| 2.16 | Refactor use-wingdex-data.ts | Replaced 4x `useKV` calls with API-first state hydration via `GET /api/data/all` and optimistic mutations that apply server `dexUpdates`. Includes explicit localStorage fallback for local unauthenticated mode. | ⚠️ (temporary `buildDexFromState` export kept for existing tests; remove in Phase 5) |
| 2.17 | Refactor ebird.ts (client) | Settings and Outings UI now use `/api/import/ebird-csv`, `/api/import/ebird-csv/confirm`, and `/api/export/*` endpoints. | ⚠️ (legacy helpers retained in `src/lib/ebird.ts` for `seed-data` generation and tests; cleanup in Phase 5) |
| 2.18 | Refactor species typeahead | Replaced local typeahead search with debounced `fetch('/api/species/search?q=...')` in species autocomplete. Removed runtime client imports of taxonomy search/match helpers from active app flows. | ⚠️ (`src/lib/taxonomy.ts` retained for legacy test coverage in Phase 5) |
| 2.19 | Rewrite use-kv.ts | Rewrote to simplified localStorage-only fallback behavior; removed Spark KV runtime paths and network sync logic. | ⚠️ (legacy `use-kv` tests still assume Spark/local runtime split and are slated for Phase 5 test updates) |
| 2.20 | Update storage-keys.ts | Simplified local storage key prefix to string user IDs directly (removed legacy numeric-id format assumptions). | ✅ |
| 2.21 | Server-side auth on every endpoint | Verified endpoint auth checks and user scoping; added explicit auth guard to species search endpoint for consistency with protected API contract. | ✅ |

**Audit update (2026-02-20)**
- Hardened write endpoints to reject cross-user outing references by validating `outingId` ownership in `photos`, `observations`, and `seed` mutations.
- Added explicit auth guard to `functions/api/species/search.ts` for uniform `/api/*` protection semantics.
- Removed `BETTER_AUTH_SECRET` from committed `wrangler.toml` vars so auth secrets remain secret-managed only.

**Audit update (2026-02-20, late)**
- Added local auth retry helper + local-origin cookie/session handling to eliminate 401 churn in local full-stack mode.
- Hardened CSV preview retry semantics to rebuild multipart payloads and avoid stale-body "Load failed" behavior.
- Removed hard reload shortcuts from import/sign-out paths; data now refreshes in-app after successful operations.

**D1 transaction support** — for bulk operations like eBird import (insert many outings + observations atomically):

```typescript
// functions/api/import/ebird-csv.ts (confirm handler)
async function confirmImport(context: EventContext<Env, any, any>, previewIds: string[]) {
  const userId = context.data.user.id
  const db = context.env.DB

  // Load the previews (stored in a temp table or passed from client)
  // Build insert statements
  const statements = []
  for (const outing of selectedOutings) {
    statements.push(
      db.prepare(
        'INSERT INTO outing (id, userId, startTime, endTime, locationName, lat, lon, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(outing.id, userId, outing.startTime, outing.endTime, outing.locationName, outing.lat, outing.lon, outing.notes, outing.createdAt)
    )
  }
  for (const obs of selectedObservations) {
    statements.push(
      db.prepare(
        'INSERT INTO observation (id, outingId, userId, speciesName, count, certainty, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(obs.id, obs.outingId, userId, obs.speciesName, obs.count, obs.certainty, obs.notes)
    )
  }

  await db.batch(statements)  // D1 batch = transaction

  // Recompute and return dex
  const dex = await computeDex(db, userId)
  return Response.json({ imported: { outings: selectedOutings.length, observations: selectedObservations.length }, dexUpdates: dex })
}
```

---

#### Phase 3 — Bird ID & AI

> **Status snapshot (2026-02-21)**: ✅ Phase 3 complete. Server-owned AI endpoints, provider-aware inference, simplified client, AI Gateway code path, and D1-backed per-user daily rate limiting are all implemented and tested. AI Gateway dashboard entity created but not actively routing traffic (direct OpenAI preferred for now). Default model is `gpt-4.1-mini` after benchmarking against `gpt-5-mini` and `gpt-5-nano`.
> **Confidence**: High.
> **Validation**: `npm run test:unit` ✅ (415 tests including ai-inference, ai-fixture-replay, ai-rate-limit), `npm run build` ✅, `npm run smoke:api` ✅, `npm run lint` ✅ (0 errors).

| Step | What | Details | Status |
|---|---|---|---|
| 3.1 | Create `functions/api/identify-bird.ts` | Accept multipart image + context. Resize image, construct prompt, call LLM, ground against taxonomy, compute crop box. Return structured `{ candidates, cropBox, multipleBirds }`. | ✅ |
| 3.2 | Create `functions/api/suggest-location.ts` | Accept coords + optional existing names. Call text LLM with location suggestion prompt. Return `{ name }`. | ✅ |
| 3.3 | Move prompt + inference logic to `functions/lib/bird-id.ts` | Port prompt template, `safeParseJSON`, retry logic, crop-box computation from `src/lib/ai-inference.ts`. The taxonomy grounding uses the shared `functions/lib/taxonomy.ts` from Phase 2. Prompt deduplicated into shared `functions/lib/bird-id-prompt.js` used by runtime, fixture capture, and benchmark scripts. | ✅ |
| 3.4 | Implement LLM backend selection | `env.LLM_PROVIDER` selects between AI Gateway → OpenAI (Option A), Workers AI (Option B), or hybrid (Option C). Internal to the server — clients never see the LLM API directly. | ✅ (OpenAI, Azure OpenAI, and GitHub Models provider selection + unsupported-parameter fallback handling implemented) |
| 3.5 | Simplify client `ai-inference.ts` | Remove prompt template, `loadImage()`, `sparkVisionLLM()`, `sparkTextLLM()`, `safeParseJSON`, `findBestMatch` call, crop-box math. Keep only lightweight client image compression + multipart upload (`POST /api/identify-bird`) and server text call (`POST /api/suggest-location`) with local auth retry wrapper. | ✅ |
| 3.6 | Create AI Gateway in Cloudflare dashboard | Configure caching, rate limits, logging. Optionally add fallback to Workers AI model. | ✅ Gateway created (`wingdex-prod`); code path in `bird-id.ts` routes through gateway when `CF_ACCOUNT_ID` + `AI_GATEWAY_ID` are set. Not actively used — direct OpenAI preferred for simplicity. |
| 3.7 | (Optional) Add per-user rate limiting | Use D1 counter table or in-memory tracking in the Worker to limit LLM calls per user per day | ✅ D1 `ai_daily_usage` table (migration 0003) + `enforceAiDailyLimit` helper. Defaults: 150/day identify, 300/day suggest. Returns 429 + `Retry-After`. Configurable via `AI_DAILY_LIMIT_IDENTIFY`/`AI_DAILY_LIMIT_SUGGEST` env vars. Unit + endpoint tests in `ai-rate-limit.test.ts`. |

---

#### Phase 4 — Build & Hosting

> **Status snapshot (2026-02-20)**: ⚠️ Major Spark build/runtime removals are landed, with broader hosting/deploy hardening continuing in later phases.
> **Confidence**: Medium.
> **Validation**: Repeated `npm run build` passes ✅ and local functions compile passes ✅.

| Step | What | Details | Status |
|---|---|---|---|
| 4.1 | Update vite.config.ts | Remove `import sparkPlugin` and `import createIconImportProxy` from `@github/spark`. Remove both from `plugins[]`. Add dev proxy: `server: { proxy: { '/api': 'http://localhost:8788' } }` (Wrangler dev server port). | |
| 4.2 | Update main.tsx | Remove the `isSparkHosted` check and `import('@github/spark/spark')` block. Mount directly: `createRoot(document.getElementById('app')!).render(...)`. | |
| 4.3 | Update index.html | Rename `<div id="spark-app">` → `<div id="app">`. | |
| 4.4 | Update portal-container.ts | Change `getElementById('spark-app')` → `getElementById('app')`. | |
| 4.5 | Update vite-env.d.ts | Remove `GITHUB_RUNTIME_PERMANENT_NAME` and `BASE_KV_SERVICE_URL` declarations. Keep `APP_VERSION`. | |
| 4.6 | Remove `@github/spark` | `npm uninstall @github/spark` | |
| 4.7 | Delete Spark config files | Remove spark.meta.json, runtime.config.json. | |
| 4.8 | Add `public/_redirects` | `/* index.html 200` for SPA fallback routing (or rely on Pages' auto-SPA behavior). | |
| 4.9 | Update package.json | Remove `@github/spark` from dependencies. Add `wrangler` to devDependencies, `better-auth` to dependencies. Update `description` and `keywords`. Add deploy/CF scripts. | |
| 4.10 | Phosphor icon plugin | Drop `createIconImportProxy()` — if a Phosphor icon import is invalid, the build fails with a clear error (better than silent fallback to `Question` icon). All current imports are valid. | |

---

#### Phase 5 — Testing

> **Status snapshot (2026-02-20)**: ⚠️ Phase-relevant migrated tests are updated/passing; remaining test migration items tied to future server-side AI/logic moves are pending.
> **Confidence**: Medium-High.
> **Validation**: `npm run test:unit` ✅ after aligning auth/data/storage/AI-client expectations with current implemented phases; targeted Playwright specs for CSV import and full upload flow ✅.

| Step | What | Details | Status |
|---|---|---|---|
| 5.1 | use-kv.spark.test.tsx | **Delete or rewrite** — the Spark KV test is no longer relevant. Replace with tests for the new D1-backed data hooks if desired, or test via integration tests. | |
| 5.2 | use-kv.local.test.tsx | **Update** — test the simplified localStorage fallback. Update key patterns (no more `u{numericId}_` prefix). | |
| 5.3 | app-auth-guard.hosted.test.tsx | **Rewrite** — mock `fetch('/api/auth/get-session')` instead of `window.spark.user()`. Test: no session → login page shown; valid session → app renders. | |
| 5.4 | app-auth-guard.local.test.tsx | **Update** — fallback user logic stays similar but `id` is now `string`. | |
| 5.5 | ai-inference.test.ts | **Rewrite** — mock `fetch('/api/identify-bird')` instead of `/_spark/llm`. Test that the client sends FormData with image + context and correctly handles structured response. Much simpler tests since prompt/parsing logic moved server-side. | |
| 5.6 | ai-parse-and-textllm.test.ts | **Move to server tests** — prompt parsing and `findBestMatch` logic now lives in `functions/lib/bird-id.ts`. Test it there (Vitest or Wrangler's test runner). | |
| 5.7 | ai-fixture-replay.test.ts | **Move to server tests** — LLM fixture replay should test the `identify-bird` endpoint, not client-side parsing. | |
| 5.8 | dev-user-id.test.ts | Update expected return type from `number` to `string`. | |
| 5.9 | storage-keys.test.ts | Update for new key format (string userId). | |
| 5.10 | build-dex.test.ts | **Delete or move** — `buildDexFromState` is replaced by server-side SQL. Test dex computation via integration tests against D1. | |
| 5.11 | ebird-csv.test.ts | **Move to server tests** — CSV parsing logic is now in `functions/lib/ebird.ts`. | |
| 5.12 | helpers.ts | Update localStorage key prefix (remove `wingdex_kv_u1_` pattern, use new format). Update `wingdex_dev_user_id` value from `"1"` to a string UUID. | |
| 5.13 | csv-and-upload-integration.spec.ts | Change route intercept from `**/_spark/llm` → `**/api/identify-bird`. | |
| 5.14 | Other e2e tests | Should work with minimal changes (they use local dev mode + localStorage). | |
| 5.15 | **New**: Server-side function tests | Add Vitest tests for `functions/lib/bird-id.ts` (prompt construction, response parsing, taxonomy grounding), `functions/lib/ebird.ts` (CSV parsing, grouping), `functions/lib/taxonomy.ts` (search, matching). These are the business-logic tests that moved from client to server. | |

---

#### Phase 6 — CI/CD & Deploy

> **Status snapshot (2026-02-20)**: ⏳ Not started.
> **Confidence**: Low.
> **Validation**: N/A yet.

| Step | What | Details | Status |
|---|---|---|---|
| 6.1 | Create `.github/workflows/deploy.yml` | On push to `main`: `npm ci` → `npm run build` → `wrangler pages deploy dist`. On PR: deploy preview. | |
| 6.2 | Add GitHub repo secrets | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | |
| 6.3 | Add Cloudflare secrets | `wrangler secret put BETTER_AUTH_SECRET`, `wrangler secret put GITHUB_CLIENT_SECRET`, etc. | |
| 6.4 | Custom domain | In Cloudflare Pages dashboard: add custom domain → configure DNS. | |
| 6.5 | Preview deployments | Pages auto-creates `<branch>.wingdex.pages.dev` preview URLs per PR. | |

**Deploy workflow**:
```yaml
name: Deploy
on:
  push:
    branches: [main]
  pull_request:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run build
      - run: npx wrangler d1 migrations apply wingdex-db --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dist --project-name=wingdex
```

---

#### Phase 7 — Cleanup

> **Status snapshot (2026-02-20)**: ⚠️ Partially complete (targeted cleanup and tracker/design notes done); full repo-wide cleanup sweep remains pending.
> **Confidence**: Low-Medium.
> **Validation**: Documentation/tracker updates verified and build still green ✅.

| Step | What | Details | Status |
|---|---|---|---|
| 7.1 | Grep for `spark` | Remove all references from comments, README, CONTRIBUTING, PRD, etc. | |
| 7.2 | Update PRD.md | Replace "GitHub Spark" references with "Cloudflare Pages + D1". Update auth description. | |
| 7.3 | Update README.md | New setup instructions: Wrangler, D1 migrations, local dev workflow. | |
| 7.4 | Update PWA manifests | manifest.json, site.webmanifest — update start_url, scope if domain changes. | |
| 7.5 | Remove spark-tools | This directory contains compiled Spark tooling (the icon proxy plugin). No longer needed. | |
| 7.6 | Update package.json metadata | Remove "github-spark" from keywords. Update description. | |

---

### Complete File Impact

| File | Action | Change |
|---|---|---|
| `wrangler.toml` | **Create** | Cloudflare project config (D1, AI bindings, env vars) |
| `migrations/0001_initial.sql` | **Create** | Full D1 schema (auth + app tables + indexes) |
| `functions/env.d.ts` | **Create** | `Env` type (DB, AI, env vars) |
| `functions/_middleware.ts` | **Create** | Session validation, inject user into context |
| `functions/lib/auth.ts` | **Create** | Better Auth config (GitHub/Apple/Google/passkeys, D1 adapter) |
| `functions/lib/bird-id.ts` | **Create** | Prompt template, LLM call, response parsing, taxonomy grounding, crop-box math (moved from client) |
| `functions/lib/taxonomy.ts` | **Create** | `searchSpecies()`, `findBestMatch()`, `getWikiTitle()`, `getEbirdCode()` (moved from client) |
| `functions/lib/ebird.ts` | **Create** | `parseEBirdCSV()`, `groupPreviewsIntoOutings()`, export formatters (moved from client) |
| `functions/lib/dex-query.ts` | **Create** | Shared dex SQL aggregate helper used by multiple endpoints |
| `functions/api/auth/[...path].ts` | **Create** | Better Auth catch-all handler |
| `functions/api/data/all.ts` | **Create** | GET: load all user data from D1 |
| `functions/api/data/outings.ts` | **Create** | POST: create outing |
| `functions/api/data/outings/[id].ts` | **Create** | PATCH/DELETE: update/delete outing + return dexUpdates |
| `functions/api/data/photos.ts` | **Create** | POST: bulk insert photos |
| `functions/api/data/observations.ts` | **Create** | POST/PATCH: create/update observations + return dexUpdates |
| `functions/api/data/dex.ts` | **Create** | GET: computed dex. PATCH: update dex_meta |
| `functions/api/data/seed.ts` | **Create** | POST: insert demo data |
| `functions/api/data/clear.ts` | **Create** | DELETE: wipe all user data |
| `functions/api/identify-bird.ts` | **Create** | POST: image + context → species candidates (smart bird ID endpoint) |
| `functions/api/suggest-location.ts` | **Create** | POST: coords → location name suggestion |
| `functions/api/import/ebird-csv.ts` | **Create** | POST: upload CSV → previews with conflicts; POST /confirm → insert + dexUpdates |
| `functions/api/export/outing/[id].ts` | **Create** | GET: export outing as eBird CSV |
| `functions/api/export/dex.ts` | **Create** | GET: export dex as CSV |
| `functions/api/species/search.ts` | **Create** | GET: taxonomy typeahead search |
| `src/lib/auth-client.ts` | **Create** | Better Auth client SDK config |
| `src/components/LoginPage.tsx` | **Create** | Sign-in UI (GitHub, Apple, Google, passkey buttons) |
| `.github/workflows/deploy.yml` | **Create** | Cloudflare Pages deploy CI |
| `public/_redirects` | **Create** | SPA fallback routing |
| vite.config.ts | **Modify** | Remove Spark plugins, add dev proxy to Wrangler |
| main.tsx | **Modify** | Remove Spark runtime import, change mount point to `#app` |
| App.tsx | **Modify** | Replace `window.spark.user()` with Better Auth. Change `UserInfo.id` to `string`. Replace `AuthErrorShell` with login redirect. |
| use-wingdex-data.ts | **Modify** | Replace 4x `useKV` with API-backed fetch + granular mutations. Apply `dexUpdates` from responses. Remove `buildDexFromState()`. `userId: number` → `string`. |
| use-kv.ts | **Modify** | Strip all Spark KV code. Keep simplified localStorage-only version for local dev, or delete entirely and inline. |
| storage-keys.ts | **Modify** | `userId: number` → `string`. Simplify key pattern. |
| ai-inference.ts | **Simplify** | Remove prompt template, canvas APIs, LLM wrappers, taxonomy grounding, crop math (~230→~30 lines). Replace with `POST /api/identify-bird` FormData call + `POST /api/suggest-location`. |
| taxonomy.ts (client) | **Simplify** | Remove `searchSpecies()`, `findBestMatch()`, taxonomy.json import. Keep only display helpers needed by UI, or delete entirely if all lookups go through the API. |
| ebird.ts (client) | **Simplify** | Remove `parseEBirdCSV()`, `groupPreviewsIntoOutings()`, `detectImportConflicts()`, export functions. Replace with API calls to `/api/import/ebird-csv` and `/api/export/*`. |
| dev-user.ts | **Modify** | Return `string` instead of `number`. Generate UUID-like string. |
| index.html | **Modify** | `id="spark-app"` → `id="app"` |
| portal-container.ts | **Modify** | `'spark-app'` → `'app'` |
| src/vite-env.d.ts | **Modify** | Remove `GITHUB_RUNTIME_PERMANENT_NAME`, `BASE_KV_SERVICE_URL` |
| package.json | **Modify** | Remove `@github/spark`, add `wrangler`, `better-auth`. Update scripts/metadata. |
| SettingsPage.tsx | **Modify** | `user.id: number` → `string`. Add sign-out + register-passkey. eBird import UI switches to server-driven preview/confirm flow. |
| AddPhotosFlow.tsx | **Modify** | `userId: number` → `string`. Species typeahead uses `/api/species/search`. |
| 6 test files | **Modify/Move** | AI tests move to server-side. Client tests simplified. Auth/userId mocks updated. |
| 2 e2e files | **Modify** | Update route intercepts and localStorage seeding |
| spark.meta.json | **Delete** | Spark config |
| runtime.config.json | **Delete** | Spark config |
| spark-tools | **Delete** | Spark tooling (icon proxy plugin) |

---

### Cost Estimate (< 50 users, fresh start)

| Service | Free Tier | Paid ($5/mo Workers plan) |
|---|---|---|
| **Cloudflare Pages** | 500 deploys/mo, unlimited bandwidth | $0 |
| **Pages Functions** | 100K requests/day | Included in Workers paid |
| **D1** | 5M rows read + 100K written/day, 5 GB storage | $0.75/mo beyond free |
| **AI Gateway** | Free (proxy, caching, logging) | $0 |
| **Workers AI** (if used) | 10,000 neurons/day | $0.011/1K neurons |
| **OpenAI GPT-4.1-mini** (if used) | N/A | ~$0.01-0.05 per bird ID session |
| **Custom domain** | Free via Cloudflare DNS | $0 |
| **Apple Developer** (if Apple Sign In) | N/A | $99/yr |
| **Total** | **$0 for small usage** | **~$5-10/mo + OpenAI if used** |

---

### Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **LLM quality regression** if using Workers AI | Bird ID accuracy drops | Use AI Gateway → OpenAI as primary. Offer Workers AI as optional "free mode" |
| **D1 row limits for power users** | Users with thousands of observations | 5M reads/day free is plenty. Monitor with Cloudflare analytics. Consider pagination for very large datasets. |
| **Better Auth breaking changes** | Auth breaks on lib updates | Pin version. Better Auth is actively maintained with good semver. |
| **Apple Sign In complexity** | Requires paid Apple dev account + non-trivial OIDC setup | Start with GitHub + Google only. Add Apple later if there's demand (but needed for iOS App Store). |
| **Photo blob storage** | D1 TEXT columns holding base64 can get large | Photos are session-ephemeral per PRD. Wikimedia provides persistent imagery. If persistent photos needed later, add R2. |
| **Local dev experience** | Wrangler + Vite coordination | Use Vite dev proxy (`/api/* → localhost:8788`). `npm run dev` starts Vite; `wrangler pages dev` starts Workers. Can combine with `concurrently` package. |
| **Session invalidation on deploy** | D1 sessions persist across deploys (good). No invalidation concern. | N/A |
| **Species search latency** | Server-side typeahead adds ~30-50ms per keystroke vs. instant client-side | Debounce at 150ms. Taxonomy is in Worker memory (no D1 hop). Cloudflare edge ≈ <50ms. Acceptable UX. If needed, optionally cache taxonomy client-side for offline/instant fallback. |
| **Multipart upload in Workers** | Workers runtime has request body size limits (100MB free, adjustable on paid) | Bird photos compressed to ≤800px JPEG are typically <200KB. Well within limits. |

---

### Local Dev & Testing Playbook

This section defines how to run the app locally during migration, how auth/data should behave in each mode, and the exact validation path before marking checklist items complete.

#### Runtime Modes

| Mode | Command(s) | Auth Source | Data Source | When to use |
|---|---|---|---|---|
| **Client-only fallback** | `npm run dev` | local dev user fallback (`getStableDevUserId()`) | localStorage (temporary migration fallback) | Fast UI iteration when API is not required |
| **Hybrid local (recommended default)** | `npm run dev:cf` (or run Vite + Wrangler with proxy) | Better Auth session cookie | D1 via `/api/*` | Day-to-day migration work, endpoint + UI integration |
| **Functions smoke** | `npx wrangler pages dev dist --port 8791` | Better Auth session cookie | D1 via Pages Functions only | Endpoint behavior checks independent of Vite |

#### Local Auth Plan

| Scenario | Expected behavior | Verification |
|---|---|---|
| Not signed in | protected `/api/data/*`, `/api/import/*`, `/api/export/*`, `/api/species/*` return `401` | `curl`/browser fetch to endpoint returns status `401` |
| Signed in | `/api/auth/get-session` returns user + session; app renders main routes | Browser network panel shows `200` for session endpoint |
| Sign-out flow | session cleared; protected API calls return `401` again | sign out then re-check `/api/auth/get-session` |
| Local fallback mode | app still usable without Better Auth login while migration is incomplete | run `npm run dev` and confirm local user + state hydration |

#### Local Data Plan

| Capability | Server contract | Validation |
|---|---|---|
| Initial hydration | `GET /api/data/all` returns `outings`, `photos`, `observations`, `dex` | reload app and confirm state persists from D1 |
| Outing mutations | `POST /api/data/outings`, `PATCH/DELETE /api/data/outings/:id` | create/edit/delete outing and confirm UI + D1 consistency |
| Observation mutations | `POST/PATCH /api/data/observations` returns `dexUpdates` | confirm/reject species and verify dex rows update immediately |
| Photo ingestion | `POST /api/data/photos` bulk insert | add photos in flow and confirm subsequent observation linkage |
| Seed/clear workflows | `POST /api/data/seed`, `DELETE /api/data/clear` | settings actions update state and survive reloads |

#### Test Execution Plan

| Level | Commands | Scope | Gate |
|---|---|---|---|
| **Build/type gate** | `npm run build` | TypeScript + client production build | Must pass before commit |
| **Functions compile gate** | `npx wrangler pages functions build functions --outfile /tmp/functions-worker.mjs` | Worker/function bundling | Must pass for API changes |
| **Auth smoke gate** | local `wrangler pages dev` + `curl` checks | session + protected route behavior | `401` unauthenticated; `200` session when signed in |
| **Targeted unit tests** | `npm test -- src/__tests__/...` | changed modules only first | must pass for touched areas |
| **Regression/unit suite** | `npm test` | full unit baseline | run at milestone boundaries |
| **E2E gate** | `npx playwright test` | user flows on local stack | run before Phase completion |

#### Recommended Daily Loop

1. Start in **Hybrid local** mode (`npm run dev:cf`).
2. Implement one checklist slice (single endpoint/hook/component unit).
3. Run build + functions compile gates.
4. Run targeted tests for touched areas.
5. Run a smoke check of changed API/UI behavior.
6. Update this tracker row status + deviation note (if any), then commit.

#### Deviation Logging Rules

- If local fallback behavior is temporarily retained (e.g., localStorage path while API hook is mid-refactor), record it in the checklist row notes.
- If a gate is skipped (for speed or known unrelated failures), explicitly note which gate and why.
- If endpoint contracts change, update this playbook table in the same commit as code changes.

---

### Verification Checklist

- [ ] `npm run build` succeeds without `@github/spark`
- [ ] `npm test` — all unit tests pass with updated mocks
- [ ] Server-side tests pass — bird ID prompt/parsing, taxonomy search, eBird CSV parsing
- [ ] Local dev: Vite serves SPA, localStorage fallback works, bird photos can be uploaded and identified via `/api/identify-bird` (proxied to Wrangler)
- [ ] `wrangler pages dev dist` — Pages Functions respond correctly
- [ ] Auth flow: GitHub sign-in → session cookie set → `/api/auth/get-session` returns user → app renders with user info
- [ ] Data persistence: Create outing → reload page → outing still exists (D1)
- [ ] Bird ID: Upload bird photo → `POST /api/identify-bird` → structured species candidates returned → client displays results
- [ ] Species search: Type in species field → `/api/species/search?q=robin` → autocomplete results shown
- [ ] Cascading delete: Delete outing → photos + observations deleted in D1 → `dexUpdates` in response reflects change
- [ ] Dex computation: Confirm species → mutation response includes correct `dexUpdates`
- [ ] eBird import: Upload CSV → server returns previews with conflict status → confirm → outings + observations created → `dexUpdates` returned
- [ ] eBird export: `GET /api/export/outing/:id` → valid eBird CSV downloaded
- [ ] E2E: `npx playwright test` passes against local dev server
- [ ] Deploy: Push to `main` → GitHub Actions deploys to Cloudflare Pages → app live at custom domain
- [ ] Passkey: Register passkey in settings → sign out → sign in with passkey
- [ ] No `spark` string remains in codebase (except git history)
- [ ] Client bundle size: `taxonomy.json` no longer in client bundle (~300KB reduction)
- [ ] Audit: `grep -r "findBestMatch\|buildDexFromState\|parseEBirdCSV" src/` returns zero matches (all moved server-side)
