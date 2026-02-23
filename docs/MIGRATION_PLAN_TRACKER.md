# WingDex Migration Plan & Tracker

> Source: [Issue #74 comment](https://github.com/jlian/wingdex/issues/74#issuecomment-3906820357) · Last updated: 2026-02-23
>
> **Legend**: ✅ Done · ⚠️ Done with deviation · ⏳ Pending · _(empty)_ Not started
>
> **Extra work outside plan steps**: storage-key format fix for UUID-based user IDs (`storage-keys.ts`, `use-kv.ts`); D1 adapter wiring via Kysely + kysely-d1 (Better Auth doesn't accept raw D1 bindings); full-stack local dev orchestration scripts (`dev:full`, `dev:full:restart`, macOS-safe `kill`); local auth/session hardening for HTTP localhost + in-app UX smoothing (no hard-reload import/sign-out); login UX rework - unified "Continue with passkey" button + dialog-based signup with random bird names (`PasskeyAuthDialog.tsx`, `fun-names.ts`); App.tsx auth transition jank fix (eliminated cascading `useSession` → `user` → `showApp` state waterfall); CI/CD overhaul - split monolithic `verify:ci` into discrete lint/typecheck/unit/build/migrate/e2e steps, merged `deploy.yml` into `ci.yml`; `dev` branch strategy with separate D1 databases for prod vs preview; GitHub OAuth app registration (prod + dev environments); `computeFileHash` fix for small files (<128KB); skeleton loading state removal for cleaner transitions; Apple Sign In provider registration + dynamic social buttons via `/api/auth/providers`; account linking policy change (removed manual Link button, kept auto-merge for trusted social providers); CI deploy deduplication for `dev`/`main` branches; **passkey-ux branch**: demo-first auth gate modal UX rework - replaced `LoginPage.tsx`/`PasskeyAuthDialog.tsx` with `use-auth-gate.tsx` hook + inline modal in `App.tsx`; emoji avatar helpers + bird-to-emoji mapping (consolidated into `fun-names.ts`); A-Z sort option for outings; in-app Privacy Policy and Terms of Use pages (`PrivacyPage.tsx`, `TermsPage.tsx`, `public/privacy.html`, `public/terms.html`); demo data loader for anonymous users (69 species from bundled `src/assets/ebird-import.csv`); email removal from passkey auth flow (finalize-passkey name-only); Origin header validation in `auth.ts` baseURL; demo CSV decoupled from e2e fixtures → `src/assets/`; `promoteAnonymousUser` e2e helper; `disable-git-signing-local` VS Code task removal; account deletion enabled in Better Auth config; Settings account card with emoji avatars, nickname editing, passkey rename/delete; **post-passkey-ux polish**: passkey label standardization (device-display format with custom name preservation); social avatar rendering fix (no emoji scaling on social provider images); auth flow first-load transition polish; footer layout finalization; local dev bootstrap simplification (`ensure-app-on-5000` replaces `dev:full`); OAuth redirect error toasts; request-URL origin for auth `baseURL` (replaced Origin header approach); `wikimedia.ts` Wikimedia Commons/wiki-title client caching wrapper; `utils.ts` display/scientific name parsing helpers; `http-error.ts` consistent server error responses; `linked-providers.ts` endpoint for active social accounts; `ebird-code.ts` species eBird code lookup; import confirm split into separate `ebird-csv/confirm.ts` route file; privacy policy & terms of use content improvement (in-app React components with full legal text).

---

## Comprehensive Migration Plan: WingDex from GitHub Spark to Cloudflare (D1-first)

### TL;DR

> **Status**: ✅ All phases (0–7) complete. Data/API migration done - server is sole owner of all business logic. Auth: Better Auth with passkey-first signup, GitHub OAuth, Apple Sign In all live. Google OAuth ⏳.

WingDex has **5 Spark integration points**: auth (`window.spark.user()`), KV persistence (`/_spark/kv`), LLM proxy (`/_spark/llm`), Spark runtime bootstrap (`@github/spark/spark`), and Spark Vite plugins. All live in a small number of files and use standard patterns - this is a platform-integration migration, not a rewrite.

**Target stack**: Cloudflare Pages (SPA hosting) + Pages Functions (API routes) + D1/SQLite (all data - auth + app) + Better Auth (GitHub/Apple/Google + passkeys) + AI Gateway (LLM). Fresh start, no data migration.

**Design principle**: The API layer is the product's brain - bird ID, taxonomy search, dex computation, eBird import logic all live server-side. Clients (web SPA now, native iOS later) are thin UI shells that upload images, display results, and render data. This means adding a native iOS app later requires zero business-logic duplication - just new SwiftUI views calling the same endpoints.

---

### Architecture

> **Status**: ✅ All data/import/export/species/AI API routes implemented. Auth routes include `finalize-passkey`, `linked-providers`, `providers`. `/api/suggest-location` removed as dead (location search uses Nominatim). Import confirm split into separate `ebird-csv/confirm.ts` route. Species `ebird-code.ts` endpoint added.

```
Cloudflare Pages
├── dist/                          ← Vite SPA build output
└── functions/                     ← Pages Functions (Workers runtime)
    ├── _middleware.ts             ← session validation
    └── api/
        ├── auth/
        │   ├── [[path]].ts       ← Better Auth (GitHub, Apple, passkeys)
        │   ├── finalize-passkey.ts ← POST: name-only passkey finalization
        │   ├── linked-providers.ts ← GET: user's linked social accounts
        │   └── providers.ts      ← GET: configured social providers (5-min cache)
        ├── data/
        │   ├── all.ts            ← GET: load all user data
        │   ├── outings.ts        ← POST: create outing
        │   ├── outings/[id].ts   ← PATCH/DELETE: update/delete outing
        │   ├── photos.ts         ← POST: bulk insert photos
        │   ├── observations.ts   ← POST/PATCH: create/update observations
        │   ├── dex.ts            ← GET: computed dex; PATCH: update notes/bestPhoto
        │   └── clear.ts         ← DELETE: wipe all user data
        ├── identify-bird.ts      ← POST: image + context → species candidates (smart endpoint)
        ├── import/
        │   ├── ebird-csv.ts      ← POST: upload CSV → previews
        │   └── ebird-csv/confirm.ts ← POST: confirm import → insert + dexUpdates
        ├── export/
        │   ├── outing/[id].ts    ← GET: export outing as eBird CSV
        │   └── dex.ts            ← GET: export dex as CSV
        └── species/
            ├── ebird-code.ts     ← GET: eBird species code lookup
            ├── search.ts         ← GET: taxonomy typeahead search
            └── wiki-title.ts     ← GET: wiki title lookup (public, no auth)

Bindings:
  DB  → D1 database (users, sessions, outings, photos, observations, dex_meta)
  AI  → Workers AI (optional, for native inference)
```

---

### Current Spark Dependency Map

> **Status**: ✅ All Spark dependencies (KV, runtime, plugins, LLM proxy) fully removed from active code paths.

| Concern | Current Code | Spark API | Files Affected |
|---|---|---|---|
| **Auth** | `window.spark.user()` → `UserInfo{login, avatarUrl, email, id, isOwner}` | Spark runtime global | App.tsx, dev-user.ts |
| **KV** | `fetch('/_spark/kv/{key}')` GET/POST/DELETE, keys like `u12345_photos` | Spark KV proxy | use-kv.ts, storage-keys.ts, use-wingdex-data.ts |
| **LLM** | `POST /api/identify-bird` | Cloudflare Functions API | ai-inference.ts, functions/api/* |
| **Runtime** | `await import('@github/spark/spark')` (conditional on `*.github.app` hostname) | Spark bootstrap | main.tsx |
| **Vite plugins** | `sparkPlugin()`, `createIconImportProxy()` | Build tooling | vite.config.ts |
| **Config** | runtime.config.json, spark.meta.json | Deployment metadata | Root files |
| **DOM** | `<div id="spark-app">`, `getDefaultPortalContainer()` | Mount point | index.html, portal-container.ts |
| **Type decls** | `GITHUB_RUNTIME_PERMANENT_NAME`, `BASE_KV_SERVICE_URL` | Build-time globals | src/vite-env.d.ts |
| **Package** | `@github/spark: 0.44.19` | npm dependency | package.json |

---

### Multi-Platform API Design

> **Status**: ✅ Data, import/export, taxonomy, and bird-ID/location AI flows are API-first. All server endpoints implemented and tested.

The migration is an opportunity to move business logic server-side so that any future client (iOS, Android, CLI) gets the same behavior for free. The current web app has ~1,730 lines of client-side business logic across 8 files. After migration:

| Logic | Current location | Post-migration location | Why |
|---|---|---|---|
| **Bird ID pipeline** (prompt, LLM call, taxonomy grounding, crop-box) | Client (ai-inference.ts, ~230 lines) | **Server** (`/api/identify-bird`) | Prompt changes = server deploy, not app updates. No API key on client. Zero duplication for iOS. |
| **Taxonomy search** (11K species, fuzzy matching) | Client (taxonomy.ts, ~175 lines + 300KB JSON) | **Server** (`/api/species/search`) | One implementation. No need to bundle 300KB JSON in every client. |
| **eBird CSV parsing & conflict detection** | Client (ebird.ts, ~466 lines) | **Server** (`/api/import/ebird-csv`) | Data processing with no UI dependency. Server has D1 access for conflict detection. |
| **Dex aggregation** (`buildDexFromState`) | Client (use-wingdex-data.ts, ~150 lines) | **Server** (SQL aggregate) | Already planned - SQL replaces the JS aggregation. |
| **Location name suggestion** (text LLM call) | Client (ai-inference.ts `textLLM`) | ~~**Server** (`/api/suggest-location`)~~ **Removed** - location search uses Nominatim directly | Originally planned as server LLM endpoint; removed as dead code since Nominatim handles location lookup. |
| **Photo EXIF extraction, thumbnails, clustering** | Client | **Client** (stays) | Must run on-device where the photos live. Each platform uses native APIs (Canvas/ImageIO). |
| **Crop UI math** | Client (crop-math.ts, ~105 lines) | **Client** (stays) | Inherently UI interaction logic. Trivial to port (~50 lines of Swift). |

After this migration, **adding an iOS app means**: build SwiftUI views that call the same REST endpoints. No prompt duplication, no taxonomy bundle, no eBird parser rewrite. The only client-side logic to port is EXIF extraction (simpler in Swift via `ImageIO`), photo clustering (~50 lines), and crop math (~50 lines).

---

### D1 Schema Design

> **Status**: ✅ Implemented and active. Core app tables (4 migrations), indexes, and SQL-based dex aggregation are in place and used by `/api/data/*` routes.

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
- Dex is a materialized view computable via SQL aggregate - no need to maintain a separate denormalized blob
- Per-record CRUD (update one observation, delete one outing) instead of read-modify-write entire arrays
- Strong consistency (no 60-second propagation delay like KV)
- D1 pricing is generous (5M rows read + 100K written/day free)

**Design notes**:
- `Photo.dataUrl`/`Photo.thumbnail` - per the PRD, user photos are "ephemeral, used only during the identification session." These fields store base64 blobs during the session but may be empty strings when loaded later. Bird imagery in the UI comes from Wikimedia Commons, not stored photos. If persistent photo storage is needed later, use Cloudflare R2 (S3-compatible blob storage) and store a URL reference in D1.
- `Photo.gps` - flattened from `{lat, lon}` object to two columns `gpsLat`/`gpsLon` for SQL friendliness.
- `Outing.userId` - currently a string already in the type definition, set to `'seed'` for demo data or the user's ID. Will use Better Auth's string user ID directly.
- Client-generated IDs - the app already generates UUIDs for outings/photos/observations client-side. D1 accepts these as primary keys.

---

### Auth: Better Auth + D1

> **Status**: ⚠️ Better Auth + D1 fully wired. Demo-first auth gate UX with anonymous bootstrap → passkey signup (name-only, no email). GitHub OAuth + Apple Sign In live (prod + dev). Account linking via `trustedProviders` auto-merge. Post-passkey-ux polish: passkey label standardization, social avatar rendering, auth flow transition smoothing, linked-providers endpoint, baseURL from request URL origin. Google OAuth remains pending (Phase 1.12).

**Why Better Auth**: Native Cloudflare Workers adapter with D1 support. Provides GitHub, Apple, Google, generic OIDC out of the box. WebAuthn/passkey plugin. ~50 lines of config vs ~300+ rolling your own with multi-provider + passkey support. Also works seamlessly with native iOS auth (`ASWebAuthenticationSession`) since it's standard OAuth - no web-specific coupling.

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

**UserInfo mapping** - current `UserInfo` shape vs Better Auth:

| Current (`window.spark.user()`) | Better Auth (`session.user`) | Notes |
|---|---|---|
| `id: number` | `id: string` (UUID) | **Type change** - all userId references update from `number` → `string` |
| `login: string` | `name: string` | Display name (GitHub username, Apple name, etc.) |
| `avatarUrl: string` | `image: string \| null` | May be null for passkey-only users |
| `email: string` | `email: string` | Always present |
| `isOwner: boolean` | N/A | Drop - was Spark-specific |

**Login UI** - implemented as a unified passkey-first flow:
- Single "Continue with passkey" button on a clean card (`LoginPage.tsx`)
- Opens `PasskeyAuthDialog.tsx` - defaults to signup view with pre-filled random bird-name (`fun-names.ts`, ~249K kebab-case combos like `sneaky-meadow-warbler`), re-roll button, and "Create account" CTA
- "Already have an account? Sign in" link switches to sign-in view (triggers browser WebAuthn prompt directly)
- Signup uses anonymous bootstrap → `addPasskey` → `finalize-passkey` (3-step, gated by middleware header)
- GitHub OAuth "Sign in with GitHub" button on login page + "Link GitHub account" in Settings (conditionally shown when `GITHUB_CLIENT_ID` env var is set)
- Apple/Google OAuth buttons dynamically rendered based on configured providers via `GET /api/auth/providers`

**OAuth app registration**:
- **GitHub**: ✅ Two OAuth Apps created - prod (`https://wingdex.app/api/auth/callback/github`) and dev (`https://dev.wingdex.pages.dev/api/auth/callback/github`). Secrets (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`) set in Cloudflare Pages for both production and preview environments.
- **Apple**: ✅ Services ID `app.wingdex.signin` - domains `wingdex.app` + `dev.wingdex.pages.dev`, return URLs `https://wingdex.app/api/auth/callback/apple` + `https://dev.wingdex.pages.dev/api/auth/callback/apple`. Secrets (`APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`) set in Cloudflare Pages for both production and preview environments. Client secret JWT valid 180 days from 2026-02-22, auto-rotated via GitHub Actions.
- **Google**: Create OAuth 2.0 Client at console.cloud.google.com. Callback URL: `https://wingdex.app/api/auth/callback/google`

---

### Bird ID & AI: Smart Server Endpoint

> **Status**: ✅ Implemented. Client uses server-owned `/api/identify-bird` with D1-backed per-user daily rate limiting. `/api/suggest-location` removed - location search uses Nominatim directly; `textLLM` function deleted as dead code. Default model `gpt-4.1-mini`. AI Gateway created but direct OpenAI preferred.

Instead of a thin LLM proxy (which would force every client to reimplement prompt construction, taxonomy grounding, and crop-box computation), the server owns the entire bird identification pipeline. Clients upload an image with context and receive structured results.

**Client contract** - identical for web and any future native client:

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
4. Call LLM backend (selectable via `env.LLM_PROVIDER` - see options below)
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

#### Option A - AI Gateway → OpenAI (recommended for production)

Cloudflare AI Gateway proxies requests to OpenAI with added caching, rate limiting, logging, and fallback:

- **Pros**: Keeps GPT-4.1-mini quality for bird ID. Request caching saves cost on repeated/similar images. Logging dashboard for observability.
- **Cons**: Requires OpenAI API key + pay-per-use (~$0.40/M input tokens, $1.60/M output for GPT-4.1-mini). Not fully Cloudflare-native.
- **Setup**: Create AI Gateway in Cloudflare dashboard → get `AI_GATEWAY_ID`. Add `OPENAI_API_KEY` as a secret.

#### Option B - Workers AI (fully Cloudflare-native)

Use Cloudflare's on-edge GPU inference with `@cf/meta/llama-3.2-11b-vision-instruct` (vision) or `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (text):

- **Pros**: Free tier (10,000 neurons/day). Fully Cloudflare-native. No external API keys. Low latency (runs on edge).
- **Cons**: Bird ID accuracy will likely degrade vs GPT-4.1-mini. Open-source vision models are weaker on specialized species identification.
- **Cost**: Free: 10,000 neurons/day. Paid: $0.011/1,000 neurons.

#### Option C - Hybrid (recommended long-term)

AI Gateway with Workers AI fallback. AI Gateway supports declarative fallback configuration in the dashboard - no code needed. Consider a user-facing "Free mode" toggle in Settings that routes to Workers AI only (lower quality, zero cost).

**Frontend change** - `ai-inference.ts` gets **significantly simplified** (from ~230 lines to ~30 lines):
- Remove `compressImage()`, `loadImage()` (browser-only canvas stuff - server handles resizing)
- Remove prompt template, `safeParseJSON`, `findBestMatch` call, crop-box computation
- Remove `sparkVisionLLM()` / `sparkTextLLM()` wrappers
- Replace with: compress image client-side to ≤800px → `POST /api/identify-bird` with `FormData` → return structured response
- Location suggestion: `POST /api/suggest-location` with coords → return name string

---

### Species Search: Server-Side Taxonomy

> **Status**: ✅ Implemented. Species autocomplete queries server endpoint (`/api/species/search`) with auth guard; wiki-title lookup uses `/api/species/wiki-title` (public); eBird code lookup via `/api/species/ebird-code`. Client-side `taxonomy.ts` fully removed - 876KB saved from client bundle. Client caching wrapper in `wikimedia.ts`.

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

**Frontend change** - species typeahead in AddPhotosFlow and WingDexPage switches from local `searchSpecies()` to `fetch('/api/species/search?q=...')` (debounced at 150ms). The 300KB `taxonomy.json` import is removed from the client bundle, reducing initial load.

---

### Data Layer: Refactoring `useWingDexData`

> **Status**: ✅ Implemented as API-first with optimistic updates and localStorage fallback. Client-side `seed-data.ts` removed (demo data via CSV import API). `loadSeedData` and `importFromEBird` functions deleted from hook.

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

**Dex updates in mutation responses**: Every endpoint that modifies observations recomputes the affected dex entries via the SQL aggregate query and returns `dexUpdates: DexEntry[]`. The client applies these to local state. This eliminates `buildDexFromState()` as a client-side requirement - future iOS/native clients get correct dex state without reimplementing the aggregation logic.

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

> **Status**: ✅ Implemented. Preview/confirm import and CSV export flows now run through server endpoints used by Settings/Outings UI. Import confirm split into separate `ebird-csv/confirm.ts` route file.

Instead of parsing CSV and detecting conflicts client-side (which would require reimplementing ~400 lines of CSV/timezone/grouping logic for iOS), the server handles the full pipeline:

**Step 1 - Preview** (`POST /api/import/ebird-csv`):
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

**Step 2 - Confirm** (`POST /api/import/ebird-csv/confirm`):
```
Body: { previewIds: string[] }

Response 200:
{
  imported: { outings: number, observations: number, newSpecies: number },
  dexUpdates: DexEntry[]
}
```

Server inserts the selected outings + observations via D1 batch transaction and returns the recomputed dex.

**eBird Export** - also server-side for consistency:
- `GET /api/export/outing/:id?format=ebird` → returns eBird Record Format CSV
- `GET /api/export/dex?format=csv` → returns dex CSV

**Frontend change**: `ebird.ts` client-side parsing functions are removed. The eBird import UI in SettingsPage changes from "parse locally → show preview → bulk POST" to "upload CSV → GET preview from server → confirm selection."

---

### Top-Half Design Conformance

| Design Section | Status | Note |
|---|---|---|
| TL;DR / Overall Migration Direction | ✅ | All phases complete. Data/API migration done; all client-side business logic removed. GitHub OAuth + Apple Sign In live. Google pending (Phase 1.12). |
| Architecture | ✅ | All `/api/*` routes implemented including auth (`finalize-passkey`, `linked-providers`, `providers`), data, import/export, species (`ebird-code`), and AI. |
| Current Spark Dependency Map | ✅ | Spark KV/runtime/plugin/LLM dependencies are removed from active app paths. |
| Multi-Platform API Design | ✅ | Data, taxonomy, and bird-ID/location AI server centralization implemented and tested. |
| D1 Schema Design | ✅ | Relational schema (4 migrations) and SQL dex aggregation in place. |
| Auth: Better Auth + D1 | ⚠️ | Demo-first auth gate UX + passkey signup + GitHub OAuth + Apple Sign In. Post-passkey-ux polish (labels, social avatars, transitions, linked-providers). Google pending (1.12). |
| Bird ID & AI: Smart Server Endpoint | ✅ | `/api/identify-bird` with rate limiting. `gpt-4.1-mini` default. `/api/suggest-location` removed. |
| Species Search: Server-Side Taxonomy | ✅ | `/api/species/search` + `wiki-title` + `ebird-code`. Client `taxonomy.ts` removed - 876KB saved. |
| Data Layer: Refactoring `useWingDexData` | ✅ | API-first with optimistic updates + localStorage fallback. Dead functions removed. |
| eBird Import: Server-Side Two-Step Flow | ✅ | Server-side preview/confirm. Client `ebird.ts` + `seed-data.ts` removed. Import confirm split to separate route. |

---

### Phased Implementation

#### Phase 0 - Scaffolding (no behavior change) ✅

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
compatibility_date = "2025-11-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "dist"

# Production (default) - uses the main database
[[d1_databases]]
binding = "DB"
database_name = "wingdex-db"
database_id = "bb0a4504-8009-4ea3-b462-ce2b9de3d615"
migrations_dir = "migrations"

[ai]
binding = "AI"

# Preview/dev - uses a separate database
[env.preview]
[[env.preview.d1_databases]]
binding = "DB"
database_name = "wingdex-db-dev"
database_id = "7299207b-ddc7-4ecd-bc36-b6838f278c78"
migrations_dir = "migrations"

[env.preview.ai]
binding = "AI"

# Secrets (set via Cloudflare dashboard / `wrangler pages secret put`):
# Production: BETTER_AUTH_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, OPENAI_API_KEY, APPLE_CLIENT_ID, APPLE_CLIENT_SECRET
# Preview: BETTER_AUTH_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, APPLE_CLIENT_ID, APPLE_CLIENT_SECRET
```

---

#### Phase 1 - Auth (Better Auth) 🟡

> **Status snapshot (2026-02-23)**: ⚠️ Core auth migration implemented with demo-first UX rework + GitHub OAuth + Apple Sign In. Google ⏳. **UX overhaul (passkey-ux branch)**: `LoginPage.tsx` and `PasskeyAuthDialog.tsx` deleted - replaced by demo-first experience where anonymous users see the full app with demo data (69 species). Auth-gated features (add photos, outings, import/export) trigger a dual-mode Sign up / Log in modal via `use-auth-gate.tsx` hook. Passkey signup: anonymous bootstrap → addPasskey → finalize-passkey (name-only, no email). Settings account card: emoji avatar (bird-to-emoji mapping via `fun-names.ts`), nickname editing, passkey rename/delete, account deletion. Demo CSV moved from `e2e/fixtures/` to `src/assets/` (decouples prod from test fixtures). In-app Privacy Policy and Terms of Use pages (full legal text in React components + static HTML fallbacks). Email collection entirely removed from passkey auth flow. Social sign-in buttons dynamically rendered based on configured providers via `GET /api/auth/providers` (5-min cache). Account linking via `trustedProviders` auto-merge only. GitHub OAuth fully configured - two OAuth apps (prod + dev callbacks). Apple Sign In fully configured - Services ID `app.wingdex.signin` with return URLs for prod + dev. **Post-passkey-ux polish**: passkey label standardization (device-display format with custom name preservation); social avatar rendering without emoji scaling; auth flow first-load transition smoothing; OAuth redirect error toast feedback; `baseURL` derived from request URL origin (replaced Origin header approach); footer layout finalized; local dev bootstrap simplified (`ensure-app-on-5000`); `linked-providers.ts` endpoint for querying user's active social accounts.
> **Confidence**: High.
> **Validation**: Auth guard unit tests ✅, auth gate unit tests ✅ (8 tests), fun-names tests ✅ (5 tests), full test suite ✅ (505/505), `tsc --noEmit` ✅, `eslint` ✅ (0 errors, 0 warnings), Playwright e2e smoke ✅, preview deploy auth OK check (`/api/auth/ok` → `{"ok":true}`) ✅.

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
| 1.10 | Create login page component | ⚠️ Originally implemented as `LoginPage.tsx` + `PasskeyAuthDialog.tsx` (unified passkey-first flow). **Superseded by passkey-ux branch**: both files deleted - replaced by demo-first auth gate modal (`use-auth-gate.tsx` hook) embedded in `App.tsx`. Anonymous users see the full app with demo data; auth-gated features trigger a dual Sign up / Log in modal with cancellation handling. Social sign-in buttons dynamically rendered based on `GET /api/auth/providers` response. `fun-names.ts` retained (random bird names for signup). | ⚠️ |
| 1.11 | Update `SettingsPage` | `user.id: number` → `string`, `user.login` → `user.name`. **passkey-ux**: Account card with emoji avatar (bird-to-emoji mapping via `getEmojiAvatarColor`), nickname editing, passkey rename/delete. Account deletion button. Demo data toggle (load/clear) for anonymous users. Email recovery section removed (email stripped from passkey flow). "Link GitHub account" button removed - account linking handled automatically via `trustedProviders`. "Sign out" using `authClient.signOut()` with local anonymous re-bootstrap in-app (no hard reload). | ✅ |
| 1.12 | Register OAuth apps | GitHub ✅ (two apps: prod `wingdex.app` + dev `dev.wingdex.pages.dev`, secrets set in Cloudflare Pages for both environments). Apple ✅ (Services ID `app.wingdex.signin`, domains `wingdex.app` + `dev.wingdex.pages.dev`, return URLs for prod + dev; secrets `APPLE_CLIENT_ID` + `APPLE_CLIENT_SECRET` set in Cloudflare Pages for both production and preview environments; client secret JWT valid 180 days from 2026-02-22, auto-rotated via GitHub Actions). Google ⏳. | ⚠️ |
| 1.13 | Dynamic provider buttons | Created `GET /api/auth/providers` endpoint returning configured social providers (checks env vars). LoginPage fetches on mount, conditionally renders GitHub/Apple buttons. 5-minute `Cache-Control`. | ✅ |
| 1.14 | Account linking policy | Removed manual "Link GitHub account" button from Settings. Re-enabled `accountLinking` with `trustedProviders: ['github', 'apple']` and `allowDifferentEmails: true` for automatic social-to-social account merging. Safe because passkey users use generated emails (`anon_xxx@localhost`), preventing hijacking. | ✅ |
| 1.15 | Apple client secret rotation | Created `.github/workflows/rotate-apple-secret.yml` - scheduled workflow (cron every 5 months) generates a new Apple client secret JWT from `.p8` private key stored in GitHub secrets, pushes to Cloudflare Pages via `wrangler pages secret put` for both production and preview environments. | ✅ |
| 1.16 | Demo-first auth gate modal | Created `src/hooks/use-auth-gate.tsx` - hook + modal component replacing `LoginPage.tsx`/`PasskeyAuthDialog.tsx`. Anonymous users see full app; auth-gated features trigger dual Sign up / Log in modal. Supports cancellation (returns to previous state). 8 unit tests in `use-auth-gate.test.tsx`. | ✅ |
| 1.17 | Emoji avatar helpers | Created emoji avatar helpers with bird-to-emoji mapping - consolidated into `fun-names.ts` (originally separate `emoji-avatar.ts`, merged). `getEmojiAvatarColor()`, `emojiForBirdName()`, `emojiAvatarDataUrl()` provide consistent avatar rendering for header and Settings account card. | ✅ |
| 1.18 | Demo data loader | Created `src/lib/demo-data.ts` - loads 69 species from bundled `src/assets/ebird-import.csv` for anonymous users. Demo data toggle in Settings (load/clear). CSV moved from `e2e/fixtures/` to `src/assets/` to decouple prod from test fixtures. | ✅ |
| 1.19 | Account deletion | Enabled `deleteUser` in Better Auth config. Account deletion button in Settings account card. | ✅ |
| 1.20 | In-app legal pages | Created `src/components/pages/PrivacyPage.tsx`, `TermsPage.tsx`, `public/privacy.html`, `public/terms.html`. Footer links in app. | ✅ |
| 1.21 | A-Z sort for outings | Added alphabetical sort option to `OutingsPage.tsx`. | ✅ |
| 1.22 | Remove email from passkey flow | Removed email input from auth gate modal, email handling from `finalize-passkey.ts` (name-only), email recovery section from SettingsPage, deleted `check-email.ts` endpoint. No email collected for passkey-only users. | ✅ |
| 1.23 | Auth baseURL validation | Added Origin header validation in `functions/lib/auth.ts` - `rawHeaderOrigin` filtered for null/empty/`"null"` string, falls back to `env.BETTER_AUTH_URL` or `requestOrigin`. Throws if no valid URL found. | ✅ |
| 1.24 | E2e auth helpers | Added `promoteAnonymousUser()` helper in `e2e/helpers.ts` for e2e tests that need auth-gated features. Updated smoke, dark-mode, and CSV integration specs. | ✅ |
| 1.25 | Auth UX specs | Created `docs/PASSKEYS_UX.md` (auth gate modal spec, no-email approach). Created `docs/EMAIL_VERIFICATION.md` (deferred - future spec for optional email). | ✅ |
| 1.26 | Passkey label polish | Standardized passkey labels to device-display format (e.g. "iCloud Keychain (Chrome, macOS)"). Preserve custom names on rename. Suppress WebAuthn cancel errors from surfacing as toasts. | ✅ |
| 1.27 | Social avatar rendering | Fixed social provider avatars (GitHub/Apple) to render as `<img>` without emoji scaling. Emoji avatars only for passkey-only users. | ✅ |
| 1.28 | Auth flow polish | Smoothed first-load transitions - eliminated flash states during session hydration. Toast feedback for OAuth redirect errors. | ✅ |
| 1.29 | Linked providers endpoint | Created `GET /api/auth/linked-providers` - returns user's active social account provider IDs for Settings UI. | ✅ |
| 1.30 | Auth baseURL from request URL | Changed `auth.ts` to derive `baseURL` from `new URL(request.url).origin` instead of `Origin` header (more reliable for Cloudflare Pages previews). | ✅ |

**userId type cascade** - changing `id` from `number` to `string` touches:
- [src/App.tsx](src/App.tsx): `UserInfo.id`, `getFallbackUser()`, `useWingDexData(user.id)`, `AddPhotosFlow userId=`
- [src/hooks/use-wingdex-data.ts](src/hooks/use-wingdex-data.ts): `useWingDexData(userId: number)` → `string`
- [src/lib/storage-keys.ts](src/lib/storage-keys.ts): `getUserStorageKey(userId: number, ...)` → `string` (for localStorage fallback)
- [src/lib/dev-user.ts](src/lib/dev-user.ts): return type `number` → `string`
- [src/components/pages/SettingsPage.tsx](src/components/pages/SettingsPage.tsx): `SettingsPageProps.user.id: number` → `string`
- [src/components/flows/AddPhotosFlow.tsx](src/components/flows/AddPhotosFlow.tsx): `AddPhotosFlowProps.userId: number` → `string`
- [src/lib/ebird.ts](src/lib/ebird.ts): `groupPreviewsIntoOutings(previews, userId: string)` - already `string`, but callers pass `` `u${user.id}` `` which needs updating to just `user.id`

---

#### Phase 2 - Data Layer (D1) + Species Search ✅

> **Status snapshot (2026-02-20)**: ✅ Implemented with documented deviations in rows `2.16–2.19`. Post-Phase-5 cleanup fully removed client-side `ebird.ts`, `taxonomy.ts`, and `seed-data.ts` - all business logic now server-only.
> **Confidence**: High.
> **Validation**: `npm run lint` ✅ (no errors), `npm run typecheck` ✅, `npm run test:unit` ✅ (485 tests, 27 files), `npm run smoke:api` ✅ (authenticated `/api/data/all` + `/api/data/outings` write/read loop), `npm run smoke:api:seeded` ✅ (realistic eBird CSV preview/confirm), `npx playwright test e2e/api-smoke.spec.ts --project=chromium` ✅, targeted Playwright UI flows for CSV import + full photo upload ✅, functions compile ✅.

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
| 2.10 | Create `functions/api/data/seed.ts` | `POST`: Insert seed data (outings, observations), compute dex | ✅ (subsequently deleted - SettingsPage now uses CSV import API with demo CSV; seed endpoint had zero consumers) |
| 2.11 | Create `functions/api/data/clear.ts` | `DELETE`: Delete all user data (`DELETE FROM outing WHERE userId = ?` - CASCADE handles the rest, then `DELETE FROM dex_meta WHERE userId = ?`) | ✅ |
| 2.12 | Create `functions/api/species/search.ts` | `GET`: Load taxonomy.json into Worker module scope, implement `searchSpecies()` server-side. Accept `?q=&limit=` params. | ✅ |
| 2.13 | Create shared `functions/lib/dex-query.ts` | Extract the dex SQL aggregate query into a shared helper used by all endpoints that return `dexUpdates`. | ✅ |
| 2.14 | Move eBird parsing to `functions/lib/ebird.ts` | Port `parseEBirdCSV()`, `groupPreviewsIntoOutings()`, and export formatters from `src/lib/ebird.ts` to run in the Worker. | ✅ |
| 2.15 | Move taxonomy to `functions/lib/taxonomy.ts` | Port `searchSpecies()`, `findBestMatch()`, `getWikiTitle()`, `getEbirdCode()` to the Worker. The taxonomy.json file is loaded once at module scope. | ✅ |
| 2.16 | Refactor use-wingdex-data.ts | Replaced 4x `useKV` calls with API-first state hydration via `GET /api/data/all` and optimistic mutations that apply server `dexUpdates`. Includes explicit localStorage fallback for local unauthenticated mode. | ✅ (`buildDexFromState` export intentionally kept - validates local fallback dex logic in `build-dex.test.ts`) |
| 2.17 | Refactor ebird.ts (client) | Settings and Outings UI now use `/api/import/ebird-csv`, `/api/import/ebird-csv/confirm`, and `/api/export/*` endpoints. | ✅ (client `src/lib/ebird.ts` fully removed - `seed-data.ts` deleted, all consumers repointed to `functions/lib/ebird.ts`) |
| 2.18 | Refactor species typeahead | Replaced local typeahead search with debounced `fetch('/api/species/search?q=...')` in species autocomplete. Removed runtime client imports of taxonomy search/match helpers from active app flows. | ✅ (`src/lib/taxonomy.ts` fully removed - `wikimedia.ts` now uses `/api/species/wiki-title` endpoint with client-side cache; 876KB saved from client bundle) |
| 2.19 | Rewrite use-kv.ts | Rewrote to simplified localStorage-only fallback behavior; removed Spark KV runtime paths and network sync logic. | ✅ (use-kv tests updated in Phase 5: renamed spark→hosted, updated URLs/keys, removed Spark runtime assumptions) |
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

**Cleanup update (2026-02-20, post-Phase-5)**
- Deleted `src/lib/seed-data.ts` - SettingsPage now loads demo data via CSV import API with a bundled `ebird-import.csv` fixture.
- Deleted `src/lib/ebird.ts` - all eBird parsing consumers repointed to `functions/lib/ebird.ts`.
- Deleted `src/lib/taxonomy.ts` - `wikimedia.ts` wiki-title lookup replaced with `/api/species/wiki-title` endpoint + client-side cache. Saved 876KB from client bundle.
- Created `functions/api/species/wiki-title.ts` - public (no auth) endpoint for server-side taxonomy lookup by common name.
- Deleted `functions/api/data/seed.ts` - dead endpoint after SettingsPage refactor to CSV import.
- Removed dead `textLLM` function from `ai-inference.ts` and deleted its test file.
- Removed dead `/api/suggest-location` endpoint, `suggestLocationName` from `bird-id.ts`, and cleaned rate-limit config.
- Dead code audit: removed `downscaleForInference` (photo-utils), orphaned `ImportPreview` (client types), dead re-exports from `bird-id.ts`, un-exported self-consumed types.
- Rewrote `e2e/helpers.ts` to use `seedViaCSVImport()` API helper instead of localStorage injection.
- Replaced Radix UI Select with native `<select>` for timezone picker - SettingsPage chunk 113KB→63KB.

**D1 transaction support** - for bulk operations like eBird import (insert many outings + observations atomically):

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

#### Phase 3 - Bird ID & AI

> **Status snapshot (2026-02-21)**: ✅ Phase 3 complete. Server-owned AI endpoints, provider-aware inference, simplified client, AI Gateway code path, and D1-backed per-user daily rate limiting are all implemented and tested. AI Gateway dashboard entity created but not actively routing traffic (direct OpenAI preferred for now). Default model is `gpt-4.1-mini` after benchmarking against `gpt-5-mini` and `gpt-5-nano`.
> **Confidence**: High.
> **Validation**: `npm run test:unit` ✅ (415 tests including ai-inference, ai-fixture-replay, ai-rate-limit), `npm run build` ✅, `npm run smoke:api` ✅, `npm run lint` ✅ (0 errors).

| Step | What | Details | Status |
|---|---|---|---|
| 3.1 | Create `functions/api/identify-bird.ts` | Accept multipart image + context. Resize image, construct prompt, call LLM, ground against taxonomy, compute crop box. Return structured `{ candidates, cropBox, multipleBirds }`. | ✅ |
| 3.2 | Create `functions/api/suggest-location.ts` | Accept coords + optional existing names. Call text LLM with location suggestion prompt. Return `{ name }`. | ✅ |
| 3.3 | Move prompt + inference logic to `functions/lib/bird-id.ts` | Port prompt template, `safeParseJSON`, retry logic, crop-box computation from `src/lib/ai-inference.ts`. The taxonomy grounding uses the shared `functions/lib/taxonomy.ts` from Phase 2. Prompt deduplicated into shared `functions/lib/bird-id-prompt.js` used by runtime, fixture capture, and benchmark scripts. | ✅ |
| 3.4 | Implement LLM backend selection | `env.LLM_PROVIDER` selects between AI Gateway → OpenAI (Option A), Workers AI (Option B), or hybrid (Option C). Internal to the server - clients never see the LLM API directly. | ✅ (OpenAI, Azure OpenAI, and GitHub Models provider selection + unsupported-parameter fallback handling implemented) |
| 3.5 | Simplify client `ai-inference.ts` | Remove prompt template, `loadImage()`, `sparkVisionLLM()`, `sparkTextLLM()`, `safeParseJSON`, `findBestMatch` call, crop-box math. Keep only lightweight client image compression + multipart upload (`POST /api/identify-bird`) and server text call (`POST /api/suggest-location`) with local auth retry wrapper. | ✅ |
| 3.6 | Create AI Gateway in Cloudflare dashboard | Configure caching, rate limits, logging. Optionally add fallback to Workers AI model. | ✅ Gateway created (`wingdex-prod`); code path in `bird-id.ts` routes through gateway when `CF_ACCOUNT_ID` + `AI_GATEWAY_ID` are set. Not actively used - direct OpenAI preferred for simplicity. |
| 3.7 | (Optional) Add per-user rate limiting | Use D1 counter table or in-memory tracking in the Worker to limit LLM calls per user per day | ✅ D1 `ai_daily_usage` table (migration 0003) + `enforceAiDailyLimit` helper. Defaults: 150/day identify, 300/day suggest. Returns 429 + `Retry-After`. Configurable via `AI_DAILY_LIMIT_IDENTIFY`/`AI_DAILY_LIMIT_SUGGEST` env vars. Unit + endpoint tests in `ai-rate-limit.test.ts`. |

---

#### Phase 4 - Build & Hosting

> **Status snapshot (2026-02-20)**: ✅ All Spark build/runtime/config integrations removed. SPA hosting assets in place.
> **Confidence**: High.
> **Validation**: `npm run build` passes ✅, no Spark imports/plugins/config remain in build pipeline.

| Step | What | Details | Status |
|---|---|---|---|
| 4.1 | Update vite.config.ts | Remove `import sparkPlugin` and `import createIconImportProxy` from `@github/spark`. Remove both from `plugins[]`. Add dev proxy: `server: { proxy: { '/api': 'http://localhost:8788' } }` (Wrangler dev server port). | ✅ |
| 4.2 | Update main.tsx | Remove the `isSparkHosted` check and `import('@github/spark/spark')` block. Mount directly: `createRoot(document.getElementById('app')!).render(...)`. | ✅ |
| 4.3 | Update index.html | Rename `<div id="spark-app">` → `<div id="app">`. | ✅ |
| 4.4 | Update portal-container.ts | Change `getElementById('spark-app')` → `getElementById('app')`. | ✅ |
| 4.5 | Update vite-env.d.ts | Remove `GITHUB_RUNTIME_PERMANENT_NAME` and `BASE_KV_SERVICE_URL` declarations. Keep `APP_VERSION`. | ✅ |
| 4.6 | Remove `@github/spark` | `npm uninstall @github/spark` | ✅ |
| 4.7 | Delete Spark config files | Remove spark.meta.json, runtime.config.json. | ✅ |
| 4.8 | Add `public/_redirects` | `/* index.html 200` for SPA fallback routing (or rely on Pages' auto-SPA behavior). | ✅ |
| 4.9 | Update package.json | Remove `@github/spark` from dependencies. Add `wrangler` to devDependencies, `better-auth` to dependencies. Update `description` and `keywords`. Add deploy/CF scripts. | ✅ |
| 4.10 | Phosphor icon plugin | Drop `createIconImportProxy()` - if a Phosphor icon import is invalid, the build fails with a clear error (better than silent fallback to `Question` icon). All current imports are valid. | ✅ |

---

#### Phase 5 - Testing

> **Status snapshot (2026-02-23)**: ✅ Complete. All 507 unit tests pass across 30 files. Server-side function tests added (pure helpers + D1-mocked modules). Spark test naming/URLs updated. E2E helper rewritten to use API-based seeding. Phase 2 deferred items (2.16–2.19) resolved. Dead code cleanup removed `textLLM` test file. Lint fully clean (0 warnings). **passkey-ux additions**: `use-auth-gate.test.tsx` (8 tests), `fun-names.test.ts` (16 tests - includes merged emoji avatar tests), `wikimedia.test.ts` (14 tests), `utils.test.ts` (9 tests - display/scientific name parsing), updated `app-auth-guard.hosted.test.tsx` and `app-auth-guard.local.test.tsx` mocks for auth gate + emoji avatar exports.
> **Confidence**: High.
> **Validation**: `npm run test:unit` - 507 tests, 30 files ✅. `npm run lint` ✅ (0 errors, 0 warnings). `npm run build` ✅.

**Note**: Test count updated to 507 as of 2026-02-23 after post-passkey-ux polish (wikimedia, utils, expanded fun-names/emoji-avatar tests).

| Step | What | Details | Status |
|---|---|---|---|
| 5.1 | use-kv.spark.test.tsx | Renamed to `use-kv.hosted.test.tsx`. Updated URL to `https://wingdex.app/`, describe block to "useKV (hosted runtime)", key names to `u1_hosted_*`. | ✅ |
| 5.2 | use-kv.local.test.tsx | Updated comment from "Spark KV" to "network calls". Tests already use correct localStorage-only behavior. | ✅ |
| 5.3 | app-auth-guard.hosted.test.tsx | Updated URL from `wingdex--jlian.github.app` to `wingdex.app`. Tests mock `fetch('/api/auth/get-session')`. **passkey-ux**: Updated mocks for auth gate modal (removed LoginPage rendering assertions, added `getEmojiAvatarColor` mock export). | ✅ |
| 5.4 | app-auth-guard.local.test.tsx | Already uses string user IDs and better-auth mocks. **passkey-ux**: Added `getEmojiAvatarColor` mock export. | ✅ |
| 5.5 | ai-inference.test.ts | Already tests `fetch('/api/identify-bird')` with FormData. No Spark dependencies remain. | ✅ |
| 5.6 | ai-parse-and-textllm.test.ts | Deleted - `textLLM` function removed as dead code (location search uses Nominatim directly, not LLM suggestion). Server-side prompt/parse logic covered by `bird-id-prompt.test.ts`. | ✅ |
| 5.7 | ai-fixture-replay.test.ts | Already replays against `/api/identify-bird`. No migration needed. | ✅ |
| 5.8 | dev-user-id.test.ts | Already tests string user IDs. No changes needed. | ✅ |
| 5.9 | storage-keys.test.ts | Already uses string userId format. No changes needed. | ✅ |
| 5.10 | build-dex.test.ts | Kept - `buildDexFromState` validates local fallback dex computation logic. Still valuable for client-side correctness. | ✅ |
| 5.11 | ebird-csv.test.ts | Tests repointed to import from `functions/lib/ebird.ts` after client `src/lib/ebird.ts` removal. Server-side ebird also tested in `server-ebird.test.ts`. | ✅ |
| 5.12 | helpers.ts | Rewritten to use `seedViaCSVImport()` helper that seeds via `/api/import/ebird-csv` + `/api/import/ebird-csv/confirm` API endpoints instead of localStorage injection. | ✅ |
| 5.13 | csv-and-upload-integration.spec.ts | Already intercepts `**/api/identify-bird`. No Spark routes remain. | ✅ |
| 5.14 | Other e2e tests | All e2e tests use local dev mode + localStorage. No Spark dependencies. | ✅ |
| 5.15 | **New**: Server-side function tests | Added 6 test files covering all testable `functions/lib/` modules: `server-taxonomy.test.ts` (14 tests), `server-ebird.test.ts` (9 tests), `bird-id-prompt.test.ts` (8 tests), `bird-id-helpers.test.ts` (27 tests: safeParseJSON, extractAssistantContent, buildCropBox), `ai-rate-limit.test.ts` (7 tests with FakeD1Database mock), `dex-query.test.ts` (3 tests with DexQueryDB mock). Remaining modules (`auth.ts` - betterAuth/Kysely integration, `_middleware.ts` - PagesFunction) require full Wrangler integration tests. | ✅ |
| 5.16 | Lint cleanup | Suppressed false-positive `react-hooks/exhaustive-deps` warning in `use-wingdex-data.ts` - mutation functions close over refs, not state. | ✅ |
| 5.17 | Extract bird-id-helpers.ts | Extracted `safeParseJSON`, `extractAssistantContent`, `buildCropBox` from `bird-id.ts` into `functions/lib/bird-id-helpers.ts` so they can be tested without dragging in Cloudflare `Env` types. | ✅ |
| 5.18 | Narrow dex-query.ts type | Replaced `D1Database` with minimal `DexQueryDB` interface (same pattern as `RateLimitDB`) to avoid Cloudflare type dependency in tsc. | ✅ |
| 5.19 | **New**: Auth gate tests | Created `src/__tests__/use-auth-gate.test.tsx` - 8 tests covering modal open/close, sign-up flow, sign-in flow, cancellation, mode switching. | ✅ |
| 5.20 | **New**: Fun-names + emoji avatar tests | Created `src/__tests__/fun-names.test.ts` - 16 tests covering name generation (2), emoji-for-bird mapping (6), emoji avatar data URL (2), and emoji avatar color (5). Originally 5 tests; expanded when `emoji-avatar.ts` was merged into `fun-names.ts`. | ✅ |
| 5.21 | **New**: E2e auth helpers | Updated `e2e/helpers.ts` with `promoteAnonymousUser()` for tests requiring auth-gated features. Updated `smoke.spec.ts`, `dark-mode.spec.ts`, `csv-and-upload-integration.spec.ts` to use the helper. | ✅ |
| 5.22 | **New**: Wikimedia tests | Created `src/__tests__/wikimedia.test.ts` - 14 tests covering Wikimedia Commons image URL construction and `/api/species/wiki-title` client caching wrapper. | ✅ |
| 5.23 | **New**: Utils tests | Created `src/__tests__/utils.test.ts` - 9 tests covering `getDisplayName()` (5 tests) and `getScientificName()` (4 tests) parsing helpers. | ✅ |

---

#### Phase 6 - CI/CD & Deploy

> **Status snapshot (2026-02-23)**: ✅ Complete - significantly reworked from original plan. CI pipeline split from monolithic `verify:ci` script into discrete lint/typecheck/unit/build/migrate/e2e steps for better observability. `deploy.yml` merged into `ci.yml` (preview deploy is the last CI step). `release.yml` triggers on pushes to `[main, dev]` - semantic-release only on main, branch-aware deploy + migration. CI deploy step skips redundant preview deploy when PR source branch is `dev` or `main` (release workflow handles those). Dev branch strategy: `main` (production, deploys to `wingdex.app`), `dev` (staging, deploys to `dev.wingdex.pages.dev`). Separate D1 databases: `wingdex-db` (prod, ID `bb0a4504-...`) and `wingdex-db-dev` (preview, ID `7299207b-...`). Both remote DBs have all 4 migrations applied. GitHub + Apple OAuth secrets + `BETTER_AUTH_SECRET` + `OPENAI_API_KEY` set in Cloudflare Pages for both production and preview environments (Apple credentials configured). Custom domain `wingdex.app` added (pending first production deploy). `db:migrate` renamed to `db:migrate:local` for safety. `computeFileHash` fix for small files committed. `tsconfig.json` excludes `auth-config.test.ts` from `tsc -b` (imports Cloudflare Workers types). Apple client secret rotation workflow added (`.github/workflows/rotate-apple-secret.yml`).
> **Confidence**: High.
> **Validation**: CI passes on PR #145 ✅; preview deploys live (e.g. `cbc1648d.wingdex.pages.dev` returns 200, `/api/auth/ok` returns `{"ok":true}`) ✅; `wrangler pages secret list` confirms all secrets for both environments ✅; both remote D1 databases healthy with all migrations ✅.

| Step | What | Details | Status |
|---|---|---|---|
| 6.1 | Create deploy workflows | Original `deploy.yml` (PR preview) merged into `ci.yml` as final step. `release.yml` handles production + dev deploys on push to `[main, dev]`. Semantic-release only on `main` (`if: github.ref == 'refs/heads/main'`). Branch-aware deploy: `--branch=dev` for non-main pushes. Concurrency group: `release-${{ github.ref_name }}`. | ✅ |
| 6.2 | Add GitHub repo secrets | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BETTER_AUTH_SECRET` - set via `gh secret set` and used by both CI and release workflows. | ✅ |
| 6.3 | Add Cloudflare secrets | Production: `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `OPENAI_API_KEY`, `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`. Preview: `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`. All set via Cloudflare dashboard / `wrangler pages secret put`. Apple credentials configured. | ✅ |
| 6.4 | Custom domain | `wingdex.app` added to Cloudflare Pages project. Zone active (Cloudflare is registrar). Status: pending first production deploy. | ✅ |
| 6.5 | Preview deployments | CI workflow deploys preview per PR as `pr-<number>.wingdex.pages.dev` via `wrangler-action` with `gitHubToken` for automatic PR comments + deployment status. | ✅ |
| 6.6 | Remove stale npm pin | Removed `npm@10.9.2`/`npm@11.6.2` version pins from `ci.yml`, `copilot-setup-steps.yml`, `package.json`, `CONTRIBUTING.md`, `README.md`. | ✅ |
| 6.7 | **New**: CI pipeline overhaul | Split monolithic `verify:ci` npm script into discrete CI steps (lint → typecheck → unit tests → build → migrate local D1 → e2e tests) for better error isolation. Removed `>/dev/null` from `dev-full.sh` so build/migration errors are visible. E2e in CI uses pre-built `dist` directly (`npx wrangler pages dev dist`) instead of rebuilding via `dev:full`. | ✅ |
| 6.8 | **New**: Dev branch strategy | Created `dev` branch from `main`. CI triggers on PRs to `[main, dev]`. Release triggers on pushes to `[main, dev]`. PR #145 retargeted from `main` to `dev` for preview testing. | ✅ |
| 6.9 | **New**: Separate D1 databases | Created `wingdex-db-dev` (ID `7299207b-...`) for preview/dev deploys. Added `[env.preview]` section in `wrangler.toml` with separate D1 binding. Release workflow migrates correct DB per branch (`wingdex-db` on main, `wingdex-db-dev` on dev). | ✅ |
| 6.10 | **New**: Migration script safety | Renamed `db:migrate` → `db:migrate:local` with explicit `--local` flag to prevent accidental remote prod mutations from local machine. | ✅ |
| 6.11 | **New**: Build/tsc fix | Excluded `src/__tests__/auth-config.test.ts` from `tsconfig.json` - it imports `functions/lib/auth.ts` which uses Cloudflare Workers types not in frontend tsconfig. Tests still run via vitest (separate config). | ✅ |
| 6.12 | **New**: Prod D1 database recreation | Original `wingdex-db` was deleted. Recreated with new ID (`bb0a4504-...`), updated `wrangler.toml`, applied all 4 migrations. | ✅ |
| 6.13 | **New**: CI deploy deduplication | CI deploy step skips preview deploy when PR source branch is `dev` or `main` (`if: github.head_ref != 'dev' && github.head_ref != 'main'`), since the release workflow already deploys those branches on push. Uses `--branch=${{ github.head_ref }}` for consistent aliases. | ✅ |
| 6.14 | **New**: Apple secret rotation workflow | `.github/workflows/rotate-apple-secret.yml` - scheduled cron (every 5 months) + manual dispatch. Generates Apple client secret JWT (ES256, 6-month expiry) from `.p8` private key in GitHub secrets, pushes to Cloudflare Pages via `wrangler pages secret put` for both production and preview environments. | ✅ |

**Deploy workflows** - two files:

`ci.yml` (PRs to main/dev - CI + preview):
```yaml
name: CI & Preview
on:
  pull_request:
    branches: [main, dev]
jobs:
  build-and-test:
    steps:
      - Checkout, setup Node 25, npm ci
      - Lint
      - Typecheck
      - Unit tests
      - Build
      - Migrate local D1
      - E2E tests
      - Deploy preview (wrangler pages deploy --branch=pr-<number>)
      - Create branch preview deployment status
```

`release.yml` (push to main/dev - release + deploy):
```yaml
name: Release
on:
  push:
    branches: [main, dev]
concurrency:
  group: release-${{ github.ref_name }}
jobs:
  release:
    steps:
      - Checkout, setup Node 25, npm ci
      - Build
      - Semantic-release (main only)
      - Ensure BETTER_AUTH_SECRET in Pages
      - Apply D1 migrations (wingdex-db on main, wingdex-db-dev on dev)
      - Deploy (no --branch for main, --branch=dev for dev)
```

---

#### Phase 7 - Cleanup

> **Status snapshot (2026-02-23)**: ✅ Done with deviation. Active setup/product docs are migrated to Cloudflare/Better Auth terminology; manifests include explicit root `scope`; package metadata is clean; `spark-tools` is absent. Remaining Spark strings are intentionally historical/contextual (migration tracker narrative, changelog history, test fixtures like “Sparkle/Sparkling”).
> **Confidence**: High.
> **Validation**: Exclusion-based repo audit passed (`rg` excluding changelog/tracker/tests/taxonomy data) + targeted doc updates verified ✅.

| Step | What | Details | Status |
|---|---|---|---|
| 7.1 | Grep for `spark` | No active runtime/setup references found after exclusions (`CHANGELOG.md`, tracker, tests, taxonomy data). | ✅ |
| 7.2 | Update PRD.md | Replaced Spark auth/storage wording with Better Auth + Cloudflare D1 language. | ✅ |
| 7.3 | Update README.md | Updated platform/AI/security/prerequisite wording to current Cloudflare-based local workflow. | ✅ |
| 7.4 | Update PWA manifests | Added explicit root `scope` in `manifest.json` and `site.webmanifest` (start_url already `/`). | ✅ |
| 7.5 | Remove spark-tools | `spark-tools` directory is already absent in current repo state. | ✅ |
| 7.6 | Update package.json metadata | Already clean: no `github-spark` keyword and description reflects current product. | ✅ |
| 7.7 | Improve legal pages | Updated `PrivacyPage.tsx`, `TermsPage.tsx` with full legal text in React components. Simplified `public/privacy.html` and `public/terms.html` to redirect stubs. | ✅ |

---

### Complete File Impact

> **Status snapshot (2026-02-23)**: ⚠️ Needs reconciliation pass against current `dev` branch. Most entries are accurate, but a few paths/routes/workflow names and create/delete notes have drifted.
> **Confidence**: High.
> **Validation**: File existence + workflow/script audit completed against branch state; identified mismatches for targeted follow-up updates.

| File | Action | Change |
|---|---|---|
| `wrangler.toml` | **Create** | Cloudflare project config (D1, AI bindings, env vars) |
| `migrations/0001_initial.sql` | **Create** | Full D1 schema (auth + app tables + indexes) |
| `functions/env.d.ts` | **Create** | `Env` type (DB, AI, env vars) |
| `functions/_middleware.ts` | **Create** | Session validation, inject user into context |
| `functions/lib/auth.ts` | **Create** | Better Auth config (GitHub/Apple/Google/passkeys, D1 adapter). **passkey-ux**: Added Origin header validation for `baseURL`, enabled account deletion (`deleteUser`). **Post-passkey-ux**: Switched to request-URL origin for `baseURL`. |
| `functions/lib/bird-id.ts` | **Create** | Prompt template, LLM call, response parsing, taxonomy grounding, crop-box math (moved from client) |
| `functions/lib/bird-id-helpers.ts` | **Create** | Extracted `safeParseJSON`, `extractAssistantContent`, `buildCropBox` for testability |
| `functions/lib/bird-id-prompt.js` | **Create** | Shared prompt template (runtime, fixture capture, benchmark scripts) |
| `functions/lib/taxonomy.ts` | **Create** | `searchSpecies()`, `findBestMatch()`, `getWikiTitle()`, `getEbirdCode()` (moved from client) |
| `functions/lib/ebird.ts` | **Create** | `parseEBirdCSV()`, `groupPreviewsIntoOutings()`, export formatters (moved from client) |
| `functions/lib/dex-query.ts` | **Create** | Shared dex SQL aggregate helper used by multiple endpoints |
| `functions/lib/ai-rate-limit.ts` | **Create** | D1-backed per-user daily rate limiting for AI endpoints |
| `functions/lib/http-error.ts` | **Create** | Consistent HTTP error response helper for Pages Functions |
| `functions/api/auth/[...path].ts` | **Create** | Better Auth catch-all handler |
| `functions/api/auth/finalize-passkey.ts` | **Create** | POST: name-only passkey finalization (email handling removed) |
| `functions/api/auth/providers.ts` | **Create** | GET: returns configured social providers (checks env vars, 5-min cache) |
| `functions/api/auth/linked-providers.ts` | **Create** | GET: returns user's linked social account provider IDs |
| `functions/api/data/all.ts` | **Create** | GET: load all user data from D1 |
| `functions/api/data/outings.ts` | **Create** | POST: create outing |
| `functions/api/data/outings/[id].ts` | **Create** | PATCH/DELETE: update/delete outing + return dexUpdates |
| `functions/api/data/photos.ts` | **Create** | POST: bulk insert photos |
| `functions/api/data/observations.ts` | **Create** | POST/PATCH: create/update observations + return dexUpdates |
| `functions/api/data/dex.ts` | **Create** | GET: computed dex. PATCH: update dex_meta |
| `functions/api/data/seed.ts` | **Create → Delete** | Originally POST: insert demo data. Deleted - SettingsPage now uses CSV import API with demo CSV; seed endpoint had zero consumers |
| `functions/api/data/clear.ts` | **Create** | DELETE: wipe all user data |
| `functions/api/identify-bird.ts` | **Create** | POST: image + context → species candidates (smart bird ID endpoint) |
| `functions/api/import/ebird-csv.ts` | **Create** | POST: upload CSV → previews with conflicts |
| `functions/api/import/ebird-csv/confirm.ts` | **Create** | POST: confirm import → insert + dexUpdates (split from ebird-csv.ts) |
| `functions/api/export/outing/[id].ts` | **Create** | GET: export outing as eBird CSV |
| `functions/api/export/dex.ts` | **Create** | GET: export dex as CSV |
| `functions/api/species/search.ts` | **Create** | GET: taxonomy typeahead search |
| `functions/api/species/wiki-title.ts` | **Create** | GET: wiki title lookup (public, no auth) |
| `functions/api/species/ebird-code.ts` | **Create** | GET: eBird species code lookup |
| `src/lib/auth-client.ts` | **Create** | Better Auth client SDK config |
| `src/components/pages/LoginPage.tsx` | **Create → Delete** | Originally created as passkey-first login page. **Deleted in passkey-ux**: replaced by demo-first auth gate modal in `use-auth-gate.tsx`. |
| `src/components/flows/PasskeyAuthDialog.tsx` | **Create → Delete** | Originally created for dialog signup/sign-in. **Deleted in passkey-ux**: functionality absorbed into `use-auth-gate.tsx`. |
| `src/hooks/use-auth-gate.tsx` | **Create** | Auth gate hook + modal component. Dual Sign up / Log in modes, cancellation handling, anonymous bootstrap → addPasskey → finalize flow. |
| `src/lib/fun-names.ts` | **Create** | Random kebab-case bird-name generator (~249K combos) + emoji avatar helpers (bird-to-emoji mapping, `emojiForBirdName`, `emojiAvatarDataUrl`, `getEmojiAvatarColor` - consolidated from deleted `emoji-avatar.ts`) |
| `src/lib/demo-data.ts` | **Create** | Demo data loader for anonymous users (69 species from bundled eBird CSV) |
| `src/lib/wikimedia.ts` | **Create** | Wikimedia Commons image URL construction + `/api/species/wiki-title` client caching wrapper |
| `src/assets/ebird-import.csv` | **Create** | Bundled demo eBird CSV (copied from `e2e/fixtures/`, decouples prod from test fixtures) |
| `src/components/pages/PrivacyPage.tsx` | **Create** | In-app Privacy Policy page |
| `src/components/pages/TermsPage.tsx` | **Create** | In-app Terms of Use page |
| `public/privacy.html` | **Create** | Static Privacy Policy HTML |
| `public/terms.html` | **Create** | Static Terms of Use HTML |
| `docs/PASSKEYS_UX.md` | **Create** | Auth gate modal UX spec (no-email passkey approach) |
| `docs/EMAIL_VERIFICATION.md` | **Create** | Deferred email verification spec |
| `src/__tests__/use-auth-gate.test.tsx` | **Create** | 8 tests for auth gate hook |
| `src/__tests__/fun-names.test.ts` | **Create** | 16 tests for random name generation + emoji avatar helpers |
| `src/__tests__/wikimedia.test.ts` | **Create** | 14 tests for Wikimedia Commons/wiki-title integration |
| `src/__tests__/utils.test.ts` | **Create** | 9 tests for display/scientific name parsing helpers |
| `.github/workflows/deploy.yml` | **Create → Delete** | Originally separate deploy workflow; merged into `ci.yml` as final step |
| `.github/workflows/semantic-pr-title.yml` | **Create** | Conventional Commit title validation for PRs |
| `public/_redirects` | **Create** | SPA fallback routing |
| vite.config.ts | **Modify** | Remove Spark plugins, add dev proxy to Wrangler |
| main.tsx | **Modify** | Remove Spark runtime import, change mount point to `#app` |
| App.tsx | **Modify** | Replace `window.spark.user()` with Better Auth. Change `UserInfo.id` to `string`. Replace `AuthErrorShell` with login redirect. **passkey-ux**: Integrated auth gate modal, emoji avatar in header, demo-first user flow (anonymous users see app immediately). |
| use-wingdex-data.ts | **Modify** | Replace 4x `useKV` with API-backed fetch + granular mutations. Apply `dexUpdates` from responses. Remove `buildDexFromState()`. `userId: number` → `string`. |
| use-kv.ts | **Modify** | Strip all Spark KV code. Keep simplified localStorage-only version for local dev, or delete entirely and inline. |
| storage-keys.ts | **Modify** | `userId: number` → `string`. Simplify key pattern. |
| ai-inference.ts | **Simplify** | Remove prompt template, canvas APIs, LLM wrappers, taxonomy grounding, crop math (~230→~30 lines). Replace with `POST /api/identify-bird` FormData call. |
| taxonomy.ts (client) | **Delete** | `searchSpecies()`, `findBestMatch()`, taxonomy.json import fully removed. All lookups go through `/api/species/search` and `/api/species/wiki-title`. 876KB saved from client bundle. |
| ebird.ts (client) | **Delete** | `parseEBirdCSV()`, `groupPreviewsIntoOutings()`, `detectImportConflicts()`, export functions fully removed. Server endpoints handle all eBird logic. |
| dev-user.ts | **Modify** | Return `string` instead of `number`. Generate UUID-like string. |
| index.html | **Modify** | `id="spark-app"` → `id="app"` |
| portal-container.ts | **Modify** | `'spark-app'` → `'app'` |
| src/vite-env.d.ts | **Modify** | Remove `GITHUB_RUNTIME_PERMANENT_NAME`, `BASE_KV_SERVICE_URL` |
| package.json | **Modify** | Remove `@github/spark`, add `wrangler`, `better-auth`. Update scripts/metadata. |
| SettingsPage.tsx | **Modify** | `user.id: number` → `string`. Add sign-out + register-passkey. eBird import UI switches to server-driven preview/confirm flow. **passkey-ux**: Account card (emoji avatar, nickname editing, passkey rename/delete, account deletion). Demo data toggle. Email recovery section removed. |
| AddPhotosFlow.tsx | **Modify** | `userId: number` → `string`. Species typeahead uses `/api/species/search`. |
| functions/api/auth/finalize-passkey.ts | **Modify** | **passkey-ux**: Simplified to name-only (email handling removed). |
| OutingsPage.tsx | **Modify** | **passkey-ux**: A-Z sort option added. |
| `.vscode/tasks.json` | **Modify** | **passkey-ux**: Removed `disable-git-signing-local` task and its reference from `bootstrap-workspace` dependsOn. |
| 6 test files | **Modify/Move** | AI tests move to server-side. Client tests simplified. Auth/userId mocks updated. |
| 4 e2e files | **Modify** | Update route intercepts and localStorage seeding. **passkey-ux**: Added `promoteAnonymousUser` helper, updated smoke/dark-mode/CSV specs for auth gate. |
| spark.meta.json | **Delete** | Spark config |
| runtime.config.json | **Delete** | Spark config |
| spark-tools | **Delete** | Spark tooling (icon proxy plugin) |

---

### Cost Estimate (< 50 users, fresh start)

> **Status snapshot (2026-02-23)**: ⚠️ Informational and directionally accurate, but should be treated as approximate and periodically refreshed as provider pricing changes.
> **Confidence**: Medium.
> **Validation**: Qualitative review only (no live pricing fetch in this pass).

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

> **Status snapshot (2026-02-23)**: ✅ All risks reviewed and accounted for. No outstanding concerns.
> **Confidence**: High.
> **Validation**: Cross-checked against current tracker sections and active branch artifacts.

| Risk | Impact | Mitigation | Status |
|---|---|---|---|
| **LLM quality regression** if using Workers AI | Bird ID accuracy drops | Use AI Gateway → OpenAI as primary. Offer Workers AI as optional "free mode" | ✅ Mitigated - OpenAI is primary path |
| **D1 row limits for power users** | Users with thousands of observations | 5M reads/day free is plenty. Monitor with Cloudflare analytics. Consider pagination for very large datasets. | ✅ Acceptable for current scale |
| **Better Auth breaking changes** | Auth breaks on lib updates | Pin version. Better Auth is actively maintained with good semver. | ✅ Pinned |
| **Apple Sign In complexity** | Requires paid Apple dev account + non-trivial OIDC setup | Services ID `app.wingdex.signin`, credentials set in Cloudflare Pages (prod + preview). Client secret JWT valid 180 days (expires ~2026-08-21), auto-rotated via GitHub Actions workflow. | ✅ Fully configured |
| **Photo blob storage** | D1 TEXT columns holding base64 can get large | Photos are session-ephemeral per PRD. Wikimedia provides persistent imagery. If persistent photos needed later, add R2. | ✅ By design |
| **Local dev experience** | Wrangler + Vite coordination | `npm run dev` starts Vite + Wrangler via dev proxy (`/api/* → localhost:8788`). | ✅ Solved |
| **Session invalidation on deploy** | D1 sessions persist across deploys (good). No invalidation concern. | N/A | ✅ Non-issue |
| **Species search latency** | Server-side typeahead adds ~30-50ms per keystroke vs. instant client-side | Debounce at 150ms. Taxonomy is in Worker memory (no D1 hop). Cloudflare edge ≈ <50ms. Acceptable UX. | ✅ Acceptable |
| **Multipart upload in Workers** | Workers runtime has request body size limits (100MB free, adjustable on paid) | Bird photos compressed to ≤800px JPEG are typically <200KB. Well within limits. | ✅ Within limits |

---

### Local Dev & Testing Playbook

> **Status snapshot (2026-02-23)**: ✅ Complete. Playbook reflects intent accurately; some commands reference migration-era modes (`dev:cf`) that were consolidated into `npm run dev`. Considered acceptable as historical context.
> **Confidence**: High.
> **Validation**: Compared playbook commands with `package.json`, `scripts/dev.sh`, and `scripts/ensure-app-on-5000.sh`.

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
| Seed/clear workflows | `DELETE /api/data/clear` (seed removed - demo data via CSV import) | settings actions update state and survive reloads |

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

> **Status snapshot (2026-02-23)**: ⚠️ Mostly complete. Automated build/unit/smoke checks are validated; remaining items are manual auth/UI/deploy flows or intentionally deferred.
> **Confidence**: High.
> **Validation**: `npm run build`, `npm test`, `npm run smoke:api`, `npm run smoke:api:seeded`, focused Playwright API smoke, local health checks on `:5000`, client-bundle artifact audit, MCP Playwright manual UI checks (demo render, auth-gated modal trigger, sign-up/login mode switch, provider buttons visible, photo upload + identify confirm flow, species search autocomplete list populated from `robin` query, outing-detail export button download + toast + `/api/export/outing/:id` network `200`), user-confirmed GitHub/Apple sign-in + trusted-provider auto-merge behavior, passkey sign-in session verification via MCP (`/api/auth/get-session` → `200` with user+session), direct Wrangler API checks on `:8788` for export/cascade (`API_EXPORT_CASCADE_OK`), latest full Playwright run (`34 passed / 1 skipped` after stabilizing `e2e/csv-and-upload-integration.spec.ts` upload-flow assertion timing), and targeted new e2e coverage for immediate Outings visibility after upload-save and UI eBird export download.

- [x] `npm run build` succeeds without `@github/spark`
- [x] `npm test` - all unit tests pass with updated mocks
- [x] Server-side tests pass - bird ID prompt/parsing, taxonomy search, eBird CSV parsing
- [x] Local dev: Vite serves SPA, localStorage fallback works, bird photos can be uploaded and identified via `/api/identify-bird` (proxied to Wrangler)
- [x] `wrangler pages dev dist` - Pages Functions respond correctly
- [x] Auth flow: GitHub sign-in → session cookie set → `/api/auth/get-session` returns user → app renders with user info _(manually verified by user)_
- [x] Auth flow: Passkey sign-in + social auto-merge via trusted providers (GitHub, Apple) _(GitHub/Apple social sign-in and trusted-provider auto-merge manually verified by user; dedicated passkey lifecycle check remains below)_
- [x] Data persistence: Create outing → reload page → outing still exists (D1)
- [x] Bird ID: Upload bird photo → `POST /api/identify-bird` → structured species candidates returned → client displays results
- [x] Species search: Type in species field → `/api/species/search?q=robin` → autocomplete results shown _(validated via MCP Playwright; listbox options rendered for robin query)_
- [x] Cascading delete: Delete outing → photos + observations deleted in D1 → `dexUpdates` in response reflects change
- [x] Dex computation: Confirm species → mutation response includes correct `dexUpdates`
- [x] eBird import: Upload CSV → server returns previews with conflict status → confirm → outings + observations created → `dexUpdates` returned
- [x] eBird export: `GET /api/export/outing/:id` → valid eBird CSV downloaded _(also validated through Outing detail UI Export button in MCP and e2e)_
- [x] E2E: `npx playwright test` passes against local dev server _(latest full run: 34 passed / 1 skipped)_
- [x] Deploy: Push to `main` → GitHub Actions deploys to Cloudflare Pages → app live at custom domain
- [x] Deploy: Push to `dev` → GitHub Actions deploys to `dev.wingdex.pages.dev` with separate D1 database
- [x] Passkey: Register passkey in settings → sign out → sign in with passkey _(manually completed by user; MCP session check confirms signed-in passkey session)_
- [x] No active Spark runtime/setup references remain in codebase (excluding migration/changelog history, tests, and taxonomy data)
- [x] Client bundle size: `taxonomy.json` no longer in client bundle (~300KB reduction)
- [x] Audit: no client runtime imports of `functions/lib/{taxonomy,ebird,dex-query}` in `src/` (excluding `src/__tests__`)
