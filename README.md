# System One Skills

**Cut the test-log tokens your agent reads.**

One focused skill for **Devin, Claude Code, and Codex**: run a noisy test or build
command once, return its exit status and compact evidence, and keep the full log
locally for inspection. No model call, API key, or runtime dependency.

[Skills guide](https://sys1.io/skills) · [Source](https://github.com/0thernet/system-one-skills) · [SYS1](https://sys1.io)

```sh
system-one-skills check --timeout-ms 900000 -- bun test
```

## Skill inventory

All eleven workflows are tracked below. **Only `system-one-verify` is currently
shipped.** The other entries are research candidates, not installable skills or
claims of proven savings. The [CI pilot](https://github.com/0thernet/system-one-skills/blob/main/docs/CI-PILOT.md)
found no established avoidable polling in its resolved sequences, so that
candidate stays out of the package. The [full catalog](https://github.com/0thernet/system-one-skills/blob/main/docs/SKILL-CATALOG.md)
records transcript coverage, native baselines, reliability requirements, and the
next experiment for each one.

| Skill | Job | Evidence / availability |
| --- | --- | --- |
| `system-one-verify` | Run noisy checks and retain compact evidence | Shipped; measured text savings on selected validation logs; bounded runtime contracts tested |
| `system-one-explore` | Bounded repository search and orientation | Candidate; must beat focused `rg` and selective file reads without missing relevant code |
| `system-one-ci` | Wait for one identified CI run | Candidate; must beat native `gh run watch` while preserving run identity and final status |
| `system-one-diff` | Bounded diff inspection or review | Candidate; must preserve relevant changes and count follow-up reads and missed findings |
| `system-one-digest` | Compact current Git state | Candidate; must beat a short native Git invocation without hiding state |
| `system-one-fetch` | Extract useful page text with provenance | Candidate; must preserve source evidence and beat existing bounded fetch tools |
| `system-one-research` | Assemble a multi-source evidence bundle | Candidate; needs source-quality, citation-completeness, and full-task cost evaluation |
| `system-one-triage` | Classify bounded code, research, or writing decisions | Candidate; needs labeled decisions, abstention checks, and all model costs counted |
| `system-one-writing` | Find concrete draft-quality issues | Candidate; needs author-approved labels and measured usefulness, not heuristic counts alone |
| `system-one-evolve` | Evaluate and select routing policies | Candidate; requires independent task-quality evidence including the entire search cost |
| `system-one` | Select an appropriate workflow | Candidate; routing and discovery overhead must earn their cost over direct selection |

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

## Tokens, reliability, and performance

These are separate claims. A smaller response is not evidence of faster task
completion or a more reliable answer.

| Dimension | Benefit being tested | Current evidence |
| --- | --- | --- |
| Token usage | Less text reaches the agent after skill, invocation, and retrieval costs | Real-log replay counts include static overhead; full-task and billing savings remain unmeasured |
| Reliability | Deterministic capture preserves command status and inspectable evidence | Runtime tests cover exact short output, private complete logs, failures, cancellation, and bounded capture; task-level reliability improvement is unproven |
| Performance | Less agent work after paying command-wrapper overhead | 140 synthetic native/wrapper pairs added **41.82 ms median / 48.37 ms p95** locally; model and end-to-end task latency remain unmeasured |

The wrapper adds local work. Its benefit is avoiding unnecessary model context
and repeated mechanical interpretation; it does not make the underlying tests
run faster. Compare against native quiet modes and bounded tools before adding
a skill. If the task needs the full output anyway, reduction can add cost.
The [runtime report](https://github.com/0thernet/system-one-skills/blob/main/docs/RUNTIME-EVIDENCE.md)
records the shared macOS/Node 24 environment, balanced run order, raw timings,
full-log checks, and 25 fault/contract tests. Those finite checks support the
documented behavior; they do not establish improved agent task success.

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
billing or whole-task result. These two calibration cohorts include real
**Codex and Claude** transcripts, but neither supplied eligible validation replays
under the recorded selection rules. Long failure handling is covered by regression tests and an
independent agent exercise; its real-world savings still need measurement.

The [admission report](https://github.com/0thernet/system-one-skills/blob/v0.4.0/research/admission-report.json) contains every case,
explicit limits, and source hashes. Future skills need paired task evaluation
that counts follow-up reads and rejects correctness regressions.

A [previously unused September 1–11 cohort](https://github.com/0thernet/system-one-skills/blob/main/docs/HOLDOUT.md)
adds **14 selected replays: two Claude and twelve Devin**. All were below the
8 KiB routing threshold. Invoking the wrapper anyway would add **3,612 estimated
tokens**; the recommended route is native execution. No preservation check failed,
but this cohort supplies **no additional evidence of noisy-log savings**. Codex
again supplied no eligible replay. This counterfactual charges first-use overhead
per case; catalog discovery can still cost tokens when an installed skill abstains.
We publish the negative result and selection gaps alongside the favorable
calibration results.

The package contains only `system-one-verify`. Additional skills need
real task evidence and a stronger result than the available native tool before
they belong in this collection.

## How a skill earns admission

“Provably good” needs a stated workload, baseline, and claim. Tests can establish
specific output contracts; empirical trials estimate savings and failure rates
on their recorded population. Neither proves every future task will improve.

1. **Find a repeated job in real transcripts.** Publish provider coverage and
   exclusions. Call frequency motivates an experiment; it is not savings.
2. **Freeze the comparison before measuring.** Record the skill/runtime hashes,
   representative native baseline, eligible tasks, and acceptance thresholds.
3. **Test correctness first.** Preserve required evidence, task success, failure
   handling, and quality. Count wrong routing and follow-up retrieval.
4. **Measure all costs.** Include discovery, loading, every model turn, retries,
   cache buckets, wall time, and local wrapper overhead. Report each metric
   separately, including regressions.
5. **Confirm on unused tasks.** Count independent task clusters, disclose
   uncertainty, and require held-out evidence before expanding claims. A sample
   used to fix a skill becomes development data.
6. **Publish and re-evaluate.** Keep failed cases and superseded results. Tie
   reports to source hashes and withdraw claims when the implementation changes.

See the [paired-task schema and admission rules](https://github.com/0thernet/system-one-skills/blob/main/bench/TRIALS.md),
[unused-cohort protocol](https://github.com/0thernet/system-one-skills/blob/main/research/holdout-protocol.json),
and [research log](https://github.com/0thernet/system-one-skills/blob/main/docs/RESEARCH-LOG.md).
Candidates join the default installation only after evidence supports their
specific use case; an attractive mechanism alone does not qualify them.

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
