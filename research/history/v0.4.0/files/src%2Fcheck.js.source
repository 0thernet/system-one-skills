import { captureCommand } from './process.js';
import { reduceOutput } from './reduce.js';

/** @param {import('./process.js').CaptureOptions} options */
export async function check(options) {
  const captured = await captureCommand(options);
  const rendered = reduceOutput(captured);
  return { ...captured, rendered, stdout: rendered.compacted ? Buffer.from(rendered.text) : captured.raw };
}
