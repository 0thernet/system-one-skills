---
name: system-one-diff
description: Inspect or review the working diff as a byte-bounded slice. diff-slice returns stat plus a clipped patch (0 model calls); diff-review adds one structured verdict call with findings capped by schema.
allowed-tools: ["exec"]
---

# system-one-diff

Requires the `system-one-skills` runtime ([install](https://github.com/0thernet/system-one-skills#install-and-run)). If unavailable, use native tools or install when authorized.

Two programs for diff work:

- `diff-slice` — mechanical: `{"src":{"cwd":".","staged":false,"rev":"HEAD~3","max-bytes":24000}}`
  returns `stat` + a clipped unified diff with a truncated flag.
- `diff-review` — judgment: same args, then one bounded agent call returns
  `{"verdict":"pass|warn|fail","findings":[...≤6]}`. Needs an executor:
  `--executor gateway:anthropic/claude-sonnet-4` or `--executor scripted:resp.json`.

Use `diff-slice` when you will read the patch yourself; use `diff-review`
for triage. A schema-valid verdict over a clipped diff does not establish a
complete review. Inspect omitted files and relevant callers before approving
a change; charge that follow-up context to the assessment.
