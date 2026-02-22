# Contributing to WingDex

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/jlian/wingdex.git
   cd wingdex
   npm ci
   ```

   Use Node 25+ (`node --version`).

2. **Start the dev server**
   ```bash
   npm run dev
   ```
   The app runs on `http://localhost:5000`.

3. **Run tests**
   ```bash
   npm test            # all tests
   npm run test:watch  # watch mode
   ```

4. **Type check**
   ```bash
   npx tsc -b --noCheck
   ```

> **Note:** AI features use the server endpoint (`/api/identify-bird`) and require local provider credentials in `.dev.vars`.

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests if applicable
4. Run `npm test` and `npx tsc -b --noCheck` to verify everything passes
5. Open a pull request against `main`

## Code Style

- **TypeScript** — strict types, no `any` unless unavoidable
- **React** — functional components with hooks
- **Formatting** — follow the existing style (no trailing semicolons in imports, single quotes, 2-space indent)
- **Tests** — Vitest, import source functions directly rather than re-implementing logic

## Project Structure

See [README.md](README.md#project-structure) for a full annotated file tree.

Key areas:
- `src/lib/` — pure logic (AI inference, EXIF parsing, clustering, eBird import/export)
- `src/components/` — React UI (pages, flows, primitives)
- `src/__tests__/` — unit tests
- `e2e/` — Playwright end-to-end tests

## Reporting Issues

- Use [GitHub Issues](https://github.com/jlian/wingdex/issues) to report bugs or suggest features
- Include steps to reproduce for bugs
- Screenshots are welcome

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
