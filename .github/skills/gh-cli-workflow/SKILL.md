---
name: gh-cli-workflow
description: Use GitHub CLI for BirdDex PR and issue workflows in Spark Codespaces, including PR updates, issue close flow, and malformed-comment fixes.
---

# GitHub Skill (BirdDex)

Use `gh` for PR/issue CRUD and `gh api` for comment edits/deletes.

## Newline-safe markdown bodies
Prefer inline multiline bodies (no temp files, no escaped `\n`).

Good:
```bash
gh pr comment --body 'Line 1

Line 2'
```

Also good for longer text:
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

## Pull Requests
- Read active PR: `gh pr view --json number,title,url,body`
- Create PR: `gh pr create --title "..." --body 'Summary

- item' --base main --head <branch>`
- Update PR body: `gh pr edit --body 'Updated summary

- item'`
- Clear PR body: `gh pr edit --body ""`
- Read comments: `gh pr view --comments`
- Add comment: `gh pr comment --body 'Short update

- test 1 passed'`

## Issues
- Read issue: `gh issue view <number> --json number,title,body,state,url`
- Update issue body: `gh issue edit <number> --body 'Updated issue body

Details'`
- Read comments: `gh issue view <number> --comments`
- Add comment: `gh issue comment <number> --body 'Resolution summary

- action 1'`
- Close issue: `gh issue close <number> --reason "completed"`
- Close not planned: `gh issue close <number> --reason "not planned"`
- Reopen: `gh issue reopen <number>`

## Comment update/delete via API
`gh` has no direct PR-comment edit command. Use issue-comment API:

- Update comment:
  - `gh api --method PATCH /repos/jlian/birddex/issues/comments/<comment_id> -f body='Updated markdown body'`
- Delete comment:
  - `gh api --method DELETE /repos/jlian/birddex/issues/comments/<comment_id>`

## Pull Requests

Check CI status on a PR:
```bash
gh pr checks 55 --repo owner/repo
```

List recent workflow runs:
```bash
gh run list --repo owner/repo --limit 10
```

View a run and see which steps failed:
```bash
gh run view <run-id> --repo owner/repo
```

View logs for failed steps only:
```bash
gh run view <run-id> --repo owner/repo --log-failed
```

## API for Advanced Queries

The `gh api` command is useful for accessing data not available through other subcommands.

Get PR with specific fields:
```bash
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'
```

## JSON Output

Most commands support `--json` for structured output.  You can use `--jq` to filter:

```bash
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
```
