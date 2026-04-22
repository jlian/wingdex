# Agent Instructions

Operational context for AI coding agents. Read [CONTRIBUTING.md](../CONTRIBUTING.md) first for project setup, structure, verification commands, and commit conventions.

## Use the Internet

Prefer up-to-date sources over training data. Search for error messages, check official docs, and look for recent GitHub discussions.

## Quick Reference

- **Stack:** React 19, Vite, Tailwind v4, Cloudflare Workers, D1, better-auth
- **Node:** >= 24
- **Quick check:** `npm run check` (lint + typecheck + tests)
- **Full check:** `npm run check:all` (adds e2e + build)
- **Dev server:** `npm run dev` (Vite on `:5000`, Wrangler on `:8787`)
- **Stop:** `npm stop`

## Observability (Structured Logging)

Full schema and reference in **[docs/OBSERVABILITY.md](../docs/OBSERVABILITY.md)**.

Critical rules:

1. Use the request-scoped logger from `context.data.log` - never `console.log`/`console.error`.
2. Log every error path at `warn` (4xx) or `error` (5xx) with `resultType: 'Failed'`, `resultSignature`, and a `resultDescription` naming the resource, cause, and mitigation.
3. `level` hierarchy: Trace, Debug, Info, Warning, Error, Critical. Controlled by `LOG_LEVEL` env var.
4. `operationName` is camelCase: `resourceType/subType/verb` (e.g., `data/observations/write`).
5. `category` is one of `Audit`, `Application`, or `Request`.
6. Propagate `traceparent` on outbound calls.
