# Runtime cost and correctness evidence

`system-one-verify` reduces the output an agent reads. It adds a Node process,
private log writes and deterministic reduction, so it can make the local command
slower. This benchmark measures that cost instead of inferring a speedup from
fewer output tokens. It does not measure model latency or agent task success.

The machine-readable result is
[`bench/report/runtime-report.json`](../bench/report/runtime-report.json).
It contains every measured pair, source SHA-256 hashes, toolchain versions,
fixture identities, output sizes and the fault-test result.

## What runs

Seven **synthetic** fixtures copy only the public byte size and success/failure
shape of rows in [`research/admission-report.json`](../research/admission-report.json):
three eligible successes (8,207, 9,876 and 22,040 bytes), and every observed
failure (95, 304, 334 and 4,384 bytes). The fixture text is generated ASCII, not
transcript content. Failure fixtures use exit 7; the report records a historical
failure boolean, not its original numeric exit. Archived commands never run.

Each fixture has two excluded warmup pairs and 20 measured pairs. Each pair runs
identical child argv directly and through the complete `check` CLI. Native-first
and wrapper-first orders alternate, ten each per fixture; case order rotates
between rounds. Every arm starts a fresh Node process; warmups warm file/system
caches, not a persistent Node process. There is no outlier removal. The timer covers process startup,
command execution, pipe collection, and—in the wrapper arm—log writing and
reduction. Fixture setup and verification occur outside the timed interval.
The original child runs once per arm, verified by a side-effect counter.

The scheduler admits this as shared compute work. Other processes and background
activity are not isolated. A private fixed-length log path is reused within the
run; its random path prefix can change presentation bytes on another machine.

## Observed local cost

The checked-in report supplies the measured values. Medians average the middle
two observations; p95 uses nearest rank. Overhead is the **paired difference**
(wrapper minus native) for the same fixture and round, not the difference of two
percentiles. The four short failure fixtures are negative controls: the skill's
routing instruction says to use native tools for them.

<!-- runtime-measurements:start -->
Measured 2026-09-19 on macOS arm64, Node v24.20.0 and Bun 1.3.14, with the unchanged v0.4.0 runtime. Across all 140 measured pairs, added wall time was **41.82 ms median** and **48.37 ms p95**. These are observations on this host, not a performance guarantee.

| Synthetic fixture | Native → wrapper bytes | Native median / p95 ms | Wrapper median / p95 ms | Paired overhead median / p95 ms |
|---|---:|---:|---:|---:|
| failure-95 | 95 → 95 | 36.33 / 41.73 | 79.54 / 85.70 | 42.65 / 46.69 |
| failure-304 | 304 → 304 | 36.72 / 39.14 | 78.89 / 85.18 | 41.13 / 48.09 |
| failure-334 | 334 → 334 | 36.43 / 38.44 | 79.33 / 85.37 | 42.35 / 47.03 |
| failure-4384 | 4,384 → 4,384 | 36.72 / 40.81 | 79.22 / 88.06 | 42.16 / 48.37 |
| success-8207 | 8,207 → 647 | 36.51 / 40.21 | 78.84 / 83.25 | 41.24 / 45.31 |
| success-9876 | 9,876 → 614 | 36.19 / 38.27 | 78.73 / 86.53 | 42.21 / 49.69 |
| success-22040 | 22,040 → 636 | 37.09 / 41.42 | 77.63 / 90.14 | 40.53 / 48.72 |

The 280 measured command executions emitted 904,800 native versus 140,280 wrapper presentation bytes. All 154 pairs (308 executions) including warmups passed the exact exit, one-execution and wrapper-log checks. The focused runtime suite passed **25 tests / 125 assertions**, plus the separate binary CLI probe. These byte reductions are synthetic observations, not additional transcript token results.
<!-- runtime-measurements:end -->

Local process overhead and agent context savings are different outcomes. A
small added process cost could be worthwhile for a verbose, slow check, but
these measurements do not establish a break-even point in billed cost or
end-to-end task latency. Native quiet/reporter flags may be cheaper when they
retain the evidence the task needs. Token measurements and their limitations
are documented separately in [METRICS.md](METRICS.md).

## What correctness means here

Every warmup and measured pair checks the actual exit code, exactly one child
execution, byte-for-byte completeness of the private log, and mode `0600`.
Short outputs must pass through exactly. Long outputs must disclose exit and
omission and save both at least 4 KiB and half the input bytes. An additional
full CLI probe checks invalid UTF-8 and NUL byte preservation for short output.

The same measurement command runs the existing
[`tests/check-runtime.test.ts`](../tests/check-runtime.test.ts) suite. Its
individual test names and assertion count are in the report. These include:

- Early colored errors, overlapping failure excerpts, large lines, UTF-8
  boundaries and the 8 KiB compaction threshold.
- Exact short output, literal argv, exit status, working directory, a full
  private log and refusal to overwrite an existing file or symlink.
- Missing commands, native signals, timeout, INT/TERM cleanup handlers and
  escalation when a child ignores TERM.
- Inherited pipes from an escaped descendant: bounded return with explicit
  incomplete-log and uncertain-cleanup flags; no claim to kill an escaped child.
- The actual 64 MiB disk cap, the 256 KiB retained-memory bound, and a simulated
  write failure, all with failure status and incomplete evidence disclosed.
- An idempotent installer that preserves edited existing skills.

Several fault tests exercise the capture/check API directly; the report does
not relabel them all as end-to-end CLI tests. Passing this finite suite is
contract evidence, **not proof that excerpts always contain the needed diagnosis**
or that agent reliability exceeds native execution. A full-log read may still
be needed, costing tokens and time. Memory-bound assertions are not a resident
memory or throughput profile.

## Reproduce or validate

On a machine with the required host scheduler, run from the repository root
with the installed absolute scheduler path:

```sh
/absolute/path/to/host-run --mode=shared --lane=compute \
  --label=system-one-runtime-evidence -- node bench/measure-runtime.mjs --write
```

On a machine without that policy, `node bench/measure-runtime.mjs --write` runs
the same measurement. Node 20+ and the repository's development Bun installation
are required. The command generates only local fixture files, removes its own
scratch directory, runs the focused runtime tests and replaces the report only
after all assertions pass. It refuses to record a run if a hashed source changes
during measurement.

```sh
node bench/measure-runtime.mjs --check
```

The read-only check verifies current source hashes, transcript-derived fixture
identities, balanced ordering, byte guards, exits, recorded contract results and
all timing summary arithmetic. It does not remeasure performance. There is no
host-sensitive millisecond pass/fail threshold. Runtime or benchmark changes
require a fresh measurement; repeated unchanged source checks can reuse this
explicitly dated observation.
