# Agent diagnosis pilot: prepared, not run

**There is no observed agent result from this pilot.** We prepared one paired
comparison, but automatic approval review stopped execution before the private
log was sent to a model. Tokens, diagnosis accuracy, and completion time are
therefore **unmeasured**, not zero. The
[readiness record](../research/diagnosis-pilot-report.json) preserves the outcome.

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

## Why there are no results

The separate no-model settings preflight could not attest skill isolation:
startup timed out waiting for an existing Codex state-database backfill.
Credentials and saved configuration were not changed.

A subsequent bounded ephemeral launch was rejected **before execution** by
automatic approval review. Its stated reason was that permission to analyze
transcripts did not specifically authorize transmitting this private archived
log and associated context to the external model service. No model session
started, no private payload was sent, and no workaround was attempted.

Continuing this exact experiment needs explicit authorization for that payload
and destination. A public-data experiment is another possible design, with its
own frozen plan. Neither preparation nor permission establishes an outcome;
publish actual successful and unsuccessful attempts once a run is authorized.
The stronger [whole-task protocol](../bench/TRIALS.md) remains a separate gate.
