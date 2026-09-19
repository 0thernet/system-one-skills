---
name: system-one-explore
description: Map an unfamiliar repository (repo-survey) or find where something is defined/used (search-slice) with bounded outputs instead of ls/find/cat/grep round-trips. Zero model calls.
allowed-tools: ["exec"]
---

# system-one-explore

Requires the `system-one-skills` runtime ([install](https://github.com/0thernet/system-one-skills#install-and-run)). If unavailable, use native tools or install when authorized.

- `repo-survey`: `{"src":{"cwd":".","max-entries":400}}`
  → top dirs, manifests, key source files, README head, file count. Skips
  node_modules/.git/dist/target/etc. Use first on an unfamiliar repo.
- `search-slice`: `{"src":{"pattern":"verifyReceipt","cwd":".","glob":"*.ts","max-matches":24,"context-lines":0}}`
  → `[{file,line,text,text_truncated,context?}]`, `total`, `truncated`, `engine`
  (`rg` is required; missing or invalid searches fail explicitly).

Both cap results. A truncated search is partial evidence, not proof that no
other callers exist. Narrow the query or inspect omitted files when needed.
