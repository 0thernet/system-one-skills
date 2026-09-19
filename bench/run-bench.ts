#!/usr/bin/env bun
// run-bench — the system-one-skills measured comparison.
//
// For every workflow we measure what actually enters a model's context:
//
//   baseline — the raw bytes an agent ingests doing the same job by hand
//              (git status+diff+log dumps, full test logs, unbounded grep,
//              repeated gh polls, whole-diff reviews, doc-reading routing).
//   system one — actual compact CLI JSON plus all observed nested model
//                request/response envelopes; provider billing is not measured.
//
// Token figures are labeled estimates: est = ceil(bytes / 4). This is evidence
// about bytes, calls, and steps — not a billing claim. Deterministic fixtures
// only; rerun with `bun bench/run-bench.ts` (writes bench/report/).

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProgram as executeProgram, PROGRAMS_DIR, PKG, packageTools } from "../src/run-program.ts";

import { compactReport } from "../src/report.ts";
import { benchmarkFingerprint } from "./source-fingerprint.ts";

const observed = new WeakMap<object, {cli: number; request: number; response: number; receipt: number}>();
async function runProgram(opts: Parameters<typeof executeProgram>[0]) {
  let request = 0, response = 0;
  const r = await executeProgram({...opts, observeEffect: (req, res) => {
    request += Buffer.byteLength(JSON.stringify(req));
    response += Buffer.byteLength(JSON.stringify(res));
  }});
  if (r.outcome !== "complete") throw new Error(`benchmark run failed: ${JSON.stringify(r.failure)}`);
  const manifest = JSON.parse(readFileSync(opts.manifestPath, "utf8"));
  observed.set(r, {cli: Buffer.byteLength(JSON.stringify(compactReport(r, manifest))+"\n"), request, response, receipt: Buffer.byteLength(JSON.stringify(r)+"\n")});
  return r;
}

const program = (id: string) => join(PROGRAMS_DIR, `${id}.algal.json`);
const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const est = (b: number) => Math.ceil(b / 4);

function sh(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return (err.stdout ?? "") + (err.stderr ?? "");
  }
}

type Receipt = {
  outcome: string;
  work: { agentCalls: number; steps: number; units: number };
  cells: Record<string, { outputs?: Record<string, unknown>; status?: string }>;
  effects?: unknown[];
};

type Row = {
  workflow: string;
  kind: "fixed" | "semi" | "habitat";
  baseline_context_bytes: number;
  system_one_context_bytes: number;
  cli_stdout_bytes: number;
  model_request_envelope_bytes: number;
  model_response_envelope_bytes: number;
  full_receipt_bytes: number;
  context_reduction_pct: number;
  est_baseline_tokens: number;
  est_system_one_tokens: number;
  agent_calls: number;
  baseline_agent_calls: number;
  work_units: number;
  quality: string;
  detail: string;
};

function row(
  workflow: string,
  kind: Row["kind"],
  baseline: string | number,
  receipt: Receipt,
  extra: { baseline_agent_calls?: number; quality: string; detail: string },
): Row {
  const observation = observed.get(receipt)!;
  const algalBytes = observation.cli + observation.request + observation.response;
  const b = typeof baseline === "string" ? bytes(baseline) : baseline;
  return {
    workflow, kind,
    baseline_context_bytes: b,
    system_one_context_bytes: algalBytes,
    cli_stdout_bytes: observation.cli,
    model_request_envelope_bytes: observation.request,
    model_response_envelope_bytes: observation.response,
    full_receipt_bytes: observation.receipt,
    context_reduction_pct: b ? Math.round((1 - algalBytes / b) * 1000) / 10 : 0,
    est_baseline_tokens: est(b),
    est_system_one_tokens: est(algalBytes),
    agent_calls: receipt.work.agentCalls,
    baseline_agent_calls: extra.baseline_agent_calls ?? 0,
    work_units: receipt.work.units,
    quality: extra.quality,
    detail: extra.detail,
  };
}


async function main() {
  // -------- fixture repo: committed files + dirty diff + noisy test log ----
  const repo = mkdtempSync(join(tmpdir(), "algal-bench-"));
  execSync("git init -q && git config user.email b@b && git config user.name b", { cwd: repo });
  writeFileSync(join(repo, "package.json"), '{"name":"fixture","version":"0.0.0"}\n');
  writeFileSync(join(repo, "README.md"), "# fixture repo\n\na small benchmark fixture\n");
  mkdirSync(join(repo, "src"), { recursive: true });
  for (let i = 0; i < 40; i++) {
    writeFileSync(join(repo, "src", `m${i}.ts`), `export const v${i} = ${i};\n// marker alpha\n`);
  }
  execSync("git add -A && git commit -qm init", { cwd: repo });
  for (let i = 0; i < 40; i++) {
    const lines = [`export const v${i} = ${i + 100};`, "// marker alpha"];
    for (let k = 0; k < 18; k++) lines.push(`export const churn${i}_${k} = ${i * 97 + k}; // edited`);
    writeFileSync(join(repo, "src", `m${i}.ts`), lines.join("\n") + "\n");
  }
  const logLines: string[] = [];
  for (let i = 0; i < 180; i++) logLines.push(`(pass) test_${i} [0.42ms]`);
  logLines.push("(fail) test_important expected {a:1} got {a:2}");
  logLines.push("error: 1 fail, 179 pass");
  writeFileSync(join(repo, "testlog.txt"), logLines.join("\n"));

  const rows: Row[] = [];

  // --------------------------------------------------------- git-digest ---
  {
    const baseline =
      sh("git status --porcelain=v1 --branch", repo) +
      sh("git log -8 --pretty='%h %s (%cr)'", repo) +
      sh("git diff --stat HEAD", repo) +
      sh("git stash list", repo);
    const r = (await runProgram({
      manifestPath: program("git-digest"),
      args: { src: { cwd: repo } },
      dir: mkdtempSync(join(tmpdir(), "bench-")),
    })) as unknown as Receipt;
    rows.push(row("git-digest", "fixed", baseline, r, {
      quality: "bounded status counts/recent/stat; file-level details omitted",
      detail: "status+log+stat+stash dumps vs summary",
    }));
  }

  // --------------------------------------------------------- test-sift ----
  {
    const baseline = sh("cat testlog.txt", repo);
    const r = (await runProgram({
      manifestPath: program("test-sift"),
      args: { src: { cmd: "cat testlog.txt && exit 1", cwd: repo } },
      dir: mkdtempSync(join(tmpdir(), "bench-")),
    })) as unknown as Receipt;
    rows.push(row("test-sift", "fixed", baseline, r, {
      quality: "verdict+failure lines+tail preserved; filler dropped",
      detail: "full test log vs sifted verdict",
    }));
  }

  // -------------------------------------------------------- repo-survey ---
  {
    const baseline =
      sh("find . -type f -not -path './.git/*' | head -400", repo) +
      sh("ls -d */ 2>/dev/null", repo) +
      sh("cat README.md package.json 2>/dev/null", repo);
    const r = (await runProgram({
      manifestPath: program("repo-survey"),
      args: { src: { cwd: repo } },
      dir: mkdtempSync(join(tmpdir(), "bench-")),
    })) as unknown as Receipt;
    rows.push(row("repo-survey", "fixed", baseline, r, {
      quality: "repository orientation only; file contents omitted",
      detail: "find+ls+cat chain vs survey summary",
    }));
  }

  // ------------------------------------------------------- search-slice ---
  {
    const baseline = sh("grep -rn 'marker alpha' . --exclude-dir=.git", repo);
    const r = (await runProgram({
      manifestPath: program("search-slice"),
      args: { src: { pattern: "marker alpha", cwd: repo, "max-matches": 12 } },
      dir: mkdtempSync(join(tmpdir(), "bench-")),
    })) as unknown as Receipt;
    rows.push(row("search-slice", "fixed", baseline, r, {
      quality: "at most 12 of 40 matches; incomplete search, ordering is not guaranteed",
      detail: "unbounded grep (40 hits) vs 12-match slice",
    }));
  }

  // -------------------------------------------------------- diff-review ---
  {
    const rawDiff = sh("git diff HEAD", repo);
    const respDir = mkdtempSync(join(tmpdir(), "bench-resp-"));
    writeFileSync(join(respDir, "r.json"), JSON.stringify({
      review: { verdict: "warn", findings: ["[low] src/m3.ts: magic number churn"] },
    }));
    const r = (await runProgram({
      manifestPath: program("diff-review"),
      args: { src: { cwd: repo, "max-bytes": 8000 } },
      dir: mkdtempSync(join(tmpdir(), "bench-")),
      executorSpecs: [`scripted:${join(respDir, "r.json")}`],
    })) as unknown as Receipt;
    rows.push(row("diff-review", "semi", rawDiff, r, {
      baseline_agent_calls: 3,
      quality: "scripted schema plumbing only; clipped diff and no semantic review quality measurement",
      detail: "whole diff + assumed 3-call read-review loop vs 1 bounded call",
    }));
  }

  // ----------------------------------------------------------- ci-watch ---
  {
    const poll = JSON.stringify([{ databaseId: 1, status: "in_progress", conclusion: null, url: "https://ci/x", headSha: "abc", displayTitle: "checks" }], null, 1);
    const r = (await runProgram({
      manifestPath: program("ci-watch"),
      args: { src: { cwd: repo, "wait-ms": 0 } },
      dir: mkdtempSync(join(tmpdir(), "bench-")),
      tools: new Map([["ci.status.v1", {
        signature: packageTools().get("ci.status.v1")!.signature,
        tool: async () => ({ report: { ok: true, status: "completed", conclusion: "success", url: "https://ci/x", run_id: "1", head_sha: "abc", title: "checks", done: "stop" } }),
      }]]),
    })) as unknown as Receipt;
    rows.push(row("ci-watch", "fixed", poll.repeat(5), r, {
      quality: "terminal status identical to final poll",
      detail: "5 polls of gh JSON vs terminal summary (stubbed tool)",
    }));
  }

  // -------------------------------------------------- router (habitat) ----
  {
    const cases = JSON.parse(readFileSync(join(PKG, "fixtures", "router-cases.json"), "utf8")) as Array<{ args: { task: string }; expect: string; key: string }>;
    // baseline: a general agent routes each task after reading the pack's
    // skill docs (~2.8 KB each) — the realistic "figure it out" context.
    const docBytes = 2800;
    const baseline = cases.reduce((n, c) => n + docBytes + bytes(c.args.task), 0);
    const routerManifest = JSON.parse(readFileSync(program("router"), "utf8"));
    const prompt = routerManifest.cells.find((c: { id: string }) => c.id === "route").prompt as string;
    // quality: scripted executor answers the expected lane per case — the run
    // measures call count + work; accuracy on the SAME cases is what evolve
    // reports, so we run the habitat eval for the real number.
    const respDir = mkdtempSync(join(tmpdir(), "bench-resp-"));
    writeFileSync(join(respDir, "r.json"), JSON.stringify({
      gen: routerManifest,
      route: cases.map((c) => c.expect),
    }));
    const r = (await runProgram({
      manifestPath: program("router-habitat"),
      args: { src: { cases } },
      dir: mkdtempSync(join(tmpdir(), "bench-")),
      executorSpecs: [`scripted:${join(respDir, "r.json")}`],
    })) as unknown as Receipt;
    const score = r.cells["score"]?.outputs?.out as { score?: number } | undefined;
    rows.push(row("router-habitat", "habitat", baseline, r, {
      quality: `scripted labels score ${score?.score ?? "?"} on ${cases.length} training cases; no independent accuracy evidence`,
      detail: "per-case doc-reading agent vs classifier + spawned eval loop",
    }));
  }

  {
    const rawSources = [0, 1, 2].map((i) => ({
      title: `Source ${i + 1}`,
      text: `<html><article>${`Evidence ${i + 1} supports the bounded research question. `.repeat(260)}</article><nav>${"navigation filler ".repeat(700)}</nav><script>${"tracking ".repeat(900)}</script></html>`,
    }));
    const baseline = rawSources.map((source) => source.text).join("\n");
    const respDir = mkdtempSync(join(tmpdir(), "bench-resp-"));
    writeFileSync(join(respDir, "r.json"), JSON.stringify({
      judge: { answers: {
        relevance: { choice: "supports", confidence: 0.9, probabilities: { supports: 0.9, contradicts: 0.02, mixed: 0.05, irrelevant: 0.03 } },
        sufficient: { noul: 0.82 },
        source_quality: { score: 4, confidence: 0.8, probabilities: { "1": 0.01, "2": 0.04, "3": 0.15, "4": 0.7, "5": 0.1 } },
      } },
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => new Response(rawSources[Number(String(url).split("/").pop())]?.text ?? "", {headers:{"content-type":"text/html"}})) as typeof fetch;
    let r: Receipt;
    try { r = (await runProgram({
      manifestPath: program("research-triage"),
      args: { src: { sources: rawSources.map((_, i)=>`https://fixture.invalid/${i}`), question: "Does the evidence support the claim?", "max-bytes-per-source": 4000 } },
      dir: mkdtempSync(join(tmpdir(), "bench-")),
      executorSpecs: [`scripted:${join(respDir, "r.json")}`],
    })) as unknown as Receipt;
    } finally { globalThis.fetch = originalFetch; }
    rows.push(row("research-triage", "semi", baseline, r, {
      baseline_agent_calls: 1,
      quality: "scripted typed relevance/sufficiency/quality answers over the same three sources",
      detail: "raw HTML sources vs stripped byte-capped evidence + one typed decision",
    }));
  }

  {
    const draft = Array.from({ length: 320 }, (_, i) => `Paragraph ${i + 1}. This draft sentence explains the same concept with measured detail and a claim of ${i + 10}% improvement.`).join("\n\n");
    const r = (await runProgram({
      manifestPath: program("writing-audit"),
      args: { src: { text: draft } },
      dir: mkdtempSync(join(tmpdir(), "bench-")),
    })) as unknown as Receipt;
    rows.push(row("writing-audit", "fixed", draft, r, {
      quality: "mechanical audit signals preserved; semantic editing still requires selected prose",
      detail: "whole draft scan vs deterministic bounded audit record",
    }));
  }

  {
    const rawDiff = sh("git diff HEAD", repo);
    const respDir = mkdtempSync(join(tmpdir(), "bench-resp-"));
    writeFileSync(join(respDir, "r.json"), JSON.stringify({
      judge: { answers: {
        risk: { choice: "medium", confidence: 0.8, probabilities: { low: 0.1, medium: 0.8, high: 0.1 } },
        merge_ready: { noul: 0.65 },
        quality: { score: 3, confidence: 0.75, probabilities: { "1": 0.02, "2": 0.08, "3": 0.7, "4": 0.15, "5": 0.05 } },
      } },
    }));
    const r = (await runProgram({
      manifestPath: program("change-triage"),
      args: { src: { cwd: repo, "max-bytes": 8000 } },
      dir: mkdtempSync(join(tmpdir(), "bench-")),
      executorSpecs: [`scripted:${join(respDir, "r.json")}`],
    })) as unknown as Receipt;
    rows.push(row("change-triage", "semi", rawDiff, r, {
      baseline_agent_calls: 1,
      quality: "typed risk/readiness/quality answers over the same bounded diff",
      detail: "whole diff vs capped evidence + one Jev-compatible typed decision",
    }));
  }

  // ------------------------------------------------------------- report ---
  const totals = rows.reduce(
    (a, r) => ({
      baseline_context_bytes: a.baseline_context_bytes + r.baseline_context_bytes,
      system_one_context_bytes: a.system_one_context_bytes + r.system_one_context_bytes,
      agent_calls: a.agent_calls + r.agent_calls,
      baseline_agent_calls: a.baseline_agent_calls + r.baseline_agent_calls,
      work_units: a.work_units + r.work_units,
    }),
    { baseline_context_bytes: 0, system_one_context_bytes: 0, agent_calls: 0, baseline_agent_calls: 0, work_units: 0 },
  );
  const report = {
    source_fingerprint: benchmarkFingerprint(),
    generated_by: "bench/run-bench.ts — deterministic fixtures, no live model calls",
    methodology: {
      baseline: "raw bytes an agent ingests doing the same job by hand (command dumps, unbounded logs, doc reads)",
      algal: "exact default CLI stdout bytes + observed serialized model request/response envelopes for every nested executor call; not provider tokenization",
      tokens: "est = ceil(bytes/4) — a byte estimate, not provider usage",
      caveats: [
        "baselines measure the evidence-ingestion half of a workflow, not the agent's reasoning cost",
        "byte reduction is not a token/billing guarantee; cache effects depend on provider",
        "fixture size is selected; real inputs can be smaller and produce negative savings",
        "diff-review baseline assumes a typical 3-call read-review loop (labeled assumption)",
        "historical -18.9% small-diff result used the old selected-output measurement; rerun real small inputs and count current full CLI + nested envelopes",
        "Jev-compatible rows use scripted typed answers: they validate orchestration and bytes, not live provider quality, latency, or billing",
        "writing-audit preserves mechanical signals, not the draft's full semantic content; semantic editing still requires selected prose",
      ],
    },
    workflows: rows,
    totals: {
      ...totals,
      context_reduction_pct: Math.round((1 - totals.system_one_context_bytes / totals.baseline_context_bytes) * 1000) / 10,
      est_baseline_tokens: est(totals.baseline_context_bytes),
      est_system_one_tokens: est(totals.system_one_context_bytes),
    },
  };
  mkdirSync(join(PKG, "bench", "report"), { recursive: true });
  writeFileSync(join(PKG, "bench", "report", "bench-report.json"), JSON.stringify(report, null, 1) + "\n");
  process.stdout.write(JSON.stringify(report, null, 1) + "\n");
}

await main();
