# algal-skills

Token-efficient agent skills built on [ALGAL](https://github.com/hraness/algal)
programs: deterministic and semi-deterministic workflows that keep raw tool
output out of the model's context, optional Jev typed decisions for coding,
research, and writing triage, plus self-evolving habitats promoted by
replayable evidence.

Requires **Bun ≥ 1.3**. Depends on `@hraness/algal` (pinned git commit).

## The idea

Agents burn context on evidence, not reasoning: `git status` dumps, full test
logs, unbounded `grep`, `sleep; gh run list` poll loops, raw HTML. Each
algal-skills program wraps one of those loops in a data manifest the ALGAL
runtime executes: the shell work happens inside a **bounded tool call**, and
the model receives only the compact typed report. Every run emits a receipt
that replays bit-for-bit offline (`algal-skills verify`).

Three kinds of program:

- **fixed** — `maxAgentCalls: 0`, pure `expr`/`fn`/`tool`/`repeat` cells.
  No model involved at all.
- **semi-deterministic** — one bounded `agent`, `classifier`, or typed
  `decide` cell with a declared output contract, fed a byte-capped evidence
  slice.
- **malleable habitats** — an agent proposes *candidate manifests as data*,
  spawned children evaluate them on labeled cases, and the host promotes a
  strictly-better winner into a durable slot. Evolution never mutates a
  running manifest.

## Install & use

```sh
bun add algal-skills            # or: bunx algal-skills ...
bunx algal-skills list          # program catalog
bunx algal-skills run git-digest --args '{"src":{"cwd":"."}}'
bunx algal-skills run test-sift --args '{"src":{"cmd":"bun test","cwd":"."}}'
bunx algal-skills verify receipt.json manifest.algal.json
```

`run` executes in-process through the ALGAL library with the pack's tools
wired as a `ToolRegistry` — no tool subprocess, no path templating. Args are
keyed by input cell (`{"src":{...}}`); `--args @file.json` also works.

Skill definitions for agent CLIs ship under `skills/`. Install all eleven from
the public Agent Skills registry source, or copy them from the npm package:

```sh
bunx skills add 0thernet/algal-skills --all
bunx algal-skills install-skills                      # -> ./.devin/skills/
bunx algal-skills install-skills --target .agents/skills
bunx algal-skills install-skills --target ~/.config/devin/skills
```

Discover first without installing: `bunx skills add 0thernet/algal-skills --list`.

## Optional Jev decisions

Jev is optional. Fixed programs run unchanged without it. When ALGAL's
credential resolver finds Jev in `TYPESAFE_API_KEY`, the OS vault, or its
permission-checked credential file, `algal-skills` automatically admits Jev
for `classifier` and typed `decide` effects only:

```sh
bunx algal auth jev                 # configure through ALGAL custody
bunx algal-skills capabilities      # reports availability, never the key
bunx algal-skills run change-triage --args '{"src":{"cwd":"."}}'
```

Jev answers bounded `noul`, `choice`, and `score` questions. It does not
generate code or prose, serve approval gates, or replace deterministic tools.
Pass `--executor jev[:model]` to require it explicitly; pass a scripted or
gateway executor to select a different boundary. Credentials never enter
manifests, digests, logs, or receipts.

## Programs

| program | calls | replaces |
| --- | --- | --- |
| `git-digest` | 0 | `git status` + `log` + `diff --stat` + `stash list` round-trips |
| `diff-slice` | 0 | unbounded `git diff` dumps |
| `test-sift` | 0 | reading whole test logs for the verdict |
| `release-gate` | 0 | sequential test/lint/typecheck/build babysitting |
| `ci-watch` | 0 | `sleep` + `gh run list` poll loops |
| `repo-survey` | 0 | `find`/`ls`/`cat` chains on an unfamiliar repo |
| `search-slice` | 0 | unbounded `grep`/`rg` dumps (rg, JS fallback) |
| `web-fetch` | 0 | raw HTML in context |
| `research-bundle` | 0 | repeated fetch/read/clip loops across up to 12 sources |
| `writing-audit` | 0 | rereading a whole draft for mechanical/style signals |
| `diff-review` | 1 | whole-diff reviews; schema-verified verdict |
| `change-triage` | 1 typed | diff risk/readiness/quality triage (Jev-compatible) |
| `research-triage` | 1 typed | source relevance/sufficiency/quality triage (Jev-compatible) |
| `writing-evaluate` | 1 typed | issue/readiness/quality evaluation without rewriting |
| `router` / `router-live` | 1 | doc-reading to pick a lane; Jev can serve the classifier |
| `router-habitat` | 1+N | propose→evaluate→score router candidates |
| `hab-eval-inner`, `ci-check-inner` | – | inner organisms for `each`/`repeat` cells |

## Habitat evolution

```sh
bunx algal-skills evolve --generations 3 \
  --executor gateway:anthropic/claude-sonnet-4 \
  --cases fixtures/router-cases.json --seed-champion yes
```

`router-habitat`'s `gen` agent emits one candidate router manifest per
generation; an `each` cell spawns it against labeled cases via
`hab-eval-inner`; an `expr` scorer emits fitness. The driver measures the
incumbent `router-champion` slot on identical cases and promotes **only a
strictly better** candidate, writing a lineage record
(`router-champion-lineage` slot). `router-live` consumes the slot — promotion
changes routing without editing anything on disk.

For tests and offline work use `--executor scripted:<file>`; see
`fixtures/habitat.responses.json` for the queue format (per-cell FIFO).

## Measured results

`bun bench/run-bench.ts` rebuilds the fixture repo and rewrites
`bench/report/bench-report.json`. Latest run (deterministic fixtures):

| workflow | baseline → algal context bytes | reduction | agent calls |
| --- | --- | --- | --- |
| git-digest | 2176 → 1609 | 26.1% | 0 |
| test-sift | 4460 → 832 | 81.3% | 0 |
| repo-survey | 635 → 94 | 85.2% | 0 |
| search-slice | 1230 → 379 | 69.2% | 0 |
| diff-review | 37441 → 9672 | 74.2% | 1 |
| ci-watch | 745 → 35 | 95.3% | 0 |
| router-habitat | 25493 → 6922 | 72.8% | 10 |
| research-triage | 102062 → 12521 | 87.7% | 1 scripted typed |
| writing-audit | 36920 → 1611 | 95.6% | 0 |
| change-triage | 37441 → 9934 | 73.5% | 1 scripted typed |
| **total** | **248603 → 43609** | **82.5%** | 13 |

Read these as **context-byte reductions on declared fixtures**, with
`est_tokens = ceil(bytes/4)` labeled as estimates. Jev-compatible rows use
scripted typed answers, proving orchestration and context shape—not live Jev
quality, latency, or billing. Byte reduction is not a billing
guarantee; small inputs can cost more than they save (a 1.4 KB diff measured
**-18.9%**). Full methodology, corpus motivation, and caveats:
[docs/METRICS.md](docs/METRICS.md). Motivating corpus: aggregate analysis of
~1,250 local agent sessions (tool-call mix and output-byte volumes only — no
transcript content ships) in `research/session-report.json`.

## Safety model

- Manifests are data; tool impls are reviewed code — fixed argv arrays, no
  string-concatenated shells, byte-bounded outputs.
- The tool surface is bounded git/gh/rg/fetch/text-analysis/subprocess only for
  declared workflows; nothing writes, commits, pushes, or mutates remotes.
- `test.run`/`check.run` run caller-declared commands inside the runtime's
  effect boundary — treat them as `exec` equivalents, not sandbox escapes.
- Spawned manifests are admitted by the contract parser under the parent's
  budgets; they cannot name executors or functions the host didn't supply.
- `verify` replays receipts bit-for-bit; promotion requires a strictly
  better measured score, not an agent's say-so.

## Development

```sh
bun install
bun test                 # 24 tests: admission, bounds, runs, Jev seam, verify, hygiene
bun bench/run-bench.ts   # regenerate bench/report/bench-report.json
bunx algal-skills list
```

`tools/shell.tools.json` also provides a `cmd:`-executor registry for running
these manifests under the plain `algal` CLI (`--tools` + `__PKG__`→package
dir). The `cmd:` path runs tools as subprocesses capped at 30 s by the host —
prefer `algal-skills run` for anything heavier.

## License

MIT
