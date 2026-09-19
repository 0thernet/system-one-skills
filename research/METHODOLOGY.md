# Assessing System One skills against real transcripts

The evidence has three different jobs. Transcript aggregates identify repeated
work that might benefit from a skill. Archived-output replay tests a reducer's
payload size and specific preservation rules. A paired agent trial must test
whether the complete intervention saves measured tokens while preserving the
original task outcome. Passing either of the first two does not establish the
third.

## Corpus and privacy

`session-report.json` is a convenience sample from one consenting developer's
local **Devin CLI, Claude Code, and Codex** records. Its fixed event interval is
**2026-09-12 00:00 UTC inclusive through 2026-09-19 00:00 UTC exclusive**. This
excludes the work that produced this assessment. It does not represent the
distribution of all developers, repositories, languages, or agents.

The analyzer reads local sources, emits allowlisted workflow names and numeric
aggregates, and publishes SHA-256 fingerprints of the analyzer and selected
evidence. It does not publish message bodies, commands, command arguments,
repository names, local paths, transcript IDs, model reasoning, or credentials.
Hashes identify the measured evidence; they are not a public substitute for
the private corpus. Independent contributors can run the analyzer on their
own authorized corpus and publish aggregates with the same schema.

JSONL discovery uses a file-modification-time prefilter at the window start;
the report counts excluded files. Event timestamps then enforce the half-open
window. A restored file with an old modification time can therefore be
missed. Tool inputs are UTF-8 strings or canonical JSON arguments. Output
measurement uses textual payloads, joining text blocks with newlines and
excluding image/audio blocks and outer transcript records. These are **byte
measurements**, not provider tokenization or billed cost.

Each provider reports its selected-evidence fingerprint, selected records by
UTC day, session coverage, deduplication/exclusion counts, workflow tool-call
counts, input bytes, and output bytes. The public report must remain aggregate
only. Raw replay inputs and receipts are optional private artifacts in a
directory outside the repository, created with restrictive permissions.

## Provider-specific correctness

| Provider | Selected evidence | Usage accounting |
| --- | --- | --- |
| Codex | Time-windowed response items across local rollout files; globally deduplicate calls by `call_id`. Output keys include call ID, output item ID (or timestamp plus ordinal), and content digest, retaining distinct identical yields. | Sum individual `token_usage_record.usage` records, deduplicated by `response_id`. Never sum cumulative `token_count` snapshots or maxima across forked sessions. Cached-input and reasoning-output fields are subsets, not additional tokens. Missing individual usage records mean missing coverage, not zero usage. |
| Devin CLI | A read-only SQLite transaction; follow `sessions.main_chain_id` through `parent_node_id`. Read message/tool fields only for the resulting ancestry. Exclude stale JSON exports and forest copies. Copied nodes use original message timestamps when present. | Deduplicate assistant `metadata.metrics` by `message_id`. Keep input, cache creation, cache read, and output separately as recorded. Cache inclusion depends on the selected model/backend; do not infer an additive cross-model input total. Compacted-away messages are absent. |
| Claude Code | Follow `parentUuid` from the latest main conversation message in each JSONL file; use the latest sidechain only in files without a main chain. Report other nodes as excluded. | Deduplicate globally by assistant `message.id`; take the maximum of each usage field across blocks of that same response, then sum responses. Keep input, cache creation, cache read, and output separate. The selected leaf is a best-observable branch, not an authoritative exported active-head pointer. |

Current active ancestry may differ from the ancestry active at the historical
cutoff, particularly after compaction or rewind. This is a study of the
**retained historical evidence at collection time**, not a reconstruction of
all work ever performed. Do not compare provider totals as if their coverage
and token semantics were identical. The main session count describes
**contributing execution/session groups** after deduplication, not every
discovered file or the number of user tasks. Codex `session_meta.session_id`
groups multiple agent threads; `recorded_usage_thread_count` separately counts
distinct observed `token_usage_record.thread_id` values. Claude `sessionId`
can include sidechains; Devin uses the database session identity. These are
provider-specific groupings and must not be presented as equivalent task counts.
Devin output identity is the message ID; Claude uses record UUID plus block
index. If an output lacks any stable event identity, the analyzer falls back
to call ID plus content and explicitly counts that limitation. Such a fallback
can collapse identical repeated yields. Conversely, rewritten timestamps or
ordinals can prevent deduplicating an inherited Codex event. These rules improve
coverage accounting; they do not prove a perfect reconstruction of every
model-visible delivery.

Codex also exposes completed `CommandExecution` events for shell operations
nested inside orchestration tools. The report publishes a **separate
supplemental view**, deduplicated by event ID, with captured output bytes and
workflow counts. These events overlap response-item tool results; never add
the two views or call their combined bytes model-visible savings. Their typed
exit status can supply archived-output replay evidence even when the enclosing
orchestration history is compacted or only partially retained. A model response
count is not an expected tool-call count: many responses contain no tool call.

The old report did not meet these rules: it included only two providers,
mixed differently bounded populations, counted JSON-envelope characters,
summed inherited cumulative usage, and attributed parallel Devin outputs to
the first call in a step. Its values must not be used as savings claims.

## Workflow classification and additional opportunities

Tool names map to a closed list of workflows. Shell commands are classified
using documented regular expressions, including commands found as static
strings inside Codex orchestration calls. No historical command is executed.
Operations with multiple detected workflow classes are recorded as
`mixed_shell`; unsupported wrappers, dynamic commands, and unknown tools
remain `shell_other` or `other`. Tool outputs without a selected matching call
are counted as `unmatched_output`, not assigned to a guessed workflow.

These heuristics locate opportunities, not proven waste. A command mentioning
`test` may be inspecting tests; a search result may be essential evidence.
Input/output byte counts also do not measure how often cached material was
reused later. Audit representative private examples before building a skill
for a high-frequency class. Preserve zeros, unmatched data, and negative
results in published assessments.

Beyond the existing Git, search, validation, and research skills, use measured
workflow counts to prioritize these hypotheses:

| Observed class | Candidate System One skill | Required preservation rule before claiming utility |
| --- | --- | --- |
| `file_read` plus `repository_search` | Symbol-scoped evidence packets with referenced file/line slices and expansion on demand. | Correct source identity, requested symbol, relevant callers, and explicit omissions; an exact slice must remain retrievable. |
| `process_wait` plus `ci_status` | Change-only process or CI watchers that return a terminal condition once. | Exact owned process/run identity, terminal status, timeout/cancellation, and actionable failure evidence. A wait count alone does not prove redundant polling. |
| `coordination` | Compact worker-result receipts and changed-state summaries. | Owner, input revision, result revision, required checks, unresolved blockers, and independent integration review. Summarizing a worker claim is not verifying it. |
| `dependency_build` plus `validation` | Diagnostic grouping by failing target, package, or compiler error. | Exit status, first actionable diagnostic, affected target, truncation, and an escalation path to raw logs. |
| `mixed_shell` and `shell_other` | Better instrumentation and command attribution before a new reducer. | Retain operation boundaries and distinguish reads from mutation. High unknown volume is a measurement gap, not an invitation to automate unknown commands. |

No transcript count alone justifies implementing or enabling any of these
candidates. Check actual frequencies in `session-report.json`; zero or sparse
coverage should lower priority. Writing style judgments, research truth, and
architecture choices need separate quality labels even if a typed model
returns schema-valid answers.

## Archived-output replay

`replay_validation.ts` runs the actual packaged `test-sift` program on a
deterministic smallest-hash sample of at most 12 eligible outputs per provider.
Eligibility requires an explicit completed exit status in the provider
envelope or result metadata. `is_error`, a textual “passed” message, a pending
process, or missing usage is not treated as an exit code. Multi-result
envelopes without an unambiguous single result are excluded.

The private replay command only prints the recorded text and returns its
recorded exit status. **Original commands are never run.** Each sample has a
fresh private receipt store. Portable exit statuses outside 0–255 and excerpts
over 256 KiB are excluded with a recorded reason. Provider metadata can remain
in an archived excerpt; lost stdout/stderr ordering and output already
truncated by the original agent cannot be reconstructed.
Codex samples can come from the supplemental completed-command view; each
public sample identifies its source view. The corpus-wide model-visible byte
counts and these nested command samples answer different questions.

The measured intervention is exactly `JSON.stringify(compactReport(receipt,
manifest)) + "\n"`, the default CLI payload. The baseline is the archived log
excerpt alone, without its original tool envelope. Every selected case is
reported, including cases where the compact result is larger, exclusions,
and harness errors. `ceil(bytes / 4)` is labeled only as a rough token proxy;
there is no measured tokenizer or provider billing in replay.

Preservation checks cover the recorded exit status, pass/fail result, emitted
byte count, and the final 30 newline-separated records after trimming when
they fit the 12 KB tail bound. This deliberately narrow check does **not**
prove that an agent could diagnose the original error, choose the right fix,
or complete the task from the reduced evidence. Source hashes tie results to
the tested runtime and formatter. Rerun after relevant changes.

## End-to-end acceptance

For an actual token-savings claim, pair a baseline agent run with a skill run
on the same frozen task/repository fixture, independently label success and
evidence quality, and collect real provider usage for **all** turns. Include
skill instructions, invocation overhead, typed-model calls, cache reads and
writes, retries, repairs, and later context expansion. Use the same provider,
model/version, budgets, and cache policy; randomize run order and repeat pairs
instead of comparing unrelated transcripts. Keep private evidence local and
publish the method, cohort counts, provider-specific usage deltas, uncertainty,
failures, and exclusions. An independent task-success gate must pass before
positive payload compression is described as an optimization.

Typed Jev decisions and router evolution need real live evaluation to claim
quality or token savings. Scripted decisions establish parser and contract
behavior only. Read the repository's benchmark and paired-trial tools for
the currently implemented gates; this transcript study supplies opportunity
and replay evidence, not a blanket correctness or net-savings endorsement.

## Reproduction

Run only against transcripts you are authorized to inspect. Choose an explicit
cutoff and use the repository's host scheduler when required by local policy.

```sh
python3 -m unittest discover -s tests -p 'transcript*_test.py' -v
python3 research/analyze_sessions.py \
  --since 2026-09-12T00:00:00Z --until 2026-09-19T00:00:00Z \
  --private-samples ../private-evidence
bun research/replay_validation.ts \
  ../private-evidence/validation-replay-inputs.json \
  research/replay-report.json research/session-report.json
```

Paths to each provider source are configurable. The analyzer is local and
offline; private replay receipts and samples are never package artifacts.
Do not upload or commit them to reproduce this study.
