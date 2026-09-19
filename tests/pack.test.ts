// algal-skills test suite — deterministic fixtures only, no network, no live
// model calls. Runs through the same in-process runner the bin uses.

import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { parseOrganismManifest, digestCanonical, manifestToJson } from "@hraness/algal";
import {
  PKG,
  PROGRAMS_DIR,
  packageTools,
  runProgram,
  verifyRun,
} from "../src/run-program.ts";
import { TOOLS } from "../tools/tool.ts";

const program = (id: string) => join(PROGRAMS_DIR, `${id}.algal.json`);
const tool = (name: keyof typeof TOOLS) => {
  const impl = TOOLS[name];
  if (!impl) throw new Error(`missing tool ${name}`);
  return impl;
};
const manifestJson = (id: string) =>
  JSON.parse(readFileSync(program(id), "utf8"));

// A throwaway git repo so git-dependent tools have a real target.
let repo = "";
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "algal-skills-test-"));
  execSync("git init -q && git config user.email t@t && git config user.name t", { cwd: repo });
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\nexport const b = 2;\n");
  writeFileSync(join(repo, "README.md"), "# fixture repo\n\nline two\n");
  writeFileSync(join(repo, "package.json"), '{"name":"fixture","version":"0.0.0"}\n');
  execSync("git add -A && git commit -qm init", { cwd: repo });
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\nexport const b = 3;\n");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "needle.ts"), "export function needle() { return 42; }\n");
});

// ------------------------------------------------------------ admission ---

describe("manifest admission", () => {
  const files = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith(".algal.json"));
  test("catalog is non-empty and every manifest parses", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const f of files) {
      const m = parseOrganismManifest(JSON.parse(readFileSync(join(PROGRAMS_DIR, f), "utf8")));
      expect(m.contract).toBe("algal.organism.v1");
    }
  });
  test("fixed programs declare zero agent calls", () => {
    for (const id of ["git-digest", "diff-slice", "test-sift", "release-gate", "ci-watch", "repo-survey", "search-slice", "web-fetch"]) {
      expect(manifestJson(id).budgets.maxAgentCalls).toBe(0);
    }
  });
  test("embedded manifests match pinned digests", async () => {
    const canonicalDigest = (id: string) =>
      digestCanonical(manifestToJson(parseOrganismManifest(manifestJson(id))));
    const ciWatch = manifestJson("ci-watch");
    const pinned = ciWatch.cells.find((c: { id: string }) => c.id === "loop").manifest;
    expect(pinned).toBe(canonicalDigest("ci-check-inner"));
    const habitat = manifestJson("router-habitat");
    const pinnedEval = habitat.cells.find((c: { id: string }) => c.id === "eval").manifest;
    expect(pinnedEval).toBe(canonicalDigest("hab-eval-inner"));
  });
});

// ---------------------------------------------------------- tool impls ----

describe("tools", () => {
  test("git.digest.v1 reports branch and dirty state", async () => {
    const r = await tool("git.digest.v1")({ cwd: repo });
    expect(r.ok).toBe(true);
    expect(r.branch).toBe("main");
    expect(r.unstaged).toBe(1);
    expect(r.untracked).toBe(1);
    expect((r.recent as string[]).length).toBe(1);
  });
  test("search.slice.v1 falls back to the bounded JS engine without rg", async () => {
    const r = await tool("search.slice.v1")({ pattern: "needle", cwd: repo, glob: "*.ts", "max-matches": 5 });
    expect(r.ok).toBe(true);
    const m = r.matches as Array<{ file: string }>;
    expect(m.some((x) => x.file.endsWith("needle.ts"))).toBe(true);
    expect(m.length).toBeLessThanOrEqual(5);
  });
  test("test.run.v1 classifies failures and bounds failures list", async () => {
    const fail = await tool("test.run.v1")({ cmd: "echo 'FAIL test_x expected 1 got 2' && exit 1", cwd: repo });
    expect(fail.ok).toBe(true);
    expect(fail.code).toBe(1);
    expect((fail.failures as string[]).length).toBeLessThanOrEqual(40);
    const pass = await tool("test.run.v1")({ cmd: "exit 0", cwd: repo });
    expect(pass.code).toBe(0);
    expect(pass.category).toBe("pass");
  });
  test("check.run.v1 runs stages and reports first failure", async () => {
    const r = await tool("check.run.v1")({ cwd: repo, "cmd-test": "exit 0", "cmd-lint": "echo bad && exit 2" });
    expect(r.passed).toBe(false);
    expect(r.failed_stage).toBe("lint");
    expect((r.stages as Array<{ name: string; skipped: boolean }>)[2]?.skipped).toBe(true);
  });
  test("repo.survey.v1 bounds entries and finds manifests/readme", async () => {
    const r = await tool("repo.survey.v1")({ cwd: repo, "max-entries": 50 });
    expect(r.ok).toBe(true);
    expect((r.manifests as string[])).toContain("package.json");
    expect(r.readme_head).toContain("fixture repo");
  });
  test("web.fetch.v1 rejects non-http input without a request", async () => {
    const r = await tool("web.fetch.v1")({ url: "file:///etc/passwd" });
    expect(r.ok).toBe(false);
  });
});

// ------------------------------------------------------ program runs ------

describe("program runs", () => {
  test("git-digest emits digest + summary with zero agent calls", async () => {
    const r = await runProgram({
      manifestPath: program("git-digest"),
      args: { src: { cwd: repo } },
      dir: mkdtempSync(join(tmpdir(), "algal-store-")),
    });
    expect(r.outcome).toBe("complete");
    expect(r.work.agentCalls).toBe(0);
    const summary = r.cells["fmt"]?.outputs?.out as string;
    expect(summary).toContain("branch main");
    expect(summary).toContain("unstaged 1");
  });
  test("search-slice returns bounded matches", async () => {
    const r = await runProgram({
      manifestPath: program("search-slice"),
      args: { src: { pattern: "export", cwd: repo, "max-matches": 3 } },
      dir: mkdtempSync(join(tmpdir(), "algal-store-")),
    });
    expect(r.outcome).toBe("complete");
    const out = r.cells["fmt"]?.outputs?.out as string;
    expect(out).toContain("3 matches");
  });
  test("test-sift reports failure category and tail", async () => {
    const r = await runProgram({
      manifestPath: program("test-sift"),
      args: { src: { cmd: "echo 'error TS2345 type mismatch' && exit 1", cwd: repo } },
      dir: mkdtempSync(join(tmpdir(), "algal-store-")),
    });
    const v = r.cells["fmt"]?.outputs?.out as string;
    expect(v).toContain("FAIL");
    expect(r.work.agentCalls).toBe(0);
  });
  test("release-gate reports per-stage verdicts", async () => {
    const r = await runProgram({
      manifestPath: program("release-gate"),
      args: { src: { "cmd-test": "exit 0", "cmd-build": "exit 3", cwd: repo } },
      dir: mkdtempSync(join(tmpdir(), "algal-store-")),
    });
    const v = r.cells["fmt"]?.outputs?.out as string;
    expect(v).toContain("FAILED at build");
    expect(v).toContain("test: exit 0");
  });
  test("diff-review runs one scripted agent call inside a schema", async () => {
    const dir = mkdtempSync(join(tmpdir(), "algal-store-"));
    const resp = mkdtempSync(join(tmpdir(), "algal-resp-"));
    writeFileSync(
      join(resp, "r.json"),
      JSON.stringify({ review: { verdict: "pass", findings: [] } }),
    );
    const r = await runProgram({
      manifestPath: program("diff-review"),
      args: { src: { cwd: repo } },
      dir,
      executorSpecs: [`scripted:${join(resp, "r.json")}`],
    });
    expect(r.outcome).toBe("complete");
    expect(r.work.agentCalls).toBe(1);
    expect(r.cells["fmt"]?.outputs?.out).toContain("pass");
  });
  test("router-live routes through the slot default with zero config", async () => {
    const resp = mkdtempSync(join(tmpdir(), "algal-resp-"));
    writeFileSync(join(resp, "r.json"), JSON.stringify({ route: "search" }));
    const r = await runProgram({
      manifestPath: program("router-live"),
      args: { src: { task: "where is foo defined" } },
      dir: mkdtempSync(join(tmpdir(), "algal-store-")),
      executorSpecs: [`scripted:${join(resp, "r.json")}`],
    });
    expect(r.outcome).toBe("complete");
    expect(r.cells["lane"]?.outputs?.out).toBe("search");
  });
});

// ------------------------------------------------------------ receipts ----

describe("receipts", () => {
  test("verify replays a tool-grounded run bit-for-bit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "algal-store-"));
    const receipt = await runProgram({
      manifestPath: program("git-digest"),
      args: { src: { cwd: repo } },
      dir,
    });
    const report = await verifyRun(
      JSON.parse(JSON.stringify(receipt)),
      manifestJson("git-digest"),
      dir,
    );
    expect(report.ok).toBe(true);
    expect(report.mismatches ?? []).toEqual([]);
  });
});

// ------------------------------------------------------------- privacy ----

describe("package hygiene", () => {
  const SHIPPED = ["bin", "tools", "src", "programs", "skills", "habitats", "fixtures", "bench", "docs", "package.json", "README.md"];
  function* walk(dir: string): Generator<string> {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) yield* walk(p);
      else yield p;
    }
  }
  test("no absolute home paths, transcript data, or secrets in shipped files", () => {
    const bad: string[] = [];
    const patterns = [/\/Users\/bg\//, /\.codex\/sessions/, /devin\/cli\/transcripts/, /sk-[a-zA-Z0-9]{20,}/, /ghp_[a-zA-Z0-9]{20,}/, /npm_[a-zA-Z0-9]{20,}/];
    for (const top of SHIPPED) {
      const p = join(PKG, top);
      try {
        const entries = p.endsWith(".json") || p.endsWith(".md") ? [p] : [...walk(p)];
        for (const f of entries) {
          const text = readFileSync(f, "utf8");
          for (const pat of patterns) {
            if (pat.test(text)) bad.push(`${f}: ${pat}`);
          }
        }
      } catch { /* path absent — fine */ }
    }
    expect(bad).toEqual([]);
  });
});
