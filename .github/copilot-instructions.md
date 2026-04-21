# Coding Guidelines

Guidelines to reduce common LLM coding mistakes. Bias toward caution over speed; for trivial tasks, use judgment.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for project setup, commit conventions, and code style.

## Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

## Simplicity First
- No features, abstractions, or "flexibility" beyond what was asked.
- If you write 200 lines and it could be 50, rewrite it.

## Surgical Changes
- Don't "improve" adjacent code, comments, or formatting. Match existing style.
- Don't refactor things that aren't broken.
- Remove imports/variables/functions that YOUR changes made unused, but don't remove pre-existing dead code.
- Every changed line should trace directly to the user's request.

## Goal-Driven Execution
- Transform tasks into verifiable goals with concrete success criteria.
- For multi-step tasks, state a brief plan with verification checks.

## Commits
- Don't commit too optimistically. Always verify correctness first.
- Don't push without asking.
- Follow the commit convention in [CONTRIBUTING.md](../CONTRIBUTING.md#commits).

## Text Encoding
- Use commas, colons, semicolons, or hyphens (`-`) instead of em-dashes or en-dashes.
- Stick to ASCII punctuation in commit messages, PR descriptions, issue comments, and code comments.