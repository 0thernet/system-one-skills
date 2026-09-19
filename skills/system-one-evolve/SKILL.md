---
name: system-one-evolve
description: "Run the router habitat: an agent proposes candidate router manifests, spawned children evaluate them on labeled cases, and a strictly-improving winner is promoted to the router-champion slot with lineage evidence."
allowed-tools: ["exec"]
---

# system-one-evolve

Requires the `system-one-skills` runtime ([install](https://github.com/0thernet/system-one-skills#install-and-run)). If unavailable, use native tools or install when authorized.

```
system-one-skills evolve --generations 3 --executor gateway:anthropic/claude-sonnet-4
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
or pass `--cases`. The runtime records receipts; promotion is host policy, never
self-modification. This is experimental: scripted fixture accuracy tests
execution plumbing only. Use separate proposal/training and held-out cases,
count all candidate/evaluation calls, and qualify live accuracy before adoption.
