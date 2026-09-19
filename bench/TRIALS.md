# Whole-task trial assessment

A shorter excerpt does not establish a cheaper, more reliable, or faster agent.
`assess-trials.ts` screens **observed paired whole-task runs** separately on
correctness, tokens, and elapsed time. It does not launch agents or turn replay
measurements into observations. There are currently no admitted whole-task
observations in this repository.

```sh
bun bench/assess-trials.ts private-observed-trials.json
```

The input is a JSON array of pairs. An empty array returns
`status: "no-observed-trials"`; malformed observations fail. The CLI emits
`schema_version: 2`, a status, and grouped results. The exported `assessTrials`
function returns that groups array. A successful process exit means the input
was assessed, **not** that a skill passed. Read each group's `verdict` and its
three individual metric verdicts.

## Design before measurement

1. Freeze the skill revision, task population, success tests, quality rubric,
   provider/model settings, toolchain/resource environment, and cache policy.
   Specify and audit the **best available native baseline**, including native
   quiet flags, bounded tool output, and existing efficient commands where they
   preserve task correctness. Comparing against an avoidably verbose or weak
   workflow does not qualify the skill.
   Record these in a dated plan before collecting the confirmatory cohort.
2. Assign baseline/skill order randomly and counterbalance it. Both arms start
   from the same task snapshot with equivalent context and cache conditions.
   Keep the task outcome check independent of the skill's own summary.
3. Reserve new task families and agent sessions for evaluation. A task or
   transcript used to choose the skill, threshold, or wording is development
   data, even when it was originally a real user task. Do not label it held out.
4. Keep every attempt, including timeouts, failed tasks, retries, and unfavorable
   outcomes. Count provider-reported usage through the final answer, including
   catalog discovery, skill loading, follow-up log reads, repairs, and subagents.
   Measure elapsed time over that same complete task boundary.
5. Have an evaluator blinded to the arm apply the frozen rubric and inspect
   the outcome. Record private evidence references and review the independence
   and accounting declarations. Publish anonymized aggregates and limitations,
   never raw private transcripts or credentials.

If a result motivates a skill change, that cohort becomes development evidence
for the changed version. Collect a fresh held-out cohort before making its
confirmatory claim. Do not keep testing subgroups until a favorable one passes.

## Input schema

`Trial` is exported from [assess-trials.ts](assess-trials.ts). All fields below
are required; missing metrics cannot be silently treated as zero.

| Pair field | Meaning |
| --- | --- |
| `id` | Unique observation ID; repeated IDs are rejected. |
| `skill`, `skill_revision` | Skill name and immutable revision being evaluated. |
| `provider` | `devin`, `claude`, or `codex`. |
| `model` | Actual versioned model, not an unverified marketing alias. |
| `evidence` | Must be `observed`. Synthetic/calibration rows are rejected. |
| `plan_ref` | Reference to the predeclared cohort, order, and measurement plan. |
| `baseline_strategy` | Stable versioned identifier for the best available native workflow, including its quiet/bounded options. |
| `baseline_review_ref` | Audit reference supporting that baseline choice; shared by runs using that design. |
| `baseline_qualified` | Must be true only after the native alternatives have been reviewed. |
| `rubric` | Stable identifier for the outcome tests and quality rubric. |
| `held_out`, `used_for_tuning` | Qualification requires `true`, `false`. |
| `all_attempts_included` | Must be true; no selective removal of failed attempts. |
| `randomized_order` | Whether order was randomized under the recorded plan. |
| `order` | `baseline-first` or `skill-first`; both must occur within a qualifying group. |
| `independence` | Task/session identifiers and an audit declaration, below. |
| `baseline`, `skill_arm` | Whole-task measurements, below. |

`independence` contains `task_cluster`, `baseline_session`, `skill_session`,
`audited` (boolean), and `review_ref`. Give related variations of one underlying
task the same task cluster. Rows sharing a task **or either session** form one
cluster, transitively. For example, ten task variants within one session cannot
become ten independent observations. Identifiers must be stable across the
cohort; inventing new IDs does not create independence. External review must
consider shared artifacts, reused conversations, and other dependencies that
IDs alone cannot reveal. The baseline and skill arms must also use distinct
sessions; reusing one conversation would expose the second arm to the first.

Each arm has these fields:

| Arm field | Meaning |
| --- | --- |
| `context` | Strings: `task_snapshot`, `environment`, `model`, `model_settings`, `cache_condition`. Every field must match its paired arm. |
| `tokens` | Six reconciled integer counters, below. |
| `accounting` | Evidence references and complete-usage declarations, below. |
| `elapsed_ms` | Positive whole-task wall-clock duration, including retries and follow-ups. |
| `task_pass` | Boolean result of the independent outcome check. |
| `critical_errors` | Nonnegative integer; one critical skill error blocks adoption. |
| `quality` | A rubric-derived score from 0 to 1. Any paired decline blocks adoption. |
| `evaluation_ref` | Auditable reference to the outcome and rubric assessment. |
| `evaluator_blinded` | Boolean; false prevents qualification. |

`tokens` contains exactly `uncached_input`, `cached_input`, `cache_write_input`,
`output`, `input_total`, and `total`, all nonnegative safe integers. The equations
must hold:

```text
input_total = uncached_input + cached_input + cache_write_input
total       = input_total + output
```

These are **normalized, disjoint** counters. A provider may already include
cached or cache-write tokens in its input count; subtract the overlapping parts
before filling `uncached_input`. Do not sum a provider's inclusive input total
and its cache counters. Set `cache_write_input` to zero only when that is correct
for the provider's semantics. Document model reasoning/output accounting too.
Reconciliation catches inconsistent totals; it cannot detect a false statement
about provider semantics.

`accounting` contains string references `usage_ref` and `normalization_ref`, plus
four booleans: `disjoint_buckets`, `whole_task`, `includes_catalog_and_skill`, and
`includes_followups_retries_subagents`. Every flag must be true to qualify.
Usage must come from complete provider telemetry, not a character estimate or a
replay tokenizer. If telemetry cannot separate overlap or cover a subagent,
report the evidence gap instead of claiming a complete pair. Token count is not
a dollar-cost estimate: cached tokens and model rates can have different prices.

A unit-fixture constructor in [trial-assessment.test.ts](../tests/trial-assessment.test.ts)
shows the complete shape. Those rows are deliberately fabricated **test inputs**
and are never published as observed trials. Private evidence references should
remain private; publish only references/aggregates that are safe to share.

## How each verdict is derived

Groups are split by skill, revision, provider, model, environment, model settings,
cache condition, rubric, plan, baseline strategy, and baseline review reference. A positive result for one group does not
qualify another provider, model, or warm/cold cache setting.

Within a group, correlated rows contribute one cluster-average token difference
and one cluster-average elapsed-time difference. Totals over all supplied rows
are also reported but cannot inflate the number of independent observations.
Different native baseline designs are never pooled into one qualification.
Qualification requires at least **30 independently audited task/session
clusters**, an audited best available native baseline, complete matched
measurements, held-out status, all attempts,
randomized order, and blinded quality evaluation. Thirty is a project screening
minimum, not a mathematical guarantee or a power analysis.

| Axis | Screen |
| --- | --- |
| Correctness/reliability | Any critical skill error, baseline-pass/skill-fail pair, or lower quality score rejects adoption. Pass counts and unsuccessful tasks stay visible. Consistently improved outcome clusters can pass the paired exact sign test, but failed baselines still prevent an equivalent-success token claim. |
| Tokens | Both arms must successfully complete every included task without critical errors. The unweighted mean of cluster savings must be positive, and the one-sided exact sign-test p-value must be at most 0.05. |
| Performance | Reports whole-task elapsed time only. Any pair over **5% slower** is a material latency regression and blocks adoption. Consistent positive elapsed-time differences with positive mean and sign-test p-value at most 0.05 pass the latency-improvement screen. Otherwise, absence of a material slowdown is reported without claiming faster execution. |

The five-percent threshold is an explicit project screening tolerance, not an
estimated confidence limit. A two-percent observed slowdown can coexist with
`no-observed-material-latency-regression`; the negative timing difference remains
in the report. It does not mean zero overhead. Use a predeclared stricter external
acceptance criterion if a workload requires it. CPU, memory, throughput, and
billing cost are outside this schema and must not be claimed from elapsed time.

The overall `candidate-for-scoped-adoption` verdict requires the token screen,
no correctness regression, successful tasks in both arms, and no material
latency regression. Token savings cannot cancel a correctness failure or a
material slowdown. A correctness regression also rejects the token and
performance axes: faster completion of a worse answer is not an equivalent-task
performance improvement. Individual verdicts remain separate so a token-saving result
cannot be misrepresented as a demonstrated reliability or speed improvement.

## Uncertainty and limits

The exact sign test uses the number of positive and negative cluster-average
differences; zero differences are ties. Under independent clusters and a null
probability of improvement of one half, its one-sided p-value is the binomial
upper-tail probability. It tests direction, **not a lower confidence bound on
mean tokens saved**. The report also includes mean, median, minimum, maximum,
and positive/negative/tie counts. A large outlier or a long repeated session
cannot alone satisfy the direction screen.

When a qualified cohort observes zero skill-failure clusters, the report gives
`1 - 0.05^(1 / n)` as the one-sided 95% upper bound under an independent,
common-probability Bernoulli model. With 30 independent clusters this is about
**9.5%**, not zero risk. For insufficiently qualified cohorts or any observed
failures the bound is `null`; raw failures remain visible. This bound does not
establish a reliability improvement over baseline or cover undetected errors.

The program validates schema, arithmetic, matching, grouping, and declared
qualification. It **does not open evidence references or independently prove
that declarations are true**. Holdout integrity, provider usage semantics,
label quality, baseline competitiveness, independence, and omitted attempts
require an external audit.
The screens are exploratory, have no multiple-comparison correction, and do not
establish non-inferiority of unobserved failure modes. Predeclare a fresh
confirmatory cohort and an appropriate error budget before broader claims.
