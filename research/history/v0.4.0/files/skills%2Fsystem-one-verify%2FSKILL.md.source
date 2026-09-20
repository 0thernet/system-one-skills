---
name: system-one-verify
description: Run known noisy tests or builds with compact output. Use for pass/fail checks expected to emit at least 8 KiB; use native tools for short output or detailed log analysis.
---

Run an authorized validation command once:

```sh
system-one-skills check --timeout-ms 900000 -- bun test
```

Requires Node 20+ and the [runtime](https://github.com/0thernet/system-one-skills#install). If unavailable, use native tools. Keep any required host scheduler outside this command.

Choose this only when earlier runs establish verbose output and the task needs the exit status. Short output passes through unchanged. The runtime preserves the command's exit code and reduces long output without model calls.

Omissions are explicit; the complete local log is retained at the printed path. Inspect it when warnings, coverage, or failure diagnosis matter. Do not infer complete diagnostic coverage from an excerpt, or rerun a command merely to retrieve omitted output.
