#!/usr/bin/env node
// Local process measurements using synthetic output shaped by public transcript
// metadata. Never reads private transcripts or executes their command strings.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = join(root, 'bench/report/runtime-report.json');
const cli = join(root, 'bin/system-one-skills.js');
const pairs = 20;
const warmupPairs = 2;
const sourcePaths = [
  'bench/measure-runtime.mjs', 'bin/system-one-skills.js', 'src/check.js',
  'src/process.js', 'src/reduce.js', 'skills/system-one-verify/SKILL.md',
  'tests/check-runtime.test.ts', 'research/admission-report.json',
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = () => Object.fromEntries(sourcePaths.map(path => [path, hash(readFileSync(join(root, path)))]));
const round = value => Number(value.toFixed(6));
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return {
    n: sorted.length,
    min_ms: sorted[0],
    median_ms: round(sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2),
    p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max_ms: sorted.at(-1),
  };
};
const admission = JSON.parse(readFileSync(join(root, 'research/admission-report.json'), 'utf8'));
const selected = admission.samples.filter(row => row.routed_by_prior_output_size || !row.recorded_exit_zero)
  .sort((a, b) => a.archived_output_bytes - b.archived_output_bytes);
assert.equal(selected.length, 7, 'Review this benchmark selection if transcript cases change');
assert.deepEqual(selected.filter(row => row.recorded_exit_zero).map(row => row.archived_output_bytes), [8207, 9876, 22040]);
assert.equal(selected.filter(row => !row.recorded_exit_zero).length, 4);
const fixtures = selected.map(row => ({
  id: `${row.recorded_exit_zero ? 'success' : 'failure'}-${row.archived_output_bytes}`,
  source_sample_id: row.sample_id,
  source_provider: row.provider,
  bytes: row.archived_output_bytes,
  code: row.recorded_exit_zero ? 0 : 7,
}));

function validate(report) {
  assert.equal(report.schema_version, 1);
  assert.equal(report.evidence_type, 'synthetic local CLI measurement; transcript-shaped sizes and success/failure only');
  assert.deepEqual(report.source_sha256, hashes(), 'Measured source or evidence changed; rerun --write');
  assert.equal(report.method.measured_pairs_per_fixture, pairs);
  assert.equal(report.method.warmup_pairs_per_fixture, warmupPairs);
  assert.equal(report.cases.length, fixtures.length);
  const allDeltas = [];
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i], row = report.cases[i];
    assert.deepEqual(row.fixture, f);
    assert.equal(row.measurements.length, pairs);
    assert.equal(row.native_output_bytes, f.bytes);
    assert.equal(row.wrapper_stderr_bytes, 0);
    assert.equal(row.observed_exit_code, f.code);
    assert.equal(row.full_log_exact, true);
    assert.equal(row.one_execution_per_arm, true);
    assert.equal(row.private_log_mode, '0600');
    assert.equal(row.wrapper_output_bytes, row.wrapper_stdout_bytes + row.wrapper_stderr_bytes);
    if (f.bytes < 8192) {
      assert.equal(row.wrapper_output_bytes, f.bytes);
      assert.equal(row.short_output_exact, true);
    } else {
      assert.ok(row.wrapper_output_bytes <= f.bytes / 2);
      assert.ok(f.bytes - row.wrapper_output_bytes >= 4096);
      assert.equal(row.short_output_exact, null);
    }
    row.measurements.forEach((m, index) => {
      assert.equal(m.pair, index + 1);
      assert.equal(m.first, (index + i) % 2 === 0 ? 'native' : 'wrapper');
      assert.ok(Number.isFinite(m.native_ms) && m.native_ms > 0);
      assert.ok(Number.isFinite(m.wrapper_ms) && m.wrapper_ms > 0);
      assert.equal(m.delta_ms, round(m.wrapper_ms - m.native_ms));
    });
    assert.deepEqual(row.native_wall_time, summarize(row.measurements.map(m => m.native_ms)));
    assert.deepEqual(row.wrapper_wall_time, summarize(row.measurements.map(m => m.wrapper_ms)));
    assert.deepEqual(row.paired_overhead, summarize(row.measurements.map(m => m.delta_ms)));
    allDeltas.push(...row.measurements.map(m => m.delta_ms));
  }
  assert.deepEqual(report.paired_overhead_all_fixtures, summarize(allDeltas));
  assert.deepEqual(report.measured_output_bytes, { native: report.cases.reduce((n, row) => n + row.native_output_bytes * pairs, 0), wrapper: report.cases.reduce((n, row) => n + row.wrapper_output_bytes * pairs, 0) });
  assert.equal(report.reliability.paired_command_runs, (pairs + warmupPairs) * fixtures.length * 2);
  assert.equal(report.reliability.measured_pairs, pairs * fixtures.length);
  assert.equal(report.reliability.exact_exit_full_log_and_one_execution_verified_in_every_pair, true);
  assert.equal(report.reliability.existing_runtime_suite.command, 'bun test tests/check-runtime.test.ts');
  assert.equal(report.reliability.existing_runtime_suite.exit_code, 0);
  assert.ok(report.reliability.existing_runtime_suite.passed_tests >= 25);
  assert.equal(report.reliability.existing_runtime_suite.failed_tests, 0);
  assert.equal(report.reliability.existing_runtime_suite.test_names.length, report.reliability.existing_runtime_suite.passed_tests);
  assert.equal(report.reliability.binary_cli.exact_stdout, true);
  assert.equal(report.reliability.binary_cli.exact_log, true);
  assert.equal(report.reliability.binary_cli.exit_code, 7);
}

async function measure() {
  const before = hashes();
  const scratch = mkdtempSync(join(tmpdir(), 'system-one-measure-'));
  chmodSync(scratch, 0o700);
  const fixtureFile = join(scratch, 'fixture.bin');
  const counterFile = join(scratch, 'counter');
  const logFile = join(scratch, 'check.log');
  const runner = join(scratch, 'fixture.cjs');
  writeFileSync(runner, 'const fs=require("node:fs");const [input,counter,code]=process.argv.slice(2);fs.appendFileSync(counter,"1");process.stdout.write(fs.readFileSync(input));process.exitCode=Number(code);\n');
  const records = fixtures.map(fixture => ({ fixture, measurements: [] }));
  function payload(f) {
    const ending = f.code ? '\nFAIL synthetic validation: expected 17, received 12\n' : '\nSynthetic validation passed\n';
    const line = 'PASS synthetic case: expected result verified\n';
    const fill = f.bytes - Buffer.byteLength(ending);
    return Buffer.from(line.repeat(Math.ceil(fill / line.length)).slice(0, fill) + ending);
  }
  function arm(f, mode, bytes) {
    writeFileSync(counterFile, '');
    rmSync(logFile, { force: true });
    const childArgv = [runner, fixtureFile, counterFile, String(f.code)];
    const argv = mode === 'native' ? childArgv : [cli, 'check', '--log', logFile, '--', process.execPath, ...childArgv];
    const start = performance.now();
    const result = spawnSync(process.execPath, argv, { cwd: scratch, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
    const elapsed = round(performance.now() - start);
    assert.equal(result.error, undefined, `${f.id}: ${mode} failed to complete`);
    assert.equal(result.signal, null);
    assert.equal(result.status, f.code);
    assert.equal(result.stderr.length, 0);
    assert.equal(readFileSync(counterFile, 'utf8'), '1');
    if (mode === 'native') assert.ok(result.stdout.equals(bytes));
    else {
      assert.ok(readFileSync(logFile).equals(bytes));
      assert.equal(statSync(logFile).mode & 0o777, 0o600);
      if (f.bytes < 8192) assert.ok(result.stdout.equals(bytes));
      else {
        assert.ok(result.stdout.length <= f.bytes / 2);
        assert.ok(f.bytes - result.stdout.length >= 4096);
        assert.ok(result.stdout.toString().startsWith(`exit=${f.code} bytes=${f.bytes} omitted=`));
        assert.ok(result.stdout.includes(Buffer.from('Synthetic validation passed')));
      }
    }
    return { elapsed, stdoutBytes: result.stdout.length, stderrBytes: result.stderr.length };
  }
  try {
    // Rotate case order each round, and alternate the first arm for every case.
    // Warmups use the same commands but are excluded from all reported timings.
    for (let roundIndex = -warmupPairs; roundIndex < pairs; roundIndex++) {
      for (let slot = 0; slot < fixtures.length; slot++) {
        const i = (slot + roundIndex + warmupPairs) % fixtures.length;
        const f = fixtures[i], bytes = payload(f);
        assert.equal(bytes.length, f.bytes);
        writeFileSync(fixtureFile, bytes);
        const first = (roundIndex + i + 2 * pairs) % 2 === 0 ? 'native' : 'wrapper';
        const order = first === 'native' ? ['native', 'wrapper'] : ['wrapper', 'native'];
        const observed = {};
        for (const mode of order) observed[mode] = arm(f, mode, bytes);
        if (roundIndex >= 0) {
          const row = records[i];
          row.measurements.push({ pair: roundIndex + 1, first, native_ms: observed.native.elapsed, wrapper_ms: observed.wrapper.elapsed, delta_ms: round(observed.wrapper.elapsed - observed.native.elapsed) });
          if (row.wrapper_output_bytes !== undefined) assert.equal(row.wrapper_output_bytes, observed.wrapper.stdoutBytes + observed.wrapper.stderrBytes);
          Object.assign(row, { native_output_bytes: observed.native.stdoutBytes + observed.native.stderrBytes, wrapper_stdout_bytes: observed.wrapper.stdoutBytes, wrapper_stderr_bytes: observed.wrapper.stderrBytes, wrapper_output_bytes: observed.wrapper.stdoutBytes + observed.wrapper.stderrBytes, observed_exit_code: f.code, full_log_exact: true, one_execution_per_arm: true, private_log_mode: '0600', short_output_exact: f.bytes < 8192 ? true : null });
        }
      }
    }
    const binary = Buffer.from([255, 0, 254, 10, 65, 0, 66]);
    writeFileSync(fixtureFile, binary);
    arm({ id: 'binary-short', code: 7, bytes: binary.length }, 'wrapper', binary);
    const suite = spawnSync('bun', ['test', 'tests/check-runtime.test.ts'], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, timeout: 60000, maxBuffer: 1024 * 1024 });
    assert.equal(suite.error, undefined, 'Runtime suite did not finish');
    const suiteOutput = (suite.stdout + suite.stderr).replace(/\x1b\[[0-9;:]*m/g, '');
    if (suite.status !== 0) process.stderr.write(suiteOutput);
    assert.equal(suite.status, 0, 'Runtime reliability suite failed');
    const names = [...suiteOutput.matchAll(/^\(pass\) (.+?)(?: \[[\d.]+m?s\])?$/gm)].map(match => match[1]);
    const passed = Number(suiteOutput.match(/\b(\d+) pass\b/)?.[1]);
    const failed = Number(suiteOutput.match(/\b(\d+) fail\b/)?.[1]);
    assert.ok(passed >= 25);
    assert.equal(names.length, passed);
    assert.equal(failed, 0);
    for (const row of records) {
      row.native_wall_time = summarize(row.measurements.map(m => m.native_ms));
      row.wrapper_wall_time = summarize(row.measurements.map(m => m.wrapper_ms));
      row.paired_overhead = summarize(row.measurements.map(m => m.delta_ms));
    }
    const report = {
      schema_version: 1,
      measured_at_utc: new Date().toISOString(),
      evidence_type: 'synthetic local CLI measurement; transcript-shaped sizes and success/failure only',
      environment: { platform: process.platform, architecture: process.arch, kernel_release: release(), node: process.version, bun: suiteOutput.match(/bun test v([^\s]+)/)?.[1] ?? 'unknown', package_version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, scheduler: 'hra-host-run --mode=shared --lane=compute', machine_isolation: 'shared scheduler admission; other processes and background activity were not isolated' },
      source_sha256: before,
      method: { measured_pairs_per_fixture: pairs, warmup_pairs_per_fixture: warmupPairs, fixture_selection: 'All routed success rows and all recorded failure rows from research/admission-report.json. Public sizes and exit-zero booleans only; content is newly generated ASCII. Failure code 7 is chosen for the fixture, not a recovered historical code.', ordering: 'Interleaved pairs; each fixture alternates native-first and wrapper-first, 10 each. Case order rotates every round. Two full warmup pairs per fixture excluded.', timing_boundary: 'performance.now immediately before and after spawnSync. Native: node fixture.cjs input counter code. Wrapper: node bin/system-one-skills.js check --log LOG -- node fixture.cjs input counter code. The child argv is identical in each pair. Includes wrapper Node startup, command execution, private log writes, reduction, and parent stdout collection. Payload creation, assertions, counter reset, and log cleanup are outside the measured interval.', stdout_boundary: 'Parent pipes capture all stdout/stderr bytes. Fixtures write stdout only. Log path has constant byte length within this run; nonce/path length can change compact byte counts between machines. No terminal rendering, provider envelopes, API, agent/model call, or downstream log-read timing.', p95: 'Nearest-rank: sorted[ceil(n*0.95)-1]. Median averages the middle two for even n. Paired delta is wrapper minus native for the same fixture and round. No trimming or outlier removal.', safe_command_policy: 'Only generated local fixture commands and the checked-in runtime tests execute. No transcript commands, network, repository tests/builds under study, or model calls.' },
      cases: records,
      paired_overhead_all_fixtures: summarize(records.flatMap(row => row.measurements.map(m => m.delta_ms))),
      measured_output_bytes: { native: records.reduce((n, row) => n + row.native_output_bytes * pairs, 0), wrapper: records.reduce((n, row) => n + row.wrapper_output_bytes * pairs, 0) },
      reliability: { paired_command_runs: (pairs + warmupPairs) * fixtures.length * 2, measured_pairs: pairs * fixtures.length, exact_exit_full_log_and_one_execution_verified_in_every_pair: true, binary_cli: { fixture_bytes: binary.length, exact_stdout: true, exact_log: true, exit_code: 7 }, existing_runtime_suite: { command: 'bun test tests/check-runtime.test.ts', exit_code: suite.status, passed_tests: passed, failed_tests: failed, assertions: Number(suiteOutput.match(/\b(\d+) expect\(\) calls/)?.[1]), test_names: names } },
      limitations: ['Synthetic process benchmark, not timing the archived projects or replaying their workloads.', 'One OS/architecture and one Node version on a shared host. Small sample p95 estimates and scheduling noise do not establish a latency service-level objective.', 'Wrapper overhead can make short/fast checks slower; output reduction is not a measured wall-clock speedup.', 'Fault tests establish only their explicit deterministic contracts. They do not measure agent task success, diagnostic completeness, fewer retries, or a reliability improvement over native execution.', 'A compact excerpt can omit the needed diagnosis. Full log retrieval is required when evidence is insufficient, and its tokens and latency are excluded here.', 'Transcript token savings are a separate calibrated observation in research/admission-report.json; these synthetic output byte counts are not token-savings evidence.'],
    };
    assert.deepEqual(hashes(), before, 'Sources changed while measuring; discard this run');
    validate(report);
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ report: 'bench/report/runtime-report.json', pairs: pairs * fixtures.length, overhead_ms: report.paired_overhead_all_fixtures, runtime_tests: passed }));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

const mode = process.argv.slice(2);
assert.equal(mode.length, 1, 'Use --write to measure or --check to validate recorded evidence');
if (mode[0] === '--write') await measure();
else if (mode[0] === '--check') { validate(JSON.parse(readFileSync(reportPath, 'utf8'))); console.log('Runtime evidence: source hashes, transcript shapes, paired summaries and contract results verified'); }
else throw new Error('Use --write or --check');
