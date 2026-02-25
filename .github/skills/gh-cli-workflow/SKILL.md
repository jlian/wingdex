---
name: gh-cli-workflow
description: Use GitHub CLI for PR and issue workflows, including PR creation, issue management, review threads, and CI checks.
---

# GitHub CLI Workflow Skill

## Key rules

1. **Markdown bodies**: Use the `create_file` tool to write to `/tmp/<name>.md`, then pass with `--body-file`. Never use heredocs, pipes, or `--body` with multi-line content - they mangle markdown in concurrent terminal sessions.
2. **ASCII only**: No em-dashes or en-dashes in bodies/comments - they corrupt in `gh` output. Use hyphens, commas, colons, semicolons.
3. **PR titles and commit messages**: Use Conventional Commit format with a **required** scope, for example:
`feat(Outings):`, `fix(Homepage):`, `docs(README):`, `chore(Hydration):`, `perf(Outings):`, `refactor(BirdDetails):`, `test(CSV):`, `ci(PR):`, `build(Deps):`, `revert(Outings):`.

## PRs and issues

```bash
# Inspect
gh pr view --json number,title,url,body
gh pr view --comments
gh issue view <number> --json number,title,body,state,url

# Create (write body to /tmp/pr-body.md with create_file tool first)
gh pr create --title "feat: ..." --base main --head <branch> --body-file /tmp/pr-body.md
gh issue create --title "chore: ..." --body-file /tmp/issue-body.md

# Update
gh pr edit --body-file /tmp/pr-body.md
gh pr edit <number> --title "fix: new title"
gh issue edit <number> --body-file /tmp/issue-body.md

# Comment (short inline is fine; multi-line use --body-file)
gh pr comment --body "LGTM, merging."
gh issue comment <number> --body "Fixed in abc1234."

# Close
gh issue close <number> --reason "completed"
gh issue close <number> --reason "not planned"
```

## CI checks

```bash
gh pr checks <pr-number>
gh run list --limit 10
gh run view <run-id>
gh run view <run-id> --log-failed
```

## Edit or delete comments

```bash
gh api --method PATCH /repos/{owner}/{repo}/issues/comments/<id> -f body='Fixed body'
gh api --method DELETE /repos/{owner}/{repo}/issues/comments/<id>

# For complex bodies, write to /tmp/ with create_file tool first:
gh api --method PATCH /repos/{owner}/{repo}/issues/comments/<id> -f body="$(cat /tmp/comment-fix.md)"
```

## Review threads

`gh pr view --comments` shows conversation but not inline review threads. Use GraphQL for thread management.

```bash
# List threads
gh api graphql -f query='
  query {
    repository(owner:"{owner}", name:"{repo}") {
      pullRequest(number:<N>) {
        reviewThreads(first:100) {
          nodes {
            id isResolved path
            comments(last:1) { nodes { url body author { login } } }
          }
        }
      }
    }
  }'

# Reply and resolve
gh api graphql \
  -f query='mutation($id:ID!, $body:String!) {
    addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id, body:$body}) {
      comment { url }
    }
  }' -f id='<thread_id>' -f body='Addressed in <sha>.'

gh api graphql \
  -f query='mutation($id:ID!) {
    resolveReviewThread(input:{threadId:$id}) { thread { isResolved } }
  }' -f id='<thread_id>'
```

## Filtered queries

```bash
gh pr view <N> --json title,state --jq '.title, .state'
gh issue list --json number,title --jq '.[] | "\(.number): \(.title)"'
```