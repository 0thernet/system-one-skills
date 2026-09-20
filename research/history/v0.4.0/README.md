# Immutable v0.4 evidence

This public snapshot preserves the complete source/report closure used by the
historical evidence validators at Git commit
`49c9ba49212f465c6a7d6054208bed7f39e9b813`. It contains 54 files and 860,809
source bytes. No private logs, prompts, transcripts, credentials, or raw replay
inputs are included. Percent-encoded `.source` names prevent test discovery
from accidentally executing archived tests.

`manifest.json` records every original path, SHA-256, size, and Git mode. The
history validator pins the manifest digest and rejects missing, changed, extra,
linked, or nonregular entries. It also requires all 21 retained public report
and protocol artifacts to remain byte-identical at their original repository
paths. Current runtime files, package metadata, tests, and the current synthetic
benchmark may evolve; this snapshot does not attest to their behavior.

`node research/validate-history.mjs` reconstructs a private temporary root and
runs the original integrity checks against the original source and report
graph. The checks retain negative findings, failed attempts, and original
measurement limitations. They do not rerun archived commands or model calls.
The temporary root is removed after validation.

Historical private inputs would be necessary to reproduce those exact old
measurements. They are unnecessary for checking the retained public arithmetic
and source bindings or for measuring a newly declared current-version cohort.
New artifact admission must separately bind current source bytes to fresh
deterministic, replay, and runtime evidence. Never update this snapshot merely
to make current-source drift pass.
