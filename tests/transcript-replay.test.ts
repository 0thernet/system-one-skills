import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReplay, validateSample } from "../research/replay_validation.ts";

test("replay measures real compact output, retains growth, and never publishes private log text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "system-one-transcript-replay-"));
  try {
    const input = join(dir, "private.json");
    const output = join(dir, "public.json");
    const corpus = join(dir, "corpus.json");
    await writeFile(input, JSON.stringify([
      { provider: "codex", sample_id: "a".repeat(64), log: "PRIVATE-CONTENT\nFAIL archived-only", exit_code: 2 },
      { provider: "devin", sample_id: "b".repeat(64), log: "", exit_code: 0 },
      { provider: "claude", sample_id: "c".repeat(64), log: "x".repeat(256 * 1024 + 1), exit_code: 0 },
    ]));
    await writeFile(corpus, JSON.stringify({ corpus_evidence_sha256: "d".repeat(64) }));
    const report = await runReplay(input, output, corpus);
    expect(report.providers.codex?.measured).toBe(1);
    expect(report.providers.codex?.original_nonzero_exits).toBe(1);
    expect(report.providers.codex?.exit_code_failures).toBe(0);
    expect(report.providers.codex?.verdict_failures).toBe(0);
    expect(report.providers.codex?.tail_failures).toBe(0);
    expect(report.providers.devin?.cases_with_larger_or_equal_payload).toBe(1);
    expect(report.providers.claude?.excluded).toBe(1);
    expect(await readFile(output, "utf8")).not.toContain("PRIVATE-CONTENT");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("replay sample IDs and statuses cannot inject a path or shell command", () => {
  expect(() => validateSample({ provider: "codex", sample_id: "../../escape", log: "safe", exit_code: 0 })).toThrow();
  expect(() => validateSample({ provider: "unknown", sample_id: "a".repeat(64), log: "safe", exit_code: 0 })).toThrow();
  expect(() => validateSample({ provider: "devin", sample_id: "a".repeat(64), log: "safe", exit_code: "0; malicious" })).toThrow();
});
