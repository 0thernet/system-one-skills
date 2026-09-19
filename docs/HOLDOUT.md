# Unused historical cohort: no qualifying noisy logs

The next evaluation found **no additional token-savings cases**. Its 14 selected
real validation excerpts were all short (81–3,886 bytes), so the frozen 8 KiB
routing rule would send every one to native tools. Invoking the skill anyway
would add **3,612 counted text tokens** under the same first-use accounting as
the calibration report. All 14 excerpts passed the narrow preservation checks.
This result adds negative cases and provider coverage; it does not expand the
skill's admitted use case or establish new efficacy.

The public [result](../research/holdout-report.json),
[corpus summary](../research/holdout-session-report.json), and
[protocol](../research/holdout-protocol.json) contain the complete counts,
exclusions, every sampled result, and provenance hashes.

## What was fixed before collection

The historical window is **2026-09-01 00:00 UTC inclusive through 2026-09-12
00:00 UTC exclusive**. It precedes, and does not overlap, the two September
12–19 calibration windows. These retained transcripts had not previously been
examined for this evaluation. This is a historical text cohort, not new agent
executions or randomized assignment.

The protocol was recorded locally at **2026-09-19 17:17:36 UTC**, before the
collection and analysis. That local timestamp is **not an independent public
preregistration**. The initial protocol hash and the later amendment are retained
rather than presenting the amended collector as unchanged from the first attempt.

The v0.4.0 runtime and skill, analyzer, replay reducer, tokenizer
(`tiktoken 0.12.0`, `o200k_base`), 8,192-byte routing threshold and 128-token
minimum net margin were frozen. Selection retained at most 12 eligible completed
validation outputs per provider, taking the smallest opaque sample hashes.
A recoverable explicit exit status was required. Every selected row, including
unfavorable results, remains public as metadata. Archived commands never execute.

The size rule is simulated using archived output size as a prior observation.
The replay does not establish what the historical agent knew, whether it would
choose correctly, or whether a later execution would emit the same amount.

## The collection failure and amendment

The first collection failed before producing a complete corpus report or replay
sample: Claude output metadata could be a non-object value, and the frozen
analyzer attempted an object lookup while checking for an explicit exit status.

At **2026-09-19 17:30:54 UTC**, a separate
[`collect_holdout.py`](../research/collect_holdout.py) adapter was recorded. It
normalizes non-null, non-object metadata to an empty mapping. Text and already
supported explicit exit parsing remain unchanged; an absent or unknown exit
never becomes success. The base analyzer, runtime, routing and sampling rule
were not modified, and no completed result was discarded to obtain this result.

The amended collection records **1,235 metadata normalizations** for Claude.
That counter is measured before output-fragment deduplication and is not a count
of independent tasks. Claude still has **109 validation outputs excluded for
missing explicit exit status**, and Devin has 15. This amendment is a collection
boundary repair, not evidence of improved skill behavior.

## Coverage and results

| Provider | Contributing session groups | Unique tool calls | Eligible completed validation outputs | Selected excerpts | Routed at 8 KiB | Recorded nonzero exits |
|---|---:|---:|---:|---:|---:|---:|
| Codex | 43 | 86 | 0 | 0 | 0 | 0 |
| Claude Code | 20 | 33,710 | 2 | 2 | 0 | 2 |
| Devin | 3 | 1,511 | 28 | 12 | 0 | 8 |
| **Total** | **66** | **35,307** | **30** | **14** | **0** | **10** |

Session groups are provider-specific execution groups, **not 66 independent
user tasks**. Providers differ in retained formats and extraction coverage.
The Codex count does not mean there were no validation tasks; none qualified
under this collector's available evidence and selection rules. Tool-call
frequency and recorded usage buckets are not token-savings measurements.

The 14 source excerpts contain 4,549 counted `o200k_base` text tokens, and exact
pass-through leaves those 4,549 unchanged. The accounting model charges 258
first-use tokens per invocation: 204 for the full skill, 42 for its catalog
name/description and 12 for representative added command text. Thus:

| Counterfactual policy | Selected calls using the skill | Counted net text tokens saved |
|---|---:|---:|
| Apply the frozen 8 KiB eligibility rule | 0 | 0 |
| Invoke on every selected excerpt | 14 | **−3,612** |

The first row represents **abstention**, not demonstrated positive efficacy.
It does not measure the real model's routing accuracy or always-visible skill
catalog overhead on tasks that never invoke the skill. The second is a
counterfactual accounting estimate, not 3,612 observed billed tokens. The shared
illustrative task instruction cancels between arms; original complete user and
system prompts, provider framing, caching, reasoning, retries and later reads
were not measured.

There were **zero preservation-invariant failures**, including byte-exact short
pass-through and a complete private copy of each archived excerpt. Ten source
excerpts carry nonzero exit statuses. The replay preserves source metadata but
does not rerun the command or prove the original failure was correctly diagnosed.
Several compaction-only invariants are conditional and vacuously pass when no
case compacts. This cohort therefore supplies no new noisy-success or noisy-
failure evidence, no task-success comparison and no latency result.

## Provenance and privacy

The [protocol](../research/holdout-protocol.json) binds the release and source
files; the [result](../research/holdout-report.json) binds the amended protocol,
collector, assessor, public corpus summary, private source samples and private
replay file. Key SHA-256 values are:

| Artifact | SHA-256 |
|---|---|
| v0.4.0 release package | `e4ddb2258724d93555934cbfd3c5409f29555693841a750ba5017f68e87daf81` |
| Initial locally recorded protocol | `8f4d406365e5b7eb2d9e1efde84c561883c3841ff87f307f7051e9b50cd4a296` |
| Amended protocol | `a1cf5aaa2f6b80e44d9d7d47d4cf7f6a95ead511f224c3d1ed66dd31b8ca3257` |
| Collector adapter | `0c424045e3db71bfda2b7f4a416ae8373b7d670fb8df514b818839154f48a85e` |
| Public corpus summary | `2a7cbd091eabde67336c4a27a755a154a86e6bbe638adb8f1431194ef5515d7c` |

Hashes bind bytes; they do not independently certify chronology or the truth
of private source records. The assessor requires collected and replayed records
to match in identity, provider, provenance, text and exit code. It refuses source
drift and private sample/replay paths inside the repository. Private files and
log artifacts use restrictive permissions. Public files retain opaque sample
identifiers, counts and hashes; they exclude transcript text, commands and
personal file paths.

The corpus belongs to one consenting developer. The deterministic sample is not
representative of all agents, models or tasks, and related excerpts may share a
task. Anyone can check public arithmetic and source hashes; independently
reproducing the exact observations requires the same authorized private source
snapshot. Retained histories can change, and a new temporary log path changes
private replay hashes even if excerpt text is identical.

## Reproduce with authorized local transcripts

Use a disposable checkout of the commit publishing this report and keep all raw
files outside it. The following commands replace only the holdout report files in
that checkout; they do not modify the calibration reports. The collector defaults
to the user's local Codex, Claude Code and Devin stores; use `--codex-dir`,
`--claude-dir` and `--devin-db` to select authorized immutable snapshots instead.
Run collection through the required absolute host scheduler on machines that
use one. It reads the transcript files/database; replay executes only the pure
reducer over saved text.

```sh
SYS1_HOLDOUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/system-one-holdout.XXXXXX")"
chmod 700 "$SYS1_HOLDOUT_DIR"
python3 -m venv "$SYS1_HOLDOUT_DIR/venv"
"$SYS1_HOLDOUT_DIR/venv/bin/python" -m pip install -r research/requirements.txt

python3 research/collect_holdout.py \
  --since 2026-09-01T00:00:00Z --until 2026-09-12T00:00:00Z \
  --output research/holdout-session-report.json \
  --private-samples "$SYS1_HOLDOUT_DIR/samples"

node research/replay_validation.mjs "$SYS1_HOLDOUT_DIR/replay.json" \
  "holdout=$SYS1_HOLDOUT_DIR/samples/validation-replay-inputs.json"

TIKTOKEN_CACHE_DIR="$SYS1_HOLDOUT_DIR/tokenizer-cache" \
  "$SYS1_HOLDOUT_DIR/venv/bin/python" research/assess_holdout.py \
  "$SYS1_HOLDOUT_DIR/replay.json" \
  --samples "$SYS1_HOLDOUT_DIR/samples/validation-replay-inputs.json"
```

These scripts require the recorded sources and matching protocol. A different
window or changed implementation needs a newly declared experiment and separate
results, not replacement of this cohort's unfavorable result. If a future fix is
tuned using these excerpts, this cohort becomes development data and confirmation
needs another unused cohort.

To check the published source hashes and report relationships without accessing
private transcripts or rerunning collection:

```sh
bun research/validate-evidence.ts
```

The result remains **`no-eligible-routed-cases`**. More evidence is required before
claiming the skill improves task success, wall time or billed usage, or admitting
any additional skill to the default package.
