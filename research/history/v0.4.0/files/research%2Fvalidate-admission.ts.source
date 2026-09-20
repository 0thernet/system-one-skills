import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (path: string) => createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));
const report = read("research/admission-report.json");
assert.equal(report.schema_version, 2);
assert.deepEqual(report.portfolio, ["system-one-verify"]);
assert.equal(report.tokenizer.library, "tiktoken");
assert.equal(report.tokenizer.version, "0.12.0");
assert.equal(report.tokenizer.encoding, "o200k_base");
assert.equal(report.routing.minimum_expected_output_bytes, 8192);
assert.equal(report.routing.minimum_net_token_margin, 128);
assert.equal(report.overhead.original_recorded_user_and_system_prompt_tokens, null);

const files = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
const expectedSources = [
  "research/assess_admission.py", "research/replay_validation.mjs", "research/requirements.txt", "research/analyze_sessions.py",
  "skills/system-one-verify/SKILL.md", ...files("src").filter(path => path.endsWith(".js")), ...files("bin").filter(path => path.endsWith(".js")),
];
assert.deepEqual(Object.keys(report.evaluated_source_sha256).sort(), expectedSources.sort());
for (const path of expectedSources) assert.equal(report.evaluated_source_sha256[path], sha(path), `Evidence is stale: ${path}`);
assert.deepEqual(files("skills").filter(path => path.endsWith("/SKILL.md")), ["skills/system-one-verify/SKILL.md"]);

const totals: Record<string, number> = { codex: 0, claude: 0, devin: 0 };
const intervals: Array<[number, number]> = [];
for (const cohort of report.corpora) {
  assert.match(cohort.path, /^research\/(?:supplemental-)?session-report\.json$/);
  assert.equal(cohort.file_sha256, sha(cohort.path), `Corpus file changed: ${cohort.path}`);
  const corpus = read(cohort.path);
  assert.equal(corpus.analyzer_sha256, sha("research/analyze_sessions.py"));
  assert.equal(cohort.corpus_evidence_sha256, corpus.corpus_evidence_sha256);
  const interval: [number, number] = [Date.parse(corpus.window.since_inclusive_utc), Date.parse(corpus.window.until_exclusive_utc)];
  assert(interval.every(Number.isFinite) && interval[0] < interval[1]);
  for (const earlier of intervals) assert(interval[0] >= earlier[1] || interval[1] <= earlier[0], "Cohort windows overlap");
  intervals.push(interval);
  for (const name of Object.keys(totals)) {
    assert(corpus.providers[name]);
    totals[name] = (totals[name] ?? 0) + corpus.providers[name].unique_tool_calls;
  }
}
for (const [name, count] of Object.entries(totals)) assert(count > 0, `${name}: missing real transcript population`);

const expectedInvariants = ["source_byte_count_correct", "presented_byte_count_correct", "exact_passthrough_or_marked_compaction", "compacted_exit_status_disclosed", "compacted_omission_disclosed", "compacted_artifact_path_disclosed", "capture_bound_disclosed", "compaction_meets_byte_guard", "complete_archived_excerpt_saved", "artifact_permissions_private"];
const ids = new Set<string>();
let routed = 0, retainedNegatives = 0, saved = 0;
for (const row of report.samples) {
  assert.match(row.sample_id, /^[a-f0-9]{64}$/);
  const identity = `${row.provider}:${row.sample_id}`;
  assert(!ids.has(identity), "Duplicate public replay row");
  ids.add(identity);
  assert(row.provider in totals);
  assert.equal(row.routed_by_prior_output_size, row.archived_output_bytes >= report.routing.minimum_expected_output_bytes, "Routing must not be selected by observed savings");
  assert.deepEqual(Object.keys(row.invariants).sort(), expectedInvariants.sort());
  assert(Object.values(row.invariants).every(value => value === true), "Preservation invariant failed");
  assert.equal(row.output_tokens_saved, row.archived_output_tokens - row.presented_output_tokens);
  assert.equal(row.first_use_incremental_tokens, report.overhead.first_use_incremental_tokens);
  assert.equal(row.net_tokens_saved_after_first_use, row.output_tokens_saved - row.first_use_incremental_tokens);
  if (row.routed_by_prior_output_size) {
    routed++;
    saved += row.net_tokens_saved_after_first_use;
    assert(row.net_tokens_saved_after_first_use >= 128, "Routed case fails the token margin");
    assert.equal(row.meets_net_margin, true);
  } else if (row.net_tokens_saved_after_first_use < 0) retainedNegatives++;
}
assert(routed > 0, "No admitted real replay cases");
assert(retainedNegatives > 0, "Missing nonrouted negative counterexamples");
assert.equal(report.summary.sampled_cases, report.samples.length);
assert.equal(report.summary.routed_cases, routed);
assert.equal(report.summary.routed_net_tokens_saved, saved);
assert.equal(report.summary.routed_cases_below_margin, 0);
assert.equal(report.summary.invariant_failures, 0);
for (const provider of Object.keys(totals)) assert(report.providers[provider], `Missing zero-inclusive provider result: ${provider}`);
console.log(`Admission evidence current: ${routed} routed cases clear the 128-token margin; ${retainedNegatives} nonrouted negatives retained. Token counts use o200k_base, not provider billing.`);
