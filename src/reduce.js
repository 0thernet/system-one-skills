import { isUtf8 } from 'node:buffer';

/** The reducer is also the replay boundary: it never starts a process. */
export const MIN_COMPACT_BYTES = 8192;
export const MIN_SAVED_BYTES = 4096;
const EXCERPT_BYTES = 4096;

/** @param {string} line */
export function isDiagnosticLine(line) {
  return /^\s*(?:not ok\b|FAIL(?:ED)?\b|error\b|AssertionError\b|Expected\b|Received\b|panic\b|✗|×|\d+\)\s)/i.test(line.replace(/\x1b\[[0-9;:]*m/g, ''));
}

/**
 * @typedef {{text:string, raw?:Buffer, code:number, logPath:string, outputBytes?:number,
 * captureTruncated?:boolean, logIncomplete?:boolean, cleanupUncertain?:boolean,
 * diagnostics?:Array<{start:number,bytes:Buffer}>,
 * reason?:'timeout'|'log_limit'|'log_error'|'spawn_error'|'cancelled'|'drain_timeout'}} ReduceInput
 */

/**
 * Keep short logs verbatim. Long logs use one deduplicated excerpt only when
 * its complete presentation saves at least 4 KiB and half of the source bytes.
 * A resource failure must always be disclosed, even when disclosure is longer.
 * raw carries the original captured bytes when text decoding is lossy. Without
 * it, text must be an exact UTF8 suffix for source-byte offsets to be meaningful.
 * @param {ReduceInput} input
 */
export function reduceOutput(input) {
  const { text, code, logPath, captureTruncated = false, reason } = input;
  const sourceBytes = input.outputBytes ?? input.raw?.length ?? Buffer.byteLength(text);
  let bytes = input.raw ?? Buffer.from(text);
  if (input.raw && captureTruncated) {
    let start = 0;
    while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
    bytes = bytes.subarray(start);
  }
  const textStart = Math.max(0, sourceBytes - bytes.length);
  const textEnd = textStart + bytes.length;
  /** @type {string[]} */
  const lines = [];
  const offsets = [textStart];
  for (let start = 0; start < bytes.length;) {
    const newline = bytes.indexOf(10, start);
    const end = newline < 0 ? bytes.length : newline + 1;
    lines.push(bytes.toString('utf8', start, end));
    offsets.push(textStart + end);
    start = end;
  }
  /** @type {Array<{start:number,end:number}>} */
  const selected = [];
  let diagnosticBytes = 0;
  /** @type {Array<{start:number,bytes:Buffer}>} */
  const sources = [{ start: textStart, bytes }];
  if (code !== 0) {
    let matched = 0;
    for (let i = 0; i < lines.length && matched < 12 && diagnosticBytes < EXCERPT_BYTES / 2; i++) {
      if (isDiagnosticLine(lines[i] ?? '')) {
        matched++;
        // A giant preceding line must not consume the entire diagnostic budget.
        let start = Math.max(offsets[Math.max(0, i - 2)] ?? 0, (offsets[i] ?? 0) - Math.min(512, Math.floor((EXCERPT_BYTES / 2 - diagnosticBytes) / 4)), selected.at(-1)?.end ?? 0);
        while (start < textEnd && ((bytes[start - textStart] ?? 0) & 0xc0) === 0x80) start++;
        let end = Math.min(offsets[Math.min(lines.length, i + 3)] ?? textEnd, start + EXCERPT_BYTES / 2 - diagnosticBytes);
        while (end > start && ((bytes[end - textStart] ?? 0) & 0xc0) === 0x80) end--;
        if (end > start) { selected.push({ start, end }); diagnosticBytes += end - start; }
      }
    }
  }
  const tailLines = code === 0 ? 12 : 24;
  const tailBytes = code === 0 ? 1024 : selected.length ? EXCERPT_BYTES / 2 : EXCERPT_BYTES;
  let tailStart = Math.max(offsets[Math.max(0, lines.length - tailLines)] ?? textStart, textEnd - tailBytes);
  while (tailStart < textEnd && ((bytes[tailStart - textStart] ?? 0) & 0xc0) === 0x80) tailStart++;
  if (tailStart < textEnd) selected.push({ start: tailStart, end: textEnd });
  // Early evidence has its own 2 KiB budget. Select the baseline suffix first
  // so adding it cannot displace any existing diagnosis or shrink the tail.
  // The combined excerpt retains at most 6 KiB of source bytes before merging.
  let sampledBytes = 0;
  if (code !== 0) for (const range of input.diagnostics ?? []) {
    // Only add diagnostics that begin outside the suffix, preserving the
    // original full-capture behavior. Select the whole range across a cutoff,
    // but source overlapping bytes from the suffix exactly once.
    if (range.start >= textStart || sampledBytes >= EXCERPT_BYTES / 2) continue;
    let end = Math.min(range.bytes.length, EXCERPT_BYTES / 2 - sampledBytes);
    while (end > 0 && end < range.bytes.length && ((range.bytes[end] ?? 0) & 0xc0) === 0x80) end--;
    const sample = range.bytes.subarray(0, end);
    if (!sample.length) continue;
    sources.push({ start: range.start, bytes: sample.subarray(0, textStart - range.start) });
    selected.push({ start: range.start, end: range.start + sample.length });
    sampledBytes += sample.length;
  }
  /** @type {Array<{start:number,end:number}>} */
  const merged = [];
  for (const range of selected.sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  sources.sort((a, b) => a.start - b.start);
  let textLossy = false;
  const excerpt = merged.map(range => {
    const fragment = Buffer.concat(sources.flatMap(source => {
      const start = Math.max(range.start, source.start);
      const end = Math.min(range.end, source.start + source.bytes.length);
      return end > start ? [source.bytes.subarray(start - source.start, end - source.start)] : [];
    }));
    if (!isUtf8(fragment)) textLossy = true;
    return fragment.toString('utf8');
  }).join('\n[…]\n');
  // Gap markers are presentation, not retained source evidence.
  const retainedBytes = Math.min(sourceBytes, merged.reduce((sum, range) => sum + range.end - range.start, 0));
  const omittedBytes = Math.max(0, sourceBytes - retainedBytes);
  const header = `exit=${code} bytes=${sourceBytes} omitted=${omittedBytes}${reason ? ` reason=${reason}` : ''}${captureTruncated ? ' capture_truncated=true' : ''}${input.logIncomplete || reason === 'log_limit' || reason === 'log_error' ? ' log_incomplete=true' : ''}${input.cleanupUncertain ? ' cleanup_uncertain=true' : ''}${textLossy ? ' text_lossy=true' : ''}\n`;
  const candidate = header + excerpt + (excerpt && !excerpt.endsWith('\n') ? '\n' : '') + `log=${JSON.stringify(logPath)}\n`;
  const candidateBytes = Buffer.byteLength(candidate);
  const compacted = Boolean(reason || captureTruncated || input.logIncomplete || input.cleanupUncertain || (sourceBytes >= MIN_COMPACT_BYTES && candidateBytes <= sourceBytes / 2 && sourceBytes - candidateBytes >= MIN_SAVED_BYTES));
  return {
    text: compacted ? candidate : text,
    compacted,
    sourceBytes,
    outputBytes: compacted ? candidateBytes : input.raw?.length ?? Buffer.byteLength(text),
    omittedBytes: compacted ? omittedBytes : 0,
  };
}
