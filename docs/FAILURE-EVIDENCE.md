# What happens when a noisy check fails?

**One real failing check used 66% fewer text tokens while retaining all seven failing test names and their shared error message.** The compact result omitted six of the seven test callsites. It was sufficient to see what failed; it did not preserve every annotated investigation detail.

This is one archived Devin check, replayed through the unchanged v0.4.0 reducer. It is a useful failure example, not a seven-task benchmark or proof that diagnosis becomes more reliable.

| Question | Observed result |
| --- | --- |
| How much less context did the initial result use? | 6,449 tokens → 1,938 result tokens + 258 first-use tokens: **4,253 saved (66%)** |
| Could the agent see that the check failed? | Exit status 1 was disclosed. All seven test identities and their specific shared error message survived. |
| Was every useful detail retained? | **9 of 15 annotated details** survived: seven test identities, one shared message, and one of seven distinct test callsites. |
| Could omitted evidence be recovered? | The replay saved the complete archived excerpt to a private log and disclosed its path. It did not rerun the command. |
| What if the agent reads the entire log afterward? | A constructed one-full-log-read scenario costs **2,196 more tokens** than reading the original log once, before lookup-invocation or reasoning costs. |
| Was the saving just removal of colors? | No. A separate replay after removing ANSI formatting still saved **2,118 tokens (58%)**, including the same first-use cost. |

The practical boundary remains the shipped skill's existing one: use it for the pass/fail result of a check already known to be noisy. Prefer native bounded reads when the task is detailed log investigation. A small initial result can help context usage without improving diagnosis or saving tokens over a complete investigation.

## How this example was selected

Before collection, we recorded [a selection protocol](../research/failure-protocol.json) for August 1–September 19, 2026, ending at 00:00 UTC on September 19. We applied the existing provider ancestry rules, validation classifier, and explicit-exit parser to authorized local Codex, Claude, and Devin transcripts. Historical commands were never executed.

Selection required a nonzero explicit exit and at least 8,192 bytes of archived output. Identical text plus exit status would be deduplicated within each provider. Up to 12 excerpts per provider were to be selected in opaque-hash order, independent of the reducer's results. Only one qualified.

| Provider | Recognized completed validation outputs | Nonzero exits | Nonzero outputs below 8 KiB | Selected noisy failures | Validation outputs without a recoverable explicit exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| Codex | 0 | 0 | 0 | 0 | 0 |
| Claude | 2 | 2 | 2 | 0 | 109 |
| Devin | 53 | 24 | 23 | 1 | 42 |

These are parser coverage counts, not the number of validation tasks performed. The classifier excluded mixed commands; it recognized no standalone Codex validation output in this window. Many Claude observations did not expose a supported explicit exit. Empty provider strata therefore provide no efficacy evidence for that provider. The collector's [complete denominators and exclusions](../research/failure-corpus-report.json) remain public.

This is a retrospective convenience sample from one developer. Its dates overlap earlier research; currently retained active transcript ancestry can differ from earlier collections. It is not an independent holdout, a representative workload sample, or measured provider billing.

## What the reliability audit establishes

An annotating agent inspected the entire original excerpt before viewing any compact result. The root reviewer independently checked all 15 exact evidence labels against the raw source: seven distinct test identities, one common module-resolution error message, and seven distinct test callsites. The annotations and source were hashed and locked before replay. Names, source text, commands, local paths, and transcripts stay private; the [public report](../research/failure-report.json) contains only counts, opaque hashes, and retention outcomes.

The first failing test's identity and the shared diagnostic message remained visible. All seven identities survived; six source callsites did not. Exact text retention is narrower than understanding the association between evidence, identifying a root cause, repairing code, or succeeding at the original task. The common message states a module-resolution failure; we do not infer why it occurred.

The replay also checked exit disclosure, source and output byte counts, marked omissions, the disclosed log path, exact saved excerpt bytes, and private file permissions. All ten narrow invariants passed on this one case. No provider truncation marker was detected; that does **not** prove complete original stdout. The reporter itself abbreviated some source-code frames. The replay's saved “complete log” means the complete archived excerpt available to this experiment.

The predeclared full-read sensitivity adds one entire archived excerpt when a labeled detail is absent. That is a scenario, not an observed agent action. A targeted read can cost less; repeated reads, reasoning, or repair work can cost more. The separate [whole-task evaluation method](../bench/TRIALS.md) is needed to measure those effects.

## A stronger formatting baseline

The raw excerpt contained ANSI color and formatting sequences. After inspecting the source, but before reducer or token outcomes, we recorded a protocol amendment to test their effect. We removed only SGR sequences matching `ESC [ [0-9;:]* m`, preserving semantic characters, and replayed that constructed text through the same reducer.

The normalized source was still noisy: 10,600 bytes and 3,655 tokens. Its compact result used 1,279 tokens; with 258 first-use tokens, the saving was 2,118 tokens, or 58%. Stripping formatting removed 2,794 tokens from the raw baseline in this text sensitivity. This was not an actual `NO_COLOR` execution or native quiet-reporter trial, and we did not establish which native reporter would be best for the historical task.

The primary raw and secondary normalized results must stay separate. Neither should be combined with the earlier three-success-log 82% result to imply a larger independent benchmark.

## Reproduction and integrity

- [Collector](../research/failure_collect.py): separate adapter over the frozen parser, with public denominators and private raw samples.
- [Protocol](../research/failure-protocol.json): initial selection hash, amendment timing, exact source hashes, and annotation rules. Local timestamps are not independent public preregistration.
- [Assessor](../research/failure_assess.py): exact `tiktoken 0.12.0 / o200k_base` counts, per-case costs and evidence retention, including negative full-read sensitivity.
- [Boundary tests](../tests/transcript_failure_test.py): deterministic sampling, deduplication, exact diagnostic spans, and truncation markers. Synthetic tests are not efficacy observations.

Anyone can run the public integrity check without private transcripts or the tokenizer:

```sh
python3 research/failure_assess.py --check
```

It checks source and protocol hashes, provider selection denominators, opaque annotation rows, and all published totals. Recollecting source transcripts uses the host scheduler and `research/failure_collect.py --private-samples OUTSIDE_REPOSITORY_DIRECTORY`. Full replay additionally requires the private source, locked annotations, primary and SGR-normalized replay files; the assessor's `--help` lists their arguments. Replaying generates temporary private artifact paths, whose encoding can slightly change exact counts. No raw transcript is needed or shipped when installing the skill.
