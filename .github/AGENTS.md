# Agent Instructions

Operational context for AI coding agents working in the WingDex repository.
Coding style rules live in [copilot-instructions.md](./copilot-instructions.md) - read those too.

## IMPORTANT: USE THE INTERNET

Always prefer using the internet to get the most up-to-date information, documentation, and examples. Don't rely solely on training data or memory. When debugging a problem, search for error messages, check official docs, and look for recent discussions or issues on GitHub. When in doubt, look it up!

## Project Overview

WingDex is a photo-first bird identification and life-list tracker, deployed on Cloudflare Pages.

- **Frontend:** React 19, Vite, Tailwind v4, shadcn/ui (Radix primitives)
- **Backend:** Cloudflare Pages Functions (Wrangler), D1 database, better-auth
- **Tests:** Vitest (unit), Playwright (e2e)
- **Node:** >= 25 required

## Key Paths

| Path | Purpose |
|---|---|
| `src/components/ui/` | shadcn/ui primitives |
| `src/components/pages/` | Page-level React components |
| `src/components/flows/` | Multi-step UI flows |
| `src/hooks/` | Custom React hooks |
| `src/lib/` | Client-side utilities |
| `src/__tests__/` | Vitest unit/integration tests |
| `functions/api/` | Cloudflare Pages Functions (API routes) |
| `functions/lib/` | Server-side shared logic |
| `migrations/` | D1 SQL migrations |
| `e2e/` | Playwright specs |

## Verification

**Always run before pushing commits:**

```
npm run lint && npm run typecheck && npm run test:unit
```

These are fast (seconds) and catch most issues.

**Full verification** (`npm run verify`) also runs Playwright e2e and build. It takes longer but matches what CI runs on PRs. Run it when:
- Changes touch `functions/` (API routes, server logic)
- Changes touch `e2e/` specs or test fixtures
- Changes affect routing, auth, or data flow

If you skip full verify, at minimum confirm `npm run build` succeeds.

## Dev Server

- Two-process setup: Vite on `http://localhost:5000`, Wrangler Functions behind `/api/*`.
- Prefer VS Code task `ensure-app-on-5000` (or `bootstrap-workspace`) instead of manually launching servers.
- Health check: `http://localhost:5000/` and `http://localhost:5000/api/auth/get-session`
- If port state is stale, run `npm run kill` first, then start via task or `npm run dev`.
- Playwright/e2e targets port 5000 by default.
- The R2 binding `RANGE_PRIORS` is configured with `remote = true` in `wrangler.toml`, so local dev reads range priors directly from the production R2 bucket. No local R2 population step is needed. To use it you must be logged in via `npx wrangler login` AND have access to the `wingdex-range-priors` bucket on the Cloudflare account. Contributors without access can still run bird ID end-to-end: `range-filter.ts` catches R2 errors and `adjustConfidence` short-circuits on `no-data`, so identification proceeds with unadjusted confidences (no range filtering).
- Local D1 state lives in `~/.cache/wingdex/wrangler-state` (set via `--persist-to`), not `.wrangler/state`. Fresh clones run `npm run db:migrate:local` to create the local DB.

## PR Workflow

- Owner/repo: `jlian/wingdex`, default branch: `main`
- PR titles must follow Conventional Commits (e.g., `feat: ...`, `fix: ...`).
- Before pushing to a branch with an open PR, fetch unresolved review comments and address them or reply with rationale.

## Observability (Structured Logging)

WingDex emits Azure-Monitor-inspired structured logs from every Cloudflare Pages Function. The schema and conventions below are required for all new and changed routes - reviewers should reject diffs that regress them.

### Schema

Every log line is a single JSON object with this envelope:

| Field | Required | Notes |
|---|---|---|
| `time` | yes | ISO 8601 timestamp, set by `createLogger`. |
| `level` | yes | `info \| warn \| error \| debug` (debug gated on `env.DEBUG`). |
| `traceId`, `spanId` | yes | W3C Trace Context, propagated from incoming `traceparent` (or generated). |
| `operationName` | yes | See conventions below. Path/method are intentionally folded in here, not separate fields. |
| `category` | recommended | Coarse bucket: `Request`, `Auth`, `Data`, `BirdId`, `Import`, `Export`, `Health`, etc. |
| `resultType` | on errors | `Succeeded \| Failed \| InProgress`. Omit on uneventful debug traces. |
| `resultSignature` | on errors | HTTP status code (or domain-specific code). |
| `resultDescription` | on errors | Human-readable message: what happened + mitigation. **Omit on 200/uneventful logs** when the rest of the envelope already conveys the outcome. |
| `durationMs` | on completion | Set automatically by `log.time(...)` spans and request-end logs. |
| `identity` | when known | `{ userId, isAnonymous, authMethod }`. Set by middleware after the session check. |
| `properties` | optional | Open bag of machine-queryable, operation-specific fields. Don't duplicate envelope fields here. |

### `operationName` conventions

- **Request lifecycle (auto, emitted by middleware):** `<pathname>/<action>` - e.g. `/api/auth/get-session/read`, `/api/data/observations/write`, `/api/data/outings/abc/delete`.
- **Per-route sub-operations (semantic):** `WingDex/<Resource>/<Sub>/<action>` - e.g. `WingDex/Data/Observations/write`, `WingDex/BirdId/RangeFilter/action`, `WingDex/Health/DB/read`.
- `<action>` is one of `read | write | delete | action` (lowercase). HTTP methods map via `methodToAction()` in `functions/lib/log.ts`. Use `action` for non-CRUD verbs (sign-in, identify, import preview, etc.).

### Identity caveat

Middleware only resolves the session (and therefore `identity.userId`) for non-`/api/auth/*` routes. Logs emitted while handling `/api/auth/*` (including `/api/auth/get-session`) carry only `authMethod` - `userId` will be absent even for signed-in callers. This is intentional: those routes own session lookup themselves and we don't want to double-call Better Auth.

### Required practices for new/changed code

1. **Always use the request-scoped logger** from `context.data.log` in route handlers - never `console.log`/`console.error` directly. This guarantees `traceId`/`spanId`/`identity` flow.
2. **Log every error path** at `warn` (client/validation) or `error` (server/unexpected) with `resultType: 'Failed'`, `resultSignature`, and a `resultDescription` that names the cause (and mitigation when possible). Silent `catch {}` and `.catch(() => undefined)` swallows are bugs.
3. **Read response bodies on client errors.** When the client surfaces a fetch failure, read `response.text()` (or JSON) so the server's `resultDescription` reaches the user/log instead of a bare status code.
4. **Use `log.time(op, category)`** for any operation whose latency matters (DB calls, R2 reads, LLM calls). Call `.end({ resultSignature, ... })` once.
5. **Propagate `traceparent`** on outbound calls between WingDex tiers (web -> API, iOS -> API). Middleware accepts incoming `traceparent` and echoes back response trace headers.
6. **Keep `properties` machine-queryable.** Counts, IDs, enum values yes; long prose no - that belongs in `resultDescription`.

If a route doesn't yet follow these rules, fix it as part of any nearby change. Patterns are exercised across `functions/api/**` and `functions/_middleware.ts` - copy from there.
