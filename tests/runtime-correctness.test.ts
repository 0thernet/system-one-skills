import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, cpSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonValue } from "@hraness/algal";
import { parseToolSignature } from "@hraness/algal";
import { TOOLS, withToolSignal } from "../tools/tool.ts";
import { runProgram, PROGRAMS_DIR, PKG, packageTools } from "../src/run-program.ts";
import { validateRouterCandidate } from "../habitats/candidate.ts";
import registry from "../tools/shell.tools.json";

const scratch: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "system-one-correctness-")); scratch.push(dir); return dir; };
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });
const call = (name: string, inputs: Record<string, unknown>) => TOOLS[name]!(inputs);
const shellQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
const repo = () => {
  const dir = temp(); git(dir, "init", "-q", "-b", "release/v0.2");
  git(dir, "config", "user.name", "test"); git(dir, "config", "user.email", "test@example.invalid");
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n"); git(dir, "add", "."); git(dir, "commit", "-qm", "fixture"); return dir;
};
const manifest = (id: string) => join(PROGRAMS_DIR, id + ".algal.json");

test("registry enforces the same effect/cost/bounds in both execution modes", () => {
  for (const [name, spec] of Object.entries(registry)) expect(packageTools().get(name)?.signature).toEqual(parseToolSignature(spec.signature));
});

test("test and gate commands preserve the suffix beyond 400 characters", async () => {
  const cmd = "true; " + " ".repeat(420) + "exit 7";
  expect((await call("test.run.v1", { cmd })).code).toBe(7);
  expect((await call("check.run.v1", { "cmd-test": cmd })).passed).toBe(false);
  expect((await call("check.run.v1", {})).passed).toBe(false);
  expect((await call("test.run.v1", { cmd: "true;" + " ".repeat(16384) })).ok).toBe(false);
});

test("large logs retain the real final failure and report total bytes and truncation", async () => {
  const script = join(temp(), "output.js");
  writeFileSync(script, 'process.stdout.write("é".repeat(180000)+"\\nFAIL final regression\\n"); process.exitCode=9;');
  const r = await call("test.run.v1", { cmd: `${shellQuote(process.execPath)} ${shellQuote(script)}` });
  expect(r.code).toBe(9); expect(r.output_bytes).toBeGreaterThan(360000);
  expect(r.output_truncated).toBe(true); expect(r.retained_bytes).toBeLessThanOrEqual(262147);
  expect(r.tail).toContain("FAIL final regression");
  expect((r.failures as string[]).some((line) => line.includes("final regression"))).toBe(true);
});

test("budget cancellation kills owned shell descendants before they write", async () => {
  const dir = temp(); const marker = join(dir, "late-write"); const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 40);
  try {
    const r = await withToolSignal(ctl.signal, () => call("test.run.v1", { cmd: `(sleep 0.2; touch ${shellQuote(marker)}) & wait` }));
    expect(r.code).toBe(124);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(existsSync(marker)).toBe(false);
  } finally { clearTimeout(timer); }
});

test("git digest preserves dotted branch names, newline filenames and renamed paths", async () => {
  const dir = repo(); git(dir, "mv", "a.ts", "b\nnewline.ts");
  const result = await call("git.digest.v1", { cwd: dir });
  expect(result.branch).toBe("release/v0.2"); expect(result.staged).toBe(1); expect(result.unstaged).toBe(0);
});

test("diff revision flags are rejected and UTF-8 clips stay inside the byte cap", async () => {
  const dir = repo(); writeFileSync(join(dir, "a.ts"), "é".repeat(2000) + "\n");
  expect((await call("diff.read.v1", { cwd: dir, rev: "--stat" })).ok).toBe(false);
  const result = await call("diff.read.v1", { cwd: dir, rev: "HEAD~0", "max-bytes": 513 });
  expect(result.ok).toBe(true); expect(result.truncated).toBe(true);
  expect(Buffer.byteLength(result.diff as string)).toBeLessThanOrEqual(513);
  expect(result.bytes).toBe(Buffer.byteLength(git(dir, "diff", "--no-ext-diff", "--no-textconv", "--find-renames", "HEAD~0", "--")));
});

test("search keeps context separate, handles colon paths, and honors brace globs", async () => {
  const dir = temp(); writeFileSync(join(dir, "with:colon.ts"), "before\nneedle\nafter\nneedle\nneedle\n");
  writeFileSync(join(dir, "ignore.txt"), "needle\n");
  const result = await call("search.slice.v1", { cwd: dir, pattern: "needle", glob: "*.{ts,js}", "max-matches": 2, "context-lines": 1 });
  const matches = result.matches as Array<{ file: string; line: number; context: unknown[] }>;
  expect(matches.map((m) => m.line)).toEqual([2, 4]);
  expect(matches.every((m) => m.file === "with:colon.ts")).toBe(true);
  expect(matches[0]?.context.length).toBe(2); expect(result.truncated).toBe(true);
});

test("missing rg fails explicitly instead of searching with different semantics", async () => {
  const previous = process.env.PATH;
  try { process.env.PATH = temp(); expect((await call("search.slice.v1", { cwd: temp(), pattern: "x" })).ok).toBe(false); }
  finally { process.env.PATH = previous; }
});

test("survey rejects missing roots and byte-bounds multibyte README text", async () => {
  expect((await call("repo.survey.v1", { cwd: join(temp(), "missing") })).ok).toBe(false);
  const dir = temp(); writeFileSync(join(dir, "README.md"), "é".repeat(1000));
  const r = await call("repo.survey.v1", { cwd: dir, "readme-bytes": 257 });
  expect(Buffer.byteLength(r.readme_head as string)).toBeLessThanOrEqual(257); expect(r.readme_truncated).toBe(true);
});

test("writing path guard also rejects symlink escapes", async () => {
  const dir = temp(); const external = join(temp(), "outside.md"); writeFileSync(external, "Private draft"); symlinkSync(external, join(dir, "draft.md"));
  expect((await call("writing.audit.v1", { cwd: dir, path: "draft.md" })).ok).toBe(false);
});

test("fresh runs against the same store observe changed worktree state", async () => {
  const dir = repo(); const store = temp();
  const run = () => runProgram({ manifestPath: manifest("git-digest"), args: { src: { cwd: dir } }, dir: store });
  const before = await run(); writeFileSync(join(dir, "a.ts"), "changed\n"); const after = await run();
  expect((before.cells.probe?.outputs?.report as { unstaged: number }).unstaged).toBe(0);
  expect((after.cells.probe?.outputs?.report as { unstaged: number }).unstaged).toBe(1);
});

test("CI watch polls the initially selected run, then stops immediately on error", async () => {
  const registry = packageTools(); const entry = registry.get("ci.status.v1")!; const seen: unknown[] = [];
  registry.set("ci.status.v1", { ...entry, tool: async (inputs) => {
    seen.push(inputs["run-id"]);
    return { report: (seen.length === 1 ? { ok: true, run_id: "42", status: "in_progress", done: "continue" } : { ok: false, run_id: "42", error: "provider unavailable", done: "stop" }) as JsonValue };
  } });
  const r = await runProgram({ manifestPath: manifest("ci-watch"), args: { src: { cwd: temp(), "wait-ms": 0 } }, dir: temp(), tools: registry });
  expect(r.outcome).toBe("complete"); expect(seen).toEqual([undefined, "42"]); expect(r.cells.fmt?.outputs?.out).toContain("failed");
});

test("failed research evidence never invokes the decision executor", async () => {
  let calls = 0;
  const response = join(temp(), "response.json"); writeFileSync(response, "{}");
  const r = await runProgram({ manifestPath: manifest("research-triage"), args: { src: { sources: [] } }, dir: temp(), executorSpecs: [`scripted:${response}`], observeEffect: () => { calls++; } });
  expect(calls).toBe(0); expect(r.work.agentCalls).toBe(0);
});

test("writing evaluator sees only the byte-bounded text and reports omitted content", async () => {
  const response = join(temp(), "response.json"); writeFileSync(response, JSON.stringify({ judge: { answers: { dominant_issue: { choice: "none", confidence: 1, probabilities: { none: 1 } }, publish_ready: { noul: 0.5 }, quality: { score: 3, confidence: 1, probabilities: { "3": 1 } } } } }));
  let context = "";
  await runProgram({ manifestPath: manifest("writing-evaluate"), args: { src: { text: "A".repeat(800) + "DO_NOT_INCLUDE_SUFFIX", "max-bytes": 512 } }, dir: temp(), executorSpecs: [`scripted:${response}`], observeEffect: (request) => { context = JSON.stringify(request.context); } });
  expect(context).not.toContain("DO_NOT_INCLUDE_SUFFIX"); expect(context).toContain('"truncated":true');
});

test("habitat rejects structural mutations before candidate effects can execute", () => {
  const candidate = JSON.parse(readFileSync(manifest("router"), "utf8"));
  expect(() => validateRouterCandidate(candidate)).not.toThrow();
  candidate.cells[1].prompt += " Prefer direct when uncertain.";
  expect(() => validateRouterCandidate(candidate)).not.toThrow();
  candidate.cells.push({ id: "side-effect", kind: "tool", tool: "check.run.v1" });
  expect(() => validateRouterCandidate(candidate)).toThrow("only change");
});

test("stat line omission and search context clipping are explicitly flagged", async () => {
  const dir = repo();
  for (let i = 0; i < 65; i++) writeFileSync(join(dir, `file-${i}.ts`), "before\n");
  git(dir, "add", "."); git(dir, "commit", "-qm", "many files");
  for (let i = 0; i < 65; i++) writeFileSync(join(dir, `file-${i}.ts`), "after\n");
  expect((await call("diff.read.v1", { cwd: dir })).stat_truncated).toBe(true);
  expect((await call("git.digest.v1", { cwd: dir })).stat_truncated).toBe(true);
  writeFileSync(join(dir, "context.txt"), "x".repeat(600) + "\nneedle\n");
  const r = await call("search.slice.v1", { cwd: dir, pattern: "needle", "context-lines": 1 });
  expect((r.matches as Array<{ context: Array<{ text_truncated: boolean }> }>)[0]?.context[0]?.text_truncated).toBe(true);
});

test("inline research evidence preserves code and angle-bracket text", async () => {
  const text = "List<T> and x < y > z are literal evidence.";
  const r = await call("research.bundle.v1", { sources: [{ text }] });
  expect((r.sources as Array<{ text: string }>)[0]?.text).toBe(text);
});

test("a clipped long tail is flagged even below the process capture limit", async () => {
  const script = join(temp(), "long-line.js");
  writeFileSync(script, 'process.stdout.write("x".repeat(18000)+"\\nFAIL final\\n");process.exitCode=1;');
  const r = await call("test.run.v1", { cmd: `${shellQuote(process.execPath)} ${shellQuote(script)}` });
  expect(r.output_truncated).toBe(false); expect(r.tail_truncated).toBe(true); expect(r.tail).toContain("FAIL final");
});

test("diff review exposes clipping scope independently of the model verdict", async () => {
  const tools = packageTools(); const entry = tools.get("diff.read.v1")!;
  tools.set("diff.read.v1", { ...entry, tool: async () => ({ report: { ok: true, diff: "+changed", stat: "1 file", bytes: 90000, truncated: true, stat_truncated: false } }) });
  const response = join(temp(), "review.json"); writeFileSync(response, JSON.stringify({ review: { verdict: "warn", findings: [] } }));
  const r = await runProgram({ manifestPath: manifest("diff-review"), args: { src: { cwd: temp() } }, tools, dir: temp(), executorSpecs: [`scripted:${response}`] });
  expect(r.outcome).toBe("complete"); expect((r.cells.scope?.outputs?.out as { truncated: boolean }).truncated).toBe(true);
});

test("installed paths with spaces and apostrophes work for CLI and exported tools", () => {
  const installed = join(temp(), "package with ' spaces"); mkdirSync(installed);
  for (const entry of ["bin", "src", "tools", "programs", "habitats"]) cpSync(join(PKG, entry), join(installed, entry), { recursive: true });
  symlinkSync(join(PKG, "node_modules"), join(installed, "node_modules"));
  const cli = join(installed, "bin", "system-one-skills.js");
  const list = JSON.parse(execFileSync(process.execPath, [cli, "list"], { encoding: "utf8" }));
  expect(list.programs.length).toBe(19);
  const exported = JSON.parse(execFileSync(process.execPath, [cli, "tools"], { encoding: "utf8" }));
  const command = exported["writing.audit.v1"].exec as string;
  const report = JSON.parse(execFileSync("sh", ["-c", command.slice(4)], { input: JSON.stringify({ inputs: { text: "A draft." } }), encoding: "utf8" }));
  expect(report.report.ok).toBe(true); expect(report.report.words).toBe(2);
});
