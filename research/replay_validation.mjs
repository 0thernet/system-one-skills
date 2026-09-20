#!/usr/bin/env node
/** Replay archived text through the shipped reducer, never archived commands. */
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reduceOutput } from '../src/reduce.js';
import { CAPTURE_BYTES, MAX_LOG_BYTES, createDiagnosticCapture } from '../src/process.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');

export function validateSample(row) {
  if (!row || !['codex', 'claude', 'devin'].includes(row.provider) || !/^[a-f0-9]{64}$/.test(row.sample_id ?? '') || typeof row.log !== 'string' || !Number.isInteger(row.exit_code)) throw new Error('Invalid private replay sample');
  if (!['tool_result', 'completed_command_event'].includes(row.source_view ?? 'tool_result')) throw new Error('Invalid source view');
  return row;
}

async function outsideRepository(path) {
  const resolved = await realpath(path);
  const packageRoot = await realpath(root);
  if (resolved === packageRoot || resolved.startsWith(packageRoot + sep)) throw new Error('Private replay artifacts must stay outside the repository');
  return resolved;
}

/** @param {{name:string,path:string}[]} cohorts @param {string} outputFile */
export async function replay(cohorts, outputFile) {
  if (!cohorts.length || cohorts.length > 4) throw new Error('Expected one to four private cohorts');
  const samples = [];
  const identities = new Set();
  const privateDir = await mkdtemp(join(tmpdir(), 'system-one-assessment-'));
  await chmod(privateDir, 0o700);
  for (const cohort of cohorts) {
    if (!/^[a-z][a-z0-9_-]{0,40}$/.test(cohort.name)) throw new Error('Invalid cohort name');
    const input = await outsideRepository(resolve(cohort.path));
    const rows = JSON.parse(await readFile(input, 'utf8'));
    if (!Array.isArray(rows) || rows.length > 36) throw new Error('Expected at most 36 samples per cohort');
    for (const candidate of rows) {
      const row = validateSample(candidate);
      const identity = `${row.provider}:${row.sample_id}`;
      if (identities.has(identity)) throw new Error('Duplicate sample across cohorts');
      identities.add(identity);
      const caseDir = join(privateDir, `${cohort.name}-${row.sample_id}`);
      await mkdir(caseDir, { mode: 0o700 });
      const logPath = join(caseDir, 'check.log');
      await writeFile(logPath, row.log, { mode: 0o600 });
      const bytes = Buffer.byteLength(row.log);
      if (bytes > MAX_LOG_BYTES) throw new Error('Archived sample exceeds the runtime full-log limit; explicit exceptional replay required');
      const captureTruncated = bytes > CAPTURE_BYTES;
      const captured = Buffer.from(row.log).subarray(Math.max(0, bytes - CAPTURE_BYTES));
      let start = 0;
      if (captureTruncated) while (start < captured.length && (captured[start] & 0xc0) === 0x80) start++;
      const diagnosticCapture = createDiagnosticCapture();
      diagnosticCapture.push(Buffer.from(row.log));
      const reduced = reduceOutput({ diagnostics: diagnosticCapture.finish(), text: captured.subarray(start).toString('utf8'), code: row.exit_code, logPath, outputBytes: bytes, captureTruncated });
      const headline = `exit=${row.exit_code} bytes=${bytes} omitted=`;
      const invariants = {
        source_byte_count_correct: reduced.sourceBytes === bytes,
        presented_byte_count_correct: reduced.outputBytes === Buffer.byteLength(reduced.text),
        exact_passthrough_or_marked_compaction: reduced.compacted || reduced.text === row.log,
        compacted_exit_status_disclosed: !reduced.compacted || reduced.text.startsWith(headline),
        compacted_omission_disclosed: !reduced.compacted || /\bomitted=\d+/.test(reduced.text.split('\n')[0] ?? ''),
        compacted_artifact_path_disclosed: !reduced.compacted || reduced.text.endsWith(`log=${JSON.stringify(logPath)}\n`),
        capture_bound_disclosed: !captureTruncated || reduced.text.includes(' capture_truncated=true'),
        compaction_meets_byte_guard: !reduced.compacted || (bytes >= 8192 && bytes - reduced.outputBytes >= 4096 && reduced.outputBytes <= bytes / 2),
        complete_archived_excerpt_saved: (await readFile(logPath)).equals(Buffer.from(row.log)),
        artifact_permissions_private: ((await stat(logPath)).mode & 0o777) === 0o600 && ((await stat(caseDir)).mode & 0o777) === 0o700,
      };
      samples.push({
        provider: row.provider, sample_id: row.sample_id,
        source_view: row.source_view ?? 'tool_result', cohort: cohort.name,
        exit_code: row.exit_code, log: row.log, presented_text: reduced.text,
        compacted: reduced.compacted, invariants,
        capture_truncated: captureTruncated,
      });
    }
  }
  const result = { schema_version: 2, artifact_root: privateDir, samples, private_replay_digest: hash(JSON.stringify(samples)) };
  const output = resolve(outputFile);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await outsideRepository(dirname(output));
  const temporary = join(dirname(output), `.replay-${process.pid}-${Date.now()}.json`);
  await writeFile(temporary, JSON.stringify(result), { mode: 0o600, flag: 'wx' });
  await rename(temporary, output);
  return { samples: samples.length, compacted: samples.filter(r => r.compacted).length, invariantFailures: samples.reduce((n, r) => n + Object.values(r.invariants).filter(v => !v).length, 0) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [output, ...inputs] = process.argv.slice(2);
  if (!output || !inputs.length) throw new Error('Usage: node research/replay_validation.mjs PRIVATE_OUTPUT cohort=PRIVATE_INPUT ...');
  const cohorts = inputs.map(value => {
    const equals = value.indexOf('=');
    if (equals < 1) throw new Error('Expected cohort=PRIVATE_INPUT');
    return { name: value.slice(0, equals), path: value.slice(equals + 1) };
  });
  console.log(JSON.stringify(await replay(cohorts, output)));
}
