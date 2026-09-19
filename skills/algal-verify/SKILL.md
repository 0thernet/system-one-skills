---
name: algal-verify
description: Run the project's test or release-gate commands inside a bounded tool call and read only the verdict, extracted failure lines, and a tail — not the raw log. Covers test-sift and release-gate.
argument-hint: "<cmd> | test+lint+typecheck+build"
allowed-tools: ["exec"]
---

# algal-verify

- `test-sift`: `{"src":{"cmd":"bun test","cwd":".","timeout-ms":300000}}`
  → `{code, timed_out, category, failures[≤40], tail, output_bytes}`.
  Category classifies failures as build/lint/type/test/timeout/other.
- `release-gate`: up to four stage commands in one call:
  `{"src":{"cmd-test":"bun test","cmd-lint":"bun run lint","cmd-typecheck":"tsc --noEmit","cmd-build":"bun run build","cwd":"."}}`
  → per-stage `{name, code, skipped, tail}`, `passed`, `failed_stage`.

Both keep the full command output inside the tool boundary; only the sifted
report is returned. Use instead of running the commands and paging the log.
