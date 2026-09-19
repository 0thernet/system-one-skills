# Research log

Results are tied to implementation hashes, populations, and declared baselines.
Keep negative results and coverage gaps. A later change does not inherit an
earlier version's qualification automatically. Git history preserves prior
reports; each entry below names the work and its limits.

## 2026-09-19 — full inventory and separate evidence axes

**Distribution:** one shipped skill, `system-one-verify`; ten research
candidates. The [complete catalog](SKILL-CATALOG.md) lists each proposed
mechanism, observed transcript coverage, stronger native alternative,
correctness contract, missing costs, and next experiment. Listing a candidate
does not install it or claim that it works better.

**Token evidence:** the v0.4 calibration report retains all 24 selected Devin
excerpts. Three qualifying logs save 8,026 `o200k_base` text tokens after 774
static instruction/invocation tokens. Twenty-one short cases would add cost.
No whole-task or billed-token conclusion follows. The two calibration cohorts
also contain real Codex and Claude records, but no eligible validation replay
samples from those providers. [Methods and per-case results](METRICS.md).

**Performance evidence:** 140 balanced native/wrapper pairs over seven
transcript-shaped synthetic fixtures measured **41.82 ms median / 48.37 ms p95
added local wall time**. All timings, warmup policy, source hashes, and shared
macOS/Node environment are published. This is overhead, not a task speedup.
[Runtime results](RUNTIME-EVIDENCE.md).

**Correctness evidence:** the process measurement verified exact exits,
one execution, full private logs, and byte-exact short output. Twenty-five
runtime tests cover the documented fault and capture contracts. No trial
measured a statistical improvement in agent task reliability or diagnostic
quality. The distinction is explicit in the README and catalog.

**Assessment improvement:** the [whole-task evaluator](../bench/TRIALS.md)
now requires audited native baselines, matched context, reconciled token
buckets, all attempts and follow-ups, blinded outcome evaluation, and unused
tasks. Shared task/session ancestry reduces the independent sample count.
Correctness regressions block every positive adoption screen; material
whole-task latency regressions cannot be offset by token savings. The program
reports separate verdicts and uncertainty. There are no qualifying whole-task
observations yet; unit fixtures are not presented as real trials.

**New historical cohort:** a separate September 1–11 window tests the frozen
runtime and threshold against previously unused archived text. The locally
recorded [protocol](../research/holdout-protocol.json) precedes collection; it
is not an independently timestamped public preregistration. The first collection
failed on non-object Claude tool metadata before a complete corpus or replay
was produced. A recorded amendment adds a separately hashed adapter that
normalizes unsupported metadata to an empty mapping and counts it. It neither
infers exit statuses nor changes the frozen original analyzer or calibration
reports. Raw logs and replay artifacts stay private; archived commands never run.

The amended collection contains 35,307 tool calls (86 Codex, 33,710 Claude,
1,511 Devin). Its deterministic selection yields **14 completed validation
replays: two Claude and twelve Devin**. All are below 8 KiB, so none qualifies
for the wrapper. Invoking it on every case would add **3,612 estimated tokens**;
ten cases have recorded nonzero exits and no preservation invariant fails.
This confirms no new noisy-log savings and supplies no basis to expand the
shipped skill. [Complete results, exclusions, and reproduction](HOLDOUT.md).
Integrity checks accept this unfavorable outcome rather than require a positive
result. The expanded provider corpus must not be confused with eligible replay
coverage or a representative task sample.

**CI candidate pilot:** an identity audit of the 128 Devin CI-status calls
resolves 32 calls into 30 explicit run/context groups; 96 remain unresolved.
Only two groups repeat, with different query options in each. Neither group
establishes avoidable model polling, token savings, or an improvement over
native run watching. The candidate remains uninstalled.
[Results and conservative parser exclusions](CI-PILOT.md).

## Next admission work

1. Test validation on independent paired complete tasks, including long failures,
   wrong skill selection, warnings/coverage questions, and native quiet reporters.
   Use actual provider usage and count the cost of every follow-up log read.
2. Investigate exact-location repository search: the calibration corpus has
   573 search calls across all three providers. Compare against focused native
   search with known correct answer locations. Frequency alone proves no benefit.
3. Before further CI implementation, obtain task-intent evidence for genuinely
   repeated unchanged-status checks and compare with native run watching. The
   current identity pilot does not establish such a case; frequency alone is
   insufficient reason to add a wrapper.

Each experiment must freeze scope and criteria before collecting the data used
for its claim. Publish an insufficient or negative result as readily as a
positive one. Promote only the supported workload, withdraw stale claims, and
keep the default skill footprint small.
