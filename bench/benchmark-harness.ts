#!/usr/bin/env bun
/**
 * Validate and score provider-adapter observations against the frozen benchmark
 * protocol. This harness deliberately does not launch a model: provider
 * adapters must capture complete native usage and private task evidence, then
 * submit opaque observations for the existing whole-task assessor.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assessTrials } from "./assess-trials.ts";

const protocol = JSON.parse(readFileSync(new URL("./benchmark-protocol.json", import.meta.url), "utf8"));
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const probability = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1;
const providers = new Set(["codex", "claude", "devin"]);

type Observation = Record<string, any>;

function validateHarnessRows(rows: unknown): Observation[] {
  if (!Array.isArray(rows)) throw new Error("observations must be a JSON array");
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") throw new Error("observation must be an object");
    const r = row as Observation;
    for (const key of ["id", "task_family", "case_id", "selection_ref", "task_snapshot_sha256", "provider_adapter", "plan_ref"]) {
      if (!text(r[key])) throw new Error(`missing harness field: ${key}`);
    }
    if (ids.has(r.id)) throw new Error(`duplicate observation id: ${r.id}`);
    ids.add(r.id);
    if (!protocol.task_families[r.task_family]) throw new Error(`task family is not in the protocol: ${r.task_family}`);
    if (!providers.has(r.provider)) throw new Error(`provider is not planned: ${r.provider}`);
    for (const key of ["skill_revision", "model", "rubric", "baseline_strategy", "baseline_review_ref"]) if (!text(r[key])) throw new Error(`missing assessor field: ${key}`);
    if (!/^([a-f0-9]{64})$/.test(r.task_snapshot_sha256)) throw new Error("task_snapshot_sha256 must be a SHA-256 hex digest");
    if (!probability(r.inclusion_probability)) throw new Error("inclusion_probability must be a finite number in (0,1]");
    if (!r.operations || !["baseline", "skill"].every(arm => r.operations[arm] && ["model_turns", "tool_calls", "followup_reads", "retries", "repairs", "subagent_calls"].every(k => count(r.operations[arm][k])))) throw new Error(`incomplete per-arm operation accounting for ${r.id}`);
    if (!r.skill_discovery || !count(r.skill_discovery.visible_instruction_tokens) || !count(r.skill_discovery.loaded_instruction_tokens)) throw new Error(`incomplete skill-discovery accounting for ${r.id}`);
    if (!r.selection || typeof r.selection.eligible_before_outcome !== "boolean" || !text(r.selection.stratum) || !text(r.selection.random_seed_ref)) throw new Error(`incomplete selection provenance for ${r.id}`);
    if (!r.selection.eligible_before_outcome) throw new Error(`observation was not eligible before outcome evaluation: ${r.id}`);
    if (!r.baseline || !r.skill_arm) throw new Error(`missing paired arms for ${r.id}`);
  }
  return rows;
}

function toAssessorShape(rows: Observation[]) {
  // Existing assessTrials is the authoritative whole-task metric engine. Extra
  // harness fields are retained in the private observation file and do not
  // alter its provider-scoped grouping or cluster accounting.
  return rows.map(row => ({ ...row, skill: row.skill ?? row.task_family }));
}

function scorecards(rows: Observation[]) {
  const keys = new Map<string, Observation[]>();
  for (const row of rows) {
    const key = `${row.provider}|${row.model}|${row.task_family}`;
    keys.set(key, [...(keys.get(key) ?? []), row]);
  }
  return [...keys.entries()].sort().map(([key, group]) => {
    const [provider, model, task_family] = key.split("|");
    const baselineTokens = group.reduce((n, r) => n + r.baseline.tokens.total, 0);
    const skillTokens = group.reduce((n, r) => n + r.skill_arm.tokens.total, 0);
    const baselineElapsed = group.reduce((n, r) => n + r.baseline.elapsed_ms, 0);
    const skillElapsed = group.reduce((n, r) => n + r.skill_arm.elapsed_ms, 0);
    const operationTotals = (arm: "baseline" | "skill") => Object.fromEntries(["model_turns", "tool_calls", "followup_reads", "retries", "repairs", "subagent_calls"].map(k => [k, group.reduce((n, r) => n + r.operations[arm][k], 0)]));
    return {
      provider, model, task_family, matched_pairs: group.length,
      declared_task_clusters: new Set(group.map(r => r.independence.task_cluster)).size,
      baseline_total_tokens: baselineTokens, skill_total_tokens: skillTokens,
      recorded_tokens_delta: baselineTokens - skillTokens,
      recorded_tokens_delta_pct: baselineTokens ? (100 * (baselineTokens - skillTokens) / baselineTokens) : null,
      baseline_passes: group.filter(r => r.baseline.task_pass).length,
      skill_passes: group.filter(r => r.skill_arm.task_pass).length,
      baseline_elapsed_ms: baselineElapsed, skill_elapsed_ms: skillElapsed,
      elapsed_delta_pct: baselineElapsed ? (100 * (skillElapsed - baselineElapsed) / baselineElapsed) : null,
      baseline_operations: operationTotals("baseline"), skill_operations: operationTotals("skill"),
      correlated_extra_rows: group.length - new Set(group.map(r => r.independence.task_cluster)).size,
      scorecard_totals_are_raw_rows: true,
    };
  });
}

function crossProviderCoverage(rows: Observation[]) {
  const keys = new Map<string, Observation[]>();
  for (const row of rows) {
    const key = `${row.task_family}|${row.task_snapshot_sha256}`;
    keys.set(key, [...(keys.get(key) ?? []), row]);
  }
  return [...keys.entries()].sort().map(([key, group]) => {
    const [task_family, task_snapshot_sha256] = key.split("|");
    const present = [...new Set(group.map(r => r.provider))].sort();
    return { task_family, task_snapshot_sha256, providers_present: present, providers_missing: [...providers].filter(p => !present.includes(p)).sort(), clusters_by_provider: Object.fromEntries([...providers].sort().map(p => [p, new Set(group.filter(r => r.provider === p).map(r => r.independence.task_cluster)).size])) };
  });
}

export function runBenchmark(observations: unknown) {
  const rows = validateHarnessRows(observations);
  const groups = assessTrials(toAssessorShape(rows));
  return {
    schema_version: 1,
    protocol_sha256: sha256(JSON.stringify(protocol)),
    observation_count: rows.length,
    providers: Object.fromEntries(["codex", "claude", "devin"].map(provider => [provider, rows.filter(row => row.provider === provider).length])),
    task_families: Object.fromEntries(Object.keys(protocol.task_families).map(family => [family, rows.filter(row => row.task_family === family).length])),
    scorecards: scorecards(rows),
    cross_provider_coverage: crossProviderCoverage(rows),
    groups,
    status: rows.length ? "assessed-provider-scoped-groups" : "no-observed-benchmark-pairs",
    limitations: "Provider adapters and private evidence references are not independently verified by this CLI. A result is exploratory until the protocol's holdout, baseline, independence, accounting, correctness, latency, and sample-size gates pass.",
  };
}

if (import.meta.main) {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input) throw new Error("usage: bun bench/benchmark-harness.ts observations.json [report.json]");
  const report = runBenchmark(JSON.parse(readFileSync(input, "utf8")));
  const rendered = JSON.stringify(report, null, 2) + "\n";
  if (output) writeFileSync(output, rendered);
  else process.stdout.write(rendered);
}
