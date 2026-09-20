# Agent diagnosis pilot: startup timeout, no comparison result

**The first approved launch timed out without an answer or token counts.**
The native comparison arm was not launched. We cannot yet say whether the
compact result helped the agent diagnose the failure or saved tokens overall.
The [attempt report](../research/diagnosis-observed-report.json) records the
unsuccessful launch; missing usage is **unknown, not zero**.

## The question

Does a compact check result help an agent reach a correct diagnosis using fewer
tokens than focused native log searches, after counting the loaded instructions
and every necessary follow-up read?

The [failure replay](FAILURE-EVIDENCE.md) supplied one real Devin log with seven
failed tests. An independent reader labeled the observed failure and supporting
lines before reducer results or agent answers were available. Seven failures in
one log are **one case**, not seven independent tasks.

The frozen plan compared two fresh Codex sessions:

- **Native:** the completed exit status, the full local log, and focused native
  searches and line reads. Dumping a verbose log is not the required baseline.
- **Reduced:** the frozen v0.4.0 compact result, the exact loaded skill text, and
  access to the same full log. Provider usage would count the actual instruction
  cost; the earlier replay's 258-token estimate would not be added again.

Both answers would identify pass/fail, the failed-test count, the displayed
immediate failure, supporting evidence, and a safe next investigation without
inventing a deeper cause or fix. This deliberately probes a follow-up diagnosis
that may erase an initial saving. It does not expand the shipped skill's
pass/fail scope or establish a whole coding-task benefit.

## What was frozen

The private plan was recorded on September 20, 2026 at 02:33:21 UTC, before any
model request. The public record contains its hash and hashes of the source log,
labels, and skill. Inputs and outputs remain private.

The planned model was the configured `gpt-6-astra` at `ultra` effort through Codex
CLI 0.155.0. An immutable provider checkpoint was not exposed. The random order
was reduced then native; one pair cannot be counterbalanced. Each launch had a
120-second wall limit and an 8 MiB output-stream limit. No supported hard model
output-token cap was found in the inspected CLI interface.

The intended telemetry was the CLI's completion counters for input, cached
input, output, and reasoning. Cached and reasoning subsets would not be added
to inclusive totals. These are token observations, not billing measurements.
[Codex documents its structured event output](https://learn.chatgpt.com/docs/non-interactive-mode).

## What happened

The separate no-model settings preflight could not attest skill isolation:
startup timed out waiting for an existing Codex state-database backfill.
Credentials and saved configuration were not changed.

An initial bounded ephemeral launch was rejected **before execution** by
automatic approval review. Its stated reason was that permission to analyze
transcripts did not specifically authorize transmitting this private archived
log and associated context to the external model service. No model session
started in that rejected attempt, no private payload was sent, and no workaround
was attempted. The original
[readiness record](../research/diagnosis-pilot-report.json) preserves that earlier
outcome unchanged.

The owner then explicitly approved the payload and destination. The approved
launch began on September 20, 2026 at 04:54:37 UTC in the frozen **reduced** arm.
It reached the 120-second wall limit and was terminated, with a recorded launcher
duration of 120,191 ms. Both captured streams were empty: no session events,
answer, or provider token counters were observed. That does **not** establish
that no upstream request or cost occurred. The request status remains unknown.

Read-only inspection found the private startup database's history import still
running during the attempt. No existing managed daemon was available for the
CLI's supported proxy route. This supports a startup problem, but absent session
telemetry does not prove a complete causal account. No owned evaluation process
remained after termination; credentials and global database state were not
manually changed to force startup.

The frozen plan required stopping on a startup block and reviewing the first
attempt before a second launch. With startup unresolved, the native arm remains
**unlaunched**, not failed. There are **zero completed pairs**, no scored answers,
and no observed token difference. The launch duration is not a measurement of
diagnosis speed. Skill isolation also remains unattested.

## How the record is checked

The public report contains only aggregate observations and opaque hashes. It
binds the frozen plan, skill, reducer, source log, labels, executable, launcher,
and private capture. It includes every launched attempt. Raw logs, prompts, and
session data remain outside the repository.

```sh
python3 research/assess_diagnosis.py --check
```

The assessor checks the launch inventory, order, provenance, and derived totals.
Missing counters stay null. Cached input and reasoning output are subsets of
inclusive totals; repeated cumulative snapshots are not summed. A scored answer
needs the six declared criteria and a bound review artifact. Synthetic tests
exercise these rules and are not observations of agent performance.

## What would make a continuation useful

First establish a usable startup environment without a diagnosis request, then
record any changed setup and a fresh launch budget before collecting outcomes.
Preserve this timeout alongside future attempts. Obtain both answers, score them
without treatment labels or token counts, and count every follow-up read using
provider telemetry. Approval for the private payload and destination is already
recorded; it is not the present blocker.

Even a completed pair would be exploratory: one case, one order, no exposed
immutable model checkpoint, and a log already used in retrospective research.
It cannot demonstrate general savings, better reliability, or faster tasks.
The stronger [whole-task protocol](../bench/TRIALS.md) remains a separate gate.
