---
name: algal-explore
description: Map an unfamiliar repository (repo-survey) or find where something is defined/used (search-slice) with bounded outputs instead of ls/find/cat/grep round-trips. Zero model calls.
argument-hint: "[--cwd dir] [--max-entries N] | <pattern> [--glob g] [--max-matches N]"
allowed-tools: ["exec"]
---

# algal-explore

- `repo-survey`: `{"src":{"cwd":".","max-entries":400}}`
  → top dirs, manifests, key source files, README head, file count. Skips
  node_modules/.git/dist/target/etc. Use first on an unfamiliar repo.
- `search-slice`: `{"src":{"pattern":"verifyReceipt","cwd":".","glob":"*.ts","max-matches":24,"context-lines":0}}`
  → `[{file,line,text,context?}]`, `total`, `truncated`, `engine`
  (`rg` when available, bounded pure-JS fallback otherwise).

Both cap results so a search never floods context with raw output.
