# Observability: Structured Logging Reference

WingDex emits Azure-Monitor-inspired structured logs from every Cloudflare Pages Function. This document is the canonical reference for the schema, conventions, and required practices.

## Schema

Every log line is a JSON object with these fields:

| Field | Required | Type | Notes |
|---|---|---|---|
| `time` | yes | string | ISO 8601 UTC timestamp |
| `level` | yes | string | `Informational`, `Warning`, `Error`, `Critical` |
| `traceId` | yes | string | W3C trace-id (32 hex chars) |
| `spanId` | yes | string | W3C span-id (16 hex chars) |
| `operationName` | yes | string | `resourceType/subType/verb` (camelCase) |
| `category` | yes | string | `Audit`, `Application`, or `Request` |
| `userId` | when known | string | Top-level for easy querying |
| `identity` | when known | object | `{ isAnonymous, authMethod }` |
| `resourceId` | when applicable | string | `/users/{userId}/outings/{id}` etc. |
| `resultType` | recommended | string | `Succeeded` or `Failed` |
| `resultSignature` | on HTTP responses | number | HTTP status code |
| `resultDescription` | on failures | string | Human-readable: context, cause, mitigation |
| `durationMs` | on completion | number | Wall-clock time (ms) |
| `properties` | optional | object | Machine-queryable extras (counts, IDs, enums) |

## Level (severity)

| Value | When | Gated on DEBUG? |
|---|---|---|
| `Informational` | Happy-path events, sub-step progress | Yes (unless category is Audit) |
| `Warning` | Client errors (4xx), validation failures, degraded paths | No |
| `Error` | Server errors (5xx), unexpected exceptions | No |
| `Critical` | Reserved for data loss, security breach | No |

In production (without `env.DEBUG`), only Warning, Error, Critical, and Audit-category Informational logs are visible.

## Category

| Value | Meaning | Examples |
|---|---|---|
| `Audit` | Security/compliance-relevant changes. Always emits (bypasses DEBUG gate). | Sign-in, passkey finalization, account deletion, data clear |
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
/users/{userId}                              -- base for all authenticated requests
/users/{userId}/outings/{outingId}           -- outing-specific operations
/users/{userId}/dex                          -- dex operations
```

Routes can extend with `log.withResourceId('outings/abc')` for body-derived entity IDs. Deep calls inherit the scoped logger automatically.

## Error message quality

Every `resultDescription` must follow the "include the file name" principle:

**Bad:** `"Invalid outing reference"`
**Good:** `"Outing outing_abc123 referenced by 3 observations is not owned by user or does not exist; the outing may have been deleted by another client"`

Every error message should include:
1. **Context**: what was being attempted
2. **The error itself**: what specifically failed (with entity names/IDs)
3. **Mitigation**: what to do about it

## get-session suppression

`/api/auth/get-session` fires constantly (Better Auth's `useSession()` hook). Successful (2xx) completion logs are suppressed in middleware. Failures still log at Warning/Error level.

## Identity caveat

Middleware resolves the session (and therefore `userId`) for non-`/api/auth/*` routes. Auth routes only carry `authMethod` in `identity` - `userId` is absent.

## Required practices for new/changed code

1. **Always use the request-scoped logger** from `context.data.log` - never `console.log`/`console.error`.
2. **Log every error path** at `warn` (4xx) or `error` (5xx) with `resultType: 'Failed'`, `resultSignature`, and a descriptive `resultDescription`.
3. **Use `log.withResource()`** to attach entity-specific context (outingId, model, tier) that flows to all downstream logs.
4. **Use `log.withResourceId()`** to extend the resourceId path for entity-specific operations.
5. **Propagate `traceparent`** on outbound calls (web -> API, iOS -> API).
6. **Read `response.text()`** on client-side errors to surface server error details.
7. **Keep `properties` machine-queryable** - counts, IDs, enum values. Long prose goes in `resultDescription`.
