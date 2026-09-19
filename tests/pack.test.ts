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
  makeExecutors,
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
  execSync("git init -q -b main && git config user.email t@t && git config user.name t", { cwd: repo });
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
    for (const id of ["git-digest", "diff-slice", "test-sift", "release-gate", "ci-watch", "repo-survey", "search-slice", "web-fetch", "research-bundle", "writing-audit"]) {
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
  test("search.slice.v1 uses rg with bounded match results", async () => {
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
  test("web.fetch.v1 bounds response reads before clipping output", async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = (async () => new Response("x".repeat(200_000), { headers: { "content-type": "text/plain" } })) as unknown as typeof fetch;
    try {
      const r = await tool("web.fetch.v1")({ url: "https://example.invalid/large", "max-bytes": 512 });
      expect(r.ok).toBe(true);
      expect((r.text as string).length).toBe(512);
      expect(r.source_truncated).toBe(true);
      expect(r.source_bytes).toBeLessThanOrEqual(4096);
    } finally {
      globalThis.fetch = previous;
    }
  });
  test("research.bundle.v1 bounds inline sources and rejects unknown keys", async () => {
    const r = await tool("research.bundle.v1")({
      sources: [
        { title: "A", text: "alpha evidence" },
        { title: "B", text: "beta evidence", extra: true },
      ],
      "max-bytes-per-source": 512,
    });
    expect(r.ok).toBe(true);
    expect(r.source_count).toBe(2);
    expect(r.success_count).toBe(1);
    expect(r.error_count).toBe(1);
  });
  test("writing.audit.v1 reports bounded deterministic writing signals", async () => {
    const r = await tool("writing.audit.v1")({
      text: "# Draft\n\nThis claim improved 42% without a citation. TODO revise.",
    });
    expect(r.ok).toBe(true);
    expect(r.headings).toBe(1);
    expect(r.placeholders).toBe(1);
    expect((r.uncited_claims as string[]).length).toBe(1);
  });
  test("Jev executor specs and conditional auto-admission preserve the optional seam", async () => {
    const explicit = await makeExecutors(["jev"]);
    expect(explicit).toHaveLength(1);
    expect(explicit[0]?.id).toBe("jev");
    const previous = process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_API_KEY = "test-key-12345";
    try {
      const automatic = await makeExecutors([], { autoJev: true });
      expect(automatic).toHaveLength(1);
      expect(automatic[0]?.id).toBe("jev");
    } finally {
      if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = previous;
    }
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
  test("research-bundle and writing-audit run with zero model calls", async () => {
    const research = await runProgram({
      manifestPath: program("research-bundle"),
      args: { src: { sources: [{ title: "A", text: "bounded evidence" }] } },
      dir: mkdtempSync(join(tmpdir(), "algal-store-")),
    });
    expect(research.outcome).toBe("complete");
    expect(research.work.agentCalls).toBe(0);
    expect(research.cells["fmt"]?.outputs?.out).toContain("1/1 sources");
    const writing = await runProgram({
      manifestPath: program("writing-audit"),
      args: { src: { text: "# Draft\n\nA concise sentence." } },
      dir: mkdtempSync(join(tmpdir(), "algal-store-")),
    });
    expect(writing.outcome).toBe("complete");
    expect(writing.work.agentCalls).toBe(0);
    expect(writing.cells["fmt"]?.outputs?.out).toContain("words");
  });
  test("typed decision programs run with scripted Jev-shaped answers", async () => {
    const cases = [
      {
        id: "change-triage",
        args: { cwd: repo },
        answers: {
          risk: { choice: "low", confidence: 0.9, probabilities: { low: 0.9, medium: 0.08, high: 0.02 } },
          merge_ready: { noul: 0.85 },
          quality: { score: 4, confidence: 0.8, probabilities: { "1": 0.01, "2": 0.04, "3": 0.15, "4": 0.7, "5": 0.1 } },
        },
        summary: "risk low",
      },
      {
        id: "research-triage",
        args: { sources: [{ title: "A", text: "Evidence supports the claim." }], question: "Does the evidence support it?" },
        answers: {
          relevance: { choice: "supports", confidence: 0.9, probabilities: { supports: 0.9, contradicts: 0.02, mixed: 0.05, irrelevant: 0.03 } },
          sufficient: { noul: 0.8 },
          source_quality: { score: 4, confidence: 0.8, probabilities: { "1": 0.01, "2": 0.04, "3": 0.15, "4": 0.7, "5": 0.1 } },
        },
        summary: "supports",
      },
      {
        id: "writing-evaluate",
        args: { text: "A clear and supported draft.", audience: "engineers" },
        answers: {
          dominant_issue: { choice: "none", confidence: 0.9, probabilities: { clarity: 0.02, structure: 0.02, evidence: 0.02, tone: 0.02, mechanics: 0.02, none: 0.9 } },
          publish_ready: { noul: 0.9 },
          quality: { score: 5, confidence: 0.9, probabilities: { "1": 0.01, "2": 0.01, "3": 0.03, "4": 0.15, "5": 0.8 } },
        },
        summary: "issue none",
      },
    ];
    for (const c of cases) {
      const resp = mkdtempSync(join(tmpdir(), "algal-resp-"));
      writeFileSync(join(resp, "r.json"), JSON.stringify({ judge: { answers: c.answers } }));
      const r = await runProgram({
        manifestPath: program(c.id),
        args: { src: c.args as unknown as Record<string, import("@hraness/algal").JsonValue> },
        dir: mkdtempSync(join(tmpdir(), "algal-store-")),
        executorSpecs: [`scripted:${join(resp, "r.json")}`],
      });
      expect(r.outcome).toBe("complete");
      expect(r.work.agentCalls).toBe(1);
      expect(r.cells["fmt"]?.outputs?.out).toContain(c.summary);
    }
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
  test("verify replays a typed decision receipt without live Jev", async () => {
    const dir = mkdtempSync(join(tmpdir(), "algal-store-"));
    const resp = mkdtempSync(join(tmpdir(), "algal-resp-"));
    writeFileSync(join(resp, "r.json"), JSON.stringify({ judge: { answers: {
      dominant_issue: { choice: "none", confidence: 0.9, probabilities: { clarity: 0.02, structure: 0.02, evidence: 0.02, tone: 0.02, mechanics: 0.02, none: 0.9 } },
      publish_ready: { noul: 0.9 },
      quality: { score: 5, confidence: 0.9, probabilities: { "1": 0.01, "2": 0.01, "3": 0.03, "4": 0.15, "5": 0.8 } },
    } } }));
    const receipt = await runProgram({
      manifestPath: program("writing-evaluate"),
      args: { src: { text: "A clear draft.", audience: "engineers" } },
      dir,
      executorSpecs: [`scripted:${join(resp, "r.json")}`],
    });
    const report = await verifyRun(
      JSON.parse(JSON.stringify(receipt)),
      manifestJson("writing-evaluate"),
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
