# Contributing to WingDex

Thanks for your interest in contributing!

## Development Setup

1. **Clone and install**
   ```bash
   git clone https://github.com/jlian/wingdex.git
   cd wingdex
   npm install
   ```
   Requires Node 24+ (`node --version`).

2. **Start the dev server**
   ```bash
   npm run dev
   ```
   The app runs on `http://localhost:5000` (Vite HMR) with the API on `:8787` (Wrangler).
   On first run, `dev` creates `.dev.vars` from the example and builds the worker bundle.

3. **Create the local database**
   ```bash
   npm run db:migrate
   ```

> **Optional:** Run `npx wrangler login` to enable AI identification and range-prior filtering. The app works without it.

## Project Structure

| Path | Purpose |
|------|---------|
| `src/components/ui/` | shadcn/ui primitives |
| `src/components/pages/` | Page-level React components |
| `src/components/flows/` | Multi-step UI flows |
| `src/hooks/` | Custom React hooks |
| `src/lib/` | Client-side utilities |
| `src/__tests__/` | Vitest unit/integration tests |
| `functions/api/` | Cloudflare Workers API routes |
| `functions/lib/` | Server-side shared logic |
| `migrations/` | D1 SQL migrations |
| `e2e/` | Playwright specs |

## Verification

**Quick check** (seconds, run before every push):
```bash
npm run check
```
This runs lint + typecheck + unit tests.

**Full check** (minutes, matches CI):
```bash
npm run check:all
```
This also runs Playwright e2e and production build. Run it when changes touch `functions/`, `e2e/`, routing, auth, or data flow.

## Dev Server Details

- Two-process setup: Vite on `:5000`, Wrangler Workers behind `/api/*`
- Health check: `http://localhost:5000/api/health`
- If ports are stale, run `npm stop` first
- Local D1 state lives in `~/.cache/wingdex/wrangler-state`
- R2 `RANGE_PRIORS` is `remote = true` - requires `wrangler login` for range filtering. Without it, bird ID still works with unadjusted confidences.

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests if applicable
4. Run `npm run check` to verify
5. Open a pull request against `main`

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) with a required scope:

```
type(scope): description
```

- **Types:** `feat`, `fix`, `docs`, `chore`, `perf`, `refactor`, `test`, `ci`, `build`, `revert`
- **Scope:** short label for the area changed, e.g., `feat(Outings):`, `fix(Auth):`, `docs(README):`
- **PR titles** follow the same format - Release Please uses them for versioning

## Code Style

- **TypeScript**: strict types, no `any` unless unavoidable
- **React**: functional components with hooks
- **Formatting**: single quotes, 2-space indent, match existing style
- **Tests**: Vitest for unit, Playwright for e2e
- **Punctuation**: use ASCII only (commas, hyphens, colons) - no em-dashes or en-dashes

## Reporting Issues

- Use [GitHub Issues](https://github.com/jlian/wingdex/issues) to report bugs or suggest features
- Include steps to reproduce for bugs
- Screenshots are welcome

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
