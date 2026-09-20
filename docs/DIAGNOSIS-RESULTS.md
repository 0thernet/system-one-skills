# One live diagnosis: 4% fewer tokens, a longer run

**Both Codex answers were correct. The skill-assisted run used 3.9% fewer
recorded tokens and took 9.3 seconds longer.** This is one comparison on a real
Devin failure log, not a general performance claim.

| Completed diagnosis | Focused native reads | Compact result + skill |
| --- | ---: | ---: |
| Correctness criteria passed | 6 of 6 | 6 of 6 |
| Recorded input + output tokens | 49,803 | 47,840 |
| Launch to process exit | 28.6 seconds | 38.0 seconds |
| Log/result read commands | 3 | 4 |

The difference is **1,963 tokens (3.94%)**, including the loaded skill and the
agent's follow-up reads. The skill run took **32.7% longer** by the launcher
clock. These observations support neither a speed improvement nor better
diagnosis reliability. They do not qualify this workflow for broader adoption.

The practical advice stays narrow: use `system-one-verify` for the pass/fail
result of a check already known to be noisy. Prefer focused native reads for
detailed diagnosis. The earlier **66% smaller failure summary** measured the
initial text reduction; the completed agent interaction produced a much smaller
observed difference. [Failure replay](FAILURE-EVIDENCE.md).

## What was compared

Two fresh Codex CLI sessions received the same archived failed-check log. One
started with its exit status and used focused native searches. The other also
received the frozen v0.4.0 compact result and exact skill instructions. Neither
reran the archived command. Both could inspect the full local log.

An AI evaluator scored randomly labeled answers before seeing treatment labels,
command history, or token usage. Both correctly reported failure, seven failed
tests, the displayed error, supporting line evidence, a safe next investigation,
and the limit on inferring a deeper cause. Raw answers and logs remain private.

## Data notes

1. **One exploratory case.** Codex CLI 0.155.0 requested `gpt-6-astra` with
   `ultra` effort, in reduced-then-native order. The case was already used in
   retrospective analysis. Order, cache effects, and natural skill discovery
   were not controlled; an immutable model checkpoint and exact ambient
   isolation were not attested. The earlier attempt's request status is unknown.
2. **Provider counters, not bills.** Native input/output was 49,270/533;
   skill input/output was 47,131/709. Cached input was 23,808 versus 26,752 and
   reasoning output 197 versus 243. Those subsets are already included; no
   static 258-token supplement is added. Timings include CLI startup and shutdown,
   and are not a separately measured model or tool latency.
3. **Failed setup stays counted.** The first retry could not access tools because
   the evaluation settings disabled the required tool host. It used **24,293
   recorded tokens** and 30.8 seconds without a usable diagnosis. Restoring the
   installed host enabled the two completed runs. All three retry launches used
   **121,936 recorded tokens** together. The earlier 120-second startup timeout
   still has unknown usage, so this is not a complete cost for all evaluation
   work. It is not a net saving across retries.
4. **Plans and receipts.** Private plans were frozen and reviewed before each
   configuration's launches. Public protocol files were projected afterward;
   they are not independently timestamped preregistrations. Every attempt is
   retained with source, configuration, capture, and review hashes. The runtime
   and installed skill were unchanged throughout.

[Completed-pair report](../research/diagnosis-retry-tools-report.json) ·
[Tool-host failure report](../research/diagnosis-retry-report.json) ·
[Earlier startup timeout](DIAGNOSIS-PILOT.md) ·
[Requirements for stronger claims](../bench/TRIALS.md)
