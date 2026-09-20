import { expect, test } from "bun:test";
import { runBenchmark } from "./benchmark-harness.ts";

const tokens = { uncached_input: 100, cached_input: 0, cache_write_input: 0, output: 20, input_total: 100, total: 120 };
const arm = (taskSnapshot: string) => ({
  context: { task_snapshot: taskSnapshot, environment: "fixture", model: "fixture-model", model_settings: "fixed", cache_condition: "cold" },
  tokens, accounting: { usage_ref: "private://usage", normalization_ref: "private://normalization", disjoint_buckets: true, whole_task: true, includes_catalog_and_skill: true, includes_followups_retries_subagents: true },
  elapsed_ms: 10, task_pass: true, critical_errors: 0, quality: 1, evaluation_ref: "private://evaluation", evaluator_blinded: true,
});
const row = (id: string, provider: "codex" | "claude" | "devin" = "codex") => ({
  id, skill: "system-one-explore", skill_revision: "fixture", provider, model: "fixture-model", evidence: "observed", plan_ref: "plan-fixture", baseline_strategy: "native-fixture", baseline_review_ref: "private://baseline", baseline_qualified: true, rubric: "rubric-fixture", held_out: true, used_for_tuning: false, all_attempts_included: true, randomized_order: true, order: id.endsWith("a") ? "baseline-first" : "skill-first",
  independence: { task_cluster: id, baseline_session: `${id}-b`, skill_session: `${id}-s`, audited: true, review_ref: "private://review" },
  task_family: "system-one-explore", case_id: `case-${id}`, selection_ref: "private://selection", task_snapshot_sha256: "a".repeat(64), provider_adapter: "fixture-adapter", inclusion_probability: 1, operations: { baseline: { model_turns: 1, tool_calls: 1, followup_reads: 0, retries: 0, repairs: 0, subagent_calls: 0 }, skill: { model_turns: 1, tool_calls: 1, followup_reads: 0, retries: 0, repairs: 0, subagent_calls: 0 } }, skill_discovery: { visible_instruction_tokens: 1, loaded_instruction_tokens: 1 }, selection: { eligible_before_outcome: true, stratum: "fixture", random_seed_ref: "seed" }, baseline: arm("snapshot"), skill_arm: arm("snapshot"),
});

test("runs the empty benchmark without inventing efficacy", () => {
  const report = runBenchmark([]);
  expect(report.status).toBe("no-observed-benchmark-pairs");
  expect(report.observation_count).toBe(0);
});

test("preserves provider-scoped observations and assessor gates", () => {
  const report = runBenchmark([row("a"), row("b", "claude")]);
  expect(report.providers.codex).toBe(1);
  expect(report.providers.claude).toBe(1);
  expect(report.groups[0]!.verdict).toBe("insufficient-evidence");
  expect(report.scorecards).toHaveLength(2);
  expect(report.cross_provider_coverage[0]!.providers_missing).toContain("devin");
});

test("rejects unplanned task families", () => {
  expect(() => runBenchmark([{ ...row("bad"), task_family: "unplanned" }])).toThrow(/task family/);
});
