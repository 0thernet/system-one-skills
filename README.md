# System One Skills

**Give your agent the check result, with the full log one read away.**

A focused skill for **Devin, Claude Code, and Codex**. Run a verbose test or build
once, give the agent a compact result, and keep the full log locally for inspection.
No model call, API key, or runtime dependency.

[Skills guide](https://sys1.io/skills) · [Source](https://github.com/hraness/system-one-skills) · [SYS1](https://sys1.io)

## When it earns its place

- **More room for the task.** Repetitive test output takes up less agent context.
- **Run the check once.** Return its exit status, or report a timeout or
  capture failure.
- **Full evidence when needed.** The private local log remains available for
  warnings, coverage questions, and diagnosis.

Use it for checks you already know produce long logs. Choose native tools when
output is short, a useful quiet mode exists, or you need the full log anyway.[^2]
The practical benefit is less repetitive output with an explicit result and a
retrievable log. Better task success and faster completion have not been shown.

```sh
system-one-skills check --timeout-ms 900000 -- bun test
```

## What the numbers mean

| Result | What was compared | What it establishes |
| --- | --- | --- |
| **82% smaller initial results** | Three successful historical Devin logs: 9,731 text tokens → 1,705 including counted skill overhead | Less log text in these development replays; native quiet reporters were not tested on the original tasks.[^1] |
| **3.9% fewer recorded tokens; 9.3 seconds longer** | One completed Codex diagnosis: 49,803 → 47,840 input + output tokens; both answers scored 6/6 | Fewer recorded tokens in the skill arm, with a longer run; no general reliability or speed advantage.[^3] |
| **88% less text using Bun's own quiet reporter** | One current 21-test fixture: 466 → 55 output + invocation tokens with `--dots` | A native alternative worth trying first. No skill was involved; this is a synthetic fixture, not the historical logs or a complete agent task.[^4] |

These percentages measure different things and must not be combined. The 82%
figure measures an initial result; the 3.9% figure includes the completed
diagnosis and its follow-up reads. The comparison that ultimately matters is a
correct completed task against the best practical native workflow.

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

| Skill | Potential benefit | What to use today |
| --- | --- | --- |
| `system-one-verify` | Read less repetitive check output while retaining the exit status and full log | **Available:** known noisy pass/fail checks when native quiet output is inadequate |
| `system-one-explore` | Find matching code and relevant lines in fewer reads | Focused native search; research must prove it preserves required locations |
| `system-one-ci` | Avoid repeated model check-ins while CI runs | Native run watching; our pilot established no avoidable polling |
| `system-one-diff` | Read large changes with explicit review coverage | Scoped native diffs; research must measure missed findings |
| `system-one-digest` | Collect the repository facts a task needs together | Native Git status; most observed outputs were already too small to justify another layer |
| `system-one-fetch` | Extract the source passage needed for an answer | The agent's readable-page tool; extraction accuracy and extra savings are unproven |
| `system-one-research` | Keep source evidence together and avoid duplicate reads | Native search and targeted reads; no separate benefit demonstrated |
| `system-one-triage` | Handle a recurring decision with a cheaper, accurate process | Deterministic rules or the primary agent; no evaluated decision family yet |
| `system-one-writing` | Find mechanical draft issues cheaply | Existing linters; inactive until there is relevant task evidence |
| `system-one-evolve` | Improve a useful routing policy over repeated use | A fixed reviewed policy; inactive until optimization can repay its cost |
| `system-one` | Choose the smallest useful skill | Direct selection; an extra router is unjustified for one available skill |

The [full catalog](https://github.com/hraness/system-one-skills/blob/main/docs/SKILL-CATALOG.md)
explains the proposed benefit, native alternative, and evidence needed for each.
The [research log](https://github.com/hraness/system-one-skills/blob/main/docs/RESEARCH-LOG.md)
publishes positive and negative findings. New skills must save tokens on complete
tasks while meeting correctness and latency requirements.

Recent analysis covers [a real failed check](https://github.com/hraness/system-one-skills/blob/main/docs/FAILURE-EVIDENCE.md)
and [outputs from 960 calls plus native reporter alternatives](https://github.com/hraness/system-one-skills/blob/main/docs/CANDIDATE-EVIDENCE.md).
The failure summary saved tokens but needed the full log for some details;
the candidate analysis gives us reasons to keep the install small.
A [live Codex diagnosis comparison](https://github.com/hraness/system-one-skills/blob/main/docs/DIAGNOSIS-RESULTS.md)
also counts follow-up reads and keeps failed setup attempts in the evidence record.

We are prioritizing **more useful failure excerpts** and **focused search with
needed source lines** over a larger catalog. Both must beat the corresponding
native workflow on total tokens, correctness and completion time before a new
capability earns a place in the package. The [catalog's research priorities](https://github.com/hraness/system-one-skills/blob/main/docs/SKILL-CATALOG.md#next-experiments)
explain the specific evidence gaps.

The [whole-task benchmark harness](https://github.com/hraness/system-one-skills/blob/main/docs/BENCHMARK-HARNESS.md)
is now the path to stronger claims: it selects relevant task episodes before
outcomes, pairs each skill with the best native workflow, and reports Codex,
Claude Code, and Devin separately. The current 3.9% diagnosis result remains
one exploratory pair until that process produces held-out matched tasks; the
harness itself has no efficacy result yet.

A new [screen of 1,200 real file reads](https://github.com/hraness/system-one-skills/blob/main/docs/CANDIDATE-OPPORTUNITIES.md)
also argues against adding a generic read-reuse skill. Exact repeats accounted
for only **1.1% of read-output text**, before instructions or freshness checks.
That is an optimistic opportunity ceiling, not a measured saving.

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
    measured. These examples helped tune the implementation. Native quiet
    reporters were not compared on those historical tasks.
    [Calculation and limits](https://github.com/hraness/system-one-skills/blob/main/docs/RESULTS.md).

[^2]: **Short checks can cost more.** The 21 short development replays and 14
    selected replays from an unused Claude/Devin cohort did not qualify. Wrapping
    them adds instruction overhead without reducing their output. Installing a
    skill can also add catalog overhead on tasks that never use it. Faster task
    completion and better task success remain unproven.
    [Negative results](https://github.com/hraness/system-one-skills/blob/main/docs/HOLDOUT.md).

[^3]: **One observed diagnosis, not a qualification cohort.** One historical
    Devin failure was diagnosed by Codex in two fresh sessions, reduced first
    and native second. The skill arm made four reads versus three and took
    37.974 seconds versus 28.625 seconds from launcher start to exit. Cache
    effects were uncontrolled; the model checkpoint and ambient instructions
    were not fully attested. A blinded rubric scored both answers 6/6. Failed
    setup attempts add evaluation cost and are not subtracted from these arms.
    [Complete results and limitations](https://github.com/hraness/system-one-skills/blob/main/docs/DIAGNOSIS-RESULTS.md).

[^4]: **A current native control, not skill efficacy.** Each reporter returned
    21 passed tests, 0 failed, 106 assertions and exit 0 in one run per mode.
    Matching totals do not establish equivalent warning visibility or failure
    diagnosis. Text counts use `o200k_base`, not provider billing.
    [Native baseline and candidate screen](https://github.com/hraness/system-one-skills/blob/main/docs/CANDIDATE-EVIDENCE.md).

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
