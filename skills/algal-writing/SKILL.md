---
name: algal-writing
description: Audit drafts deterministically for readability, long sentences, repetition, placeholders, hedging, passive markers, links, and uncited claims; optionally evaluate quality through Jev typed decisions.
argument-hint: "<text|path> [audience]"
allowed-tools: ["exec"]
---

# algal-writing

Use `writing-audit` before spending model context rereading a whole draft.

```sh
bunx algal-skills run writing-audit --args '{"src":{"path":"README.md","cwd":"."}}'
bunx algal-skills run writing-evaluate --args @writing-args.json
```

`writing-audit` is deterministic and makes zero model calls. `writing-evaluate`
adds one typed `decide` effect for dominant issue, publish-readiness
probability, and a 1–5 quality score. It evaluates but never rewrites prose.
When Jev is unavailable, use the deterministic audit and edit with the active
agent.
