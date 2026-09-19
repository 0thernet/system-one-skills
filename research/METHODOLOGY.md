# Measuring the validation skill

System One Skills admits one use: reducing a known noisy validation command
when the agent needs its exit status. Admission requires measured text-token
savings after instruction and invocation overhead, preserved output contracts,
and explicit negative cases. It does not establish billed savings or complete
task correctness.

## Real transcript population

The public aggregates cover one consenting developer's retained **Devin CLI,
Claude Code, and Codex** transcripts in two disjoint UTC windows:

| Cohort | Inclusive start | Exclusive end | Report |
| --- | --- | --- | --- |
| Week | 2026-09-12 00:00 | 2026-09-19 00:00 | [session-report.json](session-report.json) |
| Supplemental | 2026-09-19 00:00 | 2026-09-19 14:00 | [supplemental-session-report.json](supplemental-session-report.json) |

The supplemental window ends before work on this project began. Files use a
modification-time prefilter followed by event timestamps; files restored with
older modification times can be missed. Source groups and usage counts are
provider-specific and must not be interpreted as equivalent user-task counts.

| Provider | Selection and deduplication |
| --- | --- |
| Codex | Windowed response items; stable call IDs and output identities distinguish inherited copies from separate yields. Sum individual usage responses by `response_id`, not cumulative snapshots. `session_id` groups multiple agent threads; the report separately counts observed usage thread IDs. Nested completed shell events have a separate overlapping view, which must not be added to model-visible tool counts. |
| Devin CLI | Read-only database snapshot, following the active parent chain. Deduplicate assistant usage by message ID and associate tool results with their own call IDs. Stale exports and inactive forest copies are excluded. Cache counters remain separate because their inclusion depends on model/backend. |
| Claude Code | Latest observable main conversation ancestry, falling back to sidechain-only files. Deduplicate assistant messages and take maximum usage fields across blocks of one response. The selected leaf is a best-observable pointer, not an authoritative active-head export. |

Current retained ancestry can omit compacted or rewound historical messages.
Missing data is not zero activity. Workflow regexes locate opportunities; they
do not prove a call was wasteful or safe to replace. Output bytes in the corpus
reports describe textual payloads, not provider-billed tokens.

## Replay selection

The unchanged analyzer chooses up to 12 smallest-hash eligible outputs per
provider per cohort. Eligibility requires a validation-class tool output with
an explicit completed exit status, or a typed completed shell event. Missing
status, ambiguous multi-result envelopes, and textual claims of success are
not inferred into successful exits. Each replay row preserves its source view.

The report includes providers with zero eligible samples. Three-provider
corpus coverage does not imply three-provider efficacy evidence. All selected
samples remain visible, including short outputs that would cost more if the
skill were invoked unnecessarily.

The replay reads archived text through the shipped pure reducer. **It never
executes an archived command.** It simulates the runtime's memory capture
bound, writes the complete archived excerpt to a private local file, and
measures the reducer's exact presented text, including the artifact path.
Replay paths contain a cohort label, opaque sample hash, and temporary-directory
nonce. They are longer than the default CLI log path, adding conservative path
overhead. The frozen report counts the paths actually rendered; a fresh nonce
can slightly change token counts on rerun.
Original provider metadata can remain in an excerpt, and prior truncation or
stdout/stderr ordering cannot be reconstructed.

These examples form a **development/calibration cohort**: an observed 8,207-byte
counterexample was used to tune the success excerpt. They are not independent
held-out evaluation tasks.

## Token accounting

The assessment uses pinned [`tiktoken`](https://github.com/openai/tiktoken)
0.12.0 with the named `o200k_base` text encoding, entirely locally. It counts
actual strings rather than dividing bytes by four. These are exact counts for
that encoding, not claims about Devin or Claude tokenization, current model
billing, or complete agent-task usage.

For each case:

```text
net tokens saved = archived output tokens − presented output tokens
                 − full skill-file tokens − catalog name/description tokens
                 − (skill invocation tokens − native invocation tokens)
```

The full skill and catalog description are charged on every case; setup is
never amortized to make a case pass. The report records both representative
invocations and their token counts. The original complete user/system prompts
were not retained with the replay samples. A plainly labeled common task
instruction estimate is charged equally to both arms and cancels in the
difference; it is not a fabricated historical prompt. Chat framing, reasoning,
cache treatment, loading interactions, retries, and later log retrieval remain
unmeasured.

## Selection rule and admission

The user-facing rule is to invoke only when earlier runs already establish at
least **8 KiB** of ordinary validation output and the task needs the exit status.
Do not run a command just to measure it, or rerun it to retrieve omitted output.

Replay simulates this selection using the archived output size as the available
prior observation. It does not prove what the historical agent knew, whether
an agent selects correctly, or whether the next run produces similar output.
Selection is independent of observed token savings: an eligible-size case
cannot be silently removed because the runtime passed it through or it failed
the margin.

Every selected case must save **at least 128 tokens** after the counted overhead.
Every case must pass the preservation checks. The public admission gate also
requires retained nonselected negative examples and reports threshold
sensitivity. A failed case requires a transparent runtime/routing change and
remeasurement; it must not become an unreported exclusion.

## What correctness checks establish

Replay checks source/presented byte counts, exact short-output passthrough,
declared exit status and omissions for compacted text, the byte guard, capture
bound disclosure, a complete saved archived excerpt, and private artifact
permissions. The saved-excerpt check validates the replay harness's artifact;
it is not proof of live CLI capture. Separate CLI integration tests validate
one-time command execution, exit propagation, private logging, timeouts,
interruption, and resource limits.

An independent synthetic forward check preserved the failure exit and single
execution, but needed a targeted saved-log read to diagnose an early colored
error. It prompted a diagnostic-matching fix and regression; it remains
development evidence rather than a holdout or a real transcript sample. Include
such follow-up reads in future paired agent-task accounting.

Neither set proves that the excerpt contains every diagnostic needed for the
original task. Inspect the saved log when failure diagnosis, warnings, coverage,
or detailed evidence matters. The current calibration set must be supplemented
with independent paired agent tasks before claiming generalization or net
end-to-end savings. Those tasks should hold repository state, model, budgets,
and cache policy fixed, count every turn including retrieval and repair, and
independently judge task success.

CI polling is not admitted: observed status-call frequency does not establish
redundant same-run polling or a benefit over native `gh run watch`.

## Privacy and reproduction

Public reports contain closed workflow labels, counts, booleans, and opaque
hashes. They contain no raw prompts, commands, log excerpts, private paths,
credentials, or transcript IDs. Raw samples and rendered outputs stay outside
the repository. Hashes bind the sources and reports and detect drift; they are
not independent proof of the measurements.

To reproduce on authorized local transcripts, create an isolated Python
environment and install `research/requirements.txt`. Run the analyzer with
explicit windows and an outside-repository private sample directory, then:

```sh
node research/replay_validation.mjs ../private-evidence/admission-input.json \
  week=../private-evidence/validation-replay-inputs.json \
  supplemental=../private-evidence/supplemental/validation-replay-inputs.json
python research/assess_admission.py ../private-evidence/admission-input.json \
  --corpus research/session-report.json \
  --corpus research/supplemental-session-report.json
bun research/validate-admission.ts
```

Use the required host scheduler for applicable local workloads. The public gate
needs no private input; rerendering and retokenizing the evidence does.
