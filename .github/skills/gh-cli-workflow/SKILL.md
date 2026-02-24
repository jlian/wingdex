---
name: gh-cli-workflow
description: Use GitHub CLI for PR and issue workflows in Codespaces, including PR updates, issue close flow, and malformed-comment fixes.
---

# GitHub CLI Workflow Skill

Use `gh` for PR/issue workflows and `gh api` for operations not covered by built-in commands.

## 1) Write clean markdown bodies
Pipe the body into `--body-file -` to avoid both temp files and heredoc stdin corruption
(on macOS with multiple concurrent terminals, heredoc stdin can get cross-contaminated):

```bash
printf '%s' '## Summary
Line 1

Line 2' | gh pr edit --body-file -
```

For bodies containing single quotes, use a heredoc into the pipe:

```bash
cat <<'EOF' | gh pr edit --body-file -
## Summary
It's a `code` example
EOF
```

Important:
- Always prefer `| gh ... --body-file -` over `--body "$(cat <<'EOF' ... )"` heredoc substitution.
- The pipe isolates stdin from the terminal PTY, preventing cross-contamination from concurrent agents.
- Keep heredoc delimiters quoted (`<<'EOF'`) so backticks are treated as plain text.
- Do not put markdown with backticks directly inside a double-quoted `--body "..."` string.

Avoid:
```bash
# Heredoc substitution -- stdin comes from terminal PTY, vulnerable to corruption
gh pr edit --body "$(cat <<'EOF'
...
EOF
)"
# Escaped newlines -- unreadable
gh pr comment --body "Line 1\n\nLine 2"
```

## 2) Pull request workflow
Inspect the active PR:
```bash
gh pr view --json number,title,url,body
gh pr view --comments
```

Create/update PRs:

```bash
printf '%s' '## Summary
- item' | gh pr create --title "..." --base main --head <branch> --body-file -

cat <<'EOF' | gh pr edit --body-file -
## Updated summary
- item
EOF

gh pr edit --body ""

cat <<'EOF' | gh pr comment --body-file -
Short update

- test 1 passed
EOF
```

If PR title check fails:
- Error pattern: `No release type found in pull request title`.
- Fix with Conventional Commit title prefixes like `feat:`, `fix:`, `docs:`, `test:`, `build:`, `ci:`, `chore:`, `refactor:`, `perf:`, `revert:`.
- Update title quickly:

```bash
gh pr edit <number> --title "fix(ci): short imperative summary"
```

## 3) Issue workflow
Inspect/update issues:
```bash
gh issue view <number> --json number,title,body,state,url
gh issue view <number> --comments
gh issue edit <number> --body 'Updated issue body

Details'
gh issue comment <number> --body 'Resolution summary

- action 1'
```

Close or reopen:
```bash
gh issue close <number> --reason "completed"
gh issue close <number> --reason "not planned"
gh issue reopen <number>
```

## 4) Edit or delete malformed comments
`gh` does not provide a direct PR comment edit command; use issue-comment API endpoints.

```bash
gh api --method PATCH /repos/<owner>/<repo>/issues/comments/<comment_id> -f body='Updated markdown body'
gh api --method DELETE /repos/<owner>/<repo>/issues/comments/<comment_id>
```

## 5) CI and workflow checks
```bash
gh pr checks 55 --repo owner/repo
gh run list --repo owner/repo --limit 10
gh run view <run-id> --repo owner/repo
gh run view <run-id> --repo owner/repo --log-failed
```

## 6) Review comments workflow (no jq)
Use these commands when you want to triage/reply/resolve review comments without `jq` parsing.

```bash
gh pr view <pr-number> --repo <owner>/<repo> --comments
gh pr view <pr-number> --repo <owner>/<repo> --web
```

Notes:
- `gh pr view --comments` is useful for PR conversation context, but not reliable for full inline review-thread management.
- For reply/resolve workflows, query `reviewThreads` via GraphQL to get thread IDs.

List review threads (with IDs, path, unresolved flag):

```bash
gh api graphql -f query='query { repository(owner:"<owner>", name:"<repo>") { pullRequest(number:<pr-number>) { reviewThreads(first:100) { nodes { id isResolved path comments(last:1){nodes{url body author{login}}} } } } } }'
```

Quick unresolved check without `jq`:

```bash
gh api graphql -f query='query { repository(owner:"<owner>", name:"<repo>") { pullRequest(number:<pr-number>) { reviewThreads(first:100) { nodes { id isResolved } } } } }' | grep '"isResolved": false' || true
```

Reply to a review thread and resolve it (CLI):

```bash
gh api graphql -f query='mutation($threadId:ID!, $body:String!) { addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId, body:$body}) { comment { url } } }' -f threadId='<thread_id>' -f body='Addressed in <commit_sha>.'
gh api graphql -f query='mutation($threadId:ID!) { resolveReviewThread(input:{threadId:$threadId}) { thread { isResolved } } }' -f threadId='<thread_id>'
```

## 7) Advanced query patterns (optional jq)
Use JSON output for scripts; add `--jq` only when you want filtered one-liners.

```bash
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
```
