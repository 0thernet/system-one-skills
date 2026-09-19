---
name: algal-fetch
description: Fetch a web page as bounded stripped text with provenance (status, content-type, source bytes, truncated flag) instead of loading raw HTML into context. Zero model calls.
argument-hint: "<url> [--max-bytes N]"
allowed-tools: ["exec"]
---

# algal-fetch

```
bunx algal-skills run web-fetch --args '{"src":{"url":"https://example.com","max-bytes":16000}}'
```

Fetches the URL (30 s cap, http/https only), strips script/style/tags for
HTML content, clips to `max-bytes` (512–131072, default 16000), and returns
`{status, content_type, text, truncated, source_bytes}`.
