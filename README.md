# System One Skills

**Keep noisy test logs out of your agent’s context.**

A focused skill for **Devin, Claude Code, and Codex**. Run a verbose test or build
once, give the agent a compact result, and keep the full log locally for inspection.
No model call, API key, or runtime dependency.

[Skills guide](https://sys1.io/skills) · [Source](https://github.com/hraness/system-one-skills) · [SYS1](https://sys1.io)

## 82% fewer tokens for noisy check results

In an initial replay of **three successful Devin logs**, including counted skill
overhead.[^1]

**9,731 tokens of logs → 1,705 tokens of results and skill overhead**

- **More room for the task.** Repetitive test output takes up less agent context.
- **Run the check once.** Return its exit status, or report a timeout or
  capture failure.
- **Full evidence when needed.** The private local log remains available for
  warnings, coverage questions, and diagnosis.

Use it for checks you already know produce long logs. Choose native tools when
output is short, a useful quiet mode exists, or you need the full log anyway.[^2]

```sh
system-one-skills check --timeout-ms 900000 -- bun test
```

## Install

Requires **Node.js 20+ on macOS or Linux**.

```sh
npm install --global https://github.com/hraness/system-one-skills/releases/download/v0.4.0/system-one-skills-0.4.0.tgz
system-one-skills install-skills --target .agents/skills
```

The [versioned release](https://github.com/hraness/system-one-skills/releases/tag/v0.4.0)
includes a SHA-256 checksum. Bun can install the same artifact. Use your agent’s
skill directory, such as `.claude/skills` or `.devin/skills`, where appropriate.
Existing modified skill files are never silently overwritten.

## How it works

1. **Run once.** Execute the original command and capture its output locally.
2. **Return a compact result.** Keep the exit status and selected evidence,
   disclose omissions, and print the full log’s location.
3. **Inspect only when needed.** Open the log for details the excerpt cannot answer.

The skill selects checks known from earlier runs to produce at least **8 KiB**.
Short output passes through unchanged; long output is reduced only when it is at
least 50% and 4 KiB smaller. Do not run a check twice just to measure its size.
Timeouts and capture problems are reported as failures. Required repository gates
still apply. Tested preservation behavior and local processing cost are documented
in the [results notes](https://github.com/hraness/system-one-skills/blob/main/docs/RESULTS.md).

## All skills

**One shipped skill. Ten research candidates.** Only `system-one-verify` is
installed. The others need evidence of a benefit over native tools before they
join the package.

| Skill | Purpose | Status |
| --- | --- | --- |
| `system-one-verify` | Compact noisy check results | Shipped |
| `system-one-explore` | Repository search | Research |
| `system-one-ci` | CI monitoring | Research |
| `system-one-diff` | Scoped diff review | Research |
| `system-one-digest` | Repository-state summaries | Research |
| `system-one-fetch` | Readable page extraction | Research |
| `system-one-research` | Source evidence bundles | Research |
| `system-one-triage` | Bounded decision routing | Research |
| `system-one-writing` | Mechanical draft checks | Research |
| `system-one-evolve` | Routing-policy evaluation | Research |
| `system-one` | Skill selection | Research |

The [full catalog](https://github.com/hraness/system-one-skills/blob/main/docs/SKILL-CATALOG.md)
explains the proposed benefit, native alternative, and evidence needed for each.
The [research log](https://github.com/hraness/system-one-skills/blob/main/docs/RESEARCH-LOG.md)
publishes positive and negative findings. New skills must save tokens on complete
tasks while meeting correctness and latency requirements.

<a id="commands"></a>

<details>
<summary><strong>Commands and operating limits</strong></summary>

```sh
system-one-skills check -- npm test
system-one-skills check --cwd ./project --timeout-ms 900000 -- npm run build
system-one-skills check --log ./check.log -- sh -c 'npm test && npm run lint'
```

Arguments after `--` go directly to the command. Use an explicit shell for pipes
or chained commands. Keep any required host scheduler outside this command.
`--log` reserves a new private file and refuses to overwrite an existing path.

Commands are noninteractive, with a five-minute default timeout, adjustable up
to fifteen minutes, and a 64 MiB log limit. Exceeding a limit stops the command
and reports a failure; incomplete capture is disclosed. Cancellation forwards
the signal for cleanup, then escalates after a bounded grace period. Undrained
inherited pipes produce `log_incomplete=true` and `cleanup_uncertain=true`.
Default logs use a private temporary directory. They may contain sensitive output;
delete them when no longer needed.

</details>

## Why “System One”?

A System One skill handles a small recurring operation so the coordinating agent
can use its context for the task. Here, ordinary code processes repetitive logs.
[TypeSafe’s introduction to System One models and Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
is related background; this collection needs no model backend or TypeSafe account.

[SYS1](https://sys1.io) is the related decision interface for applications: typed
yes/no answers, choices, and scores across local models, hosted Jev, and compatible
servers. System One Skills works independently; installing either project does
not configure the other. [SYS1 source](https://github.com/hraness/sys1).

[^1]: **Early text-replay result, not whole-task or billing savings.** Three noisy
    successful logs qualified from 24 Devin development replays. Their 9,731 tokens
    became 931 output tokens plus 774 counted skill, discovery, and invocation
    tokens. `(9,731 − 1,705) / 9,731 = 82.48%`, rounded to 82%. Counts use
    `o200k_base`; retries, later log reads, and complete agent usage were not
    measured. These examples helped tune the implementation.
    [Calculation and limits](https://github.com/hraness/system-one-skills/blob/main/docs/RESULTS.md).

[^2]: **Short checks can cost more.** The 21 short development replays and 14
    selected replays from an unused Claude/Devin cohort did not qualify. Wrapping
    them adds instruction overhead without reducing their output. Installing a
    skill can also add catalog overhead on tasks that never use it. Faster task
    completion and better task success remain unproven.
    [Negative results](https://github.com/hraness/system-one-skills/blob/main/docs/HOLDOUT.md).

<details>
<summary><strong>Development and assessment</strong></summary>

```sh
bun install --frozen-lockfile
bun run check
bun bench/run-bench.ts
bun bench/assess-trials.ts private-observed-trials.json
```

The aggregate gate checks runtime behavior, skill footprint, evidence freshness,
privacy, and package contents. The [trial protocol](https://github.com/hraness/system-one-skills/blob/main/bench/TRIALS.md)
requires a strong native baseline, unused tasks, complete token accounting,
independent correctness evaluation, and measured completion time. Correctness
or material latency regressions block adoption. Synthetic tests check behavior;
real transcript replays measure text reduction. MIT licensed.

</details>
