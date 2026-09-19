# algal-skills metrics methodology

What we measure, how to reproduce it, and what the numbers do **not** claim.

## Corpus motivation (why these workflows)

`research/analyze_sessions.py` streams local Codex and Devin CLI session
transcripts and emits **aggregate statistics only** — tool-call counts,
output-byte volumes per tool, token totals, compactions. No message content,
file contents, secrets, or paths leave the transcripts. Output:
`research/session-report.json`.

Aggregate findings (single-user, ~1 week):

| corpus | sessions | input tokens | cached | top context sinks measured |
| --- | --- | --- | --- | --- |
| codex | 1197 | 2.91B | 92.1% | exec output ~56.5MB; 1,029 compactions; send_message 2,415 calls |
| devin | 52 | 1.13B | 97.7% | exec ~5.0MB + read ~3.0MB + get_output ~2.3MB + grep ~0.9MB re-ingested |

Interpretation, not extrapolation: within this corpus, the recurring
context-heavy patterns were **git evidence gathering, test/build log reads,
CI/PR polling, repo exploration, and search dumps** — the workflows this pack
covers. These are one user's sessions; they motivate program selection, they
are not a measured savings claim.

## Bench design (`bench/run-bench.ts`)

For each workflow we measure **what enters the model's context**:

- `baseline_context_bytes` — raw bytes of the command outputs an agent
  ingests doing the same job by hand (measured by running the equivalent
  commands on the bench's own fixture repo).
- `algal_context_bytes` — bytes of the program's interface output
  (`summary`/`verdict` text) plus, for semi-deterministic programs, the
  evidence bytes the model cell actually saw.
- `agent_calls`, `work_units` — from the run receipt, not estimates.
- `est_*_tokens = ceil(bytes/4)` — labeled byte-estimates only.

Deterministic inputs: the bench builds a fixture repo (40 files, dirty diff
~35KB, 180-line failing test log) in tmpdir each run. Habitat quality is
measured on `fixtures/router-cases.json` (9 labeled cases) via the spawned
eval loop — `score` in the report is real, not assumed.

### Labeled baselines & caveats

- `diff-review` baseline assumes a typical 3-call read-review loop —
  **assumption**, flagged in the report.
- `ci-watch` baseline uses 5 polls of a representative `gh` JSON payload;
  the algal side runs with a stubbed tool — honest shape, simulated poll data.
- `router-habitat` baseline assumes a doc-reading agent (~2.8KB docs/task).
- Bounded programs only win above the byte cap: on a 1.4KB diff, `diff-review`
  measured **-18.9%** — included in the report caveats, not hidden.
- Baselines measure evidence ingestion, not reasoning cost; byte reduction is
  not a token/billing guarantee and says nothing about cache reuse, which is
  provider-dependent.
- Fixtures are small by construction; real repos make baselines *larger*.

## Reproduce

```sh
bun install
bun test                 # 17 checks incl. receipt bit-for-bit verify
bun bench/run-bench.ts   # rewrites bench/report/bench-report.json
```

To measure live token usage (provider usage fields, not estimates), run the
semi/habitat programs with `--executor gateway:<provider>/<model>` and diff
the receipt effect records against a raw-loop equivalent — the receipt pins
exactly what the model saw.
