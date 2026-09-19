---
name: system-one
description: Run system-one-skills programs instead of repeated raw tool output. Token-efficient deterministic workflows, optional Jev typed decisions, and replayable habitats for coding, research, and writing tasks.
allowed-tools: ["exec"]
---

# system-one-skills

Requires the `system-one-skills` runtime ([install](https://github.com/0thernet/system-one-skills#install-and-run)). If unavailable, use native tools or install when authorized.

Use `system-one-skills run <program>` when repeated or large tool output justifies
its startup and skill-loading overhead. Small focused commands can be cheaper. Each program is a data manifest run by
the ALGAL runtime: the shell work happens inside a bounded tool call and the
model receives only the compact typed report — bounded declared outputs enter context.

Legacy `algal-*` skill references map to `system-one-*` (`algal` maps to
`system-one`). Use the installed renamed runtime; an old npm package does not
automatically upgrade when its GitHub repository is renamed.

## Commands

- `system-one-skills list` — catalog with per-program agent-call counts
- `system-one-skills run <program> --args '{"src":{...}}'` — run one program
- `system-one-skills run <program> --args @args.json` — args from file
- `system-one-skills verify <receipt> <manifest>` — replay a run bit-for-bit
- `system-one-skills capabilities` — report optional Jev availability without secrets
- `system-one-skills evolve --generations N --executor <spec>` — habitat promotion

Args are keyed by input cell: almost always `{"src":{...}}` with fields like
`cwd`, `cmd`, `pattern`, `url`, `rev`, `task`, `cases`.

## Programs

Fixed (0 model calls): `git-digest`, `diff-slice`, `test-sift`, `release-gate`,
`ci-watch`, `repo-survey`, `search-slice`, `web-fetch`, `research-bundle`,
`writing-audit`.
Semi-deterministic: `diff-review`, `router`, `router-live`; Jev-compatible typed
decisions: `change-triage`, `research-triage`, `writing-evaluate`.
Malleable habitats: `router-habitat` (propose→evaluate→score candidates),
promoted via `system-one-skills evolve` into the `router-champion` slot.

## Rules

- Pass `cwd` as the project root; `"."` resolves to your working directory.
- The runtime writes its local `.algal` store; evolution writes champion slots.
  Caller-declared test/check commands can mutate files or services and need the
  same authority and scheduler as direct execution. Receipts can contain private
  evidence; keep them local.
- `--executor scripted:<file>` replays recorded effects for tests;
  `gateway:<provider>/<model>` runs text-generation calls and `jev[:model]`
  runs typed decisions. Jev auto-admits only when configured and needed.
- `run` prints declared outputs with completeness flags. Save replay evidence with
  `--receipt receipt.json`; `--full-receipt` prints the larger raw receipt.
