---
name: algal-evolve
description: "Run the router habitat: an agent proposes candidate router manifests, spawned children evaluate them on labeled cases, and a strictly-improving winner is promoted to the router-champion slot with lineage evidence."
argument-hint: "--generations N [--cases file] [--executor spec] [--seed-champion]"
allowed-tools: ["exec"]
---

# algal-evolve

```
bunx algal-skills evolve --generations 3 --executor gateway:anthropic/claude-sonnet-4
```

The habitat (`router-habitat`) is malleable: its `gen` agent emits one
candidate router manifest as data; an `each` cell spawns it against labeled
cases in `fixtures/router-cases.json`; a pure `expr` scorer emits fitness.
The evolve driver repeats generations, measures the incumbent champion on
identical cases, and promotes only a strictly better candidate into the
`router-champion` slot (with a `router-champion-lineage` record).

`router-live` is the consumer: it reads the champion slot (packaged default
when empty) and spawns it per task — promotion changes routing without
editing any manifest on disk.

Cases: `[{"args":{...},"expect":<lane>,"key":"lane"}]` — extend the fixture
or pass `--cases`. All runs emit receipts; promotion is host policy, never
self-modification.
