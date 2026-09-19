#!/usr/bin/env bun
/** Replay archived stdout through the actual test-sift program. Never rerun
 * transcript commands. Private logs and receipts stay outside the repository.
 * The only public output is explicitly selected numeric/boolean measurements.
 */
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { PKG, runProgram } from "../src/run-program.ts";
import { compactReport, reportFailed } from "../src/report.ts";

type ReplayInput = { provider: "codex" | "claude" | "devin"; sample_id: string; log: string; exit_code: number; source_view?: "tool_result" | "completed_command_event" };
type PublicRow = {
  provider: ReplayInput["provider"]; sample_id: string; archived_log_bytes: number;
  source_view?: ReplayInput["source_view"];
  status: "measured" | "excluded" | "harness_error"; exclusion?: string;
  compact_cli_bytes?: number; byte_reduction_percent?: number;
  raw_bytes_div_4_proxy?: number; compact_bytes_div_4_proxy?: number;
  original_exit_zero?: boolean; exit_code_preserved?: boolean;
  verdict_preserved?: boolean; tail_check_applicable?: boolean; final_30_lines_preserved?: boolean;
  emitted_bytes_preserved?: boolean; source_excerpt_has_truncation_marker?: boolean;
};
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function validateSample(value: unknown): ReplayInput {
  if (value === null || typeof value !== "object") throw new Error("Invalid replay sample");
  const row = value as Record<string, unknown>;
  if (!["codex", "claude", "devin"].includes(String(row.provider)) || typeof row.sample_id !== "string" || !/^[a-f0-9]{64}$/.test(row.sample_id) || typeof row.log !== "string" || !Number.isInteger(row.exit_code)) {
    throw new Error("Invalid replay sample");
  }
  if (row.source_view !== undefined && !["tool_result", "completed_command_event"].includes(String(row.source_view))) throw new Error("Invalid replay source view");
  return row as ReplayInput;
}

export async function runReplay(inputFile: string, outputFile: string, corpusReport: string) {
  const input = await realpath(resolve(inputFile));
  const packageRoot = await realpath(PKG);
  if (input === packageRoot || input.startsWith(packageRoot + sep)) throw new Error("Private replay input must be outside the repository");
  const inputs: unknown = JSON.parse(await readFile(input, "utf8"));
  if (!Array.isArray(inputs) || inputs.length > 36) throw new Error("Expected at most 36 replay samples");
  const samples = inputs.map(validateSample);
  const privateDir = await mkdtemp(join(dirname(input), "replay-"));
  await chmod(privateDir, 0o700);
  const manifestPath = join(PKG, "programs/test-sift.algal.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const rows: PublicRow[] = [];
  for (const sample of samples) {
    const rawBytes = Buffer.byteLength(sample.log);
    const row: PublicRow = {
      provider: sample.provider, sample_id: sample.sample_id,
      source_view: sample.source_view ?? "tool_result",
      archived_log_bytes: rawBytes, status: "excluded",
      source_excerpt_has_truncation_marker: /\boutput (?:was )?truncated\b|\[\.\.\.\s*truncat|\[truncated\]/i.test(sample.log),
    };
    rows.push(row);
    if (sample.exit_code < 0 || sample.exit_code > 255) { row.exclusion = "exit_code_outside_portable_shell_range"; continue; }
    if (rawBytes > 256 * 1024) { row.exclusion = "archived_log_exceeds_256kib_replay_bound"; continue; }
    try {
      const cwd = join(privateDir, sample.sample_id);
      await mkdir(cwd, { mode: 0o700 });
      await writeFile(join(cwd, "case.json"), JSON.stringify({ log: sample.log, exit_code: sample.exit_code }), { mode: 0o600 });
      await writeFile(join(cwd, "replay.mjs"), 'import { readFileSync } from "node:fs";\nconst value = JSON.parse(readFileSync(new URL("./case.json", import.meta.url), "utf8"));\nprocess.stdout.write(value.log);\nprocess.exitCode = value.exit_code;\n', { mode: 0o600 });
      const receipt = await runProgram({ manifestPath, args: { src: { cwd, cmd: "bun ./replay.mjs" } }, dir: join(cwd, "receipt") });
      const report = compactReport(receipt, manifest);
      const serialized = JSON.stringify(report) + "\n";
      const detail = report.outputs.report as Record<string, unknown> | undefined;
      const lastLines = sample.log.split("\n").slice(-30).join("\n").trim();
      const tailApplicable = Buffer.byteLength(lastLines) <= 12000;
      const compactBytes = Buffer.byteLength(serialized);
      Object.assign(row, {
        status: "measured", compact_cli_bytes: compactBytes,
        byte_reduction_percent: rawBytes ? Number(((1 - compactBytes / rawBytes) * 100).toFixed(2)) : null,
        raw_bytes_div_4_proxy: Math.ceil(rawBytes / 4), compact_bytes_div_4_proxy: Math.ceil(compactBytes / 4),
        original_exit_zero: sample.exit_code === 0,
        exit_code_preserved: detail?.code === sample.exit_code,
        verdict_preserved: report.outcome === "complete" && reportFailed(report) === (sample.exit_code !== 0),
        tail_check_applicable: tailApplicable,
        ...(tailApplicable ? { final_30_lines_preserved: detail?.tail === lastLines } : {}),
        emitted_bytes_preserved: detail?.output_bytes === rawBytes,
      });
      // The receipt contains private excerpts; store only under privateDir.
      await writeFile(join(cwd, "compact-result.json"), serialized, { mode: 0o600 });
    } catch {
      row.status = "harness_error";
      row.exclusion = "replay_failed_private_diagnostics_required";
    }
  }
  const providers = Object.fromEntries(["codex", "claude", "devin"].map(provider => {
    const selected = rows.filter(row => row.provider === provider);
    const measured = selected.filter(row => row.status === "measured");
    const raw = measured.reduce((sum, row) => sum + row.archived_log_bytes, 0);
    const compact = measured.reduce((sum, row) => sum + (row.compact_cli_bytes ?? 0), 0);
    return [provider, {
      sampled: selected.length, measured: measured.length,
      excluded: selected.filter(row => row.status === "excluded").length,
      harness_errors: selected.filter(row => row.status === "harness_error").length,
      archived_log_bytes: raw, compact_cli_bytes: compact,
      byte_reduction_percent: raw ? Number(((1 - compact / raw) * 100).toFixed(2)) : null,
      cases_with_smaller_payload: measured.filter(row => (row.compact_cli_bytes ?? 0) < row.archived_log_bytes).length,
      cases_with_larger_or_equal_payload: measured.filter(row => (row.compact_cli_bytes ?? 0) >= row.archived_log_bytes).length,
      original_nonzero_exits: measured.filter(row => !row.original_exit_zero).length,
      exit_code_failures: measured.filter(row => !row.exit_code_preserved).length,
      verdict_failures: measured.filter(row => !row.verdict_preserved).length,
      byte_count_failures: measured.filter(row => !row.emitted_bytes_preserved).length,
      tail_cases_checked: measured.filter(row => row.tail_check_applicable).length,
      tail_failures: measured.filter(row => row.tail_check_applicable && !row.final_30_lines_preserved).length,
    }];
  }));
  const source = JSON.parse(await readFile(corpusReport, "utf8"));
  const report = {
    schema_version: 1,
    method: "Deterministic smallest-hash sample of up to 12 completed validation outputs per provider. Replays only recorded stdout and explicit exit status through the actual test-sift program with a fresh private receipt store. No archived command is executed. All sampled outcomes, including growth, exclusion and harness failures, are retained.",
    baseline: "UTF-8 bytes of the archived log excerpt alone; excludes its original tool envelope. The intervention measures the exact default CLI compactReport JSON plus newline, using the fixed harmless replay command label. Skill loading, invocation input, later repair turns and end-to-end task quality are not measured.",
    token_proxy: "ceil(UTF-8 bytes / 4), a rough text-size proxy only; no model tokenizer or billed token savings claim.",
    correctness_scope: "Exact recorded exit status, pass/fail outcome, emitted byte count, and the final 30 newline-separated records, trimmed, where that tail fits the 12KB output bound. Provider metadata can remain in archived excerpts; original stdout/stderr ordering is not reconstructed. These invariants do not establish that an agent can diagnose the original failure or finish the original task.",
    corpus_evidence_sha256: source.corpus_evidence_sha256,
    replay_script_sha256: sha(await readFile(new URL(import.meta.url))),
    evaluated_source_sha256: Object.fromEntries(await Promise.all(["programs/test-sift.algal.json", "src/run-program.ts", "src/report.ts", "tools/tool.ts"].map(async path => [path, sha(await readFile(join(PKG, path)))]))),
    providers, samples: rows,
  };
  await mkdir(dirname(resolve(outputFile)), { recursive: true });
  await writeFile(outputFile, JSON.stringify(report, null, 2) + "\n");
  return report;
}

if (import.meta.main) {
  const [input, output = "research/replay-report.json", corpus = "research/session-report.json"] = process.argv.slice(2);
  if (!input) throw new Error("Usage: bun research/replay_validation.ts PRIVATE_INPUT [PUBLIC_REPORT] [CORPUS_REPORT]");
  const report = await runReplay(input, output, corpus);
  console.log(JSON.stringify(report.providers));
}
