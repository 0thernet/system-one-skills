import { expect, test } from "bun:test";
import { assessTrials, type Trial } from "../bench/assess-trials.ts";

const pair = (i:number): Trial => ({id:String(i),skill:"system-one-verify",provider:"codex",model:"fixture-only",snapshot:"fixture",evidence:"observed",held_out:true,all_overhead_included:true,baseline:{tokens:{uncached_input:100,cached_input:200,cache_write_input:0,output:10},task_pass:true,critical_errors:0,quality:1},skill_arm:{tokens:{uncached_input:50,cached_input:200,cache_write_input:0,output:10},task_pass:true,critical_errors:0,quality:1}});
test("insufficient samples do not qualify and duplicate trials fail",()=>{
  expect(assessTrials([pair(1)])[0]?.verdict).toBe("insufficient-evidence");
  expect(()=>assessTrials([pair(1),pair(1)])).toThrow();
});
test("task failure defeats apparent savings",()=>{
  const rows=Array.from({length:30},(_,i)=>pair(i));
  rows[0]!.skill_arm.task_pass=false;
  expect(assessTrials(rows)[0]?.verdict).toBe("reject-quality-regression");
});
test("overhead or missing held-out evidence defeats qualification",()=>{
  const rows=Array.from({length:30},(_,i)=>pair(i));
  expect(assessTrials(rows)[0]?.verdict).toBe("candidate-for-adoption");
  rows[0]!.all_overhead_included=false;
  expect(assessTrials(rows)[0]?.verdict).toBe("insufficient-evidence");
  rows[0]!.all_overhead_included=true;
  rows.forEach(t=>t.skill_arm.tokens.uncached_input=150);
  expect(assessTrials(rows)[0]?.verdict).toBe("no-demonstrated-net-savings");
});
