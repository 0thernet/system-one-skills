# System One Skills

**Cut the test-log tokens your agent reads.**

One focused skill for **Devin, Claude Code, and Codex**: run a noisy test or build
command once, return its exit status and compact evidence, and keep the full log
locally for inspection. No model call, API key, or runtime dependency.

[Skills guide](https://sys1.io/skills) · [Source](https://github.com/0thernet/system-one-skills) · [SYS1](https://sys1.io)

```sh
system-one-skills check --timeout-ms 900000 -- bun test
```

## The value

Passing tests can produce thousands of repetitive lines. Sending those lines to
an agent consumes context even when its immediate job is simply to verify that
the command passed. This tool handles that mechanical work locally.

- **Less context:** long output becomes a short result with selected evidence.
- **The same check:** the complete command runs once with its original arguments
  and working directory. Its exit status reaches the calling agent.
- **Evidence stays available:** omitted output remains in a private local log.
  Read the relevant part when a failure, warning, or coverage question needs it.
- **Predictable cost:** a small deterministic program does the reduction. There
  is no summarizing model or additional model conversation.

Use native tools when their output is already short, when a built-in quiet mode
provides the required evidence, or when the task needs the detailed log itself.
The included skill routes only checks known from earlier runs to produce at least
**8 KiB**. Do not run a check twice merely to decide whether to use this tool.

## How it works

1. Execute the command once and capture stdout and stderr in a private log.
2. Pass short output through unchanged.
3. For long output, retain a bounded excerpt, disclose omissions, and print the
   log path. Compact only when the result is at least 50% and 4 KiB smaller.
4. Return the command's original exit code. Timeouts and capture failures are
   always reported, even when their explanation costs more output. An excerpt
   is never treated as a complete diagnosis.

This improves the handoff of verbose validation results. It does not alter the
check, judge code quality, replace repository gates, or promise that every task
uses fewer billed tokens.

## Measured admission

The [evidence report](https://github.com/0thernet/system-one-skills/blob/v0.4.0/docs/METRICS.md) replays **24 real completed Devin
validation excerpts**. Three meet the fixed 8 KiB size rule:

| Counted context | Tokens (`o200k_base`) |
| --- | ---: |
| Original output | 9,731 |
| Compact output | 931 |
| Skill loading, discovery, and added command text | 774 |
| **Net saved in these three cases** | **8,026** |

All three exceed a 128-token margin after the counted static overhead. The
21 short cases stay visible in the report: needlessly invoking the skill adds
258 tokens per case. That is why the skill routes short checks to native tools.

These are development measurements of successful noisy logs, not a provider
billing or whole-task result. The broader corpus includes real **Codex and Claude**
transcripts, but neither supplied eligible validation replays under the recorded
selection rules. Long failure handling is covered by regression tests and an
independent agent exercise; its real-world savings still need measurement.

The [admission report](https://github.com/0thernet/system-one-skills/blob/v0.4.0/research/admission-report.json) contains every case,
explicit limits, and source hashes. Future skills need paired task evaluation
that counts follow-up reads and rejects correctness regressions.

The package contains only `system-one-verify`. Additional skills need
real task evidence and a stronger result than the available native tool before
they belong in this collection.

## Install

Requires **Node.js 20+ on macOS or Linux**. Install the versioned package with npm:

```sh
npm install --global https://github.com/0thernet/system-one-skills/releases/download/v0.4.0/system-one-skills-0.4.0.tgz
```

The [immutable release](https://github.com/0thernet/system-one-skills/releases/tag/v0.4.0)
includes a SHA-256 checksum. Bun can install the same artifact.

Install the one skill in your agent's skill directory:

```sh
system-one-skills install-skills --target .agents/skills
```

For other registries, use the appropriate directory, such as `.claude/skills` or
`.devin/skills`. Existing modified skill files are never silently overwritten.

## Commands

```sh
system-one-skills check -- npm test
system-one-skills check --cwd ./project --timeout-ms 900000 -- npm run build
system-one-skills check --log ./check.log -- sh -c 'npm test && npm run lint'
```

Arguments after `--` go directly to the command. Use an explicit shell for pipes
or chained commands. Keep any required host scheduler outside this command.
`--log` reserves a new private file before execution and refuses to overwrite an
existing path. Commands are noninteractive, with a five-minute default timeout
(adjustable up to fifteen minutes) and a 64 MiB log limit. Exceeding a limit stops
the command and reports a failure; the log is marked incomplete when needed.
Cancellation first forwards the signal for cleanup, then escalates after a
bounded grace period. If inherited pipes cannot be drained, the result reports
`log_incomplete=true` and `cleanup_uncertain=true` instead of waiting indefinitely.
Default logs use a private temporary directory; delete them when
they are no longer needed. Logs stay local and can contain sensitive output.

## Why “System One”?

A System One skill gives an agent a small, bounded operation for a recurring
job. Here, ordinary code handles repetitive log processing so the coordinating
agent can spend its context on the task. [TypeSafe's introduction to System One
models and Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
is related background; this independent collection requires neither a model
backend nor a TypeSafe account.

## Related project: SYS1

[SYS1](https://sys1.io) provides typed model decisions for your application:
yes/no answers, choices, and scores across local models, hosted Jev, and
compatible servers. Use its Node/Bun client, embedded Bun router, or local
HTTP daemon. [View the SYS1 source](https://github.com/hraness/sys1).

System One Skills handles deterministic log reduction. It works without SYS1;
installing either project does not configure the other. The
[skills guide on sys1.io](https://sys1.io/skills) explains the workflow,
installation, and relationship between the projects.

## Development and assessment

```sh
bun install --frozen-lockfile
bun run check
bun bench/run-bench.ts
bun bench/assess-trials.ts private-observed-trials.json
```

The aggregate gate checks runtime behavior, skill footprint, evidence freshness,
privacy, and package contents. Synthetic cases test behavior; real transcript
replays measure the admitted handoff. Whole-task improvements require paired
runs that include follow-up reads, retries, quality, caching, and actual provider
usage. See the [assessment method](https://github.com/0thernet/system-one-skills/blob/v0.4.0/docs/METRICS.md) for the protocol. MIT licensed.
