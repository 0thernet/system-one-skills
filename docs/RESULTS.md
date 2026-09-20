# Results in plain language

**82% fewer tokens for noisy check results**, in an initial replay of three
successful Devin logs, including counted skill overhead.

The practical benefit is a smaller result for the agent to read while the check
still runs and its full log stays available. Use the skill for known noisy
pass/fail checks. Native tools are a better fit for short output, useful quiet
modes, or tasks that need the whole log.

## What the headline counts

| Across the three qualifying logs | Text tokens |
| --- | ---: |
| Original output | 9,731 |
| Compact result | 931 |
| Counted skill, discovery, and invocation overhead | 774 |
| Result plus overhead | **1,705** |
| Net reduction | **8,026 (82.48%)** |

The headline rounds `(9,731 − 931 − 774) / 9,731` to **82%**. This is the combined
reduction across the three logs, not the average reduction per log or a prediction
for a typical agent task. The individual reductions were approximately 63%, 78%,
and 91%. We use the combined result rather than highlight the best case.

The data comes from the [v0.4.0 admission report](../research/admission-report.json)
and [per-case measurements](METRICS.md). The output contains 90% fewer tokens
before overhead, but that larger percentage omits part of the cost and is not
our headline.

## What stays the same

The runtime executes the command once, returns its exit status, and keeps the
complete captured output in a private local log. It reports timeouts, resource
limits, and incomplete capture. An excerpt is never a complete diagnosis.

The [runtime evidence](RUNTIME-EVIDENCE.md) includes 25 tests of these contracts.
This supports the documented behavior; it does not establish better agent task
success or fewer diagnostic mistakes. A later full-log read can reduce or erase
the initial token benefit.

## When the benefit disappears

All 21 short logs in the development sample and all 14 selected logs in the
[unused historical cohort](HOLDOUT.md) fell below the 8 KiB routing threshold.
Their output passed through unchanged. Unnecessary use would add 258 counted
first-use tokens per case. Always-visible skill discovery can also cost tokens
on tasks that never invoke it.

The [CI pilot](CI-PILOT.md) found no established advantage over native run
watching. That candidate and the other nine research candidates stay outside
the installation. A common workflow alone does not justify another skill.

## Data notes

1. **Small development sample.** The favorable result uses three successful noisy
   Devin logs selected from 24 eligible replay excerpts. These examples helped
   tune the implementation. The broader research includes real Codex and Claude
   transcripts; it does not establish equivalent savings for those agents.
2. **Text counts, not bills.** Counts use `tiktoken 0.12.0` with `o200k_base`.
   The estimate includes counted skill text, discovery, and representative added
   command text. It excludes complete task prompts, provider framing, cache
   pricing, reasoning, retries, subagents, and later log reads. The original
   commands were not rerun; archived text was replayed through the reducer.
3. **Known-noisy routing.** Eligibility uses an archived output size of at least
   8 KiB as a prior observation. The replay does not measure whether an agent
   would choose correctly or whether the next execution stays noisy.
4. **Local cost.** A separate synthetic runtime test measured about **42 ms median
   added processing time** across 140 native/wrapper pairs on a shared macOS
   arm64 host, Node 24.20.0. The p95 was 48.37 ms. This is overhead, not faster
   completion. [Raw timings and setup](RUNTIME-EVIDENCE.md).
5. **Evidence owner.** These are agent-authored analyses of one consenting
   developer’s private transcripts. Public reports contain aggregates and opaque
   hashes; raw transcript text remains private. Findings were checked on
   September 19, 2026 against the unchanged v0.4.0 runtime.

## What would justify a stronger claim

The next useful analysis is a comparison on previously unused **complete noisy
check tasks**, including failures, against the best native quiet or bounded
output. Count actual provider usage, every follow-up read and retry, correct
failure diagnosis, and time to completion. More transcript volume without those
comparisons would not establish a cheaper, faster, or more reliable agent.

The [whole-task trial protocol](../bench/TRIALS.md) sets those requirements.
Until that evidence exists, the headline describes the measured check-result
reduction only. The [research log](RESEARCH-LOG.md) preserves the complete findings.
