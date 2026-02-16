---
name: gh-cli-workflow
description: Use GitHub CLI for BirdDex PR and issue workflows in Spark Codespaces, including PR updates, issue close flow, and malformed-comment fixes.
---

# GitHub Skill (BirdDex)

Use `gh` for PR/issue CRUD and `gh api` for comment edits/deletes.

## Newline-safe markdown bodies
Prefer files to avoid literal `\n` rendering:

`cat > /tmp/body.md <<'EOF'`
`Line 1`
`Line 2`
`EOF`

Then use `--body-file /tmp/body.md`.

Avoid: `--body "line1\n\nline2"`

## Pull Requests
- Read active PR: `gh pr view --json number,title,url,body`
- Create PR: `gh pr create --title "..." --body-file /tmp/pr_body.md --base main --head <branch>`
- Update PR body: `gh pr edit --body-file /tmp/pr_body.md`
- Clear PR body: `gh pr edit --body ""`
- Read comments: `gh pr view --comments`
- Add comment: `gh pr comment --body-file /tmp/comment.md`

## Issues
- Read issue: `gh issue view <number> --json number,title,body,state,url`
- Update issue body: `gh issue edit <number> --body-file /tmp/issue_body.md`
- Read comments: `gh issue view <number> --comments`
- Add comment: `gh issue comment <number> --body-file /tmp/comment.md`
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
