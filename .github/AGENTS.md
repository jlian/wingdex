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
- The R2 binding `RANGE_PRIORS` is configured with `remote = true` in `wrangler.toml`, so local dev reads range priors directly from the production R2 bucket. No local R2 population step is needed; you must be logged in via `npx wrangler login`.
- Local D1 state lives in `~/.cache/wingdex/wrangler-state` (set via `--persist-to`), not `.wrangler/state`. Fresh clones run `npm run db:migrate:local` to create the local DB.

## PR Workflow

- Owner/repo: `jlian/wingdex`, default branch: `main`
- PR titles must follow Conventional Commits (e.g., `feat: ...`, `fix: ...`).
- Before pushing to a branch with an open PR, fetch unresolved review comments and address them or reply with rationale.
