---
name: algal-triage
description: Use optional Jev typed decisions for bounded code-change, research-evidence, and writing-quality triage while preserving deterministic fallback programs when Jev is unavailable.
argument-hint: "change | research | writing"
allowed-tools: ["exec"]
---

# algal-triage

Check capability without exposing credentials:

```sh
bunx algal-skills capabilities
```

When `jev.available` is true, classifier and `decide` cells auto-route to Jev:

- `change-triage` → merge risk, readiness probability, quality score
- `research-triage` → relevance, sufficiency probability, source quality
- `writing-evaluate` → dominant issue, publish readiness, writing quality

Configure through ALGAL credential custody with `bunx algal auth jev` or
`TYPESAFE_API_KEY`. Credentials never enter manifests, digests, or receipts.
Without Jev, use `diff-slice`/`diff-review`, `research-bundle`, and
`writing-audit`; fixed workflows continue to work with zero model calls.
