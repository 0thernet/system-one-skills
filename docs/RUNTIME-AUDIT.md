# Runtime correctness audit

This audit separates admission, execution invariants, and semantic quality. All
19 manifests parse and embedded manifest digests are checked. The deterministic
fixtures below verify specific behavior; they do not establish end-to-end token
savings or live Jev judgment quality. Pair them with the real-transcript method
in the [README](../README.md#assess-token-savings-without-hiding-correctness-losses).

| Programs | Verified behavior | Boundary that remains |
|---|---|---|
| `git-digest` | Real Git fixtures preserve dotted branches, rename/newline paths, worktree freshness and counts; reports unmerged files and omitted stat lines. | It is a point-in-time summary, not a transactional repository snapshot. Unborn history and incomplete stat/stash data are explicit. |
| `diff-slice`, `diff-review`, `change-triage` | Real diffs preserve revision selection, reject flag injection, count source bytes and bound UTF-8 slices; scripted decisions obey output contracts. | A partial diff is not a whole-change review. A model verdict or readiness value is not a merge gate or a calibrated probability. |
| `test-sift`, `release-gate` | Preserve complete command strings, actual exit status, timeouts and final log tails; empty gates fail. Budget abort kills the owned POSIX process group. | Captured logs retain only a bounded tail once large. Early failure excerpts can be omitted; `output_truncated` makes this visible. Caller commands retain their normal effects. |
| `search-slice` | Ripgrep JSON preserves filenames containing colons, separates matches from context, honors brace globs and flags match/context clipping. Missing `rg` fails explicitly. | A bounded result cannot prove absence outside the reported search scope. Regex and ignore behavior are those of the installed ripgrep. |
| `repo-survey` | Missing roots fail, traversal is bounded and README reads/clipping are byte-limited. | Depth, entry limits, hidden/generated directories and summary caps make this an orientation sample, not a complete file inventory. |
| `ci-check-inner`, `ci-watch` | The watcher selects one run for HEAD or explicit ID, passes that ID through the repeat loop and stops on errors. The loop is tested with controlled provider responses. | No live GitHub/provider qualification is claimed. One run does not represent all required checks. Reaching the round bound is not completion. |
| `web-fetch`, `research-bundle` | Mocked response streams enforce read/output caps; reject non-HTTP URLs/non-text responses; report failures/truncation; preserve literal inline code. | HTML stripping is not a browser or a source-quality assessment. It can omit structure. A truncated source cannot support absence claims or facts beyond the captured text. |
| `research-triage` | Failed evidence does not invoke a model; successful scripted decisions and replay are checked. | Partial/mixed bundles require source inspection. Relevance, sufficiency and quality need independently labeled real cases. |
| `writing-audit`, `writing-evaluate` | Deterministic signals, byte limits and symlink path boundaries are checked. The evaluator receives the bounded audited text rather than the omitted suffix. | Readability/passive/claim detection are heuristics, not editorial truth; sentence indexes are not file line numbers. Truncated drafts cannot establish whole-draft readiness. |
| `router`, `router-live` | Scripted classification and default-slot execution work. | Accuracy, misrouting costs and added model overhead remain unqualified on held-out real tasks. |
| `router-habitat`, `hab-eval-inner` | Generated candidates can only alter the router prompt or reduce existing budgets; structural mutations are rejected before evaluation. Scripted incumbent/candidate scoring confirms ties do not promote. | The driver scores proposal-visible cases, not a held-out set. Synthetic scripted labels are execution fixtures. Use one evolution owner per store; this is experimental optimization, not an approval system. |

## Cross-cutting checks

Both tool registries share the same input schema, effect, cost and output bound.
Fresh tool calls execute again even when the `.algal` store is reused. The
compatibility store name is retained for existing installations. Receipt replay
uses recorded effects; it does not revalidate current external state. Pin the
package/runtime versions as well as manifests when retaining replay evidence.

The `observeEffect` measurement hook receives cloned request/result envelopes
from successful root and nested executor calls. It does not change the
executor's output contract. Envelope bytes are not provider-reported tokens;
failed calls and provider-side overhead require additional usage records in a
real trial.

Regression source: [`runtime-correctness.test.ts`](../tests/runtime-correctness.test.ts).
Baseline admission, execution and replay: [`pack.test.ts`](../tests/pack.test.ts).
The focused audit run passed **41 tests / 158 assertions** on 2026-09-19. A separate
one-generation scripted habitat run with a seeded incumbent scored 9/9 for each
and correctly declined promotion. No live semantic-quality result is implied.

## Independent forward test

A skill-guided `test-sift` invocation was run against a fresh temporary Bun
project containing a failing invoice-subtotal assertion. The actual CLI returned
exit 1, category `test`, the failing test location, and **Expected 15 / Received
8**, sufficient to identify the assertion without another log read. This was an
authored execution fixture, not a historical transcript or a live model trial.
On that short input, the 641-byte raw log became 1,112 bytes of default CLI JSON
(**73.5% larger**). The case demonstrates preserved diagnostic behavior and a
negative size result; it does not measure provider tokens.

Focused follow-up checks also cover tail clipping below the process capture
limit, review scope metadata independent of the model verdict, and an installed
package copied beneath a path containing spaces and an apostrophe. The latter
runs both the CLI catalog and an exported command-tool invocation successfully.
