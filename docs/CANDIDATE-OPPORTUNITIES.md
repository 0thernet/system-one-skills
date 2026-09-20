# Which additional skills are worth testing?

**A general read-caching skill is not justified by this transcript screen.**
We examined 1,200 file-read calls from real Devin, Claude, and Codex sessions.
Exact repeated responses contained only **1.09% of all read-output tokens**.
Deleting every repeated response would be an optimistic ceiling, before paying
for instructions, cache checks, freshness checks, or a later reread. We did not
measure any saved agent tokens or establish that a read was safe to skip.

The stricter subset—an earlier identical response followed by the same read with
no intervening recorded tool call—contained **one response worth two tokens**.
That does not warrant another installed skill. Keeping a weak candidate out is
part of optimizing the agent.

| Source | File-read calls | Exact repeated responses | Tokens in repeated responses | Repeats with no intervening tool call |
| --- | ---: | ---: | ---: | ---: |
| Codex | 42 | 0 | 0 | 0 |
| Claude | 9 | 1 | 2 | 1 / 2 tokens |
| Devin | 1,149 | 73 | 12,483 | 0 |
| **Total** | **1,200** | **74** | **12,485** | **1 / 2 tokens** |

**Focused reads are already common.** Explicit line ranges, head/tail selections,
or structured read limits appeared in **516 of 1,200 calls (43%)**: 20 Codex and
496 Devin calls. We could not recognize a bound in the others; that does not make
them wasteful. Full-file context may be needed, defaults may already limit output,
and compound commands can be too ambiguous for this conservative parser.

**This screen found no evidence for a generic JSON field-projection skill.**
No eligible single-fragment read output was a complete JSON object or array with two or
more top-level entries. This deliberately excludes JSON wrapped in tool output
or embedded inside source text. It says nothing about unrelated API responses,
and never establishes which fields an agent could safely omit.

## What this changes

Read reuse remains a research idea, outside the installed package. The stronger
next experiments target a concrete decision or lookup: preserve exact failure
locations, select an existing quiet reporter when appropriate, or return focused
search hits with useful line references. Those mechanisms must beat native tools
on complete tasks, including instruction cost, extra reads, latency, and a
blinded correctness check. This screen does not qualify them either. See the
[full skill catalog](SKILL-CATALOG.md) and the
[completed one-case diagnosis comparison](DIAGNOSIS-RESULTS.md).

## Data and limits

1. **Population:** one consenting developer's retained transcripts, from
   September 12, 2026 00:00 UTC through September 19, 2026 14:00 UTC, exclusive.
   The local collection recorded 229 Codex, 32 Claude, and 7,546 Devin calls;
   42, 9, and 1,149 respectively were classified as file reads. Read evidence
   spanned 27, 6, and 41 source/session groups, which are not independent tasks.
   Every selected read had output; three Codex reads had multiple fragments and
   were excluded from exact-repeat matching. The corpus is strongly Devin-heavy
   and shares the previous discovery window; this is not a fresh holdout.
2. **Exact equality:** same provider, session, source transcript file, canonical
   tool name and arguments, and exact bytes of one rendered output fragment.
   We did not normalize away envelopes, timestamps, whitespace, or ANSI codes.
   This misses some semantically identical reads. A matching output does not
   prove the file stayed unchanged between reads, that the earlier result was
   still in context, or that either output was complete. Compaction, resumes,
   parallel work, external changes, and unrecorded activity remain possible.
3. **Conservative chronology:** all 74 repeats had an earlier response before
   the repeated call. Every Devin repeat had other recorded tool calls between
   those endpoints; this screen does not infer whether they changed the file.
   Even the one adjacent Claude repeat is not a proven safe cache hit.
4. **Accounting:** separately tokenized observed output fragments total
   1,143,648 `o200k_base` text tokens and 4,142,386 UTF-8 bytes. The repeated-output
   ceiling is `12,485 / 1,143,648 = 1.0917%`. These are local text measurements,
   not provider usage, saved reasoning, billed cost, or latency. No historical
   command ran and no transcript was sent to a model for this screen.
5. **Provenance:** the [local protocol](../research/candidate-opportunities-protocol.json)
   was recorded before this collection's outcomes, after the earlier portfolio
   counts suggested examining reads. The [public report](../research/candidate-opportunities-report.json)
   exposes opaque case hashes and arithmetic; raw source text stays private.
   Independent review strengthened only report validation after collection.
   The report preserves the original collection-source hashes and records that
   amendment explicitly; measurements and the selection protocol did not change.

Validate the public report without reading private transcripts or installing a
tokenizer:

```sh
python3 research/candidate_opportunities.py --check
python3 -m unittest discover -s tests -p transcript_opportunities_test.py
```
