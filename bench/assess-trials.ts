#!/usr/bin/env bun
// Score observed paired trials; this does not manufacture model runs or labels.
import { readFileSync } from "node:fs";

type Arm = {
  tokens: { uncached_input: number; cached_input: number; cache_write_input: number; output: number };
  task_pass: boolean;
  critical_errors: number;
  quality: number;
};
export type Trial = {
  id: string;
  skill: string;
  provider: "devin" | "claude" | "codex";
  model: string;
  snapshot: string;
  evidence: "observed";
  held_out: boolean;
  all_overhead_included: boolean;
  baseline: Arm;
  skill_arm: Arm;
};
const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const tokenTotal = (a: Arm) => Object.values(a.tokens).reduce((a,b)=>a+b,0);

/** Conservative admission: quality cannot be traded away for shorter output. */
export function assessTrials(trials: Trial[]) {
  if (!Array.isArray(trials) || !trials.length) throw new Error("expected nonempty observed trial array");
  const ids = new Set<string>();
  const groups = new Map<string, Trial[]>();
  for (const t of trials) {
    if (!t || !t.id || ids.has(t.id) || !t.skill || !t.model || !t.snapshot ||
        !["devin","claude","codex"].includes(t.provider) || t.evidence !== "observed" ||
        typeof t.held_out !== "boolean" || typeof t.all_overhead_included !== "boolean") throw new Error("invalid, duplicate, or unobserved trial");
    ids.add(t.id);
    for (const a of [t.baseline,t.skill_arm]) {
      if (!a?.tokens || Object.keys(a.tokens).sort().join() !== "cache_write_input,cached_input,output,uncached_input" ||
          !Object.values(a.tokens).every(n=>finite(n)&&Number.isInteger(n)) ||
          typeof a.task_pass !== "boolean" || !finite(a.critical_errors) || !Number.isInteger(a.critical_errors) ||
          !finite(a.quality) || a.quality > 1) throw new Error("invalid arm metrics; token buckets must be disjoint, quality 0..1");
    }
    const key = `${t.skill}/${t.provider}/${t.model}`;
    groups.set(key,[...(groups.get(key) ?? []),t]);
  }
  return [...groups.entries()].map(([group, rows]) => {
    const deltas = rows.map(t=>tokenTotal(t.baseline)-tokenTotal(t.skill_arm));
    const mean = deltas.reduce((a,b)=>a+b,0)/rows.length;
    const sd = rows.length > 1 ? Math.sqrt(deltas.reduce((n,d)=>n+(d-mean)**2,0)/(rows.length-1)) : 0;
    const lower = rows.length >= 30 ? mean-1.96*sd/Math.sqrt(rows.length) : null;
    const regressions = rows.filter(t=>!t.skill_arm.task_pass || t.skill_arm.critical_errors > 0 || t.skill_arm.quality < t.baseline.quality).length;
    const complete = rows.every(t=>t.held_out && t.all_overhead_included);
    return {
      group, pairs:rows.length,
      baseline_tokens: rows.reduce((n,t)=>n+tokenTotal(t.baseline),0),
      skill_tokens: rows.reduce((n,t)=>n+tokenTotal(t.skill_arm),0),
      mean_tokens_saved:mean, approximate_95pct_lower_bound:lower,
      quality_regressions:regressions,
      verdict: regressions ? "reject-quality-regression" : !complete || lower === null ? "insufficient-evidence" : lower > 0 ? "candidate-for-adoption" : "no-demonstrated-net-savings",
      limitations:"30 independent held-out pairs is a screening minimum, not a guarantee. Approximate normal interval; repeated tasks from one session are correlated. Audit labels, tails, cache buckets and provider costs before adoption.",
    };
  });
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) throw new Error("usage: bun bench/assess-trials.ts private-observed-trials.json");
  console.log(JSON.stringify(assessTrials(JSON.parse(readFileSync(file,"utf8"))),null,2));
}
