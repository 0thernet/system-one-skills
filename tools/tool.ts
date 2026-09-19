#!/usr/bin/env bun
// algal-skills-tool — deterministic tool implementations behind the
// algal-skills `cmd:` registry. Reads { inputs, requestDigest, idempotencyKey }
// on stdin and prints a JSON object of output ports on stdout.
//
// Every implementation is reviewed code, not model output: commands are
// fixed argv arrays (no string concatenation into shells), outputs are
// byte-bounded, and failures return structured records instead of throwing.

import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const MAX_STDIN = 64 * 1024;
const DEFAULT_TIMEOUT = 60_000;
const MAX_CMD_OUTPUT = 256 * 1024;

// ---------------------------------------------------------------- helpers --

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const chunk of process.stdin) {
    n += chunk.length;
    if (n > MAX_STDIN) throw new Error("stdin exceeds 64 KiB bound");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function run(
  argv: string[],
  opts: { cwd?: string; timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const maxBytes = opts.maxBytes ?? MAX_CMD_OUTPUT;
  return new Promise((res) => {
    const cmd = argv[0];
    if (!cmd) {
      res({ code: 2, stdout: "", stderr: "empty argv", timedOut: false });
      return;
    }
    const child: ChildProcess = spawn(cmd, argv.slice(1), {
      cwd: opts.cwd,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT);
    child.stdout?.on("data", (d: { toString(e: string): string }) => {
      if (stdout.length < maxBytes) stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: { toString(e: string): string }) => {
      if (stderr.length < 8192) stderr += d.toString("utf8");
    });
    child.on("error", (e: Error) => {
      clearTimeout(timer);
      res({ code: 127, stdout, stderr: String(e), timedOut });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      res({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

function tail(s: string, maxLines: number): string {
  const lines = s.split("\n");
  return lines.slice(-maxLines).join("\n").trim();
}

function clip(s: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= maxBytes) return { text: s, truncated: false };
  return { text: buf.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

function safeCwd(u: unknown): string {
  const cwd = typeof u === "string" && u.trim() ? resolve(u) : process.cwd();
  return cwd;
}

function str(u: unknown, d = ""): string {
  return typeof u === "string" ? u : d;
}

function int(u: unknown, d: number, lo: number, hi: number): number {
  const n = typeof u === "number" && Number.isFinite(u) ? Math.floor(u) : d;
  return Math.min(hi, Math.max(lo, n));
}

// ------------------------------------------------------------- git.digest --

async function gitDigest(inputs: Record<string, unknown>) {
  const cwd = safeCwd(inputs.cwd);
  const maxRecent = int(inputs["max-recent"], 8, 1, 32);
  const st = await run(["git", "-C", cwd, "status", "--porcelain=v1", "--branch"]);
  if (st.code !== 0) {
    return { ok: false, error: tail(st.stderr || st.stdout, 6) || "git status failed" };
  }
  const lines = st.stdout.split("\n").filter(Boolean);
  const head = lines[0] ?? "## ";
  const branchM = /^## ([^.\s]+)/.exec(head);
  const abM = /ahead (\d+).*behind (\d+)|ahead (\d+)|behind (\d+)/.exec(head);
  const files = lines.slice(1);
  const staged = files.filter((l) => l[0] !== " " && l[0] !== "?").length;
  const unstaged = files.filter((l) => l[1] === "M" || l[1] === "D" || l[1] === "T").length;
  const untracked = files.filter((l) => l.startsWith("??")).length;
  const log = await run(["git", "-C", cwd, "log", `-${maxRecent}`, "--pretty=%h %s (%cr)"]);
  const stat = await run(["git", "-C", cwd, "diff", "--stat", "HEAD"], { maxBytes: 16384 });
  const stash = await run(["git", "-C", cwd, "stash", "list"]);
  return {
    ok: true,
    branch: branchM?.[1] ?? "?",
    ahead: abM ? Number(abM[1] ?? abM[3] ?? 0) : 0,
    behind: abM ? Number(abM[2] ?? abM[4] ?? 0) : 0,
    staged,
    unstaged,
    untracked,
    recent: log.code === 0 ? log.stdout.split("\n").filter(Boolean) : [],
    stat: tail(stat.stdout, 40),
    stash_count: stash.code === 0 ? stash.stdout.split("\n").filter(Boolean).length : 0,
  };
}

// ------------------------------------------------------------- diff.read ---

async function diffRead(inputs: Record<string, unknown>) {
  const cwd = safeCwd(inputs.cwd);
  const maxBytes = int(inputs["max-bytes"], 24_000, 512, 128_000);
  const staged = inputs.staged === true;
  const args = ["-C", cwd, "diff", "--find-renames"];
  if (staged) args.push("--staged");
  const rev = str(inputs.rev);
  if (rev && /^[a-zA-Z0-9._/-]{1,80}$/.test(rev)) args.push(rev);
  const d = await run(["git", ...args], { maxBytes: maxBytes + 1024 });
  if (d.code !== 0) return { ok: false, error: tail(d.stderr, 6) || "git diff failed" };
  const stat = await run(["git", "-C", cwd, "diff", "--stat", ...(staged ? ["--staged"] : []), ...(rev ? [rev] : [])], {
    maxBytes: 16384,
  });
  const { text, truncated } = clip(d.stdout, maxBytes);
  return { ok: true, stat: tail(stat.stdout, 60), diff: text, truncated, bytes: Buffer.from(d.stdout, "utf8").length };
}

// -------------------------------------------------------------- test.run ---

const FAIL_PATTERNS = [
  /^\s*(?:not ok|FAIL|FAILED|✗|×|\[FAILED\]|failing)\b.*$/gim,
  /^\s*\d+\)\s+.+$/gm,
  /^\s*(?:error|Error|ERROR|panic|thread '.+' panicked)\b.*$/gm,
  /^\s*(?:AssertionError|expect\(.+\)|Expected|Received:).+$/gm,
];

const CATEGORY_RULES: Array<[string, RegExp]> = [
  ["build", /error TS\d+|cannot find module|compilation failed|build failed|error: linking|cargo build|SyntaxError/i],
  ["lint", /eslint|biome|prettier|clippy|lint .*error|warning: unused/i],
  ["type", /typecheck|type error|error TS\d+|tsc --noEmit|mypy/i],
  ["test", /\d+ (?:tests? )?(?:fail|passed)|assertion|expected .* got|not ok \d+|panicked at/i],
];

async function testRun(inputs: Record<string, unknown>) {
  const cwd = safeCwd(inputs.cwd);
  const cmd = str(inputs.cmd).slice(0, 400);
  const timeoutMs = int(inputs["timeout-ms"], 300_000, 1000, 900_000);
  if (!cmd) return { ok: false, error: "test.run.v1 requires cmd" };
  const r = await run(["sh", "-c", cmd], { cwd, timeoutMs, maxBytes: MAX_CMD_OUTPUT });
  const out = `${r.stdout}\n${r.stderr}`;
  const failures = new Set<string>();
  for (const pat of FAIL_PATTERNS) {
    pat.lastIndex = 0;
    for (const m of out.matchAll(pat)) {
      if (failures.size < 40) failures.add(m[0].trim().slice(0, 240));
    }
  }
  let category = "pass";
  if (r.timedOut) category = "timeout";
  else if (r.code !== 0) {
    category = "other";
    for (const [name, rule] of CATEGORY_RULES) {
      if (rule.test(out)) {
        category = name;
        break;
      }
    }
  }
  return {
    ok: true,
    code: r.code,
    timed_out: r.timedOut,
    category,
    failures: [...failures],
    tail: tail(out, 30),
    output_bytes: Buffer.from(out, "utf8").length,
  };
}

// -------------------------------------------------------------- ci.status --

async function ciStatus(inputs: Record<string, unknown>) {
  const cwd = safeCwd(inputs.cwd);
  const waitMs = int(inputs["wait-ms"], 0, 0, 60_000);
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  const r = await run(
    ["gh", "run", "list", "--limit", "1", "--json", "databaseId,status,conclusion,url,headSha,displayTitle"],
    { cwd, timeoutMs: 30_000 },
  );
  if (r.code !== 0) return { ok: false, error: tail(r.stderr, 6) || "gh run list failed" };
  let list: Array<Record<string, unknown>>;
  try {
    list = JSON.parse(r.stdout);
  } catch {
    return { ok: false, error: "gh returned unparseable JSON" };
  }
  const latest = list[0];
  if (!latest) return { ok: true, status: "none", conclusion: "", url: "", run_id: "" };
  return {
    ok: true,
    status: str(latest.status, "unknown"),
    conclusion: str(latest.conclusion),
    url: str(latest.url),
    run_id: str(latest.databaseId) || String(latest.databaseId ?? ""),
    head_sha: str(latest.headSha).slice(0, 12),
    title: str(latest.displayTitle).slice(0, 120),
  };
}

// ------------------------------------------------------------ repo.survey --

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target",
  ".next", ".nuxt", ".cache", ".turbo", "coverage", "__pycache__", ".venv",
  "venv", ".idea", ".vscode-test", "vendor", "Pods", ".algal", ".morphogen",
]);

const MANIFEST_NAMES = new Set([
  "package.json", "cargo.toml", "pyproject.toml", "go.mod", "pom.xml",
  "build.gradle", "build.gradle.kts", "composer.json", "gemfile", "pubspec.yaml",
  "deno.json", "deno.jsonc", "bunfig.toml", "cmakelists.txt", "makefile",
  "justfile", "taskfile.yml", "dockerfile", "docker-compose.yml", "compose.yml",
  "agents.md", "claude.md", "security.md", "license", "license.md",
]);

async function repoSurvey(inputs: Record<string, unknown>) {
  const root = safeCwd(inputs.cwd);
  const maxEntries = int(inputs["max-entries"], 400, 16, 4000);
  const maxReadme = int(inputs["readme-bytes"], 3000, 256, 16000);
  const dirs: string[] = [];
  const manifests: string[] = [];
  const keyFiles: string[] = [];
  let files = 0;
  let truncated = false;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated || depth > 6) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files + dirs.length >= maxEntries) {
        truncated = true;
        return;
      }
      const rel = join(dir, e.name).slice(root.length + 1);
      if (e.name.startsWith(".") && e.name !== ".github") continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
        if (depth <= 2) dirs.push(rel + "/");
        await walk(join(dir, e.name), depth + 1);
      } else {
        files++;
        const low = e.name.toLowerCase();
        if (MANIFEST_NAMES.has(low)) manifests.push(rel);
        else if (/\.(ts|tsx|rs|py|go|java|kt|swift|c|cpp|rb|ex|exs|scala|sql)$/i.test(e.name) && keyFiles.length < 60 && depth <= 3) {
          keyFiles.push(rel);
        }
      }
    }
  };
  await walk(root, 0);
  let readmeHead = "";
  for (const name of ["README.md", "readme.md", "README.txt", "README"]){
    try {
      const p = join(root, name);
      const s = await stat(p);
      if (s.isFile()) {
        readmeHead = (await readFile(p, "utf8")).slice(0, maxReadme);
        break;
      }
    } catch {
      /* no readme at this name */
    }
  }
  return { ok: true, dirs: dirs.slice(0, 80), manifests: manifests.slice(0, 40), key_files: keyFiles, file_count: files, readme_head: readmeHead, truncated };
}

// ----------------------------------------------------------- search.slice --

function globToRe(glob: string): RegExp | null {
  if (!glob) return null;
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") { re += ".*"; i++; }
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") re += "(?:";
    else if (c === "}") re += ")";
    else if (c === ",") re += "|";
    else if (c !== undefined) re += c.replace(/[.+^$[\]()\\|]/g, "\\$&");
  }
  try {
    return new RegExp(glob.includes("/") ? `^${re}$` : `(^|/)${re}$`);
  } catch {
    return null;
  }
}

async function jsGrep(
  root: string,
  re: RegExp,
  globRe: RegExp | null,
  maxMatches: number,
  ctxLines: number,
): Promise<{ matches: Array<Record<string, unknown>>; scanned: number; truncated: boolean }> {
  const matches: Array<Record<string, unknown>> = [];
  let scanned = 0;
  let truncated = false;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated || depth > 6 || scanned > 8000) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (truncated) return;
      const full = join(dir, e.name);
      const rel = full.slice(root.length + 1);
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && !SKIP_DIRS.has(e.name.toLowerCase())) await walk(full, depth + 1);
        continue;
      }
      if (e.name.startsWith(".")) continue;
      if (globRe && !globRe.test(rel) && !globRe.test(e.name)) continue;
      scanned++;
      let text: string;
      try {
        const s = await stat(full);
        if (s.size > 512 * 1024) continue;
        text = await readFile(full, "utf8");
      } catch {
        continue;
      }
      if (text.includes("\u0000")) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= maxMatches) { truncated = true; return; }
        const line = lines[i] ?? "";
        if (re.test(line)) {
          const ctx: string[] = [];
          for (let k = 1; k <= ctxLines; k++) {
            if (i - k >= 0) ctx.unshift(lines[i - k] ?? "");
            if (i + k < lines.length) ctx.push(lines[i + k] ?? "");
          }
          matches.push({ file: rel, line: i + 1, text: line.trim().slice(0, 200), ...(ctxLines ? { context: ctx.map((l) => l.trim().slice(0, 160)) } : {}) });
        }
      }
    }
  };
  await walk(root, 0);
  return { matches, scanned, truncated };
}

async function searchSlice(inputs: Record<string, unknown>) {
  const cwd = safeCwd(inputs.cwd);
  const pattern = str(inputs.pattern).slice(0, 200);
  const maxMatches = int(inputs["max-matches"], 24, 1, 100);
  const ctxLines = int(inputs["context-lines"], 0, 0, 5);
  const glob = str(inputs.glob).slice(0, 80);
  if (!pattern) return { ok: false, error: "search.slice.v1 requires pattern" };
  const argv = ["rg", "--line-number", "--no-heading", "--color=never", `-m${maxMatches}`];
  if (ctxLines > 0) argv.push(`-C${ctxLines}`);
  if (glob && /^[\w*?{}.[\]/!-]{1,80}$/.test(glob)) argv.push("-g", glob);
  argv.push("-e", pattern, "--", ".");
  const r = await run(argv, { cwd, timeoutMs: 30_000, maxBytes: 64_000 });
  if (r.code === 127) {
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch {
      return { ok: false, error: "search.slice.v1 pattern is not a valid regex" };
    }
    const g = await jsGrep(cwd, re, globToRe(glob), maxMatches, ctxLines);
    return { ok: true, engine: "js", matches: g.matches, total: g.matches.length, scanned: g.scanned, truncated: g.truncated };
  }
  if (r.code > 1) return { ok: false, error: tail(r.stderr, 6) || "rg failed" };
  const matches = r.stdout
    .split("\n")
    .filter(Boolean)
    .slice(0, maxMatches)
    .map((line) => {
      const m = /^([^:]+):(\d+):(.*)$/.exec(line);
      return m ? { file: m[1], line: Number(m[2]), text: (m[3] ?? "").trim().slice(0, 200) } : { file: "?", line: 0, text: line.slice(0, 200) };
    });
  return { ok: true, matches, total: matches.length, truncated: r.stdout.split("\n").filter(Boolean).length > maxMatches };
}

// -------------------------------------------------------------- web.fetch --

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

async function boundedResponseText(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", bytes: 0, truncated: false };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    const remaining = maxBytes - bytes;
    if (remaining <= 0) {
      truncated = true;
      await reader.cancel();
      break;
    }
    const chunk = item.value.byteLength > remaining ? item.value.subarray(0, remaining) : item.value;
    chunks.push(chunk);
    bytes += chunk.byteLength;
    if (chunk.byteLength < item.value.byteLength) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(joined), bytes, truncated };
}

async function webFetch(inputs: Record<string, unknown>) {
  const url = str(inputs.url);
  const maxBytes = int(inputs["max-bytes"], 16_000, 512, 120_000);
  if (!/^https?:\/\/[^\s]{1,2000}$/.test(url)) return { ok: false, error: "web.fetch.v1 requires an http(s) url" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "user-agent": "algal-skills/0.2 (+https://github.com/0thernet/algal-skills)", accept: "text/*,application/json,application/xhtml+xml" },
    });
    const raw = await boundedResponseText(res, Math.min(512_000, maxBytes * 8));
    const ct = res.headers.get("content-type") ?? "";
    const isHtml = /html|xml/.test(ct);
    const body = isHtml ? htmlToText(raw.text) : raw.text;
    const clipped = clip(body, maxBytes);
    return { ok: res.ok, status: res.status, content_type: ct.slice(0, 80), text: clipped.text, truncated: raw.truncated || clipped.truncated, source_bytes: raw.bytes, source_truncated: raw.truncated };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${String(e).slice(0, 200)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function researchBundle(inputs: Record<string, unknown>) {
  const raw = inputs.sources;
  const maxSources = int(inputs["max-sources"], 8, 1, 12);
  const requestedBytes = int(inputs["max-bytes-per-source"], 8_000, 512, 16_000);
  const maxBytes = Math.min(requestedBytes, Math.floor(80_000 / maxSources));
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "research.bundle.v1 requires a non-empty sources array" };
  }
  const sources: Array<Record<string, unknown>> = [];
  for (const [index, item] of raw.slice(0, maxSources).entries()) {
    if (typeof item === "string") {
      const fetched = await webFetch({ url: item, "max-bytes": maxBytes });
      sources.push({ index, url: item.slice(0, 2000), ...fetched });
      continue;
    }
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      sources.push({ index, ok: false, error: "source must be a URL string or {url?, title?, text?}" });
      continue;
    }
    const source = item as Record<string, unknown>;
    if (Object.keys(source).some((key) => !["url", "title", "text"].includes(key))) {
      sources.push({ index, ok: false, error: "source contains unknown keys" });
      continue;
    }
    const url = str(source.url).slice(0, 2000);
    const title = str(source.title).slice(0, 160);
    if (typeof source.text === "string") {
      const rawText = source.text.replace(/\r\n/g, "\n").trim();
      const boundedRaw = clip(rawText, Math.min(128_000, maxBytes * 8));
      const text = /<[^>]+>/.test(boundedRaw.text) ? htmlToText(boundedRaw.text) : boundedRaw.text;
      const clipped = clip(text, maxBytes);
      sources.push({ index, ok: true, url, title, text: clipped.text, truncated: boundedRaw.truncated || clipped.truncated, source_bytes: Buffer.byteLength(rawText), source_truncated: boundedRaw.truncated });
    } else if (url) {
      const fetched = await webFetch({ url, "max-bytes": maxBytes });
      sources.push({ index, url, title, ...fetched });
    } else {
      sources.push({ index, ok: false, error: "source requires url or text" });
    }
  }
  const successes = sources.filter((source) => source.ok === true);
  return {
    ok: successes.length > 0,
    sources,
    source_count: sources.length,
    success_count: successes.length,
    error_count: sources.length - successes.length,
    truncated: raw.length > maxSources || sources.some((source) => source.truncated === true),
    text_bytes: successes.reduce((sum, source) => sum + Buffer.byteLength(str(source.text)), 0),
  };
}

function syllables(word: string): number {
  const groups = word.toLowerCase().replace(/[^a-z]/g, "").match(/[aeiouy]+/g)?.length ?? 1;
  return Math.max(1, groups - (/e$/.test(word) && groups > 1 ? 1 : 0));
}

async function writingAudit(inputs: Record<string, unknown>) {
  const maxBytes = int(inputs["max-bytes"], 64_000, 512, 128_000);
  let text = str(inputs.text);
  let source = "inline";
  if (!text && typeof inputs.path === "string") {
    const root = safeCwd(inputs.cwd);
    const path = resolve(root, inputs.path);
    if (path !== root && !path.startsWith(root + sep)) return { ok: false, error: "path escapes cwd" };
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > maxBytes * 2) return { ok: false, error: "file is not a bounded text file" };
      text = await readFile(path, "utf8");
      source = path.slice(root.length + 1) || ".";
    } catch (e) {
      return { ok: false, error: `read failed: ${String(e).slice(0, 160)}` };
    }
  }
  if (!text) return { ok: false, error: "writing.audit.v1 requires text or path" };
  const clipped = clip(text.replace(/\r\n/g, "\n"), maxBytes);
  text = clipped.text;
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? [];
  const sentences = text.split(/(?<=[.!?])\s+|\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const sentenceWords = sentences.map((sentence) => sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0);
  const totalSyllables = words.reduce((sum, word) => sum + syllables(word), 0);
  const wordCount = words.length;
  const sentenceCount = Math.max(1, sentences.length);
  const readingEase = wordCount
    ? Math.round((206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (totalSyllables / wordCount)) * 10) / 10
    : 0;
  const grams = new Map<string, number>();
  const lowered = words.map((word) => word.toLowerCase());
  for (let i = 0; i + 2 < lowered.length; i++) {
    const gram = lowered.slice(i, i + 3).join(" ");
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  const repeatedPhrases = [...grams.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([phrase, count]) => ({ phrase, count }));
  const longSentences = sentences
    .map((sentence, index) => ({ line: index + 1, words: sentenceWords[index] ?? 0, text: sentence.slice(0, 180) }))
    .filter((sentence) => sentence.words > 30)
    .slice(0, 12);
  const claimLike = sentences.filter((sentence) => /\b\d+(?:\.\d+)?%?\b|\b(?:always|never|best|worst|only|proven)\b/i.test(sentence));
  const uncitedClaims = claimLike.filter((sentence) => !/https?:\/\/|\[[^\]]+\]\([^)]+\)|\[[0-9]+\]/.test(sentence));
  return {
    ok: true,
    source,
    bytes: Buffer.byteLength(text),
    truncated: clipped.truncated,
    words: wordCount,
    sentences: sentences.length,
    paragraphs: text.split(/\n\s*\n/).filter((part) => part.trim()).length,
    headings: text.split("\n").filter((line) => /^#{1,6}\s+/.test(line)).length,
    links: (text.match(/https?:\/\/|\[[^\]]+\]\([^)]+\)/g) ?? []).length,
    average_sentence_words: Math.round((wordCount / sentenceCount) * 10) / 10,
    reading_ease_estimate: readingEase,
    long_sentences: longSentences,
    repeated_phrases: repeatedPhrases,
    placeholders: (text.match(/\b(?:TODO|TBD|FIXME|XXX)\b/g) ?? []).length,
    hedge_terms: (text.match(/\b(?:maybe|perhaps|possibly|somewhat|arguably|likely)\b/gi) ?? []).length,
    passive_markers: (text.match(/\b(?:is|are|was|were|be|been|being)\s+\w+(?:ed|en)\b/gi) ?? []).length,
    claim_like_sentences: claimLike.length,
    uncited_claims: uncitedClaims.slice(0, 12).map((sentence) => sentence.slice(0, 180)),
  };
}

// ------------------------------------------------------------- check.run ---

async function checkRun(inputs: Record<string, unknown>) {
  const cwd = safeCwd(inputs.cwd);
  const timeoutMs = int(inputs["timeout-ms"], 600_000, 1000, 1_200_000);
  const stages: Array<{ name: string; code: number; skipped: boolean; tail: string }> = [];
  for (const name of ["test", "lint", "typecheck", "build"] as const) {
    const cmd = str(inputs[`cmd-${name}`]).slice(0, 400);
    if (!cmd) {
      stages.push({ name, code: 0, skipped: true, tail: "" });
      continue;
    }
    const r = await run(["sh", "-c", cmd], { cwd, timeoutMs, maxBytes: MAX_CMD_OUTPUT });
    stages.push({
      name,
      code: r.timedOut ? 124 : r.code,
      skipped: false,
      tail: tail(`${r.stdout}\n${r.stderr}`, 20),
    });
  }
  const ok = stages.every((s) => s.code === 0);
  return { ok: true, stages, passed: ok, failed_stage: stages.find((s) => s.code !== 0)?.name ?? "" };
}

// --------------------------------------------------------------- dispatch --

export const TOOLS: Record<string, (i: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  "git.digest.v1": gitDigest,
  "diff.read.v1": diffRead,
  "test.run.v1": testRun,
  "ci.status.v1": ciStatus,
  "repo.survey.v1": repoSurvey,
  "search.slice.v1": searchSlice,
  "web.fetch.v1": webFetch,
  "research.bundle.v1": researchBundle,
  "writing.audit.v1": writingAudit,
  "check.run.v1": checkRun,
};

export async function main() {
  const name = process.argv[2];
  const impl = name ? TOOLS[name] : undefined;
  if (!impl) {
    process.stderr.write(`algal-skills-tool: unknown tool "${name ?? ""}"; expected one of ${Object.keys(TOOLS).join(", ")}\n`);
    process.exit(2);
  }
  const raw = await readStdin();
  let payload: { inputs?: Record<string, unknown> };
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write("algal-skills-tool: stdin is not JSON\n");
    process.exit(2);
  }
  try {
    const outputs = await impl(payload.inputs ?? {});
    process.stdout.write(JSON.stringify({ report: outputs }) + "\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({ report: { ok: false, error: `tool error: ${String(e).slice(0, 300)}` } }) + "\n");
  }
}

if (import.meta.main) {
  await main();
}
