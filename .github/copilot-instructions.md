# Coding Guidelines

Behavioral guidelines to reduce common LLM coding mistakes, derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- Use the internet to research best practices, common pitfalls, and existing solutions.
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Codespace Runtime Assumptions

- In this Spark Codespace, assume the app is already running at `http://localhost:5000` unless a user says otherwise.
- Before starting any dev server, first verify whether `http://localhost:5000` is already available.
- Do not start an additional `npm run dev` process if port 5000 is already serving the app.
- For Playwright/e2e checks, target the existing server on port 5000 by default.

## 6. PR Review Hygiene

**Before pushing commits** to a branch with an open PR:

- Fetch unresolved PR review comments/threads.
- Address relevant feedback in code when in scope.
- If feedback is stale or not applicable, reply with a concise rationale.
- Resolve review threads after fixes/replies when appropriate.

Goal: avoid pushing follow-up commits that miss existing reviewer feedback.

## 7. Repository Defaults (WingDex)

For repository-specific CLI commands in this workspace, use these defaults unless the user specifies otherwise:

- Owner/repo: `jlian/wingdex`
- Default branch: `main`
- Active PR checks may include semantic PR title validation requiring Conventional Commit style titles (e.g., `fix: ...`).