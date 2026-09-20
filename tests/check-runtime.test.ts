import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureCommand, CAPTURE_BYTES, MAX_LOG_BYTES, createDiagnosticCapture, DIAGNOSTIC_BYTES, DIAGNOSTIC_LINES } from '../src/process.js';
import { reduceOutput } from '../src/reduce.js';
import { check } from '../src/check.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'bin/system-one-skills.js');
const node = Bun.which('node')!;
const scratch = mkdtempSync(join(tmpdir(), 'system-one-runtime-test-'));
const extraLogs = new Set<string>();
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  for (const dir of extraLogs) rmSync(dir, { recursive: true, force: true });
});
function path(name: string) { return join(scratch, name); }
function invoke(args: string[]) {
  return spawnSync(node, [cli, ...args], { cwd: scratch, timeout: 10000 });
}
async function waitForFile(file: string) {
  const deadline = Date.now() + 1500;
  while (!existsSync(file)) {
    if (Date.now() > deadline) throw new Error('fixture readiness timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('adaptive reducer', () => {
  test('small text is exact, with no wrapper or newline added', () => {
    for (const text of ['', 'ok', 'é\n\n', 'x'.repeat(8191)]) {
      const result = reduceOutput({ text, code: 7, logPath: '/private/log' });
      expect(result.text).toBe(text);
      expect(result.compacted).toBe(false);
      expect(result.omittedBytes).toBe(0);
    }
  });
  test('long output includes exit, exact byte omissions, final evidence and log path', () => {
    const text = 'passing fixture details\n'.repeat(1000) + '1000 passed\n';
    const result = reduceOutput({ text, code: 0, logPath: '/private/log' });
    const retained = text.match(/[^\n]*\n|[^\n]+$/g)!.slice(-12).join('');
    expect(result.compacted).toBe(true);
    expect(result.text).toStartWith(`exit=0 bytes=${Buffer.byteLength(text)} omitted=${Buffer.byteLength(text) - Buffer.byteLength(retained)}\n`);
    expect(result.text).toContain('1000 passed\n');
    expect(result.text).toEndWith('log="/private/log"\n');
    expect(result.outputBytes).toBeLessThanOrEqual(Buffer.byteLength(text) / 2);
    expect(Buffer.byteLength(text) - result.outputBytes).toBeGreaterThanOrEqual(4096);
  });
  test('failure windows and tail never repeat the same source region', () => {
    const text = 'FAIL early diagnosis\nexpected 7, received 3\n' + 'passing fixture\n'.repeat(1000) + 'FAIL final diagnosis\n';
    const result = reduceOutput({ text, code: 9, logPath: '/private/log' });
    expect(result.text.match(/FAIL early diagnosis/g)?.length).toBe(1);
    expect(result.text.match(/FAIL final diagnosis/g)?.length).toBe(1);
    expect(result.text).toContain('expected 7, received 3');
    expect(result.text).toStartWith('exit=9 ');
  });
  test('early colored failure is selected without modifying its source bytes', () => {
    const failure = '\x1b[31mERROR\x1b[0m invoice total mismatch\nExpected: 17\nReceived: 12\n';
    const text = failure + 'passed unrelated check\n'.repeat(1000) + 'validation failed\n';
    const result = reduceOutput({ text, code: 42, logPath: '/private/log' });
    expect(result.compacted).toBe(true);
    expect(result.text).toStartWith('exit=42 ');
    expect(result.text).toContain(failure);
    expect(result.text.match(/invoice total mismatch/g)?.length).toBe(1);
  });
  test('8 KiB success boundary compacts while preserving the final summary', () => {
    for (const size of [8192, 8207]) {
      const summary = '\nAll validation checks passed\n';
      const text = 'x'.repeat(size - Buffer.byteLength(summary)) + summary;
      const result = reduceOutput({ text, code: 0, logPath: '/private/example/realistic-check.log' });
      expect(result.compacted).toBe(true);
      expect(result.outputBytes).toBeLessThanOrEqual(size / 2);
      expect(size - result.outputBytes).toBeGreaterThanOrEqual(4096);
      expect(result.text).toContain('All validation checks passed');
    }
  });
  test('UTF8 clipping and quoted log paths preserve valid text', () => {
    const result = reduceOutput({ text: 'é😀'.repeat(3000), code: 1, logPath: '/private/a\nquoted"log' });
    expect(result.compacted).toBe(true);
    expect(result.text).not.toContain('\ufffd');
    expect(result.text).toEndWith('log="/private/a\\nquoted\\"log"\n');
  });
  test('a single enormous failure line retains its diagnostic beginning and ending', () => {
    const text = 'AssertionError: expected result ' + 'x'.repeat(20000) + ' final value';
    const result = reduceOutput({ text, code: 1, logPath: '/private/log' });
    expect(result.compacted).toBe(true);
    expect(result.text).toContain('AssertionError: expected result');
    expect(result.text).toContain('final value');
    expect(result.omittedBytes).toBe(Buffer.byteLength(text) - 4096);
  });
  test('large preceding context cannot displace the first failure diagnosis', () => {
    const text = 'é'.repeat(8000) + '\nAssertionError: preserve this diagnosis\n' + 'passing fixture\n'.repeat(1000);
    const result = reduceOutput({ text, code: 1, logPath: '/private/log' });
    expect(result.text).toContain('AssertionError: preserve this diagnosis');
    expect(result.text).not.toContain('\ufffd');
  });
  test('long presentation falls back to original if required savings are absent', () => {
    const text = 'x'.repeat(8192);
    const result = reduceOutput({ text, code: 0, logPath: '/private/' + 'l'.repeat(5000) });
    expect(result.compacted).toBe(false);
    expect(result.text).toBe(text);
  });
});

describe('bounded streaming diagnostics', () => {
  test('one-byte chunks preserve colored UTF8 diagnostics and source offsets', () => {
    const capture = createDiagnosticCapture();
    const prelude = Buffer.from('ordinary é😀 output\n');
    const diagnosis = Buffer.from('\x1b[31mFAIL\x1b[0m early é😀 mismatch\nExpected: 17\nReceived: 12\n');
    const input = Buffer.concat([prelude, diagnosis]);
    for (const byte of input) capture.push(Buffer.from([byte]));
    const ranges = capture.finish();
    expect(Buffer.concat(ranges.map(r => r.bytes))).toEqual(diagnosis);
    expect(ranges[0]!.start).toBe(prelude.length);
    for (const range of ranges) expect(input.subarray(range.start, range.start + range.bytes.length).equals(range.bytes)).toBe(true);
  });
  test('newline-free noise has bounded memory and cannot hide a later failure', () => {
    const capture = createDiagnosticCapture();
    const noise = Buffer.alloc(64 * 1024, 120);
    for (let i = 0; i < 128; i++) {
      capture.push(noise);
      expect(capture.bufferedBytes).toBeLessThanOrEqual(DIAGNOSTIC_BYTES * 2 + 4);
    }
    capture.push(Buffer.from('\nFAIL after long line\n'));
    const ranges = capture.finish();
    expect(ranges[0]!.start).toBe(128 * noise.length + 1);
    expect(ranges[0]!.bytes.toString()).toBe('FAIL after long line\n');
  });
  test('blank-line fastpath preserves offsets and required following context', () => {
    const capture = createDiagnosticCapture();
    const prelude = 'ordinary' + '\n'.repeat(2050);
    const diagnosis = 'FAIL after blanks\n\n\n';
    capture.push(Buffer.from('ordinary'));
    capture.push(Buffer.from('\n'.repeat(2048)));
    capture.push(Buffer.from('\n\nFAIL after blanks\n\n'));
    capture.push(Buffer.from('\n' + '\n'.repeat(2048)));
    const ranges = capture.finish();
    expect(ranges[0]!.start).toBe(Buffer.byteLength(prelude));
    expect(Buffer.concat(ranges.map(range => range.bytes)).toString()).toBe(diagnosis);
    expect(ranges.map(range => range.start)).toEqual([prelude.length, prelude.length + 'FAIL after blanks\n'.length, prelude.length + 'FAIL after blanks\n\n'.length]);
  });
  test('diagnostic bytes and lines have independent hard caps', () => {
    for (const input of ['FAIL é😀'.repeat(10000), 'FAIL x\n'.repeat(10000)]) {
      const capture = createDiagnosticCapture();
      capture.push(Buffer.from(input));
      const ranges = capture.finish();
      const bytes = Buffer.concat(ranges.map(r => r.bytes));
      expect(bytes.length).toBeLessThanOrEqual(DIAGNOSTIC_BYTES);
      expect(ranges.length).toBeLessThanOrEqual(DIAGNOSTIC_LINES);
      expect(bytes.toString()).not.toContain('\ufffd');
    }
  });
  test('interleaved partial stream lines preserve observed order without inventing a diagnosis', () => {
    const capture = createDiagnosticCapture();
    // Mirrors stdout starting a line, then stderr writing a complete failure.
    // The private combined log records this same order; there is no newline
    // between streams that would make FAIL a line-leading diagnostic.
    for (const chunk of ['stdout partial ', 'FAIL stderr mismatch\n', 'stdout remainder\n']) {
      capture.push(Buffer.from(chunk));
    }
    expect(capture.finish()).toEqual([]);
    // Even UTF8 bytes split around another stream remain original evidence,
    // rather than being silently reconstructed into a contiguous source line.
    const split = createDiagnosticCapture();
    split.push(Buffer.from([0xc3]));
    split.push(Buffer.from('FAIL stderr mismatch\n'));
    split.push(Buffer.from([0xa9, 10]));
    expect(split.finish()).toEqual([]);
  });
  test('a diagnostic crossing the suffix boundary is not repeated or lost', () => {
    const diagnosis = Buffer.from('FAIL boundary é😀 mismatch\n');
    const noise = 'unrelated check passed\n'.repeat(400);
    // Exercise every byte cutoff, including a suffix capture beginning inside
    // a multibyte character (the runtime removes its continuation bytes).
    for (let cutoff = 1; cutoff < diagnosis.length; cutoff++) {
      let start = cutoff;
      while ((diagnosis[start]! & 0xc0) === 0x80) start++;
      const text = diagnosis.subarray(start).toString('utf8') + noise;
      const sourceBytes = diagnosis.length + Buffer.byteLength(noise);
      const result = reduceOutput({ text, code: 7, logPath: '/private/log', outputBytes: sourceBytes, captureTruncated: true, diagnostics: [{ start: 0, bytes: diagnosis }] });
      expect(result.text).toContain(diagnosis.toString('utf8'));
      expect(result.text.match(/FAIL boundary/g)?.length).toBe(1);
      expect(result.text).toContain('[…]');
      expect(result.text).not.toContain('\ufffd');
      expect(result.omittedBytes).toBe(sourceBytes - diagnosis.length - Buffer.byteLength('unrelated check passed\n'.repeat(24)));
    }
  });
  test('sampled evidence overlapping both the suffix and its tail is counted once', () => {
    const diagnosis = Buffer.from('FAIL ' + 'x'.repeat(1990) + '\n');
    const full = Buffer.concat([diagnosis, Buffer.from('trailing ' + 'y'.repeat(400))]);
    const result = reduceOutput({ text: full.subarray(7).toString('utf8'), code: 7, logPath: '/private/log', outputBytes: full.length, captureTruncated: true, diagnostics: [{ start: 0, bytes: diagnosis }] });
    expect(result.omittedBytes).toBe(0);
    expect(result.text).toBe(`exit=7 bytes=${full.length} omitted=0 capture_truncated=true\n${full.toString('utf8')}\nlog="/private/log"\n`);
  });
});

describe('one-shot argv execution', () => {
  test('short output preserves native code, cwd, literal argv and bytes', () => {
    const log = path('exact.log');
    const literal = 'spaces; $(not-a-command) `not-a-command`';
    const result = invoke(['check', '--cwd', scratch, '--log', log, '--', node, '-e', 'process.stdout.write(Buffer.from([255,0])); process.stdout.write(process.argv[1]); require("fs").writeFileSync("one-effect", "once"); process.exitCode=7', literal]);
    expect(result.status).toBe(7);
    expect(result.stdout).toEqual(Buffer.concat([Buffer.from([255, 0]), Buffer.from(literal)]));
    expect(result.stderr.length).toBe(0);
    expect(readFileSync(log)).toEqual(result.stdout);
    expect(readFileSync(path('one-effect'), 'utf8')).toBe('once');
    expect(statSync(log).mode & 0o777).toBe(0o600);
  });
  test('default logs are private, complete and compaction never repeats the command', async () => {
    const result = await check({ argv: [node, '-e', 'const fs=require("fs");const p="counter";fs.writeFileSync(p, fs.existsSync(p)?String(+fs.readFileSync(p)+1):"1");process.stdout.write("passing line\\n".repeat(2000))'], cwd: scratch });
    extraLogs.add(dirname(result.logPath));
    expect(result.code).toBe(0);
    expect(result.rendered.compacted).toBe(true);
    expect(readFileSync(path('counter'), 'utf8')).toBe('1');
    expect(readFileSync(result.logPath, 'utf8')).toBe('passing line\n'.repeat(2000));
    expect(statSync(result.logPath).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(result.logPath)).mode & 0o777).toBe(0o700);
  });
  test('existing or symlink log refuses before command effects', () => {
    writeFileSync(path('reserved'), 'keep');
    symlinkSync(path('reserved'), path('symlink'));
    for (const log of [path('reserved'), path('symlink')]) {
      const result = invoke(['check', '--log', log, '--', node, '-e', 'require("fs").writeFileSync("must-not-exist", "bad")']);
      expect(result.status).toBe(2);
      expect(existsSync(path('must-not-exist'))).toBe(false);
      expect(readFileSync(path('reserved'), 'utf8')).toBe('keep');
    }
  });
  test('invalid options fail before effects and do not echo arguments', () => {
    const secret = 'not-for-diagnostics-secret';
    const result = invoke(['check', '--timeout-ms', 'NaN', '--', node, '-e', secret]);
    expect(result.status).toBe(2);
    expect(result.stderr.toString()).not.toContain(secret);
    expect(invoke(['check', '--timeout-ms', '0', '--', node, '-e', '']).status).toBe(2);
    expect(invoke(['check', '--log', path('a'), '--log', path('b'), '--', node, '-e', '']).status).toBe(2);
  });
  test('native signals and missing executable retain failure semantics', async () => {
    const signalled = await captureCommand({ argv: [node, '-e', 'process.kill(process.pid,"SIGTERM")'], logPath: path('signal.log') });
    expect(signalled.code).toBe(143);
    const missing = await check({ argv: ['system-one-does-not-exist-fixture'], logPath: path('missing.log') });
    expect(missing.code).toBe(127);
    expect(missing.rendered.text).toContain('reason=spawn_error');
    expect(missing.rendered.text).not.toContain('does-not-exist');
  });
  test('timeout kills owned process group and retains available evidence', async () => {
    const result = await check({ argv: ['sh', '-c', 'echo started; (sleep 0.3; echo escaped > escaped) & wait'], cwd: scratch, timeoutMs: 80, logPath: path('timeout.log') });
    expect(result.code).toBe(124);
    expect(result.rendered.text).toContain('reason=timeout');
    expect(result.rendered.text).toContain('started');
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(existsSync(path('escaped'))).toBe(false);
  });
  test('cancellation forwards TERM and INT so ready children can clean up', async () => {
    for (const requested of ['SIGTERM', 'SIGINT']) {
      const ready = path(`${requested}-ready`);
      const cleaned = path(`${requested}-cleaned`);
      const controller = new AbortController();
      const script = `const fs=require('fs');process.on(${JSON.stringify(requested)},()=>{fs.writeFileSync(${JSON.stringify(cleaned)},'cleaned');process.exit(0)});fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`;
      const pending = check({ argv: [node, '-e', script], signal: controller.signal, logPath: path(`${requested}.log`) });
      try { await waitForFile(ready); } finally { controller.abort(requested); }
      const result = await pending;
      expect(result.code).toBe(requested === 'SIGTERM' ? 143 : 130);
      expect(readFileSync(cleaned, 'utf8')).toBe('cleaned');
      expect(result.cleanupUncertain).toBe(false);
      expect(result.logIncomplete).toBe(false);
    }
  });
  test('a child ignoring TERM is escalated after the bounded cleanup grace', async () => {
    const ready = path('ignores-term-ready');
    const received = path('received-term');
    const controller = new AbortController();
    const script = `const fs=require('fs');process.on('SIGTERM',()=>fs.writeFileSync(${JSON.stringify(received)},'received'));fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`;
    const pending = check({ argv: [node, '-e', script], signal: controller.signal, logPath: path('ignores-term.log') });
    try { await waitForFile(ready); } catch (error) { controller.abort('SIGTERM'); await pending; throw error; }
    const started = Date.now();
    controller.abort('SIGTERM');
    const result = await pending;
    expect(result.code).toBe(143);
    expect(readFileSync(received, 'utf8')).toBe('received');
    expect(Date.now() - started).toBeLessThan(1000);
  });
  test('escaped descendant pipes cannot hang timeout; uncertainty is explicit', async () => {
    const pidFile = path('escaped-descendant.pid');
    const script = `const {spawn}=require('child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',1,2]});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(child.pid));child.unref();setInterval(()=>{},1000);`;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    // Give Node startup room and confirm the escaped process exists. The leader
    // then stays alive until timeout; the escaped process retains the pipes.
    const pending = check({ argv: [node, '-e', script], timeoutMs: 1000, logPath: path('escaped-descendant.log') });
    try {
      await waitForFile(pidFile);
      const result = await Promise.race([pending, new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error('inherited pipe wait exceeded bound')), 1800); })]);
      expect(result.code).toBe(124);
      expect(result.logIncomplete).toBe(true);
      expect(result.cleanupUncertain).toBe(true);
      expect(result.rendered.text).toContain('log_incomplete=true');
      expect(result.rendered.text).toContain('cleanup_uncertain=true');
      expect(Date.now() - started).toBeLessThan(1800);
      const escapedPid = Number(readFileSync(pidFile, 'utf8'));
      expect(() => process.kill(escapedPid, 0)).not.toThrow();
    } finally {
      clearTimeout(watchdog);
      if (existsSync(pidFile)) {
        const escapedPid = Number(readFileSync(pidFile, 'utf8'));
        // This unique fixture process runs indefinitely; only its test owns it.
        try { process.kill(-escapedPid, 'SIGKILL'); } catch {}
      }
      await pending;
    }
  });
  test('leader exit with inherited pipes fails after bounded drain even without timeout', async () => {
    const pidFile = path('escaped-no-timeout.pid');
    const script = `const {spawn}=require('child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',1,2]});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(child.pid));child.unref();`;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const pending = check({ argv: [node, '-e', script], timeoutMs: 10000, logPath: path('escaped-no-timeout.log') });
    try {
      const result = await Promise.race([pending, new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error('post-exit pipe drain exceeded bound')), 1000); })]);
      expect(result.code).toBe(125);
      expect(result.reason).toBe('drain_timeout');
      expect(result.rendered.text).toContain('cleanup_uncertain=true');
    } finally {
      clearTimeout(watchdog);
      if (existsSync(pidFile)) {
        const escapedPid = Number(readFileSync(pidFile, 'utf8'));
        try { process.kill(-escapedPid, 'SIGKILL'); } catch {}
      }
      await pending;
    }
  });
  test('disk cap kills with failure and clearly labels incomplete log', async () => {
    const result = await check({ argv: [node, '-e', 'process.stdout.write("x".repeat(8192));setInterval(()=>{},1000)'], maxLogBytes: 1024, logPath: path('capped.log') });
    expect(result.code).toBe(125);
    expect(statSync(result.logPath).size).toBe(1024);
    expect(result.rendered.text).toContain('reason=log_limit');
    expect(result.rendered.text).toContain('log_incomplete=true');
  });
  test('production 64 MiB cap is enforced while retaining bounded memory', async () => {
    const result = await check({ argv: [node, '-e', 'const b=Buffer.alloc(1024*1024,120);for(let n=0;n<65;n++)process.stdout.write(b);setInterval(()=>{},1000)'], logPath: path('production-cap.log') });
    expect(result.code).toBe(125);
    expect(statSync(result.logPath).size).toBe(MAX_LOG_BYTES);
    expect(result.raw.length).toBeLessThanOrEqual(CAPTURE_BYTES);
    expect(result.rendered.text).toContain('log_incomplete=true');
  });
  test('write failure fails closed without reporting a complete log', () => {
    const script = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';fs.writeSync=()=>{throw Error('simulated private disk error')};syncBuiltinESMExports();const {check}=await import(${JSON.stringify(new URL('../src/check.js', import.meta.url).href)});const r=await check({argv:[process.execPath,'-e','process.stdout.write("test output");setInterval(()=>{},1000)'],logPath:${JSON.stringify(path('io-failure.log'))}});console.log(JSON.stringify({code:r.code,text:r.rendered.text}));`;
    const proc = spawnSync(node, ['--input-type=module', '-e', script], { cwd: scratch, timeout: 10000, encoding: 'utf8' });
    expect(proc.status).toBe(0);
    const result = JSON.parse(proc.stdout);
    expect(result.code).toBe(125);
    expect(result.text).toContain('reason=log_error');
    expect(result.text).toContain('log_incomplete=true');
    expect(result.text).not.toContain('simulated private disk error');
  });
  test('bounded memory retains final UTF8 suffix while full log keeps early evidence', async () => {
    const result = await check({ argv: [node, '-e', 'process.stdout.write("FAIL early evidence\\n"+"é😀\\n".repeat(50000)+"final diagnostic\\n");process.exitCode=4'], logPath: path('large.log') });
    expect(result.code).toBe(4);
    expect(result.raw.length).toBeLessThanOrEqual(CAPTURE_BYTES);
    expect(result.captureTruncated).toBe(true);
    expect(result.rendered.text).toContain('capture_truncated=true');
    expect(result.rendered.text).toContain('final diagnostic');
    expect(result.rendered.text).not.toContain('\ufffd');
    expect(readFileSync(result.logPath, 'utf8')).toStartWith('FAIL early evidence\n');
    expect(statSync(result.logPath).size).toBe(result.outputBytes);
  });
  test('early failures survive long stdout and stderr with exact omissions', async () => {
    for (const stream of ['stdout', 'stderr']) {
      const first = 'FAIL early evidence é😀\nExpected: 17\nReceived: 12\n';
      const tail = 'passed unrelated check\n'.repeat(18000) + 'final diagnostic\n';
      // Build the noisy body in the child: Linux limits each argv entry to
      // about 128 KiB, independent of the process's total argument budget.
      const script = `process.${stream}.write(${JSON.stringify(first)} + "passed unrelated check\\n".repeat(18000) + "final diagnostic\\n");process.exitCode=7`;
      const result = await check({ argv: [node, '-e', script], logPath: path(`early-${stream}.log`) });
      expect(result.code).toBe(7);
      expect(result.rendered.text).toContain(first);
      expect(result.rendered.text).toContain('\n[…]\n');
      expect(result.rendered.text).toContain('final diagnostic');
      expect(result.rendered.text).not.toContain('\ufffd');
      expect(result.raw.length).toBeLessThanOrEqual(CAPTURE_BYTES);
      expect(result.diagnostics!.reduce((n, r) => n + r.bytes.length, 0)).toBeLessThanOrEqual(DIAGNOSTIC_BYTES);
      expect(readFileSync(result.logPath, 'utf8')).toBe(first + tail);
      // Each diagnostic also retains two following lines; Expected/Received
      // extend that context to the first two passing lines.
      const retained = Buffer.byteLength(first + 'passed unrelated check\n'.repeat(2) + 'passed unrelated check\n'.repeat(23) + 'final diagnostic\n');
      expect(result.rendered.omittedBytes).toBe(Buffer.byteLength(first + tail) - retained);
    }
  });
  test('long successful output does not surface a diagnostic-looking early line', async () => {
    const script = 'process.stdout.write("FAIL mentioned only as fixture data\\n"+"passed check\\n".repeat(30000)+"all passed\\n")';
    const result = await check({ argv: [node, '-e', script], logPath: path('success-diagnostics.log') });
    expect(result.code).toBe(0);
    expect(result.rendered.text).not.toContain('FAIL mentioned');
    expect(result.rendered.text).toContain('all passed');
  });
  test('CLI compact stdout equals the pure reducer with no wrapper', () => {
    const text = 'passing checks\n'.repeat(1200);
    const log = path('cli-equal.log');
    const result = invoke(['check', '--log', log, '--', node, '-e', 'process.stdout.write("passing checks\\n".repeat(1200))']);
    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toBe(reduceOutput({ text, code: 0, logPath: log }).text);
  });
  test('explicit installer is idempotent and preserves local changes', () => {
    expect(invoke(['install-skills']).status).toBe(2);
    const target = path('installed skills');
    expect(invoke(['install-skills', '--target', target]).status).toBe(0);
    expect(invoke(['install-skills', '--target', target]).status).toBe(0);
    const names = readdirSync(target);
    expect(names).toEqual(['system-one-verify']);
    const file = join(target, names[0]!, 'SKILL.md');
    writeFileSync(file, 'local edit');
    expect(invoke(['install-skills', '--target', target]).status).toBe(2);
    expect(readFileSync(file, 'utf8')).toBe('local edit');
  });
});
