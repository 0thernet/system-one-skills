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

The remaining names are research candidates, not shipped skills. The table has
two different numeric fields on purpose:

* **Reduction** is a paired result. It is blank until a frozen adapter beats a
  native baseline on complete task usage while meeting correctness and latency
  gates.
* **256-token headroom** is a discovery screen. It counts observed outputs that
  are at least 256 `o200k_base` text tokens (a hypothetical 128-token skill
  overhead plus a 128-token margin). It assumes impossible perfect deletion and
  proves neither an implementation nor correctness. It is useful for choosing
  what to test next, not for claiming savings.

The workflow counts come from 960 real calls across Codex, Claude Code, and
Devin. Fetch and research use the same 95-call web-research proxy and must not
be added together. The complete machine-readable derivation is
[`research/catalog-scorecard.json`](../research/catalog-scorecard.json).

| Candidate | Reduction | 256-token headroom screen | Current decision |
| --- | --- | --- |
| `system-one-explore` | **No result** | 213 / 573 calls (**37.17%**) | Headroom only; freeze expected file/line sets and compare focused native search |
| `system-one-ci` | **No result** | — | Native baseline preferred; the pilot established no avoidable model turn |
| `system-one-diff` | **No result** | 31 / 68 calls (**45.59%**) | Headroom only; test changed-hunk coverage and defect recall |
| `system-one-digest` | **No result** | 28 / 224 calls (**12.50%**) | Headroom only; native porcelain is the first baseline |
| `system-one-fetch` | **No result** | 54 / 95 shared calls (**56.84%**) | Shared web proxy; test extraction and citation completeness |
| `system-one-research` | **No result** | 54 / 95 shared calls (**56.84%**) | Same web proxy as fetch; no independent denominator or result |
| `system-one-triage` | **No result** | — | No labeled decision family or abstention test set |
| `system-one-writing` | **No result** | — | No authorized draft-audit cohort |
| `system-one-evolve` | **No result** | — | Search and promotion cost has not been shown to repay itself |
| `system-one` | **No result** | — | One admitted skill does not justify a router |

The observed token totals behind those screens are 316,753 for repository
search, 93,485 for diff review, 38,017 for Git state, and 101,121 for the
shared web proxy. They are `o200k_base` text tokens from tool results, not
provider billing or complete task usage. A native command may already be the
best answer even when an output crosses the screen.

See [the benchmark harness](BENCHMARK-HARNESS.md) for the selection and paired
whole-task protocol. Earlier exploratory figures, including the 82% replay and
the single 3.9% diagnosis pair, remain available in [the results notes](RESULTS.md)
with their narrower denominators and limitations.
