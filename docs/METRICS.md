# Evidence for System One Skills

The release separates **observed workload**, **reducer behavior**, and **task
outcomes**. Smaller tool output is useful only when the complete task costs
less and still meets its correctness criteria. No live paired task-savings
claim is made for this release.

## What the real transcripts establish

`research/analyze_sessions.py` analyzes a fixed historical window from local
Devin, Claude Code, and Codex records. The public
[aggregate report](../research/session-report.json) includes provenance,
selection rules, excluded/unsupported records, usage semantics, and workflow
opportunities. The [parser methodology](../research/METHODOLOGY.md) documents
provider differences. Raw records remain private.

The earlier analysis was inadequate: Claude was absent; cumulative or repeated
usage and forked records could inflate totals; output attribution confused
some parallel tool calls; and the Devin JSON export could lag its active
SQLite conversation. The new report replaces those totals. This is a
single-user convenience sample, not representative traffic across providers.
A provider or workflow with little evidence remains underqualified.

Observed tool frequency and bytes identify opportunities. They do not prove
those outputs were wasteful, that the agent could have skipped them, or that
the skill would complete the task. Shell-command classification is deliberately
conservative; unrecognized commands remain unknown.

### Current measured cohort

| Provider | Session groups with selected evidence | Calls | Output fragments | Unique usage responses |
| --- | ---: | ---: | ---: | ---: |
| Codex | 44 | 229 | 258 | 6,807 |
| Claude Code | 21 | 30 | 36 | 57 |
| Devin CLI | 38 | 2,992 | 2,992 | 2,845 |

Codex session groups use the recorded execution/session ID and can contain many
agent threads; distinct observed usage-thread counts are reported separately.
These groups are not a count of user tasks. The separate Codex supplemental view
contains 150 completed nested shell events;
it is not added to the outer tool-call/output view. Usage-response counts include
responses without tool calls and have provider-specific coverage.

## Real-output replay

A replay feeds recorded output through the current reducer without executing
the original command. The check compares:

- original visible output bytes;
- exact default CLI JSON bytes, including structured reports and completeness metadata;
- observed exit status against the returned exit status;
- retained failure markers where they occur in the inspected output;
- negative savings, exclusions, and missing evidence.

The replay is a counterfactual transformation of real text. It does not recover
unrecorded logs, undo original tool truncation, measure the agent's next decision,
or measure provider billing. Excerpts can omit the root cause; a failure flag
must remain a failure even when its diagnosis needs a follow-up read.

The current replay report contains twelve Devin cases from 25 eligible completed
validation outputs: 47,472 archived bytes → 20,507 default CLI bytes, a 56.8%
aggregate reduction. Four cases shrink and eight grow; all twelve preserve the
checked invariants, with three nonzero original exits. Codex and Claude have no
eligible completed pure-validation samples in this window, so their replay
coverage is zero. [Full numeric cases](../research/replay-report.json).

## Synthetic execution benchmark

`bun bench/run-bench.ts` rebuilds deterministic fixtures and regenerates
[bench-report.json](../bench/report/bench-report.json). Its source fingerprint
covers the runner, CLI, tools, manifests, dependency lockfile, and fixtures;
`bun run check` rejects a stale report.

For each row:

- `baseline_context_bytes`: bytes from the stated raw-output baseline;
- `cli_stdout_bytes`: **exact** default compact CLI JSON plus newline (derived prose is optional);
- `model_request_envelope_bytes` and `model_response_envelope_bytes`: serialized
  request/result envelopes observed at every executor call, including children;
- `system_one_context_bytes`: sum of those three values;
- `full_receipt_bytes`: the larger optional receipt, reported separately;
- `agent_calls` and `work_units`: observed execution receipt counts;
- `est_*_tokens = ceil(bytes/4)`: coarse byte proxies, never tokenizer counts.

Request envelopes include local contract metadata and are not exact provider
wire messages. Synthetic baselines omit a native agent's reasoning and may
already be reducible with a short ordinary shell command. They are fixture
comparisons, not a fair randomized end-to-end agent experiment. The benchmark
uses no live model calls.

The CI row assumes five polls and uses a stub. Router rows assume repeated
2.8 KB documentation reads and supply the correct labels to a scripted executor.
That validates the evaluation machinery, not routing accuracy. Typed review,
research, and writing decisions likewise use scripted answers. A clipped diff
is not equivalent evidence for a full review. There is no valid single overall
“quality-preserving savings” percentage to infer by pooling these tasks.

The historical 82.5% headline counted selected interface fields while the CLI
printed a full receipt. It also favored large noisy fixtures. That number is
retired as a description of default behavior. Short outputs can get larger
once metadata and skill overhead are included; publish those losses too.

## Discovery and loading overhead

`bun bench/skill-footprint.ts` measures each skill file and its name/description
bytes separately. The current eleven names/descriptions total 2,268 UTF-8 bytes,
before any harness wrappers. Bodies are loaded selectively; counting every body
as present would exaggerate normal overhead. Conversely, duplicate installed
copies can repeat discovery metadata. Neither byte figure is a tokenizer or
cache measurement. Charge the actual discovered/loaded content to live trials.

## Paired live trials

Use this protocol before recommending a skill as a default optimization:

1. Freeze a task set from historical transcripts before choosing caps or prompts.
   Include ordinary short outputs, Unicode/path edge cases, failing checks,
   timeout/cancellation, incomplete search, and missing evidence. Keep related
   tasks from the same session in one split to prevent leakage.
2. State a task-specific oracle: exact test results; required failure diagnosis;
   complete caller set; independently labeled research conclusions; or an
   editorial rubric. Syntax/schema/replay validity alone cannot be the oracle.
3. Run baseline and skill arms on equivalent clean snapshots with the same model,
   tool permissions, and budget. Randomize arm order; isolate stores and side
   effects. Record cache conditions and provider versions. Do not replay
   historical mutating commands against a live repository or account.
4. Record every model request through task completion. Count skill discovery and
   loading, tool argument text, nested calls, retries, escalation, follow-up reads,
   repairs, and final validation. Normalize provider tokens into disjoint buckets:
   uncached input, cache reads, cache writes, and output. Missing counts are
   unknown, never zero. Keep actual cost and wall-clock latency separately.
5. Blind the reviewer to the arm where possible. Preserve task pass/fail, critical
   errors, a predefined 0–1 quality score, and evidence pointers privately. Include
   failed and abandoned runs in the report, with failure causes.
6. Analyze paired differences per skill/provider/model. Use session-clustered
   confidence intervals when tasks share a conversation. Require no material
   correctness regression and positive savings after all overhead. Inspect the
   worst cases; a positive average can conceal unacceptable failures.

The supplied screening command accepts a private JSON array:

```sh
bun bench/assess-trials.ts private-observed-trials.json
```

Each record has the following shape (numbers here are **illustrative schema
values**, not an observed trial):

```json
{
  "id": "opaque-pair-id",
  "skill": "system-one-verify",
  "provider": "codex",
  "model": "exact-model-version",
  "snapshot": "repository-tree-or-fixture-digest",
  "evidence": "observed",
  "held_out": true,
  "all_overhead_included": true,
  "baseline": {
    "tokens": {"uncached_input": 500, "cached_input": 2000, "cache_write_input": 0, "output": 100},
    "task_pass": true, "critical_errors": 0, "quality": 1
  },
  "skill_arm": {
    "tokens": {"uncached_input": 450, "cached_input": 2000, "cache_write_input": 0, "output": 100},
    "task_pass": true, "critical_errors": 0, "quality": 1
  }
}
```

The assessor validates structure and rejects duplicate pairs, unobserved
records, task failures, critical errors, and quality regressions. It requires
30 held-out pairs per group and a positive approximate normal 95% lower bound
on mean token savings before returning `candidate-for-adoption`. The input's
labels and overhead declarations still need evidence; a JSON flag cannot
attest completeness. The normal interval is a screening aid, unsuitable for
strongly skewed or correlated small samples. Use cluster bootstrap or an
appropriate paired test for publication. The command does not compare dollars
or latency and does not claim cross-provider token equivalence.

## Admission status and additional classes

The [README skill table](../README.md#which-skills-are-useful) lists every skill's
preservation boundary. Manifest admission, focused regression tests, and real
output replays support executable behavior. Live semantic decision quality and
end-to-end savings remain unqualified.

Prioritize new classes using provider-specific workflow counts in the aggregate
report. The outer three-provider view contains 531 file reads (1,708,162 output
bytes), 215 repository searches (305,635 bytes), 494 process waits (1,378,914 bytes),
76 CI-status calls (116,355 bytes), and 90 coordination calls (29,892 bytes).
Pure validation accounts for 52 calls (88,342 bytes); mixed shell accounts for
860 calls and unknown shell for 449, so instrumentation gaps remain substantial.
Only five build/install calls support the specialized-build candidate. These
are opportunity counts, not avoidable-token totals. The candidate is an interpretation:

| Observed workflow family | Candidate System One skill | Required oracle before admission |
| --- | --- | --- |
| Repeated CI/PR inspection | State-change digest tied to immutable run and SHA | Same terminal state, failures, and required-check coverage; no missed transitions |
| Repeated repository reads/search | Incremental search/map refresh | Complete changed match set and explicit invalidation after file or query changes |
| Agent coordination output | Bounded handoff/status packets | Preserve blockers, ownership, unresolved findings, and evidence references |
| Test/build execution | Structured failure classification | Preserve exit status and critical diagnostics; count any follow-up reads |
| Web/research evidence | Deduplication and relevance prefilter | Held-out relevance/contradiction recall with original source access |
| Writing/editing | Mechanical audit, then optional typed prioritization | Detect labeled issues without changing meaning; semantic scores need blinded review |

A candidate with sparse or absent observed support stays a hypothesis. Do not
create a new skill merely because a large context dump exists: measure whether
a native tool, narrower query, or existing skill already solves that job more
cheaply. Router evolution additionally needs amortization: all proposal and
evaluation tokens must be recovered by later held-out routing wins.

## Reproduce and maintain

Run `python3 research/analyze_sessions.py --help` for provider input and fixed
window options. Keep local corpus roots and any replay inputs outside the public
repository. Rebuild synthetic measurements after relevant source changes, then
run the package gate. A different private corpus will produce different totals;
public parser fixtures verify interpretation without distributing conversations.

Evidence and documentation owner: this repository. Analysis/review: agents,
2026-09-19; no human or provider attestation is implied. Reassess on material
runtime, model, input-distribution, or skill changes. Token optimization is an
empirical outcome, not an installation guarantee.
