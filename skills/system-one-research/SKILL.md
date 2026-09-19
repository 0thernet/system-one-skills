---
name: system-one-research
description: Build bounded multi-source evidence bundles without loading raw pages into model context, then optionally use Jev typed decisions to classify relevance, sufficiency, and source quality.
allowed-tools: ["exec"]
---

# system-one-research

Requires the `system-one-skills` runtime ([install](https://github.com/0thernet/system-one-skills#install-and-run)). If unavailable, use native tools or install when authorized.

Use `research-bundle` for deterministic collection and `research-triage` when
typed decision support is available.

```sh
system-one-skills run research-bundle --args @research-args.json
system-one-skills capabilities
system-one-skills run research-triage --args @research-args.json
```

`src.sources` accepts at most twelve URL strings or objects shaped as
`{url?, title?, text?}`. Each source is clipped independently and failures do
not discard successful evidence. `research-triage` asks one bounded `decide`
effect; Jev is auto-admitted only when configured. Without Jev, use the bundle
and reason from its compact report with the active agent.
