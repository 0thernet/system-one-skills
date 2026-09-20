# Whole-task benchmark harness

The 3.94% diagnosis result is one exploratory pair. It cannot answer whether a
skill helps across the tasks and providers where it is meant to operate. The
current [verify scorecard](SCORECARD.md) has a larger replay result—35.20% less
presented text across 563 validation outputs—but it is still a text-boundary
measurement, not whole-task provider-token savings. This harness makes the
stronger question measurable without turning workflow frequency into a savings
claim.

## Workflow

1. Provider-specific adapters find bounded task episodes locally and label
   eligibility before outcome metrics are inspected. Raw prompts, commands,
   paths, and session IDs stay private.
2. `research/benchmark_manifest.py` validates candidate metadata and samples
   opaque episode IDs by provider, model, skill family, and predeclared stratum.
   Sampling is deterministic and records eligible-to-selected denominators and
   inclusion probabilities.
3. An adapter recreates each selected task on an immutable snapshot in two fresh
   sessions: the best native workflow and the frozen skill revision. It
   randomizes arm order, captures every attempt and follow-up, and records
   complete native usage through the final answer.
4. `bench/benchmark-harness.ts` validates paired observations and delegates
   metric assessment to the existing whole-task assessor. Codex, Claude Code,
   and Devin groups remain separate; their token counters are never pooled.

The harness does not launch provider sessions itself. Their session and usage
interfaces differ, and replaying an archived transcript would not be a
whole-task observation. Each adapter must produce the private observation
schema after a real, authorized run.

## Relevant task families

The protocol defines a selector and correctness rubric for all eleven names.
Examples of the current concrete selectors are:

- `system-one-verify`: explicit check with an exit status, balanced pass/fail,
  noisy and short-output cases, and expected failure evidence.
- `system-one-explore`: location-finding request followed by a relevant read or
  edit, with expected file/line locations frozen before evaluation.
- `system-one-ci`: one exact run and commit with repeated status observations;
  the current pilot does not provide enough avoidable polling.
- `system-one-diff`: fixed base/head review with labeled changed-file and hunk
  coverage.
- `system-one-fetch` and `system-one-research`: source extraction and distinct
  multi-source support tasks, never the generic web-call proxy.

Generic call counts are discovery evidence only. A provider with no eligible
episodes remains a missing stratum; another provider is not a substitute. The
retained corpus has useful Devin coverage but no eligible validation, CI, or web
strata for Codex and Claude in the discovery window, so it cannot support a
three-provider efficacy claim yet.

The harness emits provider-scoped scorecards and a coverage table showing which
providers share each task-family/snapshot stratum. It does not pool their token
deltas or manufacture a cross-provider effect when a provider is missing.

## Commands

```sh
python3 research/benchmark_manifest.py --check
python3 research/benchmark_manifest.py \
  --candidates /private/path/episode-candidates.json \
  --output /private/path/benchmark-selection.json \
  --seed system-one-benchmark-seed-v1 \
  --per-stratum 30
bun bench/benchmark-harness.ts \
  /private/path/benchmark-observations.json \
  /private/path/benchmark-report.json
```

Thirty independently audited task/session clusters are required for each
declared provider/model/family scope before adoption. Start with up to 12
clusters per represented stratum as a discovery screen; keep its negatives and
do not call it efficacy evidence. Only surviving strata proceed to confirmation.
The scorecard should lead with eligible episodes, matched
pairs, provider/model scope, native baseline, total-token delta, correctness,
elapsed time, and the decision. Percentages are provider-scoped; no headline
combines Codex, Claude, and Devin usage. Operation counts are separated by arm
and labeled as raw-row totals; the assessor's independent-cluster grouping is
authoritative for adoption screens.
