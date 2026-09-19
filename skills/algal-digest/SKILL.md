---
name: algal-digest
description: Get current git state (branch, staged/unstaged/untracked counts, ahead/behind, stash, recent commits, diff stat) as one compact digest instead of running git status/diff/log yourself. Zero model calls.
argument-hint: "[--cwd <dir>] [--max-recent N]"
allowed-tools: ["exec"]
---

# algal-digest

Run when you need the repository's current state before editing, committing,
or summarizing progress.

```
bunx algal-skills run git-digest --args '{"src":{"cwd":"."}}'
```

Optional args: `max-recent` (1–32, default 8).

Outputs: `digest` (structured report) and `summary` (one-screen text). The
program runs `git status --porcelain`, `git log`, `git diff --stat`, and
`git stash list` inside one bounded tool call — the porcelain output never
reaches your context.
