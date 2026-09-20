#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { benchmarkFingerprint } from "../bench/source-fingerprint.ts";
import { skillFootprint } from "../bench/skill-footprint.ts";
const PKG = fileURLToPath(new URL("../", import.meta.url));
const results: Array<{gate:string;ok:boolean;detail:string}> = [];
function gate(name:string, fn:()=>string) {
  try { results.push({gate:name,ok:true,detail:fn()}); }
  catch(e) { results.push({gate:name,ok:false,detail:String(e).slice(0,1200)}); }
}
function run(cmd:string,args:string[]) {
  const r=spawnSync(cmd,args,{cwd:PKG,encoding:"utf8",timeout:300_000});
  const text=`${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim();
  if(r.error || r.status!==0) throw new Error(`${cmd} ${args.join(" ")}: ${r.error ?? text.slice(-1800)}`);
  const tests=text.match(/(\d+) pass\s+(\d+) fail/);
  if(tests)return `${tests[1]} pass, ${tests[2]} fail`;
  const python=text.match(/Ran (\d+) tests?/);
  if(python)return `${python[1]} parser tests passed`;
  return text.split("\n").slice(-2).join(" ") || "clean";
}
gate("typecheck",()=>run("bunx",["tsc","--noEmit"]));
gate("tests",()=>run("bun",["test","tests/"]));
gate("benchmark-harness-tests",()=>run("bun",["test","bench/benchmark-harness.test.ts"]));
gate("transcript-parser-tests",()=>run("python3",["-m","unittest","discover","-s","tests","-p","transcript*_test.py"]));
gate("benchmark-manifest-tests",()=>run("python3",["-m","unittest","discover","-s","tests","-p","benchmark_manifest_test.py"]));
gate("benchmark-protocol-integrity",()=>run("python3",["research/benchmark_manifest.py","--check"]));
gate("skill-definition",()=>{
  const folders=readdirSync(join(PKG,"skills"),{withFileTypes:true}).filter(e=>e.isDirectory());
  if(folders.length!==1 || folders[0]?.name!=="system-one-verify")throw new Error("Only the admitted validation skill belongs in the default package");
  const content=readFileSync(join(PKG,"skills/system-one-verify/SKILL.md"),"utf8");
  const header=content.match(/^---\n([\s\S]*?)\n---/);
  if(!header)throw new Error("Missing skill frontmatter");
  const meta=Bun.YAML.parse(header[1]!) as Record<string,unknown>;
  if(Object.keys(meta).some(key=>!["name","description","license","allowed-tools","metadata"].includes(key)))throw new Error("Unsupported skill frontmatter");
  if(meta.name!=="system-one-verify" || typeof meta.description!=="string" || !meta.description.trim())throw new Error("Invalid skill metadata");
  const saved=JSON.parse(readFileSync(join(PKG,"bench/report/skill-footprint.json"),"utf8"));
  if(JSON.stringify(saved)!==JSON.stringify(skillFootprint()))throw new Error("Skill footprint changed; regenerate it");
  return "one admitted skill; footprint current";
});
gate("synthetic-contract-report",()=>{
  const r=JSON.parse(readFileSync(join(PKG,"bench/report/bench-report.json"),"utf8"));
  if(r.source_fingerprint!==benchmarkFingerprint())throw new Error("Source changed; regenerate bun bench/run-bench.ts");
  return `${r.cases.length} synthetic reducer probes; not savings evidence`;
});
// Historical reports remain bound to the original evaluated implementation.
// New runtime changes must separately qualify against exact current source.
gate("historical-v0.4-integrity",()=>run("node",["research/validate-history.mjs"]));
gate("current-paired-replay",()=>run("node",["research/early-diagnostics-replay.mjs","--check"]));
gate("current-runtime-qualification",()=>run("node",["bench/measure-early-diagnostics.mjs","--check"]));
gate("read-opportunity-integrity",()=>run("python3",["research/candidate_opportunities.py","--check"]));
gate("privacy-scan",()=>{
  const walk=(d:string):string[]=>readdirSync(d,{withFileTypes:true}).filter(e=>e.name!=="__pycache__" && !e.name.endsWith(".pyc")).flatMap(e=>e.isDirectory()?walk(join(d,e.name)):[join(d,e.name)]);
  const patterns=[/\/Users\/bg\//,/\/Users\/[a-z]+\/\.codex\/sessions/,/sk-[a-zA-Z0-9]{20,}/,/ghp_[a-zA-Z0-9]{20,}/,/npm_[a-zA-Z0-9]{20,}/];
  for(const top of ["bin","src","skills","bench","docs","research","README.md","package.json"]){
    const p=join(PKG,top); if(!existsSync(p))continue;
    for(const f of top.endsWith(".md") || top.endsWith(".json")?[p]:walk(p)){
      if(patterns.some(re=>re.test(readFileSync(f,"utf8"))))throw new Error(`Private path or secret pattern: ${f}`);
    }
  }
  return "no private transcript paths or secret patterns";
});
gate("package-scope",()=>{
  const pkg=JSON.parse(readFileSync(join(PKG,"package.json"),"utf8"));
  if(Object.keys(pkg.dependencies ?? {}).length)throw new Error("Runtime dependencies need explicit admission");
  const r=spawnSync("npm",["pack","--dry-run","--json"],{cwd:PKG,encoding:"utf8"});
  if(r.status!==0)throw new Error((r.stderr||r.stdout).slice(0,400));
  const packed=JSON.parse(r.stdout)[0];
  for(const file of packed.files)if(!/^(?:bin\/|src\/|skills\/|README\.md$|LICENSE$|package\.json$)/.test(file.path))throw new Error(`Unexpected public runtime file: ${file.path}`);
  return `${packed.entryCount} files, ${(packed.size/1024).toFixed(1)} KiB, zero runtime dependencies`;
});
for(const r of results)console.log(`${r.ok?"PASS":"FAIL"} ${r.gate.padEnd(28)} ${r.detail}`);
process.exit(results.some(r=>!r.ok)?1:0);
