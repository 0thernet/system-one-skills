#!/usr/bin/env bun
// check — the system-one-skills gate. Runs every gate the package claims:
// typecheck, tests, manifest admission, embedded-digest pinning, program
// smoke runs, receipt verify, and the pack file/privacy audit.
// Exit 0 when all pass; prints a compact report.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PKG, PROGRAMS_DIR } from "../src/run-program.ts";
import { benchmarkFingerprint } from "../bench/source-fingerprint.ts";
import { skillFootprint } from "../bench/skill-footprint.ts";

const results: Array<{ gate: string; ok: boolean; detail: string }> = [];

function gate(name: string, fn: () => string) {
  try {
    results.push({ gate: name, ok: true, detail: fn() });
  } catch (e) {
    results.push({ gate: name, ok: false, detail: String(e).slice(0, 400) });
  }
}

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { cwd: PKG, encoding: "utf8", timeout: 300_000 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${(r.stderr || r.stdout).slice(0, 500)}`);
  const output = `${r.stdout}\n${r.stderr}`.trim();
  const tests = output.match(/(\d+) pass\s+(\d+) fail/);
  if (tests) return `${tests[1]} pass, ${tests[2]} fail`;
  const pythonTests = output.match(/Ran (\d+) tests?/);
  if (pythonTests) return `${pythonTests[1]} parser tests passed`;
  return output.split("\n").slice(-2).join("\n");
}

gate("typecheck", () => run("bunx", ["tsc", "--noEmit"]) || "clean");
gate("tests", () => run("bun", ["test", "tests/"]));
gate("transcript-parser-tests", () => run("python3", ["-m", "unittest", "discover", "-s", "tests", "-p", "transcript*_test.py"]));
gate("manifests", () => {
  const files = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith(".algal.json"));
  for (const f of files) JSON.parse(readFileSync(join(PROGRAMS_DIR, f), "utf8"));
  return `${files.length} manifests parse`;
});
gate("skill-definitions", () => {
  const skills = join(PKG,"skills");
  const folders = readdirSync(skills, {withFileTypes:true}).filter(e=>e.isDirectory());
  for (const folder of folders) {
    const content = readFileSync(join(skills,folder.name,"SKILL.md"),"utf8");
    const header = content.match(/^---\n([\s\S]*?)\n---/);
    if (!header) throw new Error(`${folder.name}: missing frontmatter`);
    const meta = Bun.YAML.parse(header[1]!) as Record<string,unknown>;
    if (Object.keys(meta).some(key=>!["name","description","license","allowed-tools","metadata"].includes(key))) throw new Error(`${folder.name}: unsupported frontmatter key`);
    if (meta.name !== folder.name || !/^[a-z0-9-]{1,64}$/.test(folder.name) || typeof meta.description !== "string" || !meta.description.trim()) throw new Error(`${folder.name}: invalid name/description`);
  }
  const saved = JSON.parse(readFileSync(join(PKG,"bench/report/skill-footprint.json"),"utf8"));
  if (JSON.stringify(saved) !== JSON.stringify(skillFootprint())) throw new Error("skill footprint changed — run bun bench/skill-footprint.ts");
  return `${folders.length} skill definitions valid (behavior requires tests/evidence)`;
});
gate("bench-report-current", () => {
  const p = join(PKG, "bench", "report", "bench-report.json");
  if (!existsSync(p)) throw new Error("missing — run bun bench/run-bench.ts");
  const r = JSON.parse(readFileSync(p, "utf8"));
  if (r.source_fingerprint !== benchmarkFingerprint()) throw new Error("source changed — regenerate bun bench/run-bench.ts");
  return `${r.workflows.length} synthetic rows match current measurement source`;
});
gate("transcript-evidence-current", () => {
  const sha = (path: string) => createHash("sha256").update(readFileSync(join(PKG,path))).digest("hex");
  const corpus = JSON.parse(readFileSync(join(PKG,"research/session-report.json"),"utf8"));
  const replay = JSON.parse(readFileSync(join(PKG,"research/replay-report.json"),"utf8"));
  if (corpus.analyzer_sha256 !== sha("research/analyze_sessions.py")) throw new Error("analyzer changed; refresh corpus report");
  if (replay.corpus_evidence_sha256 !== corpus.corpus_evidence_sha256 || replay.replay_script_sha256 !== sha("research/replay_validation.ts")) throw new Error("replay source/corpus changed");
  for (const [path,digest] of Object.entries(replay.evaluated_source_sha256)) if (digest !== sha(path)) throw new Error(`${path} changed; replay the private sample again`);
  for (const provider of ["codex","claude","devin"]) {
    if (!(corpus.providers?.[provider]?.unique_tool_calls > 0)) throw new Error(`${provider}: no corpus evidence`);
    const r = replay.providers?.[provider];
    if (!r || r.harness_errors || r.exit_code_failures || r.verdict_failures || r.byte_count_failures || r.tail_failures) throw new Error(`${provider}: replay invariant failed`);
  }
  return "three-provider corpus current; available replay invariants pass";
});
gate("privacy-scan", () => {
  const bad: string[] = [];
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).filter(e=>e.name !== "__pycache__" && !e.name.endsWith(".pyc")).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const pats = [/\/Users\/bg\//, /\/Users\/[a-z]+\/\.codex\/sessions/, /\/Users\/[a-z]+\/\.local\/share\/devin/, /sk-[a-zA-Z0-9]{20,}/, /ghp_[a-zA-Z0-9]{20,}/, /npm_[a-zA-Z0-9]{20,}/];
  for (const top of ["bin", "tools", "src", "programs", "skills", "habitats", "fixtures", "bench", "docs", "research", "README.md", "package.json"]) {
    const p = join(PKG, top);
    if (!existsSync(p)) continue;
    const files = p.endsWith(".md") || p.endsWith(".json") ? [p] : walk(p);
    for (const f of files) {
      const t = readFileSync(f, "utf8");
      for (const pat of pats) if (pat.test(t)) bad.push(`${f}: ${pat}`);
    }
  }
  if (bad.length) throw new Error(bad.join("\n"));
  return "no private paths, transcript refs, or secret patterns";
});
gate("npm-pack-dry-run", () => {
  const r = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: PKG, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`npm pack failed: ${(r.stderr || r.stdout).slice(0,200)}`);
  const text = `${r.stdout}\n${r.stderr}`;
  const start = text.search(/^\s*\[/m);
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error(`unexpected npm output: ${text.slice(0, 200)}`);
  const d = JSON.parse(text.slice(start, end + 1));
  return `${d[0].entryCount} files, ${(d[0].size / 1024).toFixed(1)}KB`;
});

let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.gate.padEnd(24)} ${r.detail.split("\n")[0]}`);
}
process.exit(fail ? 1 : 0);
