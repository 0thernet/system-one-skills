#!/usr/bin/env bun
// Synthetic contract probes. These are not real transcript savings evidence.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reduceOutput } from "../src/reduce.js";
import { benchmarkFingerprint } from "./source-fingerprint.ts";
const cases = [
  { id: "short-success", code: 0, text: "12 tests passed\n" },
  { id: "short-failure", code: 7, text: "FAIL total: expected 15, received 8\n" },
  { id: "verbose-success", code: 0, text: Array.from({length: 1000}, (_, i) => `PASS case_${i}: expected result verified`).join("\n") + "\n1000 passed, 0 failed\n" },
  { id: "verbose-failure", code: 7, text: "FAIL invoice total: expected 15, received 8\n" + Array.from({length: 1000}, (_, i) => `PASS case_${i}: expected result verified`).join("\n") + "\n999 passed, 1 failed\n" },
];
const rows = cases.map(c => {
  const r = reduceOutput({text:c.text, code:c.code, logPath:"/tmp/system-one-example/output.log"});
  const raw = Buffer.byteLength(c.text), out = Buffer.byteLength(r.text);
  if (raw < 8192 && r.text !== c.text) throw new Error(`${c.id}: short output changed`);
  if (r.compacted && !(out <= raw / 2 && raw - out >= 4096)) throw new Error(`${c.id}: insufficient output reduction`);
  if (c.id === "verbose-failure" && !r.text.includes("expected 15, received 8")) throw new Error("failure evidence omitted");
  return {case:c.id, exit_code:c.code, input_bytes:raw, output_bytes:out, compacted:r.compacted};
});
const report = {source_fingerprint:benchmarkFingerprint(), method:"Synthetic reducer contract probes. Bytes only; no provider-token or whole-task savings claim. Real transcript token measurements are in research/admission-report.json.", cases:rows};
writeFileSync(fileURLToPath(new URL("./report/bench-report.json",import.meta.url)), JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(rows));
