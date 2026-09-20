#!/usr/bin/env node
/** Paired byte replay of an explicitly declared private development corpus. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROTOCOL = 'research/early-diagnostics-protocol.json';
const REPORT = 'research/early-diagnostics-report.json';
const CAPTURE = 256 * 1024;
const LIMIT = 64 * 1024 * 1024;
const SOURCES = ['package.json', 'bun.lock', 'scripts/check.ts', 'research/replay_validation.mjs', 'research/early-diagnostics-replay.mjs',
  'tests/early-diagnostics-replay.test.mjs', 'research/validate-history.mjs',
  'research/history/v0.4.0/manifest.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const hashFile = path => sha(readFileSync(path));
export function sourceHashes(root) {
  const files = [...SOURCES];
  const walk = path => {
    assert.ok(lstatSync(join(root, path)).isDirectory() && !lstatSync(join(root, path)).isSymbolicLink(), 'Source directory must be real');
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      assert.ok(files.length < 1000, 'Source inventory exceeded its bound');
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else { assert.ok(entry.isFile() && !entry.isSymbolicLink(), 'Unsupported source entry'); files.push(child); }
    }
  };
  for (const path of ['bin', 'src', 'skills']) walk(path);
  return Object.fromEntries(files.sort().map(path => {
    const metadata = lstatSync(join(root, path));
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 4 * 1024 * 1024, 'Source must be a bounded regular file');
    return [path, hashFile(join(root, path))];
  }));
}
const exactKeys = (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
const digest = value => assert.match(value, /^[a-f0-9]{64}$/);
const count = value => assert.ok(Number.isSafeInteger(value) && value >= 0);

export function markerLines(bytes) {
  // A deliberately separate, public reporter-marker rule, not a diagnosis oracle.
  return (bytes.toString('utf8').match(/[^\n]*\n|[^\n]+$/g) ?? []).filter(line =>
    /^\s*(?:\(fail\)|FAIL(?:ED)?(?:\s|$)|error:|AssertionError:)/i.test(line.replace(/\x1b\[[0-9;:]*m/g, '')));
}

export function replayBuffer(bytes, code, logPath, implementation, chunkBytes = 4093) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= LIMIT);
  assert.ok(Number.isSafeInteger(code) && code >= 0 && code <= 255);
  assert.ok(Number.isSafeInteger(chunkBytes) && chunkBytes > 0);
  const raw = bytes.subarray(Math.max(0, bytes.length - CAPTURE));
  const captureTruncated = bytes.length > CAPTURE;
  let start = 0;
  if (captureTruncated) while (start < raw.length && (raw[start] & 0xc0) === 0x80) start++;
  const collector = implementation.createDiagnosticCapture?.();
  if (collector) for (let offset = 0; offset < bytes.length; offset += chunkBytes) collector.push(bytes.subarray(offset, offset + chunkBytes));
  const result = implementation.reduceOutput({ raw, text: raw.subarray(start).toString('utf8'),
    code, logPath, outputBytes: bytes.length, captureTruncated, diagnostics: collector?.finish() });
  const validUtf8 = Buffer.from(bytes.toString('utf8')).equals(bytes);
  return { result, invariants: {
    source_byte_count_correct: result.sourceBytes === bytes.length,
    presented_byte_count_correct: result.outputBytes === Buffer.byteLength(result.text),
    exact_valid_short_passthrough: !validUtf8 || bytes.length >= 8192 || result.text === bytes.toString('utf8'),
    compacted_status_disclosed: !result.compacted || result.text.startsWith(`exit=${code} bytes=${bytes.length} omitted=`),
    compacted_omission_disclosed: !result.compacted || /\bomitted=\d+/.test(result.text.split('\n')[0]),
    compacted_log_path_disclosed: !result.compacted || result.text.endsWith(`log=${JSON.stringify(logPath)}\n`),
    capture_bound_disclosed: !captureTruncated || result.text.includes(' capture_truncated=true'),
    compaction_byte_guard: !result.compacted || (bytes.length >= 8192 && bytes.length - result.outputBytes >= 4096 && result.outputBytes <= bytes.length / 2),
  } };
}

export function syntheticCases() {
  const noisy = (first, last, size = 400_000) => {
    const prefix = Buffer.from(first), suffix = Buffer.from(last);
    const line = Buffer.from('passing controlled fixture detail\n');
    const remaining = size - prefix.length - suffix.length;
    assert.ok(remaining >= 0);
    const fill = Buffer.alloc(remaining);
    for (let at = 0; at < remaining; at += line.length) line.copy(fill, at);
    return Buffer.concat([prefix, fill, suffix]);
  };
  const early = 'ERROR controlled first failure\nExpected: 17\nReceived: 12\n';
  const tail = '\nFINAL_CONTROLLED_SENTINEL\n';
  const overlapSize = CAPTURE + 8;
  return [
    { id: 'short-failure', bytes: Buffer.from('ERROR short controlled failure\n'), code: 7, parity: true },
    { id: 'threshold-success', bytes: noisy('', tail, 8192), code: 0, parity: true },
    { id: 'full-capture-failure', bytes: noisy(early, tail, 22040), code: 7, parity: true },
    { id: 'early-failure', bytes: noisy(early, tail), code: 7, preserve: early },
    { id: 'early-utf8', bytes: noisy('\x1b[31mERROR\x1b[0m controlled é😀\nExpected: café\nReceived: 茶\n', tail), code: 7, preserve: 'controlled é😀\nExpected: café\nReceived: 茶\n' },
    { id: 'diagnostic-budget', bytes: noisy(Array.from({ length: 20 }, (_, i) => `ERROR controlled ${i}\n`).join(''), tail), code: 7, preserve: 'ERROR controlled 0\n' },
    { id: 'giant-error-line', bytes: Buffer.from('ERROR controlled giant ' + 'x'.repeat(400_000) + tail), code: 7, preserve: 'ERROR controlled giant ' },
    { id: 'cutoff-overlap', bytes: noisy(early, tail, overlapSize), code: 7, preserve: early },
    { id: 'success-with-error-text', bytes: noisy(early, tail), code: 0, parity: true },
    { id: 'invalid-utf8-tail', bytes: Buffer.concat([Buffer.from(early), Buffer.alloc(300_000, 255), Buffer.from(tail)]), code: 7, preserve: 'ERROR controlled first failure\n', lossy: true },
  ];
}

function inspectPrivateManifest(input, protocol, root) {
  const path = realpathSync(input), base = dirname(path), repository = realpathSync(root);
  assert.ok(path !== repository && !path.startsWith(repository + sep), 'Private inputs must stay outside the repository');
  assert.equal(lstatSync(base).mode & 0o777, 0o700, 'Private input directory must be mode 0700');
  assert.equal(lstatSync(path).mode & 0o777, 0o600, 'Private manifest must be mode 0600');
  const manifest = readJson(path);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.selection_protocol_sha256, protocol.selection_protocol_sha256, 'Private selection must match the initial pre-replay declaration');
  assert.equal(manifest.samples.length, protocol.samples.length);
  assert.deepEqual(manifest.samples.map(({ sample_id, sha256, bytes, exit_code }) => ({ sample_id, sha256, bytes, exit_code })), protocol.samples);
  const seen = new Set();
  const rows = manifest.samples.map(row => {
    assert.ok(!seen.has(row.sample_id)); seen.add(row.sample_id);
    assert.equal(row.file, `${row.sample_id}.log`);
    const file = join(base, row.file), stat = lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= LIMIT);
    assert.equal(stat.mode & 0o777, 0o600);
    const bytes = readFileSync(file);
    assert.equal(bytes.length, row.bytes);
    assert.equal(sha(bytes), row.sha256);
    assert.equal(sha(`${row.sha256}:${row.exit_code}`), row.sample_id);
    assert.ok(Buffer.from(bytes.toString('utf8')).equals(bytes), 'Real corpus is explicitly UTF-8 text; binary inputs need a separately declared cohort');
    return { ...row, bytes, file };
  });
  return { path, base, rows };
}

function tokenize(strings, python, cache) {
  assert.ok(isAbsolute(python), 'Use an explicit pinned-tokenizer Python executable');
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  const code = 'import json,sys,tiktoken\nassert tiktoken.__version__ == "0.12.0"\ne=tiktoken.get_encoding("o200k_base")\nprint(json.dumps([len(e.encode_ordinary(s)) for s in json.load(sys.stdin)]))\n';
  const result = spawnSync(python, ['-c', code], { input: JSON.stringify(strings), encoding: 'utf8',
    maxBuffer: 1024 * 1024, timeout: 120_000, env: { ...process.env, TIKTOKEN_CACHE_DIR: cache } });
  assert.equal(result.status, 0, 'Pinned tokenizer failed; inspect dependencies without printing private input');
  const counts = JSON.parse(result.stdout);
  assert.equal(counts.length, strings.length); counts.forEach(count);
  return counts;
}

function summarize(rows) {
  const result = { cases: rows.length, routed_cases: rows.filter(row => row.routed).length,
    capture_truncated_cases: rows.filter(row => row.capture_truncated).length,
    recorded_nonzero_exits: rows.filter(row => row.exit_code !== 0).length,
    marker_gains: rows.reduce((n, row) => n + row.marker_gains, 0),
    marker_losses: rows.reduce((n, row) => n + row.marker_losses, 0), baseline: {}, candidate: {} };
  for (const arm of ['baseline', 'candidate']) result[arm] = {
    presented_tokens: rows.reduce((n, row) => n + row[arm].presented_tokens, 0),
    routed_net_tokens: rows.filter(row => row.routed).reduce((n, row) => n + row[arm].net_tokens, 0),
    routed_below_margin: rows.filter(row => row.routed && !row[arm].meets_margin).length,
    retained_markers: rows.reduce((n, row) => n + row[arm].retained_markers, 0),
    cases_requiring_full_read_for_any_marker: rows.filter(row => row[arm].requires_full_read_for_any_marker).length,
    net_tokens_after_full_read_sensitivity: rows.reduce((n, row) => n + row[arm].net_tokens_after_full_read_sensitivity, 0),
    invariant_failures: rows.reduce((n, row) => n + Object.values(row[arm].invariants).filter(flag => !flag).length, 0),
  };
  return result;
}

export function validateProtocol(protocol) {
  assert.equal(protocol.schema_version, 1);
  assert.equal(protocol.experiment, 'early-diagnostics-task-log-replay-v1');
  assert.equal(protocol.baseline.git_commit, '49c9ba49212f465c6a7d6054208bed7f39e9b813');
  assert.deepEqual(protocol.tokenizer, { library: 'tiktoken', version: '0.12.0', encoding: 'o200k_base' });
  assert.equal(protocol.routing.minimum_expected_output_bytes, 8192);
  assert.equal(protocol.routing.minimum_net_token_margin, 128);
  assert.equal(protocol.capture.tail_bytes, CAPTURE);
  assert.equal(protocol.capture.maximum_log_bytes, LIMIT);
  assert.equal(protocol.capture.chunk_bytes, 4093);
  assert.equal(protocol.selection.selected_count, 9);
  assert.equal(protocol.selection.duplicate_count, 0);
  assert.equal(protocol.samples.length, protocol.selection.selected_count);
  assert.deepEqual(protocol.samples.map(row => row.sample_id), [...new Set(protocol.samples.map(row => row.sample_id))].sort());
  for (const row of protocol.samples) {
    exactKeys(row, ['sample_id', 'sha256', 'bytes', 'exit_code']);
    digest(row.sample_id); digest(row.sha256); count(row.bytes);
    assert.ok(row.bytes <= LIMIT && Number.isInteger(row.exit_code) && row.exit_code >= 0 && row.exit_code <= 255);
    assert.equal(sha(`${row.sha256}:${row.exit_code}`), row.sample_id);
  }
  assert.deepEqual(protocol.synthetic_cases, syntheticCases().map(row => row.id));
}

export function validateReport(report, protocol, root = ROOT) {
  validateProtocol(protocol);
  exactKeys(report, ['schema_version', 'experiment', 'recorded_at_utc', 'evidence_role', 'protocol_sha256', 'private_manifest_sha256', 'private_replay_sha256', 'source_sha256', 'tokenizer', 'overhead', 'cases', 'synthetic', 'summary', 'verdict']);
  assert.equal(report.schema_version, 1);
  assert.equal(report.experiment, protocol.experiment);
  assert.equal(report.evidence_role, 'development paired byte replay; not held-out or whole-task evidence');
  assert.equal(report.protocol_sha256, hashFile(join(root, PROTOCOL)));
  digest(report.private_manifest_sha256); digest(report.private_replay_sha256);
  assert.deepEqual(report.source_sha256, sourceHashes(root), 'Candidate evidence is stale');
  assert.deepEqual(report.source_sha256, protocol.candidate_source_sha256);
  assert.deepEqual(report.tokenizer, protocol.tokenizer);
  exactKeys(report.overhead, ['full_skill_tokens', 'catalog_tokens', 'baseline_invocation_tokens', 'skill_invocation_tokens', 'first_use_incremental_tokens']);
  Object.values(report.overhead).forEach(count);
  const overhead = report.overhead;
  assert.equal(overhead.first_use_incremental_tokens, overhead.full_skill_tokens + overhead.catalog_tokens + overhead.skill_invocation_tokens - overhead.baseline_invocation_tokens);
  assert.equal(report.cases.length, protocol.samples.length);
  for (let i = 0; i < report.cases.length; i++) {
    const row = report.cases[i], selected = protocol.samples[i];
    exactKeys(row, ['sample_id', 'source_sha256', 'source_bytes', 'source_tokens', 'exit_code', 'routed', 'capture_truncated', 'marker_count', 'marker_gains', 'marker_losses', 'presented_equal', 'baseline', 'candidate']);
    assert.equal(row.sample_id, selected.sample_id); assert.equal(row.source_sha256, selected.sha256);
    assert.equal(row.source_bytes, selected.bytes); assert.equal(row.exit_code, selected.exit_code);
    assert.equal(row.routed, row.source_bytes >= 8192); assert.equal(row.capture_truncated, row.source_bytes > CAPTURE);
    for (const key of ['source_tokens', 'marker_count', 'marker_gains', 'marker_losses']) count(row[key]);
    assert.equal(typeof row.presented_equal, 'boolean');
    for (const arm of ['baseline', 'candidate']) {
      const measured = row[arm];
      exactKeys(measured, ['presented_sha256', 'presented_bytes', 'presented_tokens', 'net_tokens', 'meets_margin', 'retained_markers', 'first_marker_retained', 'requires_full_read_for_any_marker', 'net_tokens_after_full_read_sensitivity', 'invariants']);
      digest(measured.presented_sha256); count(measured.presented_bytes); count(measured.presented_tokens); count(measured.retained_markers);
      assert.ok(measured.retained_markers <= row.marker_count);
      assert.equal(measured.net_tokens, row.source_tokens - measured.presented_tokens - overhead.first_use_incremental_tokens);
      assert.equal(measured.meets_margin, measured.net_tokens >= 128);
      assert.equal(measured.requires_full_read_for_any_marker, measured.retained_markers < row.marker_count);
      assert.equal(measured.net_tokens_after_full_read_sensitivity, measured.net_tokens - (measured.requires_full_read_for_any_marker ? row.source_tokens : 0));
      assert.ok(measured.first_marker_retained === null || typeof measured.first_marker_retained === 'boolean');
      assert.equal(measured.first_marker_retained === null, row.marker_count === 0);
      if (row.marker_count && measured.retained_markers === 0) assert.equal(measured.first_marker_retained, false);
      if (row.marker_count && measured.retained_markers === row.marker_count) assert.equal(measured.first_marker_retained, true);
      exactKeys(measured.invariants, ['source_byte_count_correct', 'presented_byte_count_correct', 'exact_valid_short_passthrough', 'compacted_status_disclosed', 'compacted_omission_disclosed', 'compacted_log_path_disclosed', 'capture_bound_disclosed', 'compaction_byte_guard']);
      assert.ok(Object.values(measured.invariants).every(flag => flag === true), 'Paired preservation failure');
    }
    assert.equal(row.candidate.retained_markers - row.baseline.retained_markers, row.marker_gains - row.marker_losses);
    assert.ok(row.marker_gains <= row.marker_count && row.marker_losses <= row.marker_count);
    assert.ok(row.marker_gains <= row.candidate.retained_markers && row.marker_losses <= row.baseline.retained_markers);
    assert.ok(row.baseline.retained_markers + row.marker_gains <= row.marker_count, 'Marker union exceeds source observations');
    if (!row.capture_truncated) assert.equal(row.presented_equal, true, 'Full-capture output changed');
    assert.equal(row.presented_equal, row.baseline.presented_sha256 === row.candidate.presented_sha256);
  }
  assert.deepEqual(report.synthetic.map(row => row.id), protocol.synthetic_cases);
  for (const [i, row] of report.synthetic.entries()) {
    const fixture = syntheticCases()[i];
    exactKeys(row, ['id', 'source_sha256', 'source_bytes', 'exit_code', 'checks']);
    assert.equal(row.source_sha256, sha(fixture.bytes));
    assert.equal(row.source_bytes, fixture.bytes.length);
    assert.equal(row.exit_code, fixture.code);
    exactKeys(row.checks, ['candidate_invariants', 'declared_unchanged_output', 'declared_early_evidence_retained', 'final_tail_retained', 'diagnostic_chunk_invariance', 'lossy_text_disclosed']);
    assert.ok(Object.values(row.checks).every(value => value === true), 'Controlled preservation failure');
  }
  assert.deepEqual(report.summary, summarize(report.cases));
  assert.equal(report.verdict, report.summary.candidate.routed_below_margin ? 'contract-pass-with-observed-margin-failures' : 'contract-pass-scoped-text-margin-pass');
  return report.summary;
}

function evaluateSynthetic(baseline, candidate) {
  return syntheticCases().map(row => {
    const logPath = '/private/controlled/check.log';
    const old = replayBuffer(row.bytes, row.code, logPath, baseline), current = replayBuffer(row.bytes, row.code, logPath, candidate);
    const alternate = replayBuffer(row.bytes, row.code, logPath, candidate, 7);
    return { id: row.id, source_sha256: sha(row.bytes), source_bytes: row.bytes.length, exit_code: row.code, checks: {
      candidate_invariants: Object.values(current.invariants).every(Boolean),
      declared_unchanged_output: !row.parity || current.result.text === old.result.text,
      declared_early_evidence_retained: !row.preserve || current.result.text.includes(row.preserve),
      final_tail_retained: row.id === 'short-failure' || current.result.text.includes('FINAL_CONTROLLED_SENTINEL'),
      diagnostic_chunk_invariance: alternate.result.text === current.result.text,
      lossy_text_disclosed: !row.lossy || current.result.text.includes('text_lossy=true'),
    } };
  });
}

export async function check(root = ROOT) {
  const report = readJson(join(root, REPORT)), protocol = readJson(join(root, PROTOCOL));
  const reportBytes = readFileSync(join(root, REPORT));
  assert.ok(readFileSync(join(root, 'research/early-diagnostics-runs', `${sha(reportBytes)}.json`)).equals(reportBytes), 'Current report must have an immutable complete run');
  const summary = validateReport(report, protocol, root);
  const { stageHistoricalEvidence } = await import(pathToFileURL(join(root, 'research/validate-history.mjs')).href);
  const stage = stageHistoricalEvidence(root);
  try {
    const baseline = await import(pathToFileURL(join(stage.root, 'src/reduce.js')).href);
    const candidate = { ...await import(pathToFileURL(join(root, 'src/reduce.js')).href), ...await import(pathToFileURL(join(root, 'src/process.js')).href) };
    assert.deepEqual(evaluateSynthetic(baseline, candidate), report.synthetic, 'Public fixture results changed');
    return summary;
  } finally { stage.cleanup(); }
}

function writeOnceJson(path, value, mode) {
  const bytes = JSON.stringify(value, null, 2) + '\n';
  if (existsSync(path)) assert.equal(hashFile(path), sha(bytes), 'Write-once evidence already has different bytes');
  else writeFileSync(path, bytes, { mode, flag: 'wx' });
  return sha(bytes);
}

function writeCurrent(root, value) {
  const temporary = join(root, `${REPORT}.${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  renameSync(temporary, join(root, REPORT));
}

export function recordFailedAttempt(root, { protocolHash, protocolAfterHash = protocolHash, before, after, phase, errorName, cases, synthetic, privateReplayHash }) {
  assert.ok(['replay', 'tokenization', 'synthetic', 'validation', 'publication'].includes(phase));
  const attempt = { schema_version: 1, experiment: 'early-diagnostics-task-log-replay-v1',
    status: 'failed-measurement-attempt', recorded_at_utc: new Date().toISOString(),
    protocol_sha256: protocolHash, protocol_after_sha256: protocolAfterHash, source_before: before, source_after: after,
    failure: { phase, name: ['AssertionError', 'Error', 'TypeError', 'RangeError', 'SyntaxError'].includes(errorName) ? errorName : 'Error' },
    completed_cases: cases, completed_synthetic: synthetic, private_replay_sha256: privateReplayHash };
  const bytes = JSON.stringify(attempt, null, 2) + '\n';
  const directory = join(root, 'research/early-diagnostics-attempts');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${sha(bytes)}.json`);
  writeOnceJson(path, attempt, 0o644);
  writeCurrent(root, { schema_version: 1, status: 'failed-measurement-attempt', attempt_sha256: sha(bytes) });
  return path;
}

export function publishReport(root, report) {
  const bytes = JSON.stringify(report, null, 2) + '\n';
  const directory = join(root, 'research/early-diagnostics-runs');
  mkdirSync(directory, { recursive: true });
  writeOnceJson(join(directory, `${sha(bytes)}.json`), report, 0o644);
  writeCurrent(root, report);
}

export async function measure(input, python, root = ROOT) {
  const protocolBytes = readFileSync(join(root, PROTOCOL));
  const protocol = JSON.parse(protocolBytes);
  const protocolHash = sha(protocolBytes);
  validateProtocol(protocol);
  const before = sourceHashes(root);
  assert.deepEqual(protocol.candidate_source_sha256, before, 'Freeze final candidate sources before replay');
  assert.deepEqual(protocol.routing.minimum_expected_output_bytes, 8192);
  assert.deepEqual(protocol.routing.minimum_net_token_margin, 128);
  const privateInput = inspectPrivateManifest(input, protocol, root);
  writeCurrent(root, { schema_version: 1, status: 'measurement-in-progress', protocol_sha256: protocolHash,
    started_at_utc: new Date().toISOString(), source_sha256: before });
  const { stageHistoricalEvidence } = await import(pathToFileURL(join(root, 'research/validate-history.mjs')).href);
  const stage = stageHistoricalEvidence(root);
  let phase = 'replay', completedCases = [], completedSynthetic = [], privateReplayHash = null;
  try {
    const baseline = await import(pathToFileURL(join(stage.root, 'src/reduce.js')).href);
    const candidate = { ...await import(pathToFileURL(join(root, 'src/reduce.js')).href), ...await import(pathToFileURL(join(root, 'src/process.js')).href) };
    const privateRows = privateInput.rows.map(row => {
      // Marker extraction runs before either reducer; no output-sensitive labels.
      const markers = markerLines(row.bytes);
      return { row, markers, baseline: replayBuffer(row.bytes, row.exit_code, row.file, baseline), candidate: replayBuffer(row.bytes, row.exit_code, row.file, candidate) };
    });
    const privateReplay = { schema_version: 1, protocol_sha256: protocolHash, rows: privateRows.map(data => ({ sample_id: data.row.sample_id, baseline: data.baseline.result.text, candidate: data.candidate.result.text })) };
    const privateReplayPath = join(privateInput.base, `paired-replay-${sha(JSON.stringify(privateReplay))}.json`);
    privateReplayHash = writeOnceJson(privateReplayPath, privateReplay, 0o600);
    phase = 'tokenization';
    const skill = readFileSync(join(root, 'skills/system-one-verify/SKILL.md'), 'utf8');
    const name = skill.match(/^name:\s*(.+)$/m)?.[1], description = skill.match(/^description:\s*(.+)$/m)?.[1];
    assert.ok(name && description);
    const costStrings = [skill, `${name}: ${description}`, JSON.stringify({ cmd: 'bun test' }), JSON.stringify({ cmd: 'system-one-skills check --timeout-ms 900000 -- bun test' })];
    const strings = privateRows.flatMap(row => [row.row.bytes.toString('utf8'), row.baseline.result.text, row.candidate.result.text]);
    const tokens = tokenize([...costStrings, ...strings], python, join(privateInput.base, 'tokenizer-cache'));
    const overhead = { full_skill_tokens: tokens[0], catalog_tokens: tokens[1], baseline_invocation_tokens: tokens[2], skill_invocation_tokens: tokens[3], first_use_incremental_tokens: tokens[0] + tokens[1] + tokens[3] - tokens[2] };
    const cases = privateRows.map((data, i) => {
      const rawTokens = tokens[4 + i * 3], baselineMarkers = data.markers.map(line => data.baseline.result.text.includes(line)), candidateMarkers = data.markers.map(line => data.candidate.result.text.includes(line));
      const row = { sample_id: data.row.sample_id, source_sha256: data.row.sha256, source_bytes: data.row.bytes.length, source_tokens: rawTokens, exit_code: data.row.exit_code, routed: data.row.bytes.length >= 8192, capture_truncated: data.row.bytes.length > CAPTURE, marker_count: data.markers.length,
        marker_gains: candidateMarkers.filter((value, j) => value && !baselineMarkers[j]).length, marker_losses: baselineMarkers.filter((value, j) => value && !candidateMarkers[j]).length, presented_equal: data.baseline.result.text === data.candidate.result.text };
      for (const [arm, tokenIndex, retained] of [['baseline', 5, baselineMarkers], ['candidate', 6, candidateMarkers]]) {
        const result = data[arm].result, shownTokens = tokens[tokenIndex + i * 3], requiresRead = retained.some(value => !value), net = rawTokens - shownTokens - overhead.first_use_incremental_tokens;
        row[arm] = { presented_sha256: sha(result.text), presented_bytes: result.outputBytes, presented_tokens: shownTokens, net_tokens: net, meets_margin: net >= 128,
          retained_markers: retained.filter(Boolean).length, first_marker_retained: retained[0] ?? null, requires_full_read_for_any_marker: requiresRead, net_tokens_after_full_read_sensitivity: net - (requiresRead ? rawTokens : 0), invariants: data[arm].invariants };
      }
      return row;
    });
    completedCases = cases;
    phase = 'synthetic';
    const synthetic = evaluateSynthetic(baseline, candidate);
    completedSynthetic = synthetic;
    phase = 'validation';
    const summary = summarize(cases);
    const report = { schema_version: 1, experiment: protocol.experiment, recorded_at_utc: new Date().toISOString(), evidence_role: 'development paired byte replay; not held-out or whole-task evidence', protocol_sha256: protocolHash, private_manifest_sha256: hashFile(privateInput.path), private_replay_sha256: hashFile(privateReplayPath), source_sha256: before, tokenizer: protocol.tokenizer, overhead, cases, synthetic, summary, verdict: summary.candidate.routed_below_margin ? 'contract-pass-with-observed-margin-failures' : 'contract-pass-scoped-text-margin-pass' };
    assert.deepEqual(sourceHashes(root), before, 'Source changed during measurement');
    assert.equal(hashFile(join(root, PROTOCOL)), protocolHash, 'Protocol changed during measurement');
    validateReport(report, protocol, root);
    phase = 'publication';
    publishReport(root, report);
    return summary;
  } catch (error) {
    let after = null, protocolAfterHash = null;
    try { after = sourceHashes(root); } catch { /* A changed or missing source is itself evidence. */ }
    try { protocolAfterHash = hashFile(join(root, PROTOCOL)); } catch { /* Preserve an absent protocol as null. */ }
    recordFailedAttempt(root, { protocolHash, protocolAfterHash, before, after, phase,
      errorName: error instanceof Error ? error.name : 'Error', cases: completedCases,
      synthetic: completedSynthetic, privateReplayHash });
    throw error;
  } finally { stage.cleanup(); }
}

function freeze(root) {
  const path = join(root, PROTOCOL), protocol = readJson(path);
  assert.equal(protocol.candidate_source_sha256, null, 'Protocol already binds a candidate; record a new amendment before changing it');
  protocol.selection_protocol_sha256 ??= hashFile(path);
  protocol.candidate_source_sha256 = sourceHashes(root);
  protocol.candidate_frozen_at_utc = new Date().toISOString();
  writeFileSync(path, JSON.stringify(protocol, null, 2) + '\n');
  return { protocol_sha256: hashFile(path), bound_sources: Object.keys(protocol.candidate_source_sha256).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, input, python] = process.argv.slice(2);
  try {
    if (mode === '--freeze' && !input) console.log(JSON.stringify(freeze(ROOT)));
    else if (mode === '--write' && input && python) console.log(JSON.stringify(await measure(input, python)));
    else if (mode === '--check' && !input) console.log(JSON.stringify(await check(ROOT)));
    else throw new Error('Usage: node research/early-diagnostics-replay.mjs --freeze | --write PRIVATE_MANIFEST ABSOLUTE_PYTHON | --check');
  } catch (error) {
    // Assertion diffs can contain private paths or strings; never print them.
    console.error(`Early-diagnostics evidence failed (${error instanceof Error ? error.name : 'unknown'}); inspect the declared inputs and invariants privately.`);
    process.exitCode = 1;
  }
}
