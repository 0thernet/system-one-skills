# CI monitoring pilot: no demonstrated advantage yet

The first `system-one-ci` pilot found **128 real Devin CI-status calls**, but
that frequency does not justify another installed skill. Conservative identity
resolution found **32 calls in 30 run/context groups**. Only **two groups**
contained more than one observation. Each had two calls with different literal
query options; neither provided a status-only query or an exact JSON state the
pilot could compare. **Avoidable model turns, token savings, latency change and
reliability improvement remain unmeasured.** The skill stays a research candidate.

The full public result is [ci-pilot-report.json](../research/ci-pilot-report.json).
The [collector and integrity checker](../research/ci_pilot.py) are reproducible;
no historical command executes.

## Population and selection

The window is September 12, 2026 at 00:00 UTC through September 19 at 14:00 UTC,
with the end excluded. This matches the two original corpus windows. A fresh
read-only SQLite transaction follows the current active parent chain in the
authorized Devin database. It examines matching assistant calls and only their
own returned outputs. Indexed joins constrain content reads to the active chain;
a 120-second deadline is checked during SQLite execution and aborts without
publishing partial results. This is not a strict whole-process timeout; Python
parsing time between database operations is not independently interrupted.

The unchanged analyzer labels CI-status calls. Mixed-shell and generic process
waits are excluded. This snapshot recovered the same **128 calls** as the
original aggregate: 58 on September 17, 18 on September 18, and 52 on September 19.
Equality of counts does not prove identical historical ancestry; opaque record
digests bind this new snapshot separately. Compaction or rewinds can change what
is retained in a future reproduction.

Identity requires a **literal numeric run ID** plus an explicit repository
option or an absolute working directory stated in that call. Different sessions
are never pooled. The parser rejects variables, ambiguous compound commands,
unsupported options, PR-wide checks and run lists as exact-run identities. It
does not infer a target from output prose or the session's current directory.

| Selection result | Count |
| --- | ---: |
| Observed CI-status calls | 128 |
| Identity resolved | 32 |
| Identity unresolved | 96 |
| Resolved run/context groups | 30 |
| Groups with repeated observations | 2 |
| Repeated groups inspected | 2 |

The fixed exploratory selection takes at most 20 repeated groups, ordered by
smallest opaque identity digest. Both available groups were included. Single
observations remain in the counts. This is not a random task sample or a
confirmatory holdout.

## What the two sequences establish

| Sequence | Observations | Elapsed between first and last | Identity basis | Adjacent identical literal queries | Parsed states |
| --- | ---: | ---: | --- | ---: | ---: |
| 1 | 2 | 1,096.954 seconds | Explicit repository | 0 | 0 |
| 2 | 2 | 4.291 seconds | Explicit call directory | 0 | 0 |

All four observations are run-view calls. Different query options may request
different useful evidence; this pilot does not adjudicate their intent. Even
identical parsed status would establish repeated observations, not automatically
an avoidable model turn. The agent may have done other work between checks or
needed evidence at two distinct decision points.

Only exact JSON status objects are recognized, optionally inside an explicit
completed-tool envelope. Human-readable text, filtered scalars, failed commands
and ambiguous multiple outputs remain unknown. Zero parsed states is a coverage
limitation, not evidence that the runs had no status.

The 96 unresolved calls are retained with explicit exclusion counts: 55 were
not a supported explicit run-view/watch form, 21 used dynamic or multiline shell
syntax, 17 used compound or filtered commands, two had unsupported options, and
one did not place a literal numeric run ID in the supported position. These
conservative exclusions can miss real polling; they must not be read as proof
that none occurred.

## Native baseline and decision

The baseline is the provider CLI's native watch operation for one explicit run.
It already waits locally without repeated model polling. A new skill must show
a benefit over that baseline after accounting for its own instructions,
invocation, follow-up reads, error recovery and elapsed time. The current pilot
has no such comparison and produces **no positive efficacy result**.

A next bounded discovery pilot could privately adjudicate the 96 unresolved
calls and their contexts without weakening identity rules just to obtain a
favorable count. Only if that finds actual repeated model polling should a
prototype be compared with native watching on the same recorded state
transitions. Such replay can check identity and failure contracts; it still
cannot establish live-agent speed or task quality. Stronger adoption claims
require the independently audited whole-task evidence in [TRIALS.md](../bench/TRIALS.md),
including its minimum of 30 independent task/session clusters per declared scope.

## Reproduce and check

With authorization to read the local transcript database, run:

```sh
python3 research/ci_pilot.py --devin-db PRIVATE_DATABASE
python3 research/ci_pilot.py --check
python3 research/ci_pilot.py --self-test
```

The first command performs a bounded read-only collection and replaces only the
public aggregate report after success. Use the required host scheduler if the
collection is a heavyweight workload on your machine. The other commands need
no transcript access: they check source freshness, public count consistency,
selection bounds and conservative parser fixtures. They do not remeasure the
pilot. The public report contains closed labels, counts, timing intervals and
opaque hashes; no raw commands, output text, repository names, session IDs or
private paths are published.
