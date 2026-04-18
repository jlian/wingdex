# Observability: Structured Logging Reference

WingDex emits structured logs from every Cloudflare Pages Function using a standard 6-level hierarchy. This document is the canonical reference for the schema, conventions, and operational practices.

## Schema

Every log line is a JSON object (or a compact one-liner when `LOG_FORMAT=pretty`):

| Field | Required | Type | Notes |
|---|---|---|---|
| `time` | yes | string | ISO 8601 UTC timestamp |
| `level` | yes | string | `Trace`, `Debug`, `Info`, `Warning`, `Error`, `Critical` |
| `traceId` | yes | string | W3C trace-id (32 hex chars) |
| `spanId` | yes | string | W3C span-id (16 hex chars) |
| `operationName` | yes | string | `resourceType/subType/verb` (camelCase) |
| `category` | recommended | string | `Audit`, `Application`, or `Request` |
| `userId` | when known | string | Top-level for easy querying |
| `identity` | when known | object | `{ isAnonymous, authMethod }` |
| `resourceId` | when applicable | string | `/users/{userId}/outings/{id}` etc. |
| `resultType` | recommended | string | `Succeeded` or `Failed` |
| `resultSignature` | on HTTP responses | number | HTTP status code |
| `resultDescription` | on failures | string | Human-readable: context, cause, mitigation |
| `durationMs` | on completion | number | Wall-clock time (ms) |
| `properties` | optional | object | Machine-queryable extras (counts, IDs, enums) |

## Log levels

Standard 6-level hierarchy, controlled by `LOG_LEVEL` env var:

| Level | Purpose | When to use |
|---|---|---|
| `Trace` | Ultra-verbose data dumps | Full candidate arrays, range prior maps. Deep debugging only. |
| `Debug` | Sub-step diagnostic detail | Bird-id pipeline stages, batch counts, import parsing. Local dev. |
| `Info` | Significant business events | Request completion (1 per request), audit events. **Production baseline.** |
| `Warning` | Client errors, degraded paths | 4xx responses, validation failures. Always emitted. |
| `Error` | Server errors, exceptions | 5xx responses, unhandled exceptions. Always emitted. |
| `Critical` | System-level failures | Reserved for data loss, security breach. Always emitted. |

### LOG_LEVEL env var

| Value | What's visible | Where to use |
|---|---|---|
| `trace` | Everything | On-demand deep debugging sessions |
| `debug` | Debug + Info + Warning + Error + Critical | **Local dev** (set in `.dev.vars`) |
| `info` (default) | Info + Warning + Error + Critical | **Production** and **preview** |
| `warn` (or `warning`) | Warning + Error + Critical | Quiet mode (errors and warnings only) |
| `error` | Error + Critical only | Minimal output |

Legacy `DEBUG=1` maps to `LOG_LEVEL=debug` for backwards compatibility.

### LOG_FORMAT env var

| Value | Output format | Where to use |
|---|---|---|
| (not set) | JSON (one object per line) | **Production**, preview, log analytics |
| `pretty` | Compact one-liner | **Local dev** terminal |

Pretty format example:
```
19:04:24 INFO     data/all/read 200 42ms [u1234567] Fetched 5 outings, 12 photos
19:04:24 DEBUG    birdId/llmCall/invoke [u1234567] LLM returned 3 raw candidates
19:04:27 WARNING  import/ebirdCsv/import 400 [u1234567] No CSV file in form field
19:04:27 ERROR    birdId/identify/invoke 502 2500ms [u1234567] AI returned unparseable response
```

## Environment-specific configuration

### Production
No env vars needed. Defaults to `LOG_LEVEL=info`, JSON format. You see request completions (1 line each with durationMs + status + userId), audit events, and all warnings/errors.

### Preview / staging
Same as production: `LOG_LEVEL=info`, JSON format. Preview deployments use the same log config so you can verify the production log experience before merging.

### Local dev
Add to `.dev.vars`:
```
LOG_LEVEL=debug
LOG_FORMAT=pretty
```
You see sub-step detail (bird-id pipeline, import parsing, batch counts) in a compact terminal-friendly format.

### Deep debugging
Temporarily set `LOG_LEVEL=trace` to see full data dumps (candidate arrays, range prior maps). Revert when done.

### Tracing a specific user in production
Query CF Workers Logs (or log analytics) by `userId` at Info level - it's a top-level field on every log line. If you need sub-step detail for a production issue, temporarily set `LOG_LEVEL=debug` in Cloudflare Pages env vars and redeploy. Revert after investigation.

## Category

| Value | Meaning | Examples |
|---|---|---|
| `Audit` | Security/compliance-relevant changes. Info-level Audit events are the production baseline - always visible. | Passkey finalization, data clear |
| `Application` | Normal application logic. | CRUD, bird ID, import/export, species lookup, health check |
| `Request` | Middleware request lifecycle. | Completion log with durationMs, pre-auth rejections (405/413), unhandled 500s |

## operationName conventions

Format: `resourceType/subType/verb` in camelCase.

Verbs are specific to what the operation does: `read`, `write`, `delete`, `invoke`, `import`, `export`, `validate`.

### Complete operationName table

| Route file | operationName | category | Description |
|---|---|---|---|
| Middleware: request completion | Derived from ROUTE_MAP | Request | One per request with durationMs |
| Middleware: 405/400/413 | `requests/validation/validate` | Request | Pre-auth rejections |
| Middleware: 401 no session | `auth/sessions/validate` | Request | Session lookup failed |
| Middleware: 500 unhandled | Route's op from map | Request | Unhandled exception |
| api/health.ts | `health/database/read` | Application | |
| api/identify-bird.ts | `birdId/identify/invoke` | Application | |
| lib/bird-id.ts (LLM call) | `birdId/llmCall/invoke` | Application | |
| lib/bird-id.ts (taxonomy) | `birdId/taxonomyMatch/invoke` | Application | |
| lib/bird-id.ts (range filter) | `birdId/rangeFilter/invoke` | Application | |
| lib/bird-id.ts (range priors) | `birdId/rangePriors/read` | Application | |
| lib/bird-id.ts (range adjust) | `birdId/rangeAdjust/invoke` | Application | |
| api/data/all.ts | `data/all/read` | Application | |
| api/data/observations.ts | `data/observations/write` | Application | |
| api/data/outings.ts | `data/outings/write` | Application | |
| api/data/outings/[id].ts PATCH | `data/outings/write` | Application | |
| api/data/outings/[id].ts DELETE | `data/outings/delete` | Application | |
| api/data/photos.ts | `data/photos/write` | Application | |
| api/data/dex.ts GET | `data/dex/read` | Application | |
| api/data/dex.ts PATCH | `data/dex/write` | Application | |
| api/data/clear.ts | `data/clear/delete` | Audit | Destructive |
| api/auth/finalize-passkey.ts | `auth/finalizePasskey/invoke` | Audit | Security event |
| api/auth/linked-providers.ts | `auth/linkedProviders/read` | Application | |
| api/auth/mobile/start.ts | `auth/mobileOAuth/invoke` | Application | |
| api/auth/mobile/callback.ts | `auth/mobileOAuth/invoke` | Application | |
| api/import/ebird-csv.ts | `import/ebirdCsv/import` | Application | |
| api/import/ebird-csv/confirm.ts | `import/ebirdCsvConfirm/write` | Application | |
| api/export/dex.ts | `export/dex/export` | Application | |
| api/export/sightings.ts | `export/sightings/export` | Application | |
| api/export/outing/[id].ts | `export/outingCsv/export` | Application | |
| api/species/search.ts | `species/search/read` | Application | |
| api/species/ebird-code.ts | `species/ebirdCode/read` | Application | |
| api/species/wiki-title.ts | `species/wikiTitle/read` | Application | |

## resourceId hierarchy

Auto-built by middleware after session check:

```
/users/{userId}                                          -- base for all authenticated requests
/users/{userId}/outings/{outingId}                       -- outing-specific (auto from URL params)
/users/{userId}/outings/{outingId}/observations          -- observation batch ops (via withResourceId)
/users/{userId}/outings/{outingId}/observations/{obsId}  -- single observation patch
/users/{userId}/outings/{outingId}/photos                -- photo batch ops (via withResourceId)
/users/{userId}/dex                                      -- dex read/write/export (via withResourceId)
/users/{userId}/dex/{speciesName}                        -- single species dex patch
```

Middleware auto-sets `/users/{userId}` and appends outing IDs from URL params (for `/api/data/outings/:id` and `/api/export/outing/:id`). Route handlers extend with `log.withResourceId('dex')` or `log.withResourceId('outings/' + body.id)` for body-derived entity IDs. Batch operations use the parent resource path and put individual IDs in `properties`.

## Error message quality

Every `resultDescription` must follow the "include the affected entity" principle:

**Bad:** `"Invalid outing reference"`
**Good:** `"Outing outing_abc123 referenced by 3 observations is not owned by user or does not exist; the outing may have been deleted by another client"`

Every error message should include:
1. **Context**: what was being attempted
2. **The error itself**: what specifically failed (with entity names/IDs)
3. **Mitigation**: what to do about it

## Health endpoint

`/api/health` is polled every 30 seconds by the dev server health check script. Successful (2xx) completion logs are suppressed in middleware to avoid noise. Failures still log at Warning/Error level.

## Identity caveat

Middleware resolves the session (and therefore `userId`) for non-`/api/auth/*` routes. Auth routes only carry `authMethod` in `identity` - `userId` is absent.

## Required practices for new/changed code

1. **Always use the request-scoped logger** from `context.data.log` - never `console.log`/`console.error`.
2. **Choose the right level**: `info()` for production-visible business events (the middleware completion log handles most of this automatically). `debug()` for sub-step diagnostic detail. `trace()` for full data dumps. `warn()` for 4xx. `error()` for 5xx.
3. **Log every error path** at `warn` (4xx) or `error` (5xx) with `resultType: 'Failed'`, `resultSignature`, and a descriptive `resultDescription` that names the specific resource, cause, and mitigation.
4. **Use `log.withResource()`** to attach entity-specific context (outingId, model, tier) that flows to all downstream logs.
5. **Use `log.withResourceId()`** to extend the resourceId path for entity-specific operations.
6. **Propagate `traceparent`** on outbound calls (web -> API, iOS -> API).
7. **Read `response.text()`** on client-side errors to surface server error details to the user.
8. **Keep `properties` machine-queryable** - counts, IDs, enum values. Long prose goes in `resultDescription`.

### Choosing info vs debug

Ask: "Would an ops engineer need to see this for every request in production?" If yes -> `info()`. If only useful when debugging -> `debug()`. If it's a giant data dump -> `trace()`.
