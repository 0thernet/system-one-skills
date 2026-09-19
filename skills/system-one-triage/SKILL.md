---
name: system-one-triage
description: Use optional Jev typed decisions for bounded code-change, research-evidence, and writing-quality triage while preserving deterministic fallback programs when Jev is unavailable.
allowed-tools: ["exec"]
---

# system-one-triage

Requires the `system-one-skills` runtime ([install](https://github.com/0thernet/system-one-skills#install-and-run)). If unavailable, use native tools or install when authorized.

Check capability without exposing credentials:

```sh
system-one-skills capabilities
```

When `jev.available` is true, classifier and `decide` cells auto-route to Jev:

- `change-triage` → merge risk, readiness probability, quality score
- `research-triage` → relevance, sufficiency probability, source quality
- `writing-evaluate` → dominant issue, publish readiness, writing quality

Configure through ALGAL credential custody with `bunx algal auth jev` or
`TYPESAFE_API_KEY`. Credentials never enter manifests, digests, or receipts.
Without Jev, use `diff-slice`, `research-bundle`, and
`writing-audit`; fixed workflows continue to work with zero model calls.

Typed answers and confidence are decision support, not verified correctness.
The published fixtures use scripted answers; live quality remains unqualified.
