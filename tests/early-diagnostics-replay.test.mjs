import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markerLines, publishReport, recordFailedAttempt, replayBuffer, sourceHashes, syntheticCases, validateProtocol, validateReport } from '../research/early-diagnostics-replay.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'system-one-early-evidence-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const hash = value => createHash('sha256').update(value).digest('hex');
const protocolPath = 'research/early-diagnostics-protocol.json';
const files = ['bin/system-one-skills.js', 'src/check.js', 'src/process.js', 'src/reduce.js',
  'skills/system-one-verify/SKILL.md', 'research/early-diagnostics-replay.mjs',
  'tests/early-diagnostics-replay.test.mjs', 'research/validate-history.mjs', 'research/history/v0.4.0/manifest.json',
  'package.json', 'bun.lock', 'scripts/check.ts', 'research/replay_validation.mjs'];

function publicFixture() {
  const root = mkdtempSync(join(scratch, 'fixture-'));
  const source = Object.fromEntries(files.map(path => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `controlled ${path}`);
    return [path, hash(readFileSync(join(root, path)))];
  }));
  const protocol = JSON.parse(readFileSync(fileURLToPath(new URL('../research/early-diagnostics-protocol.json', import.meta.url)), 'utf8'));
  protocol.candidate_source_sha256 = source;
  writeFileSync(join(root, protocolPath), JSON.stringify(protocol));
  const arm = { presented_sha256: '3'.repeat(64), presented_bytes: 1000, presented_tokens: 100,
    net_tokens: 880, meets_margin: true, retained_markers: 0, first_marker_retained: false,
    requires_full_read_for_any_marker: true, net_tokens_after_full_read_sensitivity: -120,
    invariants: Object.fromEntries(['source_byte_count_correct', 'presented_byte_count_correct',
      'exact_valid_short_passthrough', 'compacted_status_disclosed', 'compacted_omission_disclosed',
      'compacted_log_path_disclosed', 'capture_bound_disclosed', 'compaction_byte_guard'].map(key => [key, true])) };
  const aggregate = { presented_tokens: 100, routed_net_tokens: 880, routed_below_margin: 0, retained_markers: 0,
    cases_requiring_full_read_for_any_marker: 1, net_tokens_after_full_read_sensitivity: -120, invariant_failures: 0 };
  const report = { schema_version: 1, experiment: protocol.experiment, recorded_at_utc: '2026-09-20T00:00:00Z',
    evidence_role: 'development paired byte replay; not held-out or whole-task evidence', protocol_sha256: hash(readFileSync(join(root, protocolPath))),
    private_manifest_sha256: '4'.repeat(64), private_replay_sha256: '5'.repeat(64), source_sha256: source, tokenizer: protocol.tokenizer,
    overhead: { full_skill_tokens: 10, catalog_tokens: 5, baseline_invocation_tokens: 2, skill_invocation_tokens: 7, first_use_incremental_tokens: 20 },
    cases: protocol.samples.map(row => ({ sample_id: row.sample_id, source_sha256: row.sha256, source_bytes: row.bytes, source_tokens: 1000, exit_code: row.exit_code,
      routed: true, capture_truncated: row.bytes > 262144, marker_count: 1, marker_gains: 0, marker_losses: 0, presented_equal: true,
      baseline: structuredClone(arm), candidate: structuredClone(arm) })),
    synthetic: syntheticCases().map(row => ({ id: row.id, source_sha256: hash(row.bytes), source_bytes: row.bytes.length, exit_code: row.code,
      checks: Object.fromEntries(['candidate_invariants', 'declared_unchanged_output', 'declared_early_evidence_retained', 'final_tail_retained', 'diagnostic_chunk_invariance', 'lossy_text_disclosed'].map(key => [key, true])) })),
    summary: { cases: 9, routed_cases: 9, capture_truncated_cases: 4, recorded_nonzero_exits: 4, marker_gains: 0, marker_losses: 0,
      baseline: Object.fromEntries(Object.entries(aggregate).map(([k, v]) => [k, v * 9])), candidate: Object.fromEntries(Object.entries(aggregate).map(([k, v]) => [k, v * 9])) }, verdict: 'contract-pass-scoped-text-margin-pass' };
  return { root, protocol, report };
}

describe('fresh development replay boundary', () => {
  test('marker labels are exact source lines and retain duplicate observations', () => {
    const text = '\x1b[31merror:\x1b[0m controlled\nordinary detail\n(fail) controlled test\nFAIL suite\nerror: same\nerror: same\n';
    expect(markerLines(Buffer.from(text))).toEqual(['\x1b[31merror:\x1b[0m controlled\n', '(fail) controlled test\n', 'FAIL suite\n', 'error: same\n', 'error: same\n']);
  });

  test('replay passes exact suffix bytes and streams all original bytes once', () => {
    const bytes = Buffer.from('é'.repeat(150000));
    let received, consumed = 0, largest = 0;
    const implementation = { createDiagnosticCapture: () => ({ push(chunk) { consumed += chunk.length; largest = Math.max(largest, chunk.length); }, finish() { return []; } }),
      reduceOutput(input) { received = input; return { text: input.text, sourceBytes: input.outputBytes, outputBytes: Buffer.byteLength(input.text), compacted: false }; } };
    replayBuffer(bytes, 7, '/controlled/log', implementation, 7);
    expect(received.raw.equals(bytes.subarray(-262144))).toBe(true);
    expect(received.text).not.toContain('\ufffd');
    expect(received.outputBytes).toBe(bytes.length);
    expect(received.captureTruncated).toBe(true);
    expect(consumed).toBe(bytes.length); expect(largest).toBe(7);
  });

  test('replay rejects unsafe bounds and impossible exit metadata', () => {
    const implementation = { reduceOutput() { throw new Error('must not run'); } };
    expect(() => replayBuffer(Buffer.from('x'), -1, '/log', implementation)).toThrow();
    expect(() => replayBuffer(Buffer.from('x'), 256, '/log', implementation)).toThrow();
    expect(() => replayBuffer(Buffer.from('x'), 1, '/log', implementation, 0)).toThrow();
  });

  test('controlled cases include short, cutoff, long UTF8 and binary boundaries', () => {
    const rows = syntheticCases();
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map(row => row.id)).size).toBe(10);
    expect(rows.find(row => row.id === 'threshold-success').bytes.length).toBe(8192);
    expect(rows.find(row => row.id === 'cutoff-overlap').bytes.length).toBe(262152);
    expect(rows.find(row => row.id === 'invalid-utf8-tail').bytes.includes(255)).toBe(true);
  });

  test('public report validates its exact source and arithmetic', () => {
    const { report, protocol, root } = publicFixture();
    expect(validateReport(report, protocol, root).cases).toBe(9);
    writeFileSync(join(root, 'src/process.js'), 'changed');
    expect(() => validateReport(report, protocol, root)).toThrow();
  });

  test.each(['tokens', 'drop-case', 'invariant', 'marker-loss', 'impossible-markers', 'null-first-marker', 'first-with-none', 'private-field', 'empty-controlled-checks', 'controlled-hash', 'controlled-exit', 'controlled-bytes'])('fails closed on %s report tampering', kind => {
    const { report, protocol, root } = publicFixture();
    if (kind === 'tokens') report.cases[0].candidate.net_tokens++;
    if (kind === 'drop-case') report.cases = [];
    if (kind === 'invariant') report.cases[0].candidate.invariants.capture_bound_disclosed = false;
    if (kind === 'marker-loss') report.cases[0].marker_losses = 1;
    if (kind === 'impossible-markers') report.cases[0].marker_losses = report.cases[0].marker_gains = 1;
    if (kind === 'null-first-marker') report.cases[0].candidate.first_marker_retained = null;
    if (kind === 'first-with-none') report.cases[0].candidate.first_marker_retained = true;
    if (kind === 'private-field') report.cases[0].private_log = 'must never be public';
    if (kind === 'empty-controlled-checks') report.synthetic[0].checks = {};
    if (kind === 'controlled-hash') report.synthetic[0].source_sha256 = '0'.repeat(64);
    if (kind === 'controlled-exit') report.synthetic[0].exit_code++;
    if (kind === 'controlled-bytes') report.synthetic[0].source_bytes++;
    expect(() => validateReport(report, protocol, root)).toThrow();
  });

  test.each(['threshold', 'margin', 'tokenizer', 'baseline'])('rejects changed %s protocol', kind => {
    const { protocol } = publicFixture();
    if (kind === 'threshold') protocol.routing.minimum_expected_output_bytes++;
    if (kind === 'margin') protocol.routing.minimum_net_token_margin--;
    if (kind === 'tokenizer') protocol.tokenizer.version = 'other';
    if (kind === 'baseline') protocol.baseline.git_commit = '0'.repeat(40);
    expect(() => validateProtocol(protocol)).toThrow();
  });

  test('source inventory detects added runtime files and rejects symlinks', () => {
    const { root, report, protocol } = publicFixture();
    writeFileSync(join(root, 'src/extra.js'), 'unexpected source');
    expect(() => validateReport(report, protocol, root)).toThrow();
    symlinkSync(join(root, 'src/check.js'), join(root, 'src/link.js'));
    expect(() => sourceHashes(root)).toThrow();
  });

  test('failed attempts retain computed rows without error messages or qualifying a report', () => {
    const { root, report, protocol } = publicFixture();
    publishReport(root, report);
    const path = recordFailedAttempt(root, { protocolHash: report.protocol_sha256,
      before: report.source_sha256, after: null, phase: 'validation', errorName: 'private error text',
      cases: report.cases, synthetic: report.synthetic, privateReplayHash: '7'.repeat(64) });
    const attempt = JSON.parse(readFileSync(path, 'utf8'));
    expect(attempt.status).toBe('failed-measurement-attempt');
    expect(attempt.completed_cases).toHaveLength(9);
    expect(attempt.failure).toEqual({ phase: 'validation', name: 'Error' });
    expect(readFileSync(path, 'utf8')).not.toContain('private error text');
    expect(() => validateReport(JSON.parse(readFileSync(join(root, 'research/early-diagnostics-report.json'), 'utf8')), protocol, root)).toThrow();
    expect(readdirSync(join(root, 'research/early-diagnostics-runs'))).toHaveLength(1);
  });

  test('completed reruns preserve all immutable report bytes', () => {
    const { root, report } = publicFixture();
    publishReport(root, report);
    const first = readFileSync(join(root, 'research/early-diagnostics-report.json'));
    report.recorded_at_utc = '2026-09-20T00:01:00Z';
    publishReport(root, report);
    expect(readdirSync(join(root, 'research/early-diagnostics-runs'))).toHaveLength(2);
    expect(readFileSync(join(root, 'research/early-diagnostics-runs', `${hash(first)}.json`)).equals(first)).toBe(true);
  });

  test('protocol mutation cannot relabel an existing report', () => {
    const { root, report, protocol } = publicFixture();
    writeFileSync(join(root, protocolPath), JSON.stringify({ ...protocol, changed: true }));
    expect(() => validateReport(report, protocol, root)).toThrow();
  });

  test('rejects impossible marker unions even when paired differences reconcile', () => {
    const { root, report, protocol } = publicFixture();
    const row = report.cases[0];
    row.marker_count = 10; row.marker_gains = row.marker_losses = 8;
    for (const arm of ['baseline', 'candidate']) {
      row[arm].retained_markers = 8;
      row[arm].first_marker_retained = true;
      report.summary[arm].retained_markers = 8;
    }
    report.summary.marker_gains = report.summary.marker_losses = 8;
    expect(() => validateReport(report, protocol, root)).toThrow('Marker union exceeds source observations');
  });
});
