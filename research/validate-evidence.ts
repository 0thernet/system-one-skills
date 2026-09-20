import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));
const sha = (p: string) => createHash("sha256").update(readFileSync(join(root, p))).digest("hex");
const providers = ["codex", "claude", "devin"];
const metrics = ["tool_calls", "tool_input_bytes", "output_fragments", "tool_output_bytes"];
const zero = () => Object.fromEntries(metrics.map(k => [k, 0])) as Record<string, number>;
const add = (a: Record<string, number>, b: Record<string, number>) => {
  for (const key of metrics) a[key] = (a[key] ?? 0) + (b[key] ?? 0);
  return a;
};
const catalog = read("research/portfolio-report.json");
const calibration = read("research/admission-report.json");
assert.equal(catalog.schema_version, 1);
const corpusPaths = ["research/session-report.json", "research/supplemental-session-report.json"];
assert.deepEqual(Object.keys(catalog.source_files_sha256).sort(), [...corpusPaths, "research/admission-report.json", "bench/report/runtime-report.json"].sort());
for (const path of Object.keys(catalog.source_files_sha256)) assert.equal(catalog.source_files_sha256[path], sha(path), `Stale catalog source: ${path}`);
const corpora = corpusPaths.map(read);
const categories = [...new Set<string>(corpora.flatMap(c => providers.flatMap(p => Object.keys(c.providers[p].workflow_counts))))].sort();
assert.deepEqual(Object.keys(catalog.observed_model_visible_workflows.by_workflow).sort(), categories);
const providerTotals = Object.fromEntries(providers.map(p => [p, zero()]));
for (const category of categories) {
  const expected = Object.fromEntries(providers.map(p => [p, corpora.reduce((acc, c) => add(acc, c.providers[p].workflow_counts[category] ?? {}), zero())]));
  const group = catalog.observed_model_visible_workflows.by_workflow[category];
  assert.deepEqual(group.by_provider, expected);
  assert.deepEqual(group.total, Object.values(expected).reduce(add, zero()));
  for (const p of providers) add(providerTotals[p]!, expected[p]!);
}
assert.deepEqual(catalog.observed_model_visible_workflows.by_provider, providerTotals);
assert.deepEqual(catalog.observed_model_visible_workflows.total, Object.values(providerTotals).reduce(add, zero()));
assert.deepEqual(catalog.shipped_calibration_result.summary, calibration.summary);
assert.deepEqual(catalog.shipped_calibration_result.providers, calibration.providers);
const runtime = read("bench/report/runtime-report.json");
const runtimeCopy = catalog.shipped_runtime_result;
assert.equal(runtimeCopy.source, "bench/report/runtime-report.json");
for (const field of ["evidence_type", "measured_at_utc", "environment", "paired_overhead_all_fixtures"]) assert.deepEqual(runtimeCopy[field], runtime[field]);
assert.equal(runtimeCopy.fixture_count, runtime.cases.length);
assert.equal(runtimeCopy.measured_pairs, runtime.reliability.measured_pairs);
assert.equal(runtimeCopy.warmup_pairs_excluded, runtime.cases.length * runtime.method.warmup_pairs_per_fixture);
assert.equal(runtimeCopy.exact_exit_full_log_and_one_execution_verified_in_every_pair, runtime.reliability.exact_exit_full_log_and_one_execution_verified_in_every_pair);
for (const field of ["passed_tests", "failed_tests", "assertions"]) assert.equal(runtimeCopy.runtime_suite[field], runtime.reliability.existing_runtime_suite[field]);
const inventory = Object.keys(catalog.inventory_source.skill_files_sha256).map(p => p.split("/")[1]).sort();
assert.equal(new Set(inventory).size, 11);
assert.deepEqual(catalog.skills.map((s: {name:string}) => s.name).sort(), inventory);
const shipped = catalog.skills.filter((s: {distribution:string}) => s.distribution === "shipped");
assert.deepEqual(shipped.map((s: {name:string}) => s.name), readdirSync(join(root, "skills")));
assert.equal(catalog.shipped_skill_count, shipped.length);
assert.equal(catalog.research_only_skill_count, catalog.skills.length - shipped.length);
for (const skill of catalog.skills) {
  assert(["shipped", "research_only_not_installed"].includes(skill.distribution));
  const expected = Object.fromEntries(providers.map(p => [p, skill.workflow_categories.reduce((acc: Record<string, number>, category: string) => {
    assert(categories.includes(category));
    return add(acc, catalog.observed_model_visible_workflows.by_workflow[category].by_provider[p]);
  }, zero())]));
  assert.deepEqual(skill.observed_workflow_coverage.by_provider, expected);
  assert.deepEqual(skill.observed_workflow_coverage.total, Object.values(expected).reduce(add, zero()));
}

const protocol = read("research/holdout-protocol.json");
const holdout = read("research/holdout-report.json");
const corpus = read("research/holdout-session-report.json");
assert.equal(holdout.schema_version, 2);
assert.deepEqual(holdout.portfolio, ["system-one-verify"]);
assert.equal(holdout.evaluation_set_role, protocol.purpose);
for (const key of ["private_source_samples_sha256", "private_replay_file_sha256", "private_replay_digest"]) assert.match(holdout[key], /^[a-f0-9]{64}$/);
assert.equal(holdout.protocol_sha256, sha("research/holdout-protocol.json"));
assert.equal(holdout.report_generator_sha256, sha("research/assess_holdout.py"));
assert.equal(corpus.analyzer_sha256, sha("research/analyze_sessions.py"));
assert.deepEqual(corpus.window, protocol.window);
assert.deepEqual(holdout.corpora[0].window, corpus.window);
assert.equal(protocol.collector_adapter_sha256, sha("research/collect_holdout.py"));
assert.equal(corpus.collector_adapter_sha256, protocol.collector_adapter_sha256);
assert.equal(holdout.collector_adapter_sha256, protocol.collector_adapter_sha256);
assert.equal(protocol.amendments.length, 1);
assert(Date.parse(protocol.window.until_exclusive_utc) <= Date.parse(corpora[0].window.since_inclusive_utc));
assert.deepEqual(Object.keys(protocol.evaluated_source_sha256).sort(), Object.keys(calibration.evaluated_source_sha256).sort());
assert.deepEqual(holdout.evaluated_source_sha256, protocol.evaluated_source_sha256);
for (const path of Object.keys(protocol.evaluated_source_sha256)) assert.equal(protocol.evaluated_source_sha256[path], sha(path), `Frozen source changed: ${path}`);
assert.equal(holdout.corpora.length, 1);
assert.equal(holdout.corpora[0].path, "research/holdout-session-report.json");
assert.equal(holdout.corpora[0].file_sha256, sha("research/holdout-session-report.json"));
assert.equal(holdout.corpora[0].corpus_evidence_sha256, corpus.corpus_evidence_sha256);
assert.deepEqual(holdout.tokenizer, calibration.tokenizer);
assert.deepEqual(holdout.overhead, calibration.overhead);
assert.equal(holdout.routing.minimum_expected_output_bytes, protocol.minimum_expected_output_bytes);
assert.equal(holdout.routing.minimum_net_token_margin, protocol.minimum_net_token_margin);
assert.equal(holdout.routing.minimum_expected_output_bytes, 8192);
assert.equal(holdout.routing.minimum_net_token_margin, 128);
const ids = new Set(calibration.samples.map((r: {provider:string;sample_id:string}) => `${r.provider}:${r.sample_id}`));
const invariantKeys = Object.keys(calibration.samples[0].invariants).sort();
for (const row of holdout.samples) {
  assert(providers.includes(row.provider));
  assert.equal(row.cohort, "holdout");
  assert(["tool_result", "completed_command_event"].includes(row.source_view));
  for (const k of ["runtime_compacted", "capture_truncated", "recorded_exit_zero", "meets_net_margin", "routed_by_prior_output_size"]) assert.equal(typeof row[k], "boolean");
  assert.match(row.sample_id, /^[a-f0-9]{64}$/);
  const id = `${row.provider}:${row.sample_id}`;
  assert(!ids.has(id), "Overlapping or repeated replay identity");
  ids.add(id);
  assert.equal(row.routed_by_prior_output_size, row.archived_output_bytes >= 8192);
  for (const k of ["archived_output_bytes", "presented_output_bytes", "archived_output_tokens", "presented_output_tokens"]) assert(Number.isSafeInteger(row[k]) && row[k] >= 0);
  assert.equal(row.output_tokens_saved, row.archived_output_tokens - row.presented_output_tokens);
  assert.equal(row.first_use_incremental_tokens, holdout.overhead.first_use_incremental_tokens);
  assert.equal(row.net_tokens_saved_after_first_use, row.output_tokens_saved - row.first_use_incremental_tokens);
  assert.equal(row.net_tokens_saved_after_invocation_only, row.output_tokens_saved - holdout.overhead.incremental_invocation_tokens);
  assert.equal(row.meets_net_margin, row.net_tokens_saved_after_first_use >= 128);
  assert.deepEqual(Object.keys(row.invariants).sort(), invariantKeys);
  assert(Object.values(row.invariants).every(v => typeof v === "boolean"));
}
// Integrity checks retain negative evidence; they never require a favorable result.
type Row = {
  provider: string; archived_output_bytes: number; runtime_compacted: boolean;
  net_tokens_saved_after_first_use: number; archived_output_tokens: number;
  presented_output_tokens: number; first_use_incremental_tokens: number;
  recorded_exit_zero: boolean; invariants: Record<string, boolean>;
};
function summarize(rows: Row[], threshold = 8192) {
  const selected = rows.filter(r => r.archived_output_bytes >= threshold);
  const deltas = selected.map(r => r.net_tokens_saved_after_first_use);
  return {
    sampled_cases: rows.length, routed_cases: selected.length,
    nonrouted_cases_retained: rows.length - selected.length,
    runtime_compacted_cases: rows.filter(r => r.runtime_compacted).length,
    all_cases_net_tokens_if_invoked_every_time: rows.reduce((n,r) => n+r.net_tokens_saved_after_first_use,0),
    all_cases_with_negative_net: rows.filter(r => r.net_tokens_saved_after_first_use < 0).length,
    routed_archived_output_tokens: selected.reduce((n,r) => n+r.archived_output_tokens,0),
    routed_presented_output_tokens: selected.reduce((n,r) => n+r.presented_output_tokens,0),
    routed_first_use_incremental_tokens: selected.reduce((n,r) => n+r.first_use_incremental_tokens,0),
    routed_net_tokens_saved: deltas.reduce((n,d) => n+d,0),
    routed_minimum_net_tokens_saved: deltas.length ? Math.min(...deltas) : null,
    routed_cases_below_margin: deltas.filter(d => d < 128).length,
    invariant_failures: rows.reduce((n,r) => n+Object.values(r.invariants).filter(v => !v).length,0),
    recorded_nonzero_exits: rows.filter(r => !r.recorded_exit_zero).length,
  };
}
assert.deepEqual(holdout.summary, summarize(holdout.samples));
assert.deepEqual(Object.keys(holdout.providers).sort(), providers.slice().sort());
assert.deepEqual(Object.keys(holdout.corpora[0].providers).sort(), providers.slice().sort());
for (const provider of providers) {
  const source = corpus.providers[provider];
  const rows = holdout.samples.filter((r: Row) => r.provider === provider);
  const eligible = source.selection_and_exclusions.replay_eligible_completed_validation_outputs ?? 0;
  assert.equal(rows.length, Math.min(12, eligible), `Selected ${provider} rows must not be silently removed`);
  assert.deepEqual(holdout.providers[provider], summarize(rows));
  assert.deepEqual(holdout.corpora[0].providers[provider], {
    contributing_session_groups: source.sessions_with_selected_evidence,
    unique_tool_calls: source.unique_tool_calls, eligible_replay_outputs: eligible,
  });
}
assert.deepEqual(holdout.threshold_sensitivity, [4096,8192,16384,32768].map(threshold => ({minimum_output_bytes:threshold,...summarize(holdout.samples, threshold)})));
const expectedOutcome = holdout.summary.invariant_failures ? "preservation-failure" : holdout.summary.routed_cases_below_margin ? "routed-token-margin-failure" : !holdout.summary.routed_cases ? "no-eligible-routed-cases" : "selected-replays-clear-token-margin";
assert.equal(holdout.outcome, expectedOutcome);
// A prepared, blocked experiment is not a zero-cost successful observation.
const diagnosis = read("research/diagnosis-pilot-report.json");
assert.equal(diagnosis.evidence_kind, "evaluation-readiness-record");
assert.equal(diagnosis.status, "blocked-before-model-execution");
assert.equal(diagnosis.prepared_cases, 1);
assert.equal(diagnosis.planned_model_sessions, 2);
assert.equal(diagnosis.model_sessions_started, 0);
assert.equal(diagnosis.completed_pairs, 0);
for (const field of ["observed_token_usage", "observed_diagnosis_scores", "observed_task_latency_ms"]) assert.equal(diagnosis[field], null);
for (const field of ["private_plan_sha256", "source_log_sha256", "source_annotation_sha256"]) assert.match(diagnosis[field], /^[a-f0-9]{64}$/);
assert.equal(diagnosis.skill_sha256, sha("skills/system-one-verify/SKILL.md"));
assert.equal(diagnosis.execution_block.type, "automatic-approval-review-rejection");
assert.equal(diagnosis.execution_block.payload_transmitted, false);
assert.equal(diagnosis.execution_block.retry_or_workaround_attempted, false);
assert.equal(diagnosis.accounting.estimated_258_token_overhead_added, false);
console.log(`Evidence integrity: ${inventory.length} skills catalogued; unused replay cohort outcome=${holdout.outcome}. Negative results are publishable.`);
