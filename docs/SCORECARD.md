# Numeric scorecard

The number people should use first is the reduction in text presented to the
agent for the task family the skill actually handles. A percentage is only a
claim when its denominator, provider scope, and preservation checks are shown.

## `system-one-verify`

| Scope | Complete outputs | Long outputs compacted | Text shown before | Text shown after | Reduction | Preservation failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex | 356 | 13 | 688,245 bytes | 463,552 bytes | **32.65%** | 0 |
| Claude Code | 0 | 0 | — | — | **No result** | — |
| Devin | 207 | 15 | 475,349 bytes | 290,454 bytes | **38.90%** | 0 |
| **All observed providers** | **563** | **28** | **1,163,594 bytes** | **754,006 bytes** | **35.20%** | **0** |

Among the 28 outputs that crossed the compaction guard, the reduction was
**90.61%**. The all-output number is the useful headline: 535 short outputs
passed through unchanged, so the skill does not claim savings on work where
native output is already compact.

These are UTF-8 text bytes at the tool-result boundary. They are not billed
tokens or complete agent-task usage. The repository currently has **no verified
whole-task provider-native token-reduction percentage** for any skill. That
requires fresh, paired native-versus-skill sessions with the provider's usage
counters, a frozen correctness rubric, and a latency check. The scorecard keeps
that field explicitly unclaimed rather than translating bytes into a made-up
token number.

The source is a private, one-developer convenience corpus from 12–20 September
2026. Only the aggregate counts and a digest of the private replay are public;
commands, prompts, paths, outputs, and session IDs remain private. Recreate the
public aggregate with:

```sh
python3 research/score_verify_replay.py PRIVATE_REPLAY.json research/verify-current-report.json
python3 research/score_verify_replay.py --check
```

## Every other catalog entry

The remaining names are research candidates, not shipped skills. They have no
executable adapter and therefore no percentage reduction. Workflow-call counts
can show that a task family exists, but they cannot show that a replacement is
cheaper or correct. A candidate enters this table only after a matched native
baseline, an executable frozen revision, and a complete whole-task result.

| Candidate | Numeric reduction | Why it remains out |
| --- | --- | --- |
| `system-one-explore` | **No result** | No paired location-finding tasks with a frozen expected-location rubric |
| `system-one-ci` | **No result** | Native run watching already covers the observed identity cases |
| `system-one-diff` | **No result** | No coverage-preserving paired review cohort |
| `system-one-digest` | **No result** | Observed Git-state outputs are usually already small |
| `system-one-fetch` | **No result** | No source-extraction adapter and citation rubric |
| `system-one-research` | **No result** | No held-out multi-source task cohort |
| `system-one-triage` | **No result** | No labeled decision family or abstention test set |
| `system-one-writing` | **No result** | No authorized draft-audit cohort |
| `system-one-evolve` | **No result** | Search and promotion cost has not been shown to repay itself |
| `system-one` | **No result** | One admitted skill does not justify a router |

See [the benchmark harness](BENCHMARK-HARNESS.md) for the selection and paired
whole-task protocol. Earlier exploratory figures, including the 82% replay and
the single 3.9% diagnosis pair, remain available in [the results notes](RESULTS.md)
with their narrower denominators and limitations.
