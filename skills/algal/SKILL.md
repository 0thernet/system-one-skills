---
name: algal
description: Run algal-skills programs instead of repeated raw shell output. Token-efficient deterministic and semi-deterministic workflows with replayable receipts. Use this when a task needs git state, diffs, tests, CI status, repo maps, search slices, or bounded web fetches.
argument-hint: "list | run <program> --args <json|@file> | evolve | verify"
allowed-tools: ["exec"]
---

# algal-skills

Prefer `algal-skills run <program>` over assembling the same evidence with
repeated `exec`/`read`/`grep` calls. Each program is a data manifest run by
the ALGAL runtime: the shell work happens inside a bounded tool call and the
model receives only the compact typed report — raw logs never enter context.

## Commands

- `bunx algal-skills list` — catalog with per-program agent-call counts
- `bunx algal-skills run <program> --args '{"src":{...}}'` — run one program
- `bunx algal-skills run <program> --args @args.json` — args from file
- `bunx algal-skills verify <receipt> <manifest>` — replay a run bit-for-bit
- `bunx algal-skills evolve --generations N --executor <spec>` — habitat promotion

Args are keyed by input cell: almost always `{"src":{...}}` with fields like
`cwd`, `cmd`, `pattern`, `url`, `rev`, `task`, `cases`.

## Programs

Fixed (0 model calls): `git-digest`, `diff-slice`, `test-sift`, `release-gate`,
`ci-watch`, `repo-survey`, `search-slice`, `web-fetch`.
Semi-deterministic (1 bounded model call): `diff-review`, `router`, `router-live`.
Malleable habitats: `router-habitat` (propose→evaluate→score candidates),
promoted via `algal-skills evolve` into the `router-champion` slot.

## Rules

- Pass `cwd` as the project root; `"."` resolves to your working directory.
- Programs never write files, commit, push, or call APIs beyond the declared
  tool surface (git/gh/fetch/rg/subprocess for the declared check commands).
- `--executor scripted:<file>` replays recorded model outputs for tests;
  `gateway:<provider>/<model>` runs live structured-output calls.
- Every run prints a receipt; keep receipts for `verify` and for promotion
  lineage in habitats.
