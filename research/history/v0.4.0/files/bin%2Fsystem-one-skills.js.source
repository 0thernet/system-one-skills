#!/usr/bin/env node
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../src/check.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const help = 'system-one-skills check [--cwd PATH] [--timeout-ms N] [--log PATH] -- COMMAND ARG...\nsystem-one-skills install-skills --target PATH\n';

/** @param {string[]} args @param {string[]} allowed */
function flags(args, allowed) {
  /** @type {Record<string,string>} */
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key || !allowed.includes(key) || Object.hasOwn(out, key) || !value || value.startsWith('--')) throw new Error('invalid or duplicate option; use --help');
    out[key] = value;
  }
  return out;
}

/** @param {string} source @param {string} dest @returns {boolean} */
function identical(source, dest) {
  const a = lstatSync(source);
  const b = lstatSync(dest);
  if (a.isSymbolicLink() || b.isSymbolicLink()) return false;
  if (a.isFile() && b.isFile()) return readFileSync(source).equals(readFileSync(dest));
  if (!a.isDirectory() || !b.isDirectory()) return false;
  const names = readdirSync(source).sort();
  const others = readdirSync(dest).sort();
  return names.length === others.length && names.every((name, i) => name === others[i] && identical(join(source, name), join(dest, name)));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {
    if (args.length) throw new Error('unexpected argument');
    process.stdout.write(help);
    return;
  }
  if (command === '--version' || command === 'version') {
    if (args.length) throw new Error('unexpected argument');
    process.stdout.write(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version + '\n');
    return;
  }
  if (command === 'install-skills') {
    const options = flags(args, ['--target']);
    if (!options['--target']) throw new Error('install-skills requires --target PATH');
    const target = resolve(options['--target']);
    const skills = join(root, 'skills');
    const names = readdirSync(skills).filter(name => lstatSync(join(skills, name)).isDirectory());
    for (const name of names) {
      const dest = join(target, name);
      let present = false;
      try { lstatSync(dest); present = true; } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
      if (present && !identical(join(skills, name), dest)) throw new Error('existing skill differs; preserve it and select an empty target');
    }
    mkdirSync(target, { recursive: true });
    for (const name of names) if (!existsSync(join(target, name))) cpSync(join(skills, name), join(target, name), { recursive: true, errorOnExist: true, force: false });
    process.stdout.write(`installed ${names.length} skill${names.length === 1 ? '' : 's'}\n`);
    return;
  }
  if (command !== 'check') throw new Error('unknown command; use --help');
  const separator = args.indexOf('--');
  if (separator < 0 || separator === args.length - 1) throw new Error('check requires -- COMMAND ARG...');
  const options = flags(args.slice(0, separator), ['--cwd', '--timeout-ms', '--log']);
  const timeoutMs = options['--timeout-ms'] === undefined ? 300000 : Number(options['--timeout-ms']);
  if (options['--timeout-ms'] !== undefined && !/^\d+$/.test(options['--timeout-ms'])) throw new Error('timeout-ms must be an integer from 1 to 900000');
  const controller = new AbortController();
  const interrupt = () => controller.abort('SIGINT');
  const terminate = () => controller.abort('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    const result = await check({ argv: args.slice(separator + 1), cwd: options['--cwd'], timeoutMs, logPath: options['--log'], signal: controller.signal });
    process.stdout.write(result.stdout);
    process.exitCode = result.code;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}

try { await main(); }
catch {
  // Do not echo shell arguments, environment values, or log contents on errors.
  process.stderr.write('system-one-skills: invalid options or unavailable private log/skill target; use --help\n');
  process.exitCode = 2;
}
