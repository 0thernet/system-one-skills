import { expect, test } from "bun:test";
import { assessTrials, type Trial } from "../bench/assess-trials.ts";

// Fabricated unit fixtures exercise the assessor, never enter published observations.
const pair=(i:number):Trial=>{
  const context={task_snapshot:`fixture-task-${i}`,environment:"fixture-env",model:"fixture-model",model_settings:"fixture-settings",cache_condition:"cold-cache"};
  const arm=(input:number)=>({context:{...context},tokens:{uncached_input:input,cached_input:200,cache_write_input:0,output:10,input_total:input+200,total:input+210},
    accounting:{usage_ref:`private-fixture-usage-${i}`,normalization_ref:"fixture-normalization",disjoint_buckets:true,whole_task:true,includes_catalog_and_skill:true,includes_followups_retries_subagents:true},
    elapsed_ms:100,task_pass:true,critical_errors:0,quality:1,evaluation_ref:`private-fixture-evaluation-${i}`,evaluator_blinded:true});
  return {id:String(i),skill:"system-one-verify",skill_revision:"fixture-revision",provider:"codex",model:"fixture-model",evidence:"observed",plan_ref:"fixture-plan",baseline_strategy:"fixture-best-native",baseline_review_ref:"fixture-baseline-audit",baseline_qualified:true,rubric:"fixture-rubric",held_out:true,used_for_tuning:false,all_attempts_included:true,randomized_order:true,order:i%2?"baseline-first":"skill-first",
    independence:{task_cluster:`task-${i}`,baseline_session:`baseline-session-${i}`,skill_session:`skill-session-${i}`,audited:true,review_ref:"fixture-independence-audit"},baseline:arm(100),skill_arm:arm(50)};
};
const cohort=()=>Array.from({length:30},(_,i)=>pair(i));
const report=(rows:Trial[])=>assessTrials(rows)[0]!;
const input=(r:Trial,n:number)=>{
  r.skill_arm.tokens.uncached_input=n;
  r.skill_arm.tokens.input_total=n+r.skill_arm.tokens.cached_input+r.skill_arm.tokens.cache_write_input;
  r.skill_arm.tokens.total=r.skill_arm.tokens.input_total+r.skill_arm.tokens.output;
};

test("empty and small cohorts cannot be promoted, and duplicates are malformed",()=>{
  expect(assessTrials([])).toEqual([]);
  expect(report([pair(1)]).verdict).toBe("insufficient-evidence");
  expect(report([pair(1)]).quality.zero_observed_failure_rate_upper_95).toBeNull();
  expect(()=>assessTrials([pair(1),pair(1)])).toThrow("duplicate");
  expect(()=>assessTrials(null)).toThrow("array");
});
test("fully declared independent pairs produce only scoped screening evidence",()=>{
  const r=report(cohort());
  expect(r.verdict).toBe("candidate-for-scoped-adoption");
  expect(r.tokens.cluster_mean_savings.mean).toBe(50);
  expect(r.tokens.cluster_mean_savings.one_sided_sign_test_p).toBeCloseTo(2**-30,12);
  expect(r.quality.verdict).toBe("observed-non-regression");
  expect(r.performance.verdict).toBe("no-observed-material-latency-regression");
  expect(r.quality.zero_observed_failure_rate_upper_95).toBeCloseTo(0.09503,4);
});
test("any task failure, critical error, or quality reduction defeats shorter logs",()=>{
  for(const mutate of [(r:Trial)=>r.skill_arm.task_pass=false,(r:Trial)=>r.skill_arm.critical_errors=1,(r:Trial)=>r.skill_arm.quality=0.99]) {
    const rows=cohort(); mutate(rows[0]!);
    const r=report(rows);
    expect(r.verdict).toBe("reject-correctness-regression");
    expect(r.tokens.verdict).toBe("reject-correctness-regression");
    expect(r.performance.verdict).toBe("reject-correctness-regression");
    expect(r.quality.regression_pairs).toBe(1);
  }
});
test("unsuccessful baseline tasks remain in totals and cannot prove equivalent-task token savings",()=>{
  const rows=cohort(); rows[0]!.baseline.task_pass=false;
  const r=report(rows);
  expect(r.tokens.baseline_total).toBe(9300);
  expect(r.tokens.verdict).toBe("insufficient-evidence");
  expect(r.verdict).toBe("insufficient-evidence");
  expect(r.quality.reliability_win_clusters).toBe(1);
});
test("synthetic and calibration inputs cannot be presented as observations",()=>{
  for(const evidence of ["synthetic","calibration"]){
    expect(()=>assessTrials([{...pair(1),evidence}])).toThrow("unobserved");
  }
  for(const key of ["used_for_tuning","held_out","all_attempts_included","randomized_order"] as const){
    const rows=cohort(); rows[0]![key]=key==="used_for_tuning";
    expect(report(rows).verdict).toBe("insufficient-evidence");
  }
});
test("repeated tasks and shared sessions are clustered transitively",()=>{
  const rows=cohort(); rows.forEach(r=>r.independence.task_cluster="one-task");
  let r=report(rows);
  expect(r.independent_clusters).toBe(1);
  expect(r.correlated_extra_rows).toBe(29);
  expect(r.verdict).toBe("insufficient-evidence");
  const chain=cohort();
  chain.forEach((t,i)=>{t.independence.baseline_session=`shared-${i}`;t.independence.skill_session=`shared-${i+1}`;});
  r=report(chain);
  expect(r.independent_clusters).toBe(1);
  expect(r.verdict).toBe("insufficient-evidence");
});
test("extra correlated rows cannot dominate the direction or average of independent effects",()=>{
  const rows=cohort();
  for(let i=1;i<30;i++) input(rows[i]!,101);
  for(let i=30;i<130;i++){
    const t=pair(i);t.independence.task_cluster=rows[0]!.independence.task_cluster;rows.push(t);
  }
  const r=report(rows);
  expect(r.independent_clusters).toBe(30);
  expect(r.tokens.cluster_mean_savings.positive).toBe(1);
  expect(r.tokens.cluster_mean_savings.negative).toBe(29);
  expect(r.verdict).toBe("no-demonstrated-net-savings");
});
test("unreviewed independence and missing complete accounting cannot qualify",()=>{
  const changes=[(r:Trial)=>r.independence.audited=false,(r:Trial)=>r.skill_arm.evaluator_blinded=false,
    ...(["whole_task","disjoint_buckets","includes_catalog_and_skill","includes_followups_retries_subagents"] as const).map(k=>(r:Trial)=>r.skill_arm.accounting[k]=false)];
  for(const change of changes){const rows=cohort();change(rows[0]!);expect(report(rows).verdict).toBe("insufficient-evidence");}
});
test("mismatched snapshot, environment, model, settings, or cache cannot qualify",()=>{
  for(const k of ["task_snapshot","environment","model","model_settings","cache_condition"] as const){
    const rows=cohort(); rows[0]!.skill_arm.context[k]="different";
    expect(report(rows).qualification_blockers).toContain("baseline-skill-context-mismatch");
    expect(report(rows).verdict).toBe("insufficient-evidence");
  }
});
test("model/provider/skill/revision/cache strata cannot pool small samples into qualification",()=>{
  for(const change of [(r:Trial)=>r.provider="claude",(r:Trial)=>r.skill="another-skill",(r:Trial)=>r.skill_revision="another-revision",(r:Trial)=>r.baseline_strategy="another-native-strategy",
    (r:Trial)=>{r.model="another-model";r.baseline.context.model=r.skill_arm.context.model=r.model;},
    (r:Trial)=>r.baseline.context.cache_condition=r.skill_arm.context.cache_condition="warm-cache"]){
    const rows=cohort();rows.slice(15).forEach(change);
    const result=assessTrials(rows);
    expect(result.length).toBe(2);
    expect(result.every(r=>r.verdict==="insufficient-evidence")).toBe(true);
  }
});
test("missing latency, malformed token counts, and overlapping totals fail parsing",()=>{
  for(const corrupt of [(r:any)=>delete r.skill_arm.elapsed_ms,(r:any)=>r.skill_arm.elapsed_ms=NaN,
    (r:any)=>r.skill_arm.tokens.total++, (r:any)=>r.skill_arm.tokens.input_total++,
    (r:any)=>r.skill_arm.tokens.total_input=250,(r:any)=>r.skill_arm.tokens.uncached_input=1.5,
    (r:any)=>r.skill_arm.tokens.uncached_input=Number.MAX_SAFE_INTEGER+1,
    (r:any)=>r.skill_arm.quality=2,(r:any)=>r.skill_arm.accounting.usage_ref=" "]){
    const t=pair(1);corrupt(t);expect(()=>assessTrials([t])).toThrow();
  }
});
test("net increases, ties, and one enormous outlier do not prove consistent savings",()=>{
  for(const set of [(rows:Trial[])=>rows.forEach(r=>input(r,100)),(rows:Trial[])=>rows.forEach(r=>input(r,150)),
    (rows:Trial[])=>rows.slice(1).forEach(r=>input(r,101))]){
    const rows=cohort();set(rows);expect(report(rows).tokens.verdict).toBe("no-demonstrated-net-savings");
  }
});
test("latency is assessed separately and a material slowdown blocks adoption despite token savings",()=>{
  const rows=cohort(); rows[0]!.skill_arm.elapsed_ms=106;
  const r=report(rows);
  expect(r.tokens.verdict).toBe("token-saving-screen-passed");
  expect(r.performance.verdict).toBe("observed-latency-regression");
  expect(r.performance.material_regression_pairs).toBe(1);
  expect(r.verdict).toBe("reject-latency-regression");
});
test("latency improvement needs consistent independent gains, not only token gains",()=>{
  const rows=cohort(); rows.forEach(r=>r.skill_arm.elapsed_ms=90);
  expect(report(rows).performance.verdict).toBe("latency-improvement-screen-passed");
  rows.forEach(r=>r.skill_arm.elapsed_ms=104);
  expect(report(rows).performance.verdict).toBe("no-observed-material-latency-regression");
  expect(report(rows).performance.cluster_mean_ms_saved.mean).toBe(-4);
});
test("small asymmetric outcome changes do not claim better reliability",()=>{
  const rows=cohort();rows[0]!.baseline.task_pass=false;
  expect(report(rows).quality.verdict).toBe("observed-non-regression");
  rows.slice(0,6).forEach(r=>r.baseline.task_pass=false);
  expect(report(rows).quality.verdict).toBe("reliability-improvement-screen-passed");
  expect(report(rows).verdict).toBe("insufficient-evidence");
});
test("one-sided order and both-failed tasks never promote",()=>{
  const rows=cohort();rows.forEach(r=>r.order="baseline-first");
  expect(report(rows).qualification_blockers).toContain("randomized-crossover-order-not-qualified");
  const failed=cohort();failed[0]!.baseline.task_pass=failed[0]!.skill_arm.task_pass=false;
  expect(report(failed).quality.verdict).toBe("observed-task-failures");
  expect(report(failed).verdict).toBe("insufficient-evidence");
});

test("shared baseline/skill session or a critical baseline failure cannot support adoption",()=>{
  const rows=cohort();rows[0]!.independence.skill_session=rows[0]!.independence.baseline_session;
  expect(report(rows).qualification_blockers).toContain("paired-arms-share-session");
  expect(report(rows).verdict).toBe("insufficient-evidence");
  const critical=cohort();critical[0]!.baseline.critical_errors=1;
  expect(report(critical).quality.unsuccessful_pairs).toBe(1);
  expect(report(critical).tokens.verdict).toBe("insufficient-evidence");
});
test("aggregate token arithmetic cannot silently exceed integer precision",()=>{
  const rows=cohort();rows.forEach(r=>{
    r.baseline.tokens={uncached_input:Number.MAX_SAFE_INTEGER,cached_input:0,cache_write_input:0,output:0,input_total:Number.MAX_SAFE_INTEGER,total:Number.MAX_SAFE_INTEGER};
  });
  expect(()=>assessTrials(rows)).toThrow("safe integer precision");
});

test("weak or unaudited native baselines cannot qualify",()=>{
  const rows=cohort();rows[0]!.baseline_qualified=false;
  const result=report(rows);
  expect(result.qualification_blockers).toContain("best-available-native-baseline-not-qualified");
  expect(result.tokens.verdict).toBe("insufficient-evidence");
  expect(result.verdict).toBe("insufficient-evidence");
  expect(()=>assessTrials([{...pair(1),baseline_review_ref:""}])).toThrow();
});

test("faster but lower-quality completion cannot earn a performance improvement claim",()=>{
  const rows=cohort();rows.forEach(r=>{r.skill_arm.elapsed_ms=90;r.skill_arm.quality=0.99;});
  expect(report(rows).performance.verdict).toBe("reject-correctness-regression");
});
test("finite arm timings that overflow aggregate arithmetic are rejected",()=>{
  const rows=cohort();rows.forEach(r=>r.baseline.elapsed_ms=Number.MAX_VALUE);
  expect(()=>assessTrials(rows)).toThrow("nonfinite aggregate metric");
});
