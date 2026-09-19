---
name: algal-ci
description: Check or wait on the latest GitHub CI run through one bounded poll loop. ci-watch repeats a status probe inside the runtime until the run completes — no sleep/gh-poll cycles in context. Zero model calls.
argument-hint: "[--cwd dir] [--wait-ms N]"
allowed-tools: ["exec"]
---

# algal-ci

```
bunx algal-skills run ci-watch --args '{"src":{"cwd":".","wait-ms":20000}}'
```

Polls `gh run list --limit 1` (via the `ci.status.v1` tool) inside a `repeat`
cell, max 16 rounds, until `status == "completed"`. Returns the terminal
`{status, conclusion, url, run_id, head_sha, title}` and a one-line summary.

`wait-ms` defaults to 20000 when omitted. Intermediate status dumps stay
inside the loop — only the last round's report is emitted.
