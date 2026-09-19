/** The text-only reducer is also the replay boundary: it never starts a process. */
export const MIN_COMPACT_BYTES = 8192;
export const MIN_SAVED_BYTES = 4096;
const EXCERPT_BYTES = 4096;

/**
 * @typedef {{text:string, code:number, logPath:string, outputBytes?:number,
 * captureTruncated?:boolean, logIncomplete?:boolean, cleanupUncertain?:boolean,
 * reason?:'timeout'|'log_limit'|'log_error'|'spawn_error'|'cancelled'|'drain_timeout'}} ReduceInput
 */

/**
 * Keep short logs verbatim. Long logs use one deduplicated excerpt only when
 * its complete presentation saves at least 4 KiB and half of the source bytes.
 * A resource failure must always be disclosed, even when disclosure is longer.
 * @param {ReduceInput} input
 */
export function reduceOutput(input) {
  const { text, code, logPath, captureTruncated = false, reason } = input;
  const sourceBytes = input.outputBytes ?? Buffer.byteLength(text);
  const bytes = Buffer.from(text);
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const offsets = [0];
  for (const line of lines) offsets.push((offsets.at(-1) ?? 0) + Buffer.byteLength(line));
  /** @type {Array<{start:number,end:number}>} */
  const selected = [];
  let diagnosticBytes = 0;
  if (code !== 0) {
    let matched = 0;
    for (let i = 0; i < lines.length && matched < 12 && diagnosticBytes < EXCERPT_BYTES / 2; i++) {
      const diagnosticLine = (lines[i] ?? '').replace(/\x1b\[[0-9;:]*m/g, '');
      if (/^\s*(?:not ok\b|FAIL(?:ED)?\b|error\b|AssertionError\b|Expected\b|Received\b|panic\b|✗|×|\d+\)\s)/i.test(diagnosticLine)) {
        matched++;
        // A giant preceding line must not consume the entire diagnostic budget.
        let start = Math.max(offsets[Math.max(0, i - 2)] ?? 0, (offsets[i] ?? 0) - Math.min(512, Math.floor((EXCERPT_BYTES / 2 - diagnosticBytes) / 4)), selected.at(-1)?.end ?? 0);
        while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
        let end = Math.min(offsets[Math.min(lines.length, i + 3)] ?? bytes.length, start + EXCERPT_BYTES / 2 - diagnosticBytes);
        while (end > start && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
        if (end > start) { selected.push({ start, end }); diagnosticBytes += end - start; }
      }
    }
  }
  const tailLines = code === 0 ? 12 : 24;
  const tailBytes = code === 0 ? 1024 : selected.length ? EXCERPT_BYTES / 2 : EXCERPT_BYTES;
  let tailStart = Math.max(offsets[Math.max(0, lines.length - tailLines)] ?? 0, bytes.length - tailBytes);
  while (tailStart < bytes.length && ((bytes[tailStart] ?? 0) & 0xc0) === 0x80) tailStart++;
  if (tailStart < bytes.length) selected.push({ start: tailStart, end: bytes.length });
  /** @type {Array<{start:number,end:number}>} */
  const merged = [];
  for (const range of selected.sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  const excerpt = merged.map(range => bytes.subarray(range.start, range.end).toString('utf8')).join('\n[…]\n');
  // Gap markers are presentation, not retained source evidence.
  const retainedBytes = Math.min(sourceBytes, merged.reduce((sum, range) => sum + range.end - range.start, 0));
  const omittedBytes = Math.max(0, sourceBytes - retainedBytes);
  const header = `exit=${code} bytes=${sourceBytes} omitted=${omittedBytes}${reason ? ` reason=${reason}` : ''}${captureTruncated ? ' capture_truncated=true' : ''}${input.logIncomplete || reason === 'log_limit' || reason === 'log_error' ? ' log_incomplete=true' : ''}${input.cleanupUncertain ? ' cleanup_uncertain=true' : ''}\n`;
  const candidate = header + excerpt + (excerpt && !excerpt.endsWith('\n') ? '\n' : '') + `log=${JSON.stringify(logPath)}\n`;
  const candidateBytes = Buffer.byteLength(candidate);
  const compacted = Boolean(reason || captureTruncated || input.logIncomplete || input.cleanupUncertain || (sourceBytes >= MIN_COMPACT_BYTES && candidateBytes <= sourceBytes / 2 && sourceBytes - candidateBytes >= MIN_SAVED_BYTES));
  return {
    text: compacted ? candidate : text,
    compacted,
    sourceBytes,
    outputBytes: compacted ? candidateBytes : Buffer.byteLength(text),
    omittedBytes: compacted ? omittedBytes : 0,
  };
}
