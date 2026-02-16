---
name: gh-cli-workflow
description: Use GitHub CLI for BirdDex PR and issue workflows in Spark Codespaces, including PR updates, issue close flow, and malformed-comment fixes.
---

# GitHub Skill (BirdDex)

Use `gh` for PR/issue workflows and `gh api` for operations not covered by built-in commands.

## 1) Write clean markdown bodies
Prefer inline multiline bodies (no temp files, no escaped `\n`) with heredoc:

```bash
gh pr edit --body "$(cat <<'EOF'
## Summary
Line 1

Line 2
EOF
)"
```

Avoid:
```bash
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
gh pr create --title "..." --body 'Summary

- item' --base main --head <branch>
gh pr edit --body 'Updated summary

- item'
gh pr edit --body ""
gh pr comment --body 'Short update

- test 1 passed'
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
gh api --method PATCH /repos/jlian/birddex/issues/comments/<comment_id> -f body='Updated markdown body'
gh api --method DELETE /repos/jlian/birddex/issues/comments/<comment_id>
```

## 5) CI and workflow checks
```bash
gh pr checks 55 --repo owner/repo
gh run list --repo owner/repo --limit 10
gh run view <run-id> --repo owner/repo
gh run view <run-id> --repo owner/repo --log-failed
```

## 6) Advanced query patterns
Use JSON output + `--jq` for scripting and concise summaries.

```bash
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
```
