---
name: algal-diff
description: Inspect or review the working diff as a byte-bounded slice. diff-slice returns stat plus a clipped patch (0 model calls); diff-review adds one structured verdict call with findings capped by schema.
argument-hint: "[--cwd dir] [--staged] [--rev <rev>] [--max-bytes N]"
allowed-tools: ["exec"]
---

# algal-diff

Two programs for diff work:

- `diff-slice` — mechanical: `{"src":{"cwd":".","staged":false,"rev":"HEAD~3","max-bytes":24000}}`
  returns `stat` + a clipped unified diff with a truncated flag.
- `diff-review` — judgment: same args, then one bounded agent call returns
  `{"verdict":"pass|warn|fail","findings":[...≤6]}`. Needs an executor:
  `--executor gateway:anthropic/claude-sonnet-4` or `--executor scripted:resp.json`.

Use `diff-slice` when you will read the patch yourself; use `diff-review`
when you want the verdict without loading the whole diff into context.
