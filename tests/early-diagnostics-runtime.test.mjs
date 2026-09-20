import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildRuntimeReport, createRuntimeAttemptJournal, runtimeEvidenceSpec, saveRuntimeAttempt, summarize, validateRuntimeReport } from '../bench/measure-early-diagnostics.mjs';

// Fabricated observations exercise the validator only. They never become a
// qualification artifact or execute a benchmark child.
const digest = value => createHash('sha256').update(JSON.stringify(value, null, 2) + '\n').digest('hex');
function example() {
  const spec = runtimeEvidenceSpec();
  const attempt = {
    schema_version: 1, evidence_type: 'append-only CLI qualification attempt',
    started_at_utc: '2000-01-01T00:00:00.000Z', finished_at_utc: '2000-01-01T00:01:00.000Z',
    environment: { purpose: 'fabricated validator test, never measured evidence' },
    source_sha256_before: spec.source_sha256, source_sha256_after: spec.source_sha256,
    protocol_sha256: spec.protocol_sha256, baseline_commit: spec.baseline_commit,
    observations: spec.schedule.map(entry => {
      const fixture = spec.fixtures.find(f => f.id === entry.fixture_id);
      return { ...entry, ms: entry.iteration < 0 ? 10_000 : { native: 10, baseline: 20, candidate: 25 }[entry.arm], output_bytes: entry.arm === 'native' || fixture.bytes < 8192 ? fixture.bytes : 512, status: 'passed' };
    }),
    status: 'complete', failure: null, report: null,
  };
  attempt.report = buildRuntimeReport(attempt);
  return { attempt, expected: spec.source_sha256 };
}
function seal(attempt) { return { ...structuredClone(attempt.report), attempt_sha256: digest(attempt) }; }
function verify(attempt, expected, report = seal(attempt)) {
  return validateRuntimeReport(report, expected, () => attempt);
}
function rebuild(attempt) { attempt.report = buildRuntimeReport(attempt); }

test('complete schedule retains warmups but excludes only their predeclared timings from summaries', () => {
  const { attempt, expected } = example();
  assert.deepEqual(verify(attempt, expected), []);
  assert(attempt.observations.some(o => o.iteration < 0 && o.ms === 10_000));
  assert.equal(attempt.report.cases[0].candidate.median_ms, 25);
  assert.equal(attempt.report.total_command_runs, 594);
  assert.equal(attempt.report.measured_triplets, 180);
  assert(Object.hasOwn(expected, 'scripts/check.ts'));
  assert(Object.hasOwn(expected, 'tests/early-diagnostics-runtime.test.mjs'));
});

test('stale current source, post-measurement source drift, and a relabeled historical baseline are rejected', () => {
  for (const mutation of [
    a => { a.source_sha256_before = { ...a.source_sha256_before, 'src/process.js': '0'.repeat(64) }; },
    a => { a.source_sha256_after = { ...a.source_sha256_after, 'scripts/check.ts': '0'.repeat(64) }; },
    a => { a.baseline_commit = '0'.repeat(40); },
  ]) {
    const { attempt, expected } = example(); mutation(attempt); rebuild(attempt);
    assert.throws(() => verify(attempt, expected));
  }
});

test('missing warmup, duplicate arm, changed fixture order, and a skipped measured iteration cannot qualify', () => {
  for (const mutation of [
    a => { a.observations.splice(0, 1); },
    a => { a.observations[0] = structuredClone(a.observations[1]); },
    a => { [a.observations[0], a.observations[3]] = [a.observations[3], a.observations[0]]; },
    a => { a.observations.find(o => o.iteration === 0).iteration = 1; },
  ]) {
    const { attempt, expected } = example(); mutation(attempt);
    assert.throws(() => verify(attempt, expected));
  }
});

test('impossible wrapped byte counts fail even with consistent immutable snapshots and arithmetic', () => {
  for (const [fixture, arm, bytes] of [
    ['early-failure', 'candidate', 0],
    ['early-failure', 'baseline', 1024 * 1024],
    ['early-failure', 'candidate', 512 * 1024],
    ['short-failure', 'candidate', 1],
    ['short-failure', 'baseline', 1],
    ['short-success', 'native', 1],
  ]) {
    const { attempt, expected } = example();
    attempt.observations.find(o => o.iteration === 0 && o.fixture_id === fixture && o.arm === arm).output_bytes = bytes;
    rebuild(attempt);
    assert.throws(() => verify(attempt, expected), /byte|reduced|minimum/);
  }
});

test('changed exit, missing diagnostic and log contracts, and modified timing arithmetic are rejected', () => {
  for (const mutation of [
    r => { r.cases[1].fixture.code = 0; },
    r => { r.cases[0].contracts.candidate_log_exact = false; },
    r => { r.cases.find(c => c.fixture.id === 'early-failure').contracts.candidate_marker_retained = false; },
    r => { r.cases[0].measurements[0].extra_ms += 1; },
    r => { r.cases[0].median_extra_limit_ms += 1000; },
    r => { r.cases[0].meets_latency_budget = false; },
    r => { r.cases.pop(); },
  ]) {
    const { attempt, expected } = example(); mutation(attempt.report);
    assert.throws(() => verify(attempt, expected), /contracts or arithmetic/);
  }
});

test('all outliers remain visible and genuine latency failures cannot be relabeled as admission', () => {
  const { attempt, expected } = example();
  for (const o of attempt.observations) if (o.fixture_id === 'early-failure' && o.arm === 'candidate' && o.iteration >= 0) o.ms = 100;
  attempt.observations.find(o => o.fixture_id === 'passing-lines' && o.arm === 'candidate' && o.iteration === 0).ms = 100_000;
  rebuild(attempt);
  assert.deepEqual(verify(attempt, expected), ['early-failure']);
  const passing = attempt.report.cases.find(c => c.fixture.id === 'passing-lines');
  assert.equal(passing.candidate.max_ms, 100_000);
  assert.equal(passing.measurements.length, 20);
  attempt.report.latency_budget_failures = [];
  attempt.report.outcome = 'artifact-contracts-and-local-latency-budget-pass';
  assert.throws(() => verify(attempt, expected), /contracts or arithmetic/);
  assert.deepEqual(summarize([-30, 1, 5, 40]), { n: 4, min_ms: -30, median_ms: 3, p95_ms: 40, max_ms: 40 });
});

test('partial failed attempts and unverified arms cannot qualify', () => {
  const { attempt, expected } = example();
  attempt.status = 'failed';
  attempt.failure = { category: 'full-log-bytes', phase: 'arm', fixture: 'early-failure', arm: 'candidate' };
  attempt.observations.splice(7);
  assert.throws(() => verify(attempt, expected), /failed attempt/);
  const other = example();
  other.attempt.observations[0].status = 'failed';
  assert.throws(() => verify(other.attempt, other.expected), /Unverified arm/);
});

test('attempts preserve partial failures and prior complete snapshots without overwriting', () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-evidence-test-'));
  try {
    const { attempt } = example();
    const first = saveRuntimeAttempt(attempt, directory);
    const firstBytes = readFileSync(join(directory, `${first}.json`));
    assert.equal(saveRuntimeAttempt(attempt, directory), first);
    const failed = structuredClone(attempt);
    failed.status = 'failed'; failed.report = null;
    failed.failure = { category: 'process', phase: 'arm', fixture: 'short-success', arm: 'native' };
    failed.observations.splice(1); failed.observations[0].status = 'failed';
    const second = saveRuntimeAttempt(failed, directory);
    assert.notEqual(first, second);
    assert.equal(readdirSync(directory).length, 2);
    assert(readFileSync(join(directory, `${first}.json`)).equals(firstBytes));
    assert.equal(JSON.parse(readFileSync(join(directory, `${second}.json`), 'utf8')).observations.length, 1);
    writeFileSync(join(directory, `${first}.json`), '{}\n');
    assert.throws(() => saveRuntimeAttempt(attempt, directory), /Existing attempt changed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('attempt hash and exact current report snapshot must agree', () => {
  const { attempt, expected } = example();
  const report = seal(attempt);
  attempt.observations[0].ms += 1;
  assert.throws(() => verify(attempt, expected, report), /Attempt content changed/);
  const other = example();
  const changedReport = seal(other.attempt); changedReport.measured_at_utc = '2001-01-01T00:00:00.000Z';
  assert.throws(() => verify(other.attempt, other.expected, changedReport), /immutable attempt/);
});


test('an unfinished attempt leaves each completed observation in a bounded journal and cannot reuse an old pass', () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-journal-test-'));
  try {
    const journal = createRuntimeAttemptJournal(directory);
    journal.append({ event: 'started' });
    const observation = { iteration: -2, fixture_id: 'short-success', arm: 'native', ms: 12, output_bytes: 17, status: 'failed' };
    journal.append({ event: 'observed-arm', observation });
    const identity = journal.identity();
    const lines = readFileSync(join(directory, identity.file), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[1].observation, observation);
    assert.equal(createHash('sha256').update(readFileSync(join(directory, identity.file))).digest('hex'), identity.sha256);
    assert.throws(() => journal.append({ value: 'x'.repeat(1024 * 1024) }), /exceeds bound/);
    for (const outcome of ['incomplete-attempt', 'failed-attempt-retained']) {
      assert.throws(() => validateRuntimeReport({ outcome }), /incomplete or failed/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
