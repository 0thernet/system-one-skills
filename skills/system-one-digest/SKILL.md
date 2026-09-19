---
name: system-one-digest
description: Get current git state (branch, staged/unstaged/untracked counts, ahead/behind, stash, recent commits, diff stat) as one compact digest instead of running git status/diff/log yourself. Zero model calls.
allowed-tools: ["exec"]
---

# system-one-digest

Requires the `system-one-skills` runtime ([install](https://github.com/0thernet/system-one-skills#install-and-run)). If unavailable, use native tools or install when authorized.

Run when you need the repository's current state before editing, committing,
or summarizing progress.

```
system-one-skills run git-digest --args '{"src":{"cwd":"."}}'
```

Optional args: `max-recent` (1–32, default 8).

Default output: `digest` (structured report); `--include-summary` adds text. The
program runs `git status --porcelain`, `git log`, `git diff --stat`, and
`git stash list` inside one bounded tool call — the porcelain output never
reaches your context.
