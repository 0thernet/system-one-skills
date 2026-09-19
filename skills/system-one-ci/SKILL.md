---
name: system-one-ci
description: Check a GitHub CI run selected for the current HEAD or an explicit run ID. Poll the same run inside a bounded loop, preserving status and SHA with zero model calls.
allowed-tools: ["exec"]
---

# system-one-ci

Requires the `system-one-skills` runtime ([install](https://github.com/0thernet/system-one-skills#install-and-run)). If unavailable, use native tools or install when authorized.

```
system-one-skills run ci-watch --args '{"src":{"cwd":".","wait-ms":20000}}'
```

Selects a run for the current HEAD, or the explicit `src.run-id`, then polls
that same run ID inside a bounded repeat cell (at most 16 rounds). Returns
`{status, conclusion, url, run_id, head_sha, title}` and summary. Errors and
missing runs are explicit; a nonterminal result means the wait limit expired.

`wait-ms` defaults to 20000 when omitted. Verify run identity and final status;
this one-run result does not replace a repository's full required-check gate.
