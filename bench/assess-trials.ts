#!/usr/bin/env bun
// Assess supplied observations, not generated model runs. See TRIALS.md.
import { readFileSync } from "node:fs";

type Context = {
  task_snapshot: string;
  environment: string;
  model: string;
  model_settings: string;
  cache_condition: string;
};
type Arm = {
  context: Context;
  tokens: {
    uncached_input: number;
    cached_input: number;
    cache_write_input: number;
    output: number;
    input_total: number;
    total: number;
  };
  accounting: {
    usage_ref: string;
    normalization_ref: string;
    disjoint_buckets: boolean;
    whole_task: boolean;
    includes_catalog_and_skill: boolean;
    includes_followups_retries_subagents: boolean;
  };
  elapsed_ms: number;
  task_pass: boolean;
  critical_errors: number;
  quality: number;
  evaluation_ref: string;
  evaluator_blinded: boolean;
};
export type Trial = {
  id: string;
  skill: string;
  skill_revision: string;
  provider: "devin" | "claude" | "codex";
  model: string;
  evidence: "observed";
  plan_ref: string;
  baseline_strategy: string;
  baseline_review_ref: string;
  baseline_qualified: boolean;
  rubric: string;
  held_out: boolean;
  used_for_tuning: boolean;
  all_attempts_included: boolean;
  randomized_order: boolean;
  order: "baseline-first" | "skill-first";
  independence: {
    task_cluster: string;
    baseline_session: string;
    skill_session: string;
    audited: boolean;
    review_ref: string;
  };
  baseline: Arm;
  skill_arm: Arm;
};

const MIN_CLUSTERS = 30;
const MAX_LATENCY_REGRESSION = 0.05;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isFiniteNonnegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const mean = (xs: number[]) => {
  const sum=xs.reduce((a,b)=>a+b,0);
  if (!Number.isFinite(sum)) throw new Error("nonfinite aggregate metric; elapsed-time or token arithmetic overflow");
  return sum/xs.length;
};
const median = (xs: number[]) => { const a=[...xs].sort((a,b)=>a-b); return (a[Math.floor((a.length-1)/2)]!+a[Math.floor(a.length/2)]!)/2; };
const contextKeys = ["task_snapshot","environment","model","model_settings","cache_condition"] as const;
const accountingFlags = ["disjoint_buckets","whole_task","includes_catalog_and_skill","includes_followups_retries_subagents"] as const;

function validate(value: unknown): Trial[] {
  if (!Array.isArray(value)) throw new Error("expected observed trial array");
  const ids=new Set<string>();
  for (const t of value) {
    if (!t || !["id","skill","skill_revision","model","plan_ref","baseline_strategy","baseline_review_ref","rubric"].every(k=>isText(t[k])) ||
        ids.has(t.id) || !["devin","claude","codex"].includes(t.provider) || t.evidence!=="observed" ||
        !["held_out","used_for_tuning","all_attempts_included","randomized_order","baseline_qualified"].every(k=>typeof t[k]==="boolean") ||
        !["baseline-first","skill-first"].includes(t.order)) throw new Error("invalid, duplicate, or unobserved trial");
    ids.add(t.id);
    if (!t.independence || !["task_cluster","baseline_session","skill_session","review_ref"].every(k=>isText(t.independence[k])) ||
        typeof t.independence.audited!=="boolean") throw new Error("missing independence audit and task/session cluster identifiers");
    for (const a of [t.baseline,t.skill_arm]) {
      if (!a?.context || !contextKeys.every(k=>isText(a.context[k])) || !a.accounting ||
          !["usage_ref","normalization_ref"].every(k=>isText(a.accounting[k])) ||
          !accountingFlags.every(k=>typeof a.accounting[k]==="boolean") || !a.tokens ||
          Object.keys(a.tokens).sort().join()!=="cache_write_input,cached_input,input_total,output,total,uncached_input" ||
          !Object.values(a.tokens).every(isCount) || !isFiniteNonnegative(a.elapsed_ms) || a.elapsed_ms===0 ||
          typeof a.task_pass!=="boolean" || !isCount(a.critical_errors) ||
          !isFiniteNonnegative(a.quality) || a.quality>1 || !isText(a.evaluation_ref) ||
          typeof a.evaluator_blinded!=="boolean") throw new Error("invalid arm: require complete whole-task token, elapsed time, outcome, and quality metrics");
      const input=a.tokens.uncached_input+a.tokens.cached_input+a.tokens.cache_write_input;
      if (!Number.isSafeInteger(input) || input!==a.tokens.input_total || input+a.tokens.output!==a.tokens.total || a.tokens.total===0)
        throw new Error("token buckets must reconcile to normalized input_total and total; do not add overlapping provider counters");
    }
  }
  return value as Trial[];
}

/** Correlated rows share a task OR either agent session, transitively. */
function clusters(rows: Trial[]): Trial[][] {
  const parent=rows.map((_,i)=>i);
  const root=(i:number):number => parent[i]===i ? i : (parent[i]=root(parent[i]!));
  const seen=new Map<string,number>();
  rows.forEach((t,i)=>{
    for (const k of [`task:${t.independence.task_cluster}`,`session:${t.independence.baseline_session}`,`session:${t.independence.skill_session}`]) {
      const previous=seen.get(k);
      if (previous!==undefined) parent[root(i)]=root(previous);
      seen.set(k,i);
    }
  });
  const grouped=new Map<number,Trial[]>();
  rows.forEach((t,i)=>{const k=root(i); grouped.set(k,[...(grouped.get(k)??[]),t]);});
  return [...grouped.values()];
}

/** P(X >= wins), X ~ Binomial(n, 1/2). Log arithmetic avoids overflow. */
function positiveSignP(wins:number,n:number):number {
  if (!n || !wins) return 1;
  let logP=-n*Math.LN2;
  let total=0;
  for(let k=0;k<=n;k++) {
    if(k>=wins) total+=Math.exp(logP);
    if(k<n) logP+=Math.log(n-k)-Math.log(k+1);
  }
  return Math.min(1,total);
}
function deltaSummary(values:number[]) {
  const positive=values.filter(n=>n>0).length, negative=values.filter(n=>n<0).length;
  return {
    mean:mean(values), median:median(values), minimum:Math.min(...values), maximum:Math.max(...values),
    positive, negative, ties:values.length-positive-negative,
    one_sided_sign_test_p:positiveSignP(positive,positive+negative),
  };
}

/** Separate conditional screens. No transcript replay or scalar score proves universal goodness. */
export function assessTrials(value: unknown) {
  const trials=validate(value);
  const groups=new Map<string,Trial[]>();
  for (const t of trials) {
    const c=t.baseline.context;
    const key=JSON.stringify([t.skill,t.skill_revision,t.provider,t.model,c.environment,c.model_settings,c.cache_condition,t.rubric,t.plan_ref,t.baseline_strategy,t.baseline_review_ref]);
    groups.set(key,[...(groups.get(key)??[]),t]);
  }
  return [...groups.values()].map(rows=>{
    const t=rows[0]!, c=t.baseline.context;
    const grouped=clusters(rows);
    const blockers=new Set<string>();
    if (!rows.every(r=>r.baseline_qualified)) blockers.add("best-available-native-baseline-not-qualified");
    if (grouped.length<MIN_CLUSTERS) blockers.add("fewer-than-30-independent-task-session-clusters");
    if (!rows.every(r=>r.held_out && !r.used_for_tuning && r.all_attempts_included)) blockers.add("holdout-tuning-or-attempt-coverage-not-qualified");
    if (!rows.every(r=>r.independence.audited)) blockers.add("independence-not-audited");
    if (rows.some(r=>r.independence.baseline_session===r.independence.skill_session)) blockers.add("paired-arms-share-session");
    if (!rows.every(r=>r.randomized_order) || new Set(rows.map(r=>r.order)).size<2) blockers.add("randomized-crossover-order-not-qualified");
    if (!rows.every(r=>contextKeys.every(k=>r.baseline.context[k]===r.skill_arm.context[k]) && r.model===r.baseline.context.model)) blockers.add("baseline-skill-context-mismatch");
    if (!rows.every(r=>[r.baseline,r.skill_arm].every(a=>accountingFlags.every(k=>a.accounting[k])))) blockers.add("incomplete-or-overlapping-token-accounting");
    if (!rows.every(r=>r.baseline.evaluator_blinded && r.skill_arm.evaluator_blinded)) blockers.add("quality-evaluation-not-blinded");
    const baselineTotal=rows.reduce((n,r)=>n+r.baseline.tokens.total,0);
    const skillTotal=rows.reduce((n,r)=>n+r.skill_arm.tokens.total,0);
    if (!Number.isSafeInteger(baselineTotal) || !Number.isSafeInteger(skillTotal)) throw new Error("aggregate token count exceeds safe integer precision");
    const sufficient=blockers.size===0;
    const regressions=rows.filter(r=>r.skill_arm.critical_errors>0 || (r.baseline.task_pass && !r.skill_arm.task_pass) || r.skill_arm.quality<r.baseline.quality).length;
    const unsuccessful=rows.filter(r=>!r.baseline.task_pass || !r.skill_arm.task_pass || r.baseline.critical_errors>0 || r.skill_arm.critical_errors>0).length;
    const failureClusters=grouped.filter(rs=>rs.some(r=>!r.skill_arm.task_pass || r.skill_arm.critical_errors>0)).length;
    const reliabilityWins=grouped.filter(rs=>rs.some(r=>!r.baseline.task_pass && r.skill_arm.task_pass) && rs.every(r=>r.skill_arm.task_pass)).length;
    const reliabilityLosses=grouped.filter(rs=>rs.some(r=>r.baseline.task_pass && !r.skill_arm.task_pass)).length;
    const tokens=deltaSummary(grouped.map(rs=>mean(rs.map(r=>r.baseline.tokens.total-r.skill_arm.tokens.total))));
    const latency=deltaSummary(grouped.map(rs=>mean(rs.map(r=>r.baseline.elapsed_ms-r.skill_arm.elapsed_ms))));
    const slowPairs=rows.filter(r=>r.skill_arm.elapsed_ms>r.baseline.elapsed_ms*(1+MAX_LATENCY_REGRESSION)).length;
    const zeroFailureUpper=sufficient && failureClusters===0 ? 1-Math.pow(0.05,1/grouped.length) : null;
    const reliabilityP=positiveSignP(reliabilityWins,reliabilityWins+reliabilityLosses);
    const qualityVerdict=regressions ? "reject-correctness-regression" : !sufficient ? "insufficient-evidence" :
      failureClusters ? "observed-task-failures" : reliabilityWins && reliabilityP<=0.05 ? "reliability-improvement-screen-passed" : "observed-non-regression";
    const tokenVerdict=regressions ? "reject-correctness-regression" : !sufficient || unsuccessful ? "insufficient-evidence" :
      tokens.mean>0 && tokens.one_sided_sign_test_p<=0.05 ? "token-saving-screen-passed" : "no-demonstrated-net-savings";
    const performanceVerdict=regressions ? "reject-correctness-regression" : slowPairs ? "observed-latency-regression" : !sufficient || unsuccessful ? "insufficient-evidence" :
      latency.mean>0 && latency.one_sided_sign_test_p<=0.05 ? "latency-improvement-screen-passed" : "no-observed-material-latency-regression";
    return {
      group:{skill:t.skill,skill_revision:t.skill_revision,provider:t.provider,model:t.model,environment:c.environment,model_settings:c.model_settings,cache_condition:c.cache_condition,rubric:t.rubric,plan_ref:t.plan_ref,baseline_strategy:t.baseline_strategy,baseline_review_ref:t.baseline_review_ref},
      pairs:rows.length, independent_clusters:grouped.length, correlated_extra_rows:rows.length-grouped.length,
      qualification_blockers:[...blockers],
      quality:{verdict:qualityVerdict, regression_pairs:regressions, baseline_passes:rows.filter(r=>r.baseline.task_pass).length, skill_passes:rows.filter(r=>r.skill_arm.task_pass).length,
        unsuccessful_pairs:unsuccessful, skill_failure_clusters:failureClusters, reliability_win_clusters:reliabilityWins,reliability_loss_clusters:reliabilityLosses,
        one_sided_reliability_sign_test_p:reliabilityP, zero_observed_failure_rate_upper_95:zeroFailureUpper},
      tokens:{verdict:tokenVerdict,baseline_total:baselineTotal,skill_total:skillTotal,cluster_mean_savings:tokens},
      performance:{verdict:performanceVerdict,metric:"whole-task elapsed milliseconds",material_regression_threshold_pct:MAX_LATENCY_REGRESSION*100,material_regression_pairs:slowPairs,cluster_mean_ms_saved:latency},
      verdict:regressions ? "reject-correctness-regression" : !sufficient || unsuccessful ? "insufficient-evidence" : slowPairs ? "reject-latency-regression" :
        tokenVerdict==="token-saving-screen-passed" ? "candidate-for-scoped-adoption" : "no-demonstrated-net-savings",
      limitations:"Conditional exploratory screens for this declared scope, not proof of universal savings, reliability, or speed. References and independence require external audit. Correlated rows count once. Sign tests concern the direction of cluster-average differences, not a confidence bound on mean savings. No multiple-comparison correction; preregister a fresh confirmatory cohort before a broader claim. Zero observed failures never means zero risk.",
    };
  });
}

if (import.meta.main) {
  const file=process.argv[2];
  if(!file) throw new Error("usage: bun bench/assess-trials.ts private-observed-trials.json");
  const results=assessTrials(JSON.parse(readFileSync(file,"utf8")));
  console.log(JSON.stringify({schema_version:2,status:results.length?"assessed":"no-observed-trials",groups:results},null,2));
}
