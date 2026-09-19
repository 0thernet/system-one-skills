---
name: system-one-verify
description: Run the project's test or release-gate commands inside a bounded tool call and read only the verdict, extracted failure lines, and a tail — not the raw log. Covers test-sift and release-gate.
allowed-tools: ["exec"]
---

# system-one-verify

Requires the `system-one-skills` runtime ([install](https://github.com/0thernet/system-one-skills#install-and-run)). If unavailable, use native tools or install when authorized.

- `test-sift`: `{"src":{"cmd":"bun test","cwd":".","timeout-ms":300000}}`
  → `{code, timed_out, category, failures[≤40], tail, output_bytes, output_truncated, tail_truncated}`.
  Category classifies failures as build/lint/type/test/timeout/other.
- `release-gate`: up to four stage commands in one call:
  `{"src":{"cmd-test":"bun test","cmd-lint":"bun run lint","cmd-typecheck":"tsc --noEmit","cmd-build":"bun run build","cwd":"."}}`
  → per-stage `{name, code, skipped, tail}`, `passed`, `failed_stage`.

Both execute the complete command, then return a bounded report. Long logs
retain only a suffix, so early diagnostics may need a follow-up read. Use this
when repeated or large logs justify overhead; a short native result can cost less.
Preserve repository-required command sequences and host scheduling.
