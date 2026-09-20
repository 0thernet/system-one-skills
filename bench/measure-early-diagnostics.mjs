#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { stageHistoricalEvidence, verifyHistoricalArchive } from '../research/validate-history.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = join(root, 'bench/report/early-diagnostics-runtime.json');
const attemptsPath = join(root, 'bench/report/early-diagnostics-attempts');
const protocolPath = 'bench/early-diagnostics-protocol.json';
const protocol = JSON.parse(readFileSync(join(root, protocolPath), 'utf8'));
const paths = [protocolPath, 'bench/measure-early-diagnostics.mjs', 'package.json', 'bun.lock',
  'bin/system-one-skills.js', 'src/check.js', 'src/process.js', 'src/reduce.js',
  'skills/system-one-verify/SKILL.md', 'tests/check-runtime.test.ts',
  'tests/early-diagnostics-runtime.test.mjs', 'scripts/check.ts',
  'research/validate-history.mjs', 'research/history/v0.4.0/manifest.json'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = () => Object.fromEntries(paths.map(path => [path, hash(readFileSync(join(root, path)))]));
const round = value => Number(value.toFixed(6));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export function summarize(values) {
  assert(values.length > 0 && values.every(Number.isFinite));
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return { n: sorted.length, min_ms: sorted[0], median_ms: round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2), p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1], max_ms: sorted.at(-1) };
}
const MiB = 1024 * 1024;
const early = 'ERROR early retention fixture: missing required build input\n';
const tail = 'Final fixture sentinel\n';
const fill = (bytes, line) => Buffer.from(line.repeat(Math.ceil(bytes / Buffer.byteLength(line))).slice(0, bytes));
const noisy = (size, prefix, suffix, line = 'PASS ordinary validation result\n') => Buffer.concat([Buffer.from(prefix), fill(size - Buffer.byteLength(prefix + suffix), line), Buffer.from(suffix)]);
const fixtures = [
  { id: 'short-success', code: 0, bytes: Buffer.from('12 checks passed\n') },
  { id: 'short-failure', code: 7, bytes: Buffer.from([255, 0, 254, 10, ...Buffer.from('ERROR short binary fixture\n')]) },
  { id: 'passing-lines', code: 0, bytes: noisy(MiB, '', tail) },
  { id: 'early-failure', code: 7, bytes: noisy(MiB, early, tail), marker: early.trim(), baselineMarker: false },
  { id: 'late-failure', code: 7, bytes: noisy(MiB, '', early + tail), marker: early.trim(), baselineMarker: true },
  { id: 'blank-lines', code: 0, bytes: noisy(MiB, '', tail, '\r\n') },
  { id: 'giant-line', code: 7, bytes: noisy(4 * MiB, early, '\n' + tail, 'x'), marker: early.trim(), baselineMarker: false },
  { id: 'error-flood', code: 7, bytes: noisy(MiB, early, tail, 'ERROR repeated fixture failure\n'), marker: early.trim(), baselineMarker: false },
  { id: 'invalid-utf8', code: 7, bytes: Buffer.concat([Buffer.from(early), Buffer.alloc(MiB - Buffer.byteLength(early + tail) - 1, 255), Buffer.from('\n' + tail)]), marker: early.trim(), baselineMarker: false },
];
assert.deepEqual(fixtures.map(f => f.id), protocol.fixture_ids);
assert.deepEqual(protocol.arms, ['native', 'baseline', 'candidate']);
const identity = f => ({ id: f.id, bytes: f.bytes.length, sha256: hash(f.bytes), code: f.code, marker_required: Boolean(f.marker) });
const orderFor = (index, iteration) => {
  const shift = (index + iteration + protocol.warmup_pairs_per_fixture) % 3;
  return [...protocol.arms.slice(shift), ...protocol.arms.slice(0, shift)];
};
const contractsFor = f => ({ original_exit: true, one_execution_per_arm: true, native_bytes_exact: true, baseline_log_exact: true, candidate_log_exact: true, private_log_mode: '0600', short_passthrough: f.bytes.length < 8192 ? true : null, candidate_marker_retained: f.marker ? true : null, baseline_marker_retained: f.marker ? f.baselineMarker : null, candidate_tail_retained: f.bytes.length >= 8192 ? true : null });
function schedule() {
  const result = [];
  for (let iteration = -protocol.warmup_pairs_per_fixture; iteration < protocol.measured_pairs_per_fixture; iteration++) {
    for (let slot = 0; slot < fixtures.length; slot++) {
      const index = (slot + iteration + protocol.warmup_pairs_per_fixture) % fixtures.length;
      for (const arm of orderFor(index, iteration)) result.push({ iteration, fixture_id: fixtures[index].id, arm });
    }
  }
  return result;
}
// Public identities only. No fixture bytes, child arguments, logs, or private paths.
export function runtimeEvidenceSpec() {
  return { fixtures: fixtures.map(identity), schedule: schedule(), source_sha256: sourceHashes(), protocol_sha256: hash(readFileSync(join(root, protocolPath))), baseline_commit: verifyHistoricalArchive().sourceCommit };
}
function outputGuard(f, arm, bytes) {
  assert(Number.isSafeInteger(bytes) && bytes > 0, 'Invalid output byte count');
  if (arm === 'native' || f.bytes.length < 8192) assert.equal(bytes, f.bytes.length, 'Exact output byte count changed');
  else {
    assert(bytes < f.bytes.length / 2, 'Wrapped output is not reduced below half');
    assert(f.bytes.length - bytes >= 4096, 'Wrapped output savings below minimum');
  }
}
export function createRuntimeAttemptJournal(directory = attemptsPath) {
  mkdirSync(directory, { recursive: true });
  const stat = lstatSync(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Unsafe attempt directory');
  const file = `journal-${randomUUID()}.jsonl`, path = join(directory, file);
  writeFileSync(path, '', { flag: 'wx', mode: 0o644 });
  let size = 0;
  return {
    file,
    append(event) {
      const bytes = Buffer.from(JSON.stringify(event) + '\n');
      assert(size + bytes.length <= 1024 * 1024, 'Attempt journal exceeds bound');
      appendFileSync(path, bytes); size += bytes.length;
    },
    identity() { return { file, sha256: hash(readFileSync(path)) }; },
  };
}
export function saveRuntimeAttempt(attempt, directory = attemptsPath) {
  const bytes = jsonBytes(attempt);
  assert(bytes.length <= 1024 * 1024, 'Attempt exceeds public evidence bound');
  const digest = hash(bytes);
  mkdirSync(directory, { recursive: true });
  const stat = lstatSync(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Unsafe attempt directory');
  const path = join(directory, `${digest}.json`);
  try { writeFileSync(path, bytes, { flag: 'wx', mode: 0o644 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = lstatSync(path);
    assert(existing.isFile() && !existing.isSymbolicLink() && existing.nlink === 1);
    assert(readFileSync(path).equals(bytes), 'Existing attempt changed');
  }
  return digest;
}
function readAttempt(digest) {
  assert.match(digest, /^[a-f0-9]{64}$/);
  const path = join(attemptsPath, `${digest}.json`), stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 1024 * 1024, 'Unsafe attempt artifact');
  const bytes = readFileSync(path);
  assert.equal(hash(bytes), digest, 'Attempt content changed');
  const attempt = JSON.parse(bytes.toString('utf8'));
  assert.match(attempt.journal.file, /^journal-[a-f0-9-]{36}\.jsonl$/);
  assert.match(attempt.journal.sha256, /^[a-f0-9]{64}$/);
  const journalPath = join(attemptsPath, attempt.journal.file), journalStat = lstatSync(journalPath);
  assert(journalStat.isFile() && !journalStat.isSymbolicLink() && journalStat.nlink === 1 && journalStat.size <= 1024 * 1024);
  assert.equal(hash(readFileSync(journalPath)), attempt.journal.sha256, 'Attempt journal changed');
  return attempt;
}
export function buildRuntimeReport(attempt) {
  const records = fixtures.map(f => ({ fixture: identity(f), measurements: [] }));
  for (const [index, row] of records.entries()) {
    const f = fixtures[index];
    for (let iteration = 0; iteration < protocol.measured_pairs_per_fixture; iteration++) {
      const observations = attempt.observations.filter(o => o.iteration === iteration && o.fixture_id === f.id);
      assert.equal(observations.length, 3, 'Missing measured arm');
      const arms = Object.fromEntries(observations.map(o => [o.arm, o]));
      row.measurements.push({ iteration, order: observations.map(o => o.arm), native_ms: arms.native.ms, baseline_ms: arms.baseline.ms, candidate_ms: arms.candidate.ms, extra_ms: round(arms.candidate.ms - arms.baseline.ms), wrapper_overhead_ms: round(arms.candidate.ms - arms.native.ms), native_output_bytes: arms.native.output_bytes, baseline_output_bytes: arms.baseline.output_bytes, candidate_output_bytes: arms.candidate.output_bytes });
    }
    for (const name of protocol.arms) row[name] = summarize(row.measurements.map(m => m[`${name}_ms`]));
    row.extra = summarize(row.measurements.map(m => m.extra_ms));
    row.wrapper_overhead = summarize(row.measurements.map(m => m.wrapper_overhead_ms));
    row.median_extra_limit_ms = round(Math.max(protocol.median_extra_ms_floor, row.baseline.median_ms * protocol.median_extra_baseline_fraction));
    row.meets_latency_budget = row.extra.median_ms <= row.median_extra_limit_ms;
    row.contracts = contractsFor(f);
  }
  const failures = records.filter(r => !r.meets_latency_budget).map(r => r.fixture.id);
  return { schema_version: 1, evidence_type: 'synthetic paired CLI artifact qualification', measured_at_utc: attempt.finished_at_utc, environment: attempt.environment, source_sha256: attempt.source_sha256_before, protocol_sha256: attempt.protocol_sha256, baseline_commit: attempt.baseline_commit, measured_triplets: fixtures.length * protocol.measured_pairs_per_fixture, total_command_runs: schedule().length, cases: records, latency_budget_failures: failures, outcome: failures.length ? 'latency-budget-failure' : 'artifact-contracts-and-local-latency-budget-pass', limitations: protocol.limitations };
}
export function validateRuntimeReport(report, expectedSources = sourceHashes(), loadAttempt = readAttempt) {
  assert(!['incomplete-attempt', 'failed-attempt-retained'].includes(report.outcome), 'Latest measurement attempt is incomplete or failed');
  assert.equal(report.schema_version, 1);
  assert.equal(report.evidence_type, 'synthetic paired CLI artifact qualification');
  assert.deepEqual(report.source_sha256, expectedSources, 'Current measured source changed; rerun the declared experiment');
  assert.equal(report.protocol_sha256, hash(readFileSync(join(root, protocolPath))));
  assert.equal(report.baseline_commit, protocol.baseline_commit);
  assert.equal(report.baseline_commit, verifyHistoricalArchive().sourceCommit, 'Baseline source identity changed');
  assert.match(report.attempt_sha256, /^[a-f0-9]{64}$/);
  const attempt = loadAttempt(report.attempt_sha256);
  assert.equal(hash(jsonBytes(attempt)), report.attempt_sha256, 'Attempt content changed');
  assert.equal(attempt.schema_version, 1);
  assert.equal(attempt.evidence_type, 'append-only CLI qualification attempt');
  assert.equal(attempt.status, 'complete', 'Incomplete or failed attempt cannot qualify');
  assert.equal(attempt.failure, null);
  assert.deepEqual(attempt.source_sha256_before, expectedSources);
  assert.deepEqual(attempt.source_sha256_after, expectedSources, 'Source changed during measurement');
  assert.equal(attempt.protocol_sha256, report.protocol_sha256);
  assert.equal(attempt.baseline_commit, report.baseline_commit);
  assert.equal(attempt.observations.length, schedule().length);
  for (const [index, expected] of schedule().entries()) {
    const o = attempt.observations[index];
    assert.deepEqual({ iteration: o.iteration, fixture_id: o.fixture_id, arm: o.arm }, expected, 'Attempt schedule changed');
    assert.equal(o.status, 'passed', 'Unverified arm cannot qualify');
    assert(Number.isFinite(o.ms) && o.ms > 0);
    outputGuard(fixtures.find(f => f.id === o.fixture_id), o.arm, o.output_bytes);
  }
  const { attempt_sha256: unused, ...snapshot } = report;
  assert.deepEqual(snapshot, attempt.report, 'Report differs from immutable attempt');
  assert.deepEqual(snapshot, buildRuntimeReport(attempt), 'Report contracts or arithmetic changed');
  // Recompute from the complete attempt; warmups remain visible but are excluded
  // only from the predeclared measured summaries, never silently trimmed.
  return report.latency_budget_failures;
}

async function measure() {
  const attempt = { schema_version: 1, evidence_type: 'append-only CLI qualification attempt', started_at_utc: new Date().toISOString(), finished_at_utc: null, environment: { platform: process.platform, arch: process.arch, kernel: release(), node: process.version, scheduler: 'required externally; invocation is not attested by this harness', host_isolation: 'other processes were not isolated' }, source_sha256_before: null, source_sha256_after: null, protocol_sha256: hash(readFileSync(join(root, protocolPath))), baseline_commit: null, observations: [], status: 'failed', failure: null, report: null };
  let historical, scratch, journal, phase = 'source', location = { fixture: null, arm: null }, failureCategory = 'source-unavailable';
  try {
    journal = createRuntimeAttemptJournal();
    journal.append({ event: 'started', started_at_utc: attempt.started_at_utc, protocol_sha256: attempt.protocol_sha256 });
    // A terminated measurement must not leave a previous passing pointer current.
    writeFileSync(reportPath, jsonBytes({ schema_version: 1, outcome: 'incomplete-attempt', journal_file: journal.file }));
    attempt.source_sha256_before = sourceHashes();
    journal.append({ event: 'sources', source_sha256_before: attempt.source_sha256_before });
    phase = 'stage'; failureCategory = 'historical-baseline-invalid';
    attempt.baseline_commit = verifyHistoricalArchive().sourceCommit;
    assert.equal(protocol.baseline_commit, attempt.baseline_commit, 'Baseline source identity changed');
    historical = stageHistoricalEvidence();
    phase = 'setup'; failureCategory = 'fixture-setup';
    scratch = mkdtempSync(join(tmpdir(), 'system-one-current-runtime-'));
    chmodSync(scratch, 0o700);
    const input = join(scratch, 'input.bin'), counter = join(scratch, 'counter'), log = join(scratch, 'command.log');
    const runner = join(scratch, 'fixture.cjs');
    writeFileSync(runner, 'const fs=require("node:fs");const [input,counter,code]=process.argv.slice(2);fs.appendFileSync(counter,"1");fs.writeSync(1,fs.readFileSync(input));process.exitCode=Number(code);\n', { mode: 0o600 });
    for (const entry of schedule()) {
      const f = fixtures.find(fixture => fixture.id === entry.fixture_id), name = entry.arm;
      phase = 'arm'; location = { fixture: f.id, arm: name }; failureCategory = 'fixture-setup';
      writeFileSync(input, f.bytes); writeFileSync(counter, ''); rmSync(log, { force: true });
      const child = [runner, input, counter, String(f.code)];
      const cli = join(name === 'baseline' ? historical.root : root, 'bin/system-one-skills.js');
      const argv = name === 'native' ? child : [cli, 'check', '--log', log, '--', process.execPath, ...child];
      const start = performance.now();
      failureCategory = 'process';
      const result = spawnSync(process.execPath, argv, { cwd: scratch, timeout: 15000, maxBuffer: 8 * MiB });
      const observation = { ...entry, ms: round(performance.now() - start), output_bytes: result.stdout?.length ?? 0, status: 'failed' };
      attempt.observations.push(observation);
      journal.append({ event: 'observed-arm', observation });
      assert.equal(result.error, undefined); assert.equal(result.signal, null);
      failureCategory = 'exit-code'; assert.equal(result.status, f.code);
      failureCategory = 'unexpected-stderr'; assert.equal(result.stderr.length, 0);
      failureCategory = 'child-execution-count'; assert.equal(readFileSync(counter, 'utf8'), '1');
      if (name === 'native') { failureCategory = 'native-bytes'; assert(result.stdout.equals(f.bytes)); }
      else {
        failureCategory = 'full-log-bytes'; assert(readFileSync(log).equals(f.bytes));
        failureCategory = 'private-log-mode'; assert.equal(statSync(log).mode & 0o777, 0o600);
        if (f.bytes.length < 8192) { failureCategory = 'short-passthrough'; assert(result.stdout.equals(f.bytes)); }
        else {
          failureCategory = 'compaction-shape'; assert(result.stdout.toString().startsWith(`exit=${f.code} bytes=${f.bytes.length} omitted=`));
          if (name === 'candidate') { failureCategory = 'tail-retention'; assert(result.stdout.includes(Buffer.from(tail.trim()))); }
        }
        if (f.marker) { failureCategory = 'diagnostic-retention'; assert.equal(result.stdout.includes(Buffer.from(f.marker)), name === 'candidate' || f.baselineMarker); }
      }
      failureCategory = 'output-byte-budget'; outputGuard(f, name, result.stdout.length);
      observation.status = 'passed';
      journal.append({ event: 'verified-arm', observation_index: attempt.observations.length - 1 });
    }
    phase = 'finalize'; location = { fixture: null, arm: null }; failureCategory = 'source-changed';
    attempt.source_sha256_after = sourceHashes();
    assert.deepEqual(attempt.source_sha256_after, attempt.source_sha256_before);
    attempt.finished_at_utc = new Date().toISOString();
    attempt.status = 'complete';
    attempt.report = buildRuntimeReport(attempt);
    failureCategory = 'report-contract';
    validateRuntimeReport({ ...attempt.report, attempt_sha256: hash(jsonBytes(attempt)) }, attempt.source_sha256_before, () => attempt);
  } catch {
    attempt.status = 'failed'; attempt.report = null;
    attempt.failure = { category: failureCategory, phase, ...location };
  } finally {
    if (attempt.finished_at_utc === null) attempt.finished_at_utc = new Date().toISOString();
    if (attempt.source_sha256_after === null) { try { attempt.source_sha256_after = sourceHashes(); } catch { /* Unavailable source is an explicit null. */ } }
    try {
      if (journal) {
        journal.append({ event: 'finished', status: attempt.status, finished_at_utc: attempt.finished_at_utc, source_sha256_after: attempt.source_sha256_after, failure: attempt.failure });
        attempt.journal = journal.identity();
      }
      // A content-addressed, exclusive write preserves prior attempts and their
      // complete report snapshots even when the current report pointer moves.
      const digest = saveRuntimeAttempt(attempt);
      if (attempt.status === 'complete') {
        const report = { ...attempt.report, attempt_sha256: digest };
        writeFileSync(reportPath, jsonBytes(report));
        console.log(JSON.stringify({ attempt_sha256: digest, outcome: report.outcome, cases: report.cases.map(r => ({ id: r.fixture.id, extra_ms: r.extra, limit_ms: r.median_extra_limit_ms })) }));
        if (report.latency_budget_failures.length) process.exitCode = 1;
      } else {
        writeFileSync(reportPath, jsonBytes({ schema_version: 1, outcome: 'failed-attempt-retained', attempt_sha256: digest }));
        console.error(JSON.stringify({ attempt_sha256: digest, outcome: 'failed-attempt-retained', failure: attempt.failure }));
        process.exitCode = 1;
      }
    } finally { if (scratch) rmSync(scratch, { recursive: true, force: true }); historical?.cleanup(); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.slice(2); assert.equal(mode.length, 1, 'Use --write or --check');
  if (mode[0] === '--write') await measure();
  else if (mode[0] === '--check') {
    const failures = validateRuntimeReport(JSON.parse(readFileSync(reportPath, 'utf8')));
    assert.equal(failures.length, 0, `Material local latency regressions: ${failures.join(', ')}`);
    console.log('Current runtime evidence: immutable attempt, exact sources, all arms and warmups, contracts, arithmetic, and declared local latency budget verified');
  } else throw new Error('Use --write or --check');
}
