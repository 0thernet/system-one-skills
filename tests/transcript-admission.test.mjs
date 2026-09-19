import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { replay, validateSample } from '../research/replay_validation.mjs';

test('archived-text replay retains short negatives and verifies complete private logs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'system-one-admission-test-'));
  let artifactRoot;
  try {
    const input = join(dir, 'private.json');
    const output = join(dir, 'rendered.json');
    await writeFile(input, JSON.stringify([
      { provider: 'devin', sample_id: 'a'.repeat(64), log: 'PRIVATE SHORT OUTPUT', exit_code: 1 },
      { provider: 'codex', sample_id: 'b'.repeat(64), source_view: 'completed_command_event', log: 'test passed\n'.repeat(2000), exit_code: 0 },
    ]));
    const result = await replay([{ name: 'fixture', path: input }], output);
    assert.equal(result.samples, 2);
    assert.equal(result.compacted, 1);
    assert.equal(result.invariantFailures, 0);
    const privateResult = JSON.parse(await readFile(output, 'utf8'));
    artifactRoot = privateResult.artifact_root;
    const rows = privateResult.samples;
    assert.equal(rows[0].presented_text, 'PRIVATE SHORT OUTPUT');
    assert.equal(rows[1].source_view, 'completed_command_event');
    assert.equal(rows[1].invariants.compacted_exit_status_disclosed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
    if (artifactRoot) await rm(artifactRoot, { recursive: true, force: true });
  }
});

test('sample identities and exit statuses reject unsafe inputs', () => {
  assert.throws(() => validateSample({ provider: 'codex', sample_id: '../../escape', log: 'x', exit_code: 0 }));
  assert.throws(() => validateSample({ provider: 'codex', sample_id: 'a'.repeat(64), log: 'x', exit_code: '0; unsafe' }));
});
