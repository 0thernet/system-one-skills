# Where another skill might help—and where it probably will not

**Routine Git status is a poor target for another output-reduction skill. Search and diff need a narrow, proven use case. Native quiet test reporters deserve the first try.** These are decisions from a new analysis of retained transcripts and one current repository check; they are not measured savings from an additional skill.

## Start with the tool's own quiet mode

We ran this repository's existing 21-test assessment file unchanged under Bun 1.3.14's three native reporters. Each run returned **21 passed, 0 failed, 106 assertions and exit 0**.

| Native reporter | Output + invocation text tokens | Fewer than normal |
| --- | ---: | ---: |
| Normal | 466 | — |
| `--dots` | 55 | 411 (88.2%) |
| `--only-failures` | 59 | 407 (87.3%) |

No skill was involved. On this check, one native option removed most of the passing-test chatter. The check produced 2,029 bytes normally, so it was already below the shipped skill's 8 KiB routing threshold. **Use native quiet output when it preserves the evidence your task needs.** A wrapper is worth considering only after that comparison.

These are exact `o200k_base` counts for the captured strings, including each literal invocation. They are not billed tokens. This was one passing file with synthetic unit-test inputs, run once per mode in the disclosed order; its fixtures are not real agent-task observations. Matching aggregate test counts does not prove equivalent warning visibility, failure diagnosis, whole-task success or historical-project compatibility. We make no speed claim. [Protocol, commands, counts and source hashes](../research/candidate-native-report.json) · [Measurement code](../research/candidate_native.py).

The three successful historical logs behind the existing 82% headline show Bun test output. Bun's current help exposes both quiet options. Their effect on those original project snapshots has not been measured, so **82% remains a comparison with retained ordinary output, not evidence of beating Bun's quiet reporters**.

## How much room is there to save?

We tokenized every retained output for **960 real calls** in four candidate workflow categories: 26 Codex, 3 Claude Code and 931 Devin CLI calls. These reuse the September 12–19 discovery window; they are a retrospective screen, not a new holdout. Every selected call had at least one observed output fragment. The public report also retains empty provider/category cells rather than inventing coverage.

Before measuring, we fixed hypothetical per-use overhead budgets of 64, 128, 256 and 512 tokens and a required 128-token net benefit. Even deleting **all** output cannot meet the target when the original output contains less than overhead + 128 tokens. Deletion is not a correct implementation; this deliberately optimistic ceiling only rules out some output-reduction opportunities.

| Candidate scope | Real calls | Too little output at a hypothetical 64-token cost¹ | Too little output at a hypothetical 256-token cost¹ |
| --- | ---: | ---: | ---: |
| Explore: repository search | 573 | 326 (57%) | 396 (69%) |
| Digest: Git state | 224 | 181 (81%) | 211 (94%) |
| Diff: diff review | 68 | 35 (51%) | 40 (59%) |
| Fetch / research: web output² | 95 | 39 (41%) | 44 (46%) |

¹ Also requires a 128-token net margin. The assumed costs are not measured skill footprints and are not promises that such small implementations exist. A call above the ceiling has only mathematical room: it may need every output token for correctness. The screen covers output reduction alone, not possible savings from fewer reasoning turns or future calls.

² Fetch and research share one workflow proxy; this is not 95 independently verified tasks for each skill. Search/diff labels are heuristics and do not identify the original user intent. The source can contain prior truncation or metadata; no claim of complete original output is made.

Provider-specific output sizes show why a blanket skill would be difficult to justify:

| Workflow | Provider | Calls | Median output tokens | 90th percentile |
| --- | --- | ---: | ---: | ---: |
| Search | Codex | 18 | 125 | 1,379 |
| Search | Claude Code | 3 | 32 | 50 |
| Search | Devin CLI | 552 | 155 | 2,159 |
| Git state | Codex | 7 | 153 | 3,541 |
| Git state | Devin CLI | 217 | 96 | 284 |
| Diff | Codex | 1 | 3,611 | 3,611 |
| Diff | Devin CLI | 67 | 187 | 4,336 |
| Web output | Devin CLI | 95 | 487 | 2,475 |

There are no matched Claude Git/diff/web calls or Codex web calls in this window. Percentiles use nearest rank; a one-case percentile supplies no generalization. Counts sum separately tokenized model-visible output fragments per call. Missing later context, follow-up reads, private user intent, provider billing and whole-task latency remain unmeasured.

## What this changes

- **Digest stays deferred.** Git-state outputs are typically already short. We observed 78 explicit compact/targeted Git controls across the 224 Git-state calls. A new digest would need a demonstrated repeated multi-query task, not just shorter status text.
- **Explore needs a targeted experiment.** Most searches have too little output to pay even the smallest assumed cost and margin. Test larger, recurring location-finding tasks against native search with independently known answer locations; count pagination and missed matches.
- **Diff needs evidence preservation before compression.** A small number of large diffs provide room, but fewer lines cannot establish a correct review. A proper experiment must score missed findings and preserve every required changed-file/hunk location.
- **Fetch/research need source-fidelity tasks.** Output size leaves more potential room, but the current records do not establish removable boilerplate, correct extraction or supported answers. Inspect an authorized labeled question/source set before building a bundle.
- **CI, triage, writing, evolve and the umbrella router gain no efficacy claim from this screen.** CI retains its separate negative/inconclusive identity pilot. The others require concrete decision/task labels; generic output sizes cannot justify them. The [complete catalog](SKILL-CATALOG.md) retains their contracts and missing evidence.

We also identified 17 explicit search inventory/name/count controls and seven diff summary controls. Another 498 calls had unresolved literal-command parsing. These are observed controls, not audited best baselines: a flag may be inappropriate for a task, and an unrecognized command may already be optimal. No candidate is admitted by this analysis.

## Reproduction and integrity

The [locally recorded protocol](../research/candidate-protocol.json) predates token outcomes, but is not an independently timestamped preregistration. [The report](../research/candidate-report.json) includes opaque per-call token rows, all four overhead budgets, every provider/workflow cell, source hashes and exclusion counters. Its public gate recomputes aggregates and rejects duplicate cases, changed scope, malformed missing-output accounting and stale source/protocol hashes. It cannot independently prove private transcript authenticity.

Authorized reproduction requires the private corpus and pinned `tiktoken` 0.12.0. Collection follows the frozen analyzer's window, ancestry and deduplication semantics; the Devin adapter uses indexed read-only queries with a 120-second SQLite progress deadline. Nested Codex command telemetry is excluded to avoid double counting. Neither collector executes historical commands. Raw transcripts and captured test output stay outside the repository.

```sh
python3 research/candidate_screen.py --check
python3 research/candidate_native.py --check
# Authorized private reproduction, through the required host scheduler:
python research/candidate_screen.py --private-output ../private-evidence/candidate-measurements.json
python research/candidate_native.py --private-output ../private-evidence/candidate-native-output.json
```

The headroom screen is an early rejection filter. Admission still requires the [complete paired-task protocol](../bench/TRIALS.md): an audited native baseline, independent correctness, all usage and follow-up costs, adequate independent tasks, and measured latency. Preserving an unhelpful result is part of keeping the installed skill set useful.
