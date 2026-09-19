---
name: system-one-writing
description: Audit drafts deterministically for readability, long sentences, repetition, placeholders, hedging, passive markers, links, and uncited claims; optionally evaluate quality through Jev typed decisions.
allowed-tools: ["exec"]
---

# system-one-writing

Requires the `system-one-skills` runtime ([install](https://github.com/0thernet/system-one-skills#install-and-run)). If unavailable, use native tools or install when authorized.

Use `writing-audit` for mechanical signals in long drafts. Semantic editing
still requires reading the relevant prose; heuristics do not prove claim truth.

```sh
system-one-skills run writing-audit --args '{"src":{"path":"README.md","cwd":"."}}'
system-one-skills run writing-evaluate --args @writing-args.json
```

`writing-audit` is deterministic and makes zero model calls. `writing-evaluate`
adds one typed `decide` effect for dominant issue, publish-readiness
probability, and a 1–5 quality score. It evaluates but never rewrites prose.
When Jev is unavailable, use the deterministic audit and edit with the active
agent.

Typed answers and confidence are decision support, not verified correctness.
The published fixtures use scripted answers; live quality remains unqualified.
