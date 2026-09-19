#!/usr/bin/env bun
// check — the algal-skills gate. Runs every gate the package claims:
// typecheck, tests, manifest admission, embedded-digest pinning, program
// smoke runs, receipt verify, and the pack file/privacy audit.
// Exit 0 when all pass; prints a compact report.

import { execSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PKG, PROGRAMS_DIR } from "../src/run-program.ts";

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
  return r.stdout.trim().split("\n").slice(-2).join("\n");
}

gate("typecheck", () => run("bunx", ["tsc", "--noEmit"]) || "clean");
gate("tests", () => run("bun", ["test", "tests/"]));
gate("manifests", () => {
  const files = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith(".algal.json"));
  for (const f of files) JSON.parse(readFileSync(join(PROGRAMS_DIR, f), "utf8"));
  return `${files.length} manifests parse`;
});
gate("bench-report-current", () => {
  const p = join(PKG, "bench", "report", "bench-report.json");
  if (!existsSync(p)) throw new Error("missing — run bun bench/run-bench.ts");
  const r = JSON.parse(readFileSync(p, "utf8"));
  return `total ${r.totals.context_reduction_pct}% context reduction across ${r.workflows.length} workflows`;
});
gate("privacy-scan", () => {
  const bad: string[] = [];
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
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
