# System One Skills

**System One skills for optimizing Devin, Claude Code, and Codex agents.**
`system-one-skills` moves repeated evidence gathering into bounded programs:
git summaries, test-log extraction, code search, CI polling, research collection,
and writing checks. Optional [Jev](https://typesafe.ai/) decisions add typed
classification and scoring. [ALGAL](https://github.com/hraness/algal) executes
the programs and records replayable receipts.

The aim is **lower total token use with the same task correctness**. That is a
hypothesis to test per workflow, not a property conferred by installing a skill.
Our assessment uses real, privately held **Devin, Claude, and Codex transcripts**,
reproducible reducer replays, adversarial checks, and a protocol for paired live
trials. [See the evidence and limits](docs/METRICS.md).

## What “System One” means here

A System One skill gives an agent a fast, bounded operation for a recurring job,
leaving open-ended reasoning with the coordinating agent. This collection has
three execution styles:

- **Deterministic programs:** no model calls inside the workflow. They gather,
  filter, and format evidence using ordinary tools.
- **Typed decisions:** bounded model calls return choices, scores, or
  probabilities. Jev is an optional backend.
- **Experimental router evolution:** propose and evaluate router manifests,
  with recorded promotion evidence.

TypeSafe introduced its **System One Models** terminology and Jev on
[September 15, 2026](https://typesafe.ai/blog/introducing-system-one-models-and-jev).
This is an independent skills collection. Its deterministic programs do not
need Jev, and a typed answer can still be wrong. No TypeSafe performance claim
is used as evidence for this package's savings.

## Install and run

Requires **Bun ≥ 1.3** and Git; code search also requires **ripgrep** (`rg`).
CI programs require an authenticated `gh` CLI. Install the skills from GitHub:

```sh
bunx skills add 0thernet/system-one-skills --all
```

Install the versioned package from the [GitHub release](https://github.com/0thernet/system-one-skills/releases/tag/v0.3.0):

```sh
bun add --global https://github.com/0thernet/system-one-skills/releases/download/v0.3.0/system-one-skills-0.3.0.tgz
system-one-skills list
system-one-skills run git-digest --args '{"src":{"cwd":"."}}'
system-one-skills run test-sift --args '{"src":{"cmd":"bun test","cwd":"."}}'
```

From a source checkout, `bun install --frozen-lockfile` then use
`bun bin/system-one-skills.js` in place of `system-one-skills`.
`install-skills --target .agents/skills` copies the eleven packaged skill folders
to a chosen registry. Args are keyed by input cell; `--args @args.json` also works.

`run` prints substantive output ports, execution status, and work counts. It
preserves structured error and truncation metadata; `--include-summary` adds
duplicate human-readable renderings. Save the larger receipt
separately when you need offline replay:

```sh
system-one-skills run git-digest --args '{"src":{"cwd":"."}}' --receipt receipt.json
system-one-skills verify receipt.json git-digest
```

Receipt creation refuses to overwrite an existing file. `--full-receipt` prints
the full record explicitly and costs more context. The underlying `.algal`
store is retained for existing receipt and champion compatibility.

## Which skills are useful?

All eleven skill definitions are checked against the packaged programs. The
following assessment separates an executable contract from demonstrated savings.

| Skill | Programs | Appropriate use and correctness boundary |
| --- | --- | --- |
| `system-one` | Catalog and dispatch | Entry point; loading it has a cost. Prefer direct commands for small one-off work. |
| `system-one-digest` | `git-digest` | Repository counts and recent history. A summary does not enumerate every changed file. |
| `system-one-diff` | `diff-slice`, `diff-review` | Bound a patch or triage it. Clipped evidence cannot establish a complete code review. |
| `system-one-verify` | `test-sift`, `release-gate` | Preserve command exit status, failure excerpts, and tails. Required checks still run in full. |
| `system-one-ci` | `ci-watch` | Select the current HEAD’s CI run and poll its fixed ID. One run does not cover all required checks. |
| `system-one-explore` | `repo-survey`, `search-slice` | Orientation and bounded matches. A truncated search is not an exhaustive caller map. |
| `system-one-fetch` | `web-fetch` | Fetch and clip text with provenance. Inspect omitted material when the answer depends on it. |
| `system-one-research` | `research-bundle`, `research-triage` | Gather sources; optional relevance triage. Clipping and failed sources limit conclusions. |
| `system-one-writing` | `writing-audit`, `writing-evaluate` | Mechanical style signals; optional scoring. Semantic editing needs the actual prose. |
| `system-one-triage` | Change/research/writing decisions | Experimental decision support. Scripted fixtures establish orchestration, not live judgment quality. |
| `system-one-evolve` | `router-habitat`, `router-live` | Experimental router optimization. Include generation/evaluation costs and separate held-out cases. |

`router` is the classifier used by the router family. `ci-check-inner` and
`hab-eval-inner` are supporting programs, bringing the catalog to **19**.
Deterministic workflows have no internal model calls; decision programs have
bounded model budgets. `list` shows budget ceilings, not guaranteed call counts.

**We cannot currently claim that all skills save tokens while maintaining
correctness.** Log reduction has directly testable exit-status invariants;
semantic review, research sufficiency, writing quality, and router evolution
need independent live evaluation. Full results and failure cases belong in the
[evidence report](docs/METRICS.md), including negative savings on short outputs.
The [runtime audit](docs/RUNTIME-AUDIT.md) records per-program regression evidence.
The eleven names/descriptions alone total **2,268 UTF-8 bytes** before harness
formatting; loading an individual skill adds its body. The
[skill footprint report](bench/report/skill-footprint.json) makes that overhead
visible. Avoid duplicate installations and load only the needed skill.

## Results from real transcripts

The fixed **September 12–18, 2026 UTC** window contains 103 contributing
session groups, after the documented branch selection and deduplication rules:

| Agent transcript source | Contributing session groups | Unique tool calls | Textual output fragments |
| --- | ---: | ---: | ---: |
| Codex | 44 | 229 | 258 |
| Claude Code | 21 | 30 | 36 |
| Devin CLI | 38 | 2,992 | 2,992 |

These groups are not user-task counts: a Codex execution group can contain
multiple agent threads. They describe retained evidence, not agent efficiency. Codex's
150 supplemental nested shell events are reported separately to avoid counting
the same execution layer twice. [Corpus report](research/session-report.json).

Twelve eligible **Devin** validation-log replays reduced 47,472 archived bytes
to 20,507 default CLI bytes (**56.8%** in aggregate). Four logs became smaller;
**eight became larger**. All twelve preserved the recorded exit code, pass/fail
result, emitted byte count, and applicable final-tail checks, including three
original failures. Codex and Claude had **zero eligible completed pure-validation
replays** under this cohort's strict selection rules; that is missing coverage,
not a passing result. [Replay report](research/replay-report.json).

This is a measured transformation of real excerpts, not measured provider-token
savings or proof that the original task could be completed from those excerpts.
Skill loading and follow-up reasoning are outside this replay measurement.

## Assess token savings without hiding correctness losses

1. **Find a real repeated job.** Analyze a fixed historical window from all three
   agent transcript formats. Count linked tool results and actual usage records;
   exclude forks, duplicate messages, and unsupported records explicitly.
2. **Replay the evidence safely.** Feed recorded tool text to the current reducer
   without executing archived shell commands. Measure the exact default CLI
   JSON, including flags and wrappers. Check invariants such as exit code and
   failure visibility. This proves a narrow transformation, not task completion.
3. **Run paired held-out tasks.** Give the same task, repository snapshot, model,
   and tool permissions to a native-tool baseline and a skill-enabled agent.
   Randomize order, isolate state, and score artifacts against a predefined rubric
   without revealing the arm to the reviewer. Include short inputs and failures.
4. **Count the whole task.** Include skill discovery/loading, invocation text,
   nested model calls, retries, omitted-evidence reads, repairs, and final checks.
   Separate uncached input, cache reads, cache writes, and output tokens; also
   record latency and actual provider cost. Never sum cumulative usage snapshots.
5. **Admit only useful results.** Reject task failures or quality regressions even
   when output is smaller. Report each provider/workflow independently, confidence
   intervals and negative cases. Repeat after relevant code, model, or skill changes.

```sh
python3 research/analyze_sessions.py --help
bun bench/run-bench.ts                 # synthetic execution/size checks
bun bench/skill-footprint.ts           # discovery and loading byte footprint
bun bench/assess-trials.ts private-observed-trials.json
bun run check                         # package, skills, tests, evidence freshness
```

The trial assessor rejects duplicate/unobserved records and quality regressions.
It needs at least 30 held-out pairs per skill/provider/model before returning an
adoption candidate; this is a screening minimum, not statistical certainty.
[Protocol, input schema, and caveats](docs/METRICS.md#paired-live-trials) explain
what still needs human or independent agent review. **No paired live savings
result is claimed in this release.**

## Optional Jev decisions

```sh
bunx algal auth jev
system-one-skills capabilities
system-one-skills run change-triage --args '{"src":{"cwd":"."}}'
```

ALGAL resolves credentials from its supported environment/vault/file custody.
Configured Jev is automatically eligible for classifier and typed `decide`
effects; `--executor jev[:model]` selects it explicitly. Inspect evidence before
using a live provider: a decision transmits its bounded context to that provider.
Fixed workflows continue to work without Jev. Use `diff-slice`,
`research-bundle`, or `writing-audit` when no decision backend is available.

Offline tests use `--executor scripted:responses.json`. Scripted answers verify
contracts and replay; their apparent accuracy is not evidence of Jev quality.
The experimental `evolve` command accepts `--cases`, `--generations`, and an
executor. Do not use router scores from the proposal's own training cases as
held-out accuracy or as an approval gate.

## Further skill classes

Candidate classes must start with recurring patterns in real transcripts.
The aggregate report distinguishes observed frequencies from proposed uses.
The main corpus contains 531 file-read calls and 215 repository-search calls,
plus 494 process-wait calls and 76 CI-status calls. These support investigating
symbol-scoped evidence and change-only watchers first. Coordination has 90 calls;
build/install has only five, so a new build-specific skill has weak support here.
Mixed or unknown shell calls need better attribution before reduction. Each candidate needs a
specific preservation contract: exact run/SHA identity, complete changed-match
sets, unresolved blockers and evidence references, or correct exit/error status.
Research synthesis and writing judgment require labeled outcomes in addition
to counts. Add a skill only when its measured avoided work exceeds discovery,
execution, and follow-up costs. [See the ranked evidence](docs/METRICS.md).

## Migration from algal-skills

The project is now **`system-one-skills`** and skill folders use `system-one-*`
(the umbrella skill is `system-one`). The new package retains `algal-skills`
and `algal-skills-tool` executable aliases for local integrations. Install the
new package explicitly; an old npm installation does not automatically upgrade
to the new project. Remove old installed skill copies only after checking that
they have no local edits, to avoid duplicate discovery overhead.

Existing `algal-*` skill references map to their `system-one-*` counterparts.
Use the renamed installed skills and runtime when older repository guidance
mentions the previous names.

The old default CLI printed a full receipt while its benchmark counted selected
summary fields. The historical **82.5%** figure therefore does not describe the
old default CLI or observed end-to-end token savings. This release fixes the
output contract and remeasures actual CLI bytes and nested executor envelopes.

## Execution and privacy

Programs execute reviewed tool implementations. Caller-supplied test and check
commands have the same effects and authority requirements as direct execution;
they can write files or call services. Keep repository scheduling and delivery
gates intact. The runtime writes a local store; evolution writes champion slots.
Receipts can contain commands, paths, and evidence, so keep them private.

Only aggregate transcript measurements ship. No raw prompts, conversation IDs,
source paths, or transcript text are included. The public source fingerprint
makes the synthetic benchmark stale when relevant code changes. Receipt replay
checks recorded execution consistency; it does not attest that an external
state or a model's judgment was correct.

## Development

```sh
bun install --frozen-lockfile
bun test tests/
bun bench/run-bench.ts
bun bench/skill-footprint.ts
bun run check
```

Public documentation and evidence analysis were authored and reviewed by agents;
no human review is implied. The repository owns the maintained evidence method.
Reassess when workflows or providers change. MIT licensed.
