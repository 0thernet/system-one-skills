import { spawn } from 'node:child_process';
import { constants as osConstants, tmpdir } from 'node:os';
import { chmodSync, closeSync, mkdtempSync, openSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { isDiagnosticLine } from './reduce.js';

export const MAX_LOG_BYTES = 64 * 1024 * 1024;
export const CAPTURE_BYTES = 256 * 1024;
export const TERMINATION_GRACE_MS = 200;
export const PIPE_DRAIN_MS = 100;

export const DIAGNOSTIC_BYTES = 2048;
export const DIAGNOSTIC_LINES = 12;

/**
 * Keep the first failure lines and two following lines, independently of the
 * rolling tail. Both the incomplete line and all retained evidence are bounded.
 * Byte offsets refer to the same observed chunk order as the private full log.
 */
export function createDiagnosticCapture() {
  /** @type {Array<{start:number,bytes:Buffer}>} */
  const ranges = [];
  let prefix = Buffer.alloc(0);
  let lineBytes = 0;
  let offset = 0;
  let retained = 0;
  let lines = 0;
  let following = 0;
  const full = () => retained >= DIAGNOSTIC_BYTES || lines >= DIAGNOSTIC_LINES;
  const finishLine = () => {
    const decoder = new StringDecoder('utf8');
    const text = decoder.write(prefix); // A split final character is withheld.
    if (!full() && (isDiagnosticLine(text) || following > 0)) {
      following = isDiagnosticLine(text) ? 2 : following - 1;
      let end = Math.min(prefix.length, DIAGNOSTIC_BYTES - retained);
      while (end > 0 && end < prefix.length && ((prefix[end] ?? 0) & 0xc0) === 0x80) end--;
      const decoded = new StringDecoder('utf8').write(prefix.subarray(0, end));
      end = Math.min(end, Buffer.byteLength(decoded));
      if (end) { ranges.push({ start: offset, bytes: Buffer.from(prefix.subarray(0, end)) }); retained += end; lines++; }
    }
    offset += lineBytes;
    prefix = Buffer.alloc(0);
    lineBytes = 0;
  };
  return {
    /** @param {Buffer} chunk */
    push(chunk) {
      if (full()) return;
      let start = 0;
      while (start < chunk.length && !full()) {
        // Blank lines cannot begin a diagnosis. Skip a run without allocating
        // or decoding, unless those bytes are following-context evidence.
        if (!lineBytes && !following && chunk[start] === 10) {
          const blankStart = start;
          do { start++; } while (start < chunk.length && chunk[start] === 10);
          offset += start - blankStart;
          continue;
        }
        const newline = chunk.indexOf(10, start);
        const end = newline < 0 ? chunk.length : newline + 1;
        const keep = chunk.subarray(start, Math.min(end, start + DIAGNOSTIC_BYTES + 4 - prefix.length));
        if (keep.length) prefix = Buffer.concat([prefix, keep]);
        lineBytes += end - start;
        start = end;
        if (newline >= 0) finishLine();
      }
    },
    finish() { if (lineBytes && !full()) finishLine(); return ranges; },
    // Expose bounds for adversarial tests without exposing process state.
    get bufferedBytes() { return prefix.length + retained; },
  };
}


/**
 * @typedef {{argv:string[],cwd?:string,timeoutMs?:number,logPath?:string,
 * signal?:AbortSignal,maxLogBytes?:number}} CaptureOptions
 * @typedef {'timeout'|'log_limit'|'log_error'|'spawn_error'|'cancelled'|'drain_timeout'} FailureReason
 */

/**
 * Reserve a private log before any command side effect. Full output is written
 * once in observed pipe-chunk order; bounded memory retains its final suffix.
 * maxLogBytes is a programmatic test seam; the CLI always uses the 64 MiB cap.
 * @param {CaptureOptions} options
 */
export async function captureCommand(options) {
  const { argv, cwd, timeoutMs = 300000, signal } = options;
  if (!argv.length || !argv[0]) throw new Error('a command is required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900000) throw new Error('timeout-ms must be an integer from 1 to 900000');
  const maxLogBytes = options.maxLogBytes ?? MAX_LOG_BYTES;
  if (!Number.isSafeInteger(maxLogBytes) || maxLogBytes < 1 || maxLogBytes > MAX_LOG_BYTES) throw new Error('invalid log size bound');
  let logPath;
  if (options.logPath) logPath = resolve(options.logPath);
  else {
    const dir = mkdtempSync(join(tmpdir(), 'system-one-'));
    chmodSync(dir, 0o700);
    logPath = join(dir, 'check.log');
  }
  const fd = openSync(logPath, 'wx', 0o600);
  /** @type {Buffer} */
  let captured = Buffer.alloc(0);
  let outputBytes = 0;
  const diagnosticCapture = createDiagnosticCapture();
  let loggedBytes = 0;
  /** @type {FailureReason | undefined} */
  let reason;
  let logIncomplete = false;
  let logWriteFailed = false;
  let cleanupUncertain = false;
  let closed = false;
  const closeLog = () => { if (!closed) { closed = true; closeSync(fd); } };
  if (signal?.aborted) {
    closeLog();
    return { code: signal.reason === 'SIGTERM' ? 143 : 130, reason: /** @type {FailureReason} */ ('cancelled'), logPath, raw: captured, text: '', outputBytes, loggedBytes, captureTruncated: false, logIncomplete, cleanupUncertain };
  }
  /** @type {import('node:child_process').ChildProcess} */
  let child;
  try {
    child = spawn(argv[0], argv.slice(1), { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  } catch {
    closeLog();
    return { code: 127, reason: /** @type {FailureReason} */ ('spawn_error'), logPath, raw: captured, text: '', outputBytes, loggedBytes, captureTruncated: false, logIncomplete, cleanupUncertain };
  }
  let leaderExited = false;
  let settled = false;
  let stopping = false;
  let observedExit = 1;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let escalationTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let drainTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let stopTimer;
  /** @type {(value:number)=>void} */
  let resolveExit;
  const completion = new Promise(/** @param {(value:number)=>void} done */ (done) => { resolveExit = done; });
  /** @param {NodeJS.Signals} requested */
  const signalOwned = (requested) => {
    // Never signal a saved PGID after the leader was reaped: it can be recycled.
    if (leaderExited || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, requested);
      else child.kill(requested);
    } catch { /* Bounded drain below reports uncertainty if the pipes stay open. */ }
  };
  /** @param {number} code */
  const finish = (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearTimeout(escalationTimer);
    clearTimeout(drainTimer);
    clearTimeout(stopTimer);
    child.stdout?.removeListener('data', consume);
    child.stderr?.removeListener('data', consume);
    resolveExit(code);
  };
  const cutDrain = () => {
    if (settled) return;
    reason ??= 'drain_timeout';
    logIncomplete = true;
    cleanupUncertain = true;
    // A detached descendant can inherit these pipes. Closing our readers bounds
    // the wait; it is not evidence that this escaped process has terminated.
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
    finish(observedExit);
  };
  /** @param {FailureReason} why @param {NodeJS.Signals} [requested] */
  const stop = (why, requested = 'SIGTERM') => {
    if (settled) return;
    reason ??= why;
    if (stopping) return;
    stopping = true;
    signalOwned(requested);
    const grace = requested === 'SIGKILL' || leaderExited ? 0 : TERMINATION_GRACE_MS;
    if (grace) escalationTimer = setTimeout(() => signalOwned('SIGKILL'), grace);
    stopTimer = setTimeout(cutDrain, grace + PIPE_DRAIN_MS);
  };
  const abort = () => stop('cancelled', signal?.reason === 'SIGTERM' ? 'SIGTERM' : 'SIGINT');
  const timer = setTimeout(() => stop('timeout'), timeoutMs);
  /** @param {Buffer} chunk */
  const consume = (chunk) => {
    if (settled) return;
    outputBytes += chunk.length;
    diagnosticCapture.push(chunk);
    captured = chunk.length >= CAPTURE_BYTES
      ? Buffer.from(chunk.subarray(chunk.length - CAPTURE_BYTES))
      : Buffer.concat([captured.subarray(Math.max(0, captured.length + chunk.length - CAPTURE_BYTES)), chunk]);
    if (logWriteFailed) return;
    const keep = chunk.subarray(0, Math.max(0, maxLogBytes - loggedBytes));
    try {
      let written = 0;
      while (written < keep.length) {
        const count = writeSync(fd, keep, written, keep.length - written);
        if (!count) throw new Error('log write made no progress');
        written += count;
        loggedBytes += count;
      }
    } catch { reason ??= 'log_error'; logWriteFailed = true; logIncomplete = true; stop('log_error', 'SIGKILL'); }
    if (chunk.length > keep.length && !logWriteFailed) { reason ??= 'log_limit'; logIncomplete = true; stop('log_limit', 'SIGKILL'); }
  };
  child.stdout?.on('data', consume);
  child.stderr?.on('data', consume);
  child.on('error', () => {
    if (settled) return;
    reason ??= 'spawn_error';
    if (!child.pid) finish(127);
    else stop('spawn_error', 'SIGKILL');
  });
  child.on('exit', (code, exitSignal) => {
    leaderExited = true;
    const signalNumber = exitSignal ? osConstants.signals[exitSignal] : undefined;
    observedExit = code ?? (signalNumber ? 128 + signalNumber : 1);
    clearTimeout(escalationTimer);
    if (!settled) drainTimer = setTimeout(cutDrain, PIPE_DRAIN_MS);
  });
  child.on('close', () => finish(observedExit));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const exit = await completion;
  signal?.removeEventListener('abort', abort);
  try { closeLog(); } catch { reason ??= 'log_error'; logIncomplete = true; }
  const captureTruncated = outputBytes > captured.length;
  let start = 0;
  if (captureTruncated) while (start < captured.length && ((captured[start] ?? 0) & 0xc0) === 0x80) start++;
  const text = captured.subarray(start).toString('utf8');
  const code = reason === 'timeout' ? 124 : reason === 'cancelled' ? (signal?.reason === 'SIGTERM' ? 143 : 130) : reason === 'spawn_error' ? 127 : reason ? 125 : exit;
  return { code, reason, logPath, raw: captured, text, outputBytes, loggedBytes, captureTruncated, logIncomplete, cleanupUncertain, diagnostics: diagnosticCapture.finish() };
}
