#!/usr/bin/env bun
// system-one-skills-tool — deterministic tool implementations behind the
// system-one-skills `cmd:` registry. Reads { inputs, requestDigest, idempotencyKey }
// on stdin and prints a JSON object of output ports on stdout.
//
// Fixed probes use argv arrays. Test/check workflows execute the caller's exact
// shell command with its existing authority. Captures are byte-bounded and
// failures return structured records.

import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { open, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const MAX_STDIN = 64 * 1024;
const DEFAULT_TIMEOUT = 60_000;
const MAX_CMD_OUTPUT = 256 * 1024;
const signals = new AsyncLocalStorage<AbortSignal | undefined>();
export const withToolSignal = <T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> => signals.run(signal, fn);

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

type CommandResult = {
  code: number; stdout: string; stderr: string; combined: string; timedOut: boolean;
  stdoutBytes: number; stderrBytes: number; truncated: boolean;
};

function run(
  argv: string[],
  opts: { cwd?: string; timeoutMs?: number; maxBytes?: number; captureTail?: boolean } = {},
): Promise<CommandResult> {
  const maxBytes = opts.maxBytes ?? MAX_CMD_OUTPUT;
  return new Promise((res) => {
    if (signals.getStore()?.aborted) {
      res({ code: 124, stdout: "", stderr: "cancelled", combined: "", timedOut: true, stdoutBytes: 0, stderrBytes: 0, truncated: false });
      return;
    }
    const cmd = argv[0];
    if (!cmd) {
      res({ code: 2, stdout: "", stderr: "empty argv", combined: "", timedOut: false, stdoutBytes: 0, stderrBytes: 0, truncated: false });
      return;
    }
    const child: ChildProcess = spawn(cmd, argv.slice(1), {
      cwd: opts.cwd,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      // Kill the owned shell and descendants together when a command expires.
      detached: process.platform !== "win32",
    });
    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
    let combined: Buffer = Buffer.alloc(0);
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    const retain = (previous: Buffer, chunk: Buffer, limit: number): Buffer => {
      if (opts.captureTail) {
        if (chunk.length >= limit) return Buffer.from(chunk.subarray(chunk.length - limit));
        return Buffer.concat([previous.subarray(Math.max(0, previous.length + chunk.length - limit)), chunk]);
      }
      return previous.length >= limit ? previous : Buffer.concat([previous, chunk.subarray(0, limit - previous.length)]);
    };
    const result = (code: number): CommandResult => ({
      code: timedOut ? 124 : code, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"),
      combined: combined.toString("utf8"), timedOut, stdoutBytes, stderrBytes,
      truncated: stdoutBytes > maxBytes || stderrBytes > 8192 || stdoutBytes + stderrBytes > maxBytes,
    });
    const abort = () => {
      timedOut = true;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { child.kill("SIGKILL"); }
    };
    const signal = signals.getStore();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, opts.timeoutMs ?? DEFAULT_TIMEOUT);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      stdout = retain(stdout, chunk, maxBytes);
      combined = retain(combined, chunk, maxBytes);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      stderr = retain(stderr, chunk, 8192);
      combined = retain(combined, chunk, maxBytes);
    });
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      res({ ...result(127), stderr: String(error) });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      res(result(code ?? 1));
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
  return { text: new TextDecoder().decode(buf.subarray(0, maxBytes), { stream: true }), truncated: true };
}

function clipTail(s: string, maxBytes: number): string {
  const bytes = Buffer.from(s);
  if (bytes.length <= maxBytes) return s;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
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
  const st = await run(["git", "-C", cwd, "status", "--porcelain=v1", "--branch", "-z"]);
  if (st.code !== 0) {
    return { ok: false, error: tail(st.stderr || st.stdout, 6) || "git status failed" };
  }
  if (st.truncated) return { ok: false, error: "git status exceeded the capture bound; counts would be incomplete", truncated: true };
  const lines = st.stdout.split("\0").filter(Boolean);
  const head = lines[0] ?? "## ";
  const branch = head.replace(/^## (?:No commits yet on |Initial commit on )?/, "").split("...")[0]?.split(" [")[0] ?? "?";
  const abM = /ahead (\d+).*behind (\d+)|ahead (\d+)|behind (\d+)/.exec(head);
  const files: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const entry = lines[i]!;
    files.push(entry);
    if (/^[RC]|^.[RC]/.test(entry)) i++; // -z rename/copy has a second pathname.
  }
  const staged = files.filter((l) => l[0] !== " " && l[0] !== "?").length;
  const unstaged = files.filter((l) => l[1] === "M" || l[1] === "D" || l[1] === "T").length;
  const untracked = files.filter((l) => l.startsWith("??")).length;
  const unmerged = files.filter((l) => ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(l.slice(0, 2))).length;
  const log = await run(["git", "-C", cwd, "log", `-${maxRecent}`, "--pretty=%h %s (%cr)"]);
  const stat = await run(["git", "-C", cwd, "diff", "--stat", "HEAD"], { maxBytes: 16384 });
  const stash = await run(["git", "-C", cwd, "stash", "list"]);
  return {
    ok: true,
    branch,
    ahead: abM ? Number(abM[1] ?? abM[3] ?? 0) : 0,
    behind: abM ? Number(abM[2] ?? abM[4] ?? 0) : 0,
    staged,
    unstaged,
    untracked,
    unmerged,
    recent: log.code === 0 ? log.stdout.split("\n").filter(Boolean) : [],
    stat: clip(tail(stat.stdout, 40), 12000).text,
    stat_truncated: stat.truncated || stat.stdout.split("\n").length > 40 || Buffer.byteLength(tail(stat.stdout, 40)) > 12000,
    stash_count: stash.code === 0 && !stash.truncated ? stash.stdout.split("\n").filter(Boolean).length : null,
    truncated: log.truncated || stat.truncated || stash.truncated || stat.stdout.split("\n").length > 40 || Buffer.byteLength(tail(stat.stdout, 40)) > 12000,
    warnings: [log.code !== 0 ? "history unavailable (possibly an unborn branch)" : "", stat.code !== 0 ? "HEAD diff unavailable" : "", stash.code !== 0 ? "stash count unavailable" : ""].filter(Boolean),
  };
}

// ------------------------------------------------------------- diff.read ---

async function diffRead(inputs: Record<string, unknown>) {
  const cwd = safeCwd(inputs.cwd);
  const maxBytes = int(inputs["max-bytes"], 24_000, 512, 128_000);
  const staged = inputs.staged === true;
  const args = ["-C", cwd, "diff", "--no-ext-diff", "--no-textconv", "--find-renames"];
  if (staged) args.push("--staged");
  const rev = str(inputs.rev);
  if (rev && (!/^[a-zA-Z0-9][a-zA-Z0-9._/~^{}:@-]{0,199}$/.test(rev))) {
    return { ok: false, error: "rev must be a revision or revision range, not a flag or path" };
  }
  if (rev) args.push(rev);
  args.push("--");
  const d = await run(["git", ...args], { maxBytes: maxBytes + 1024 });
  if (d.code !== 0) return { ok: false, error: tail(d.stderr, 6) || "git diff failed" };
  const stat = await run(["git", "-C", cwd, "diff", "--no-ext-diff", "--no-textconv", "--stat", ...(staged ? ["--staged"] : []), ...(rev ? [rev] : []), "--"], { maxBytes: 16384 });
  if (stat.code !== 0) return { ok: false, error: tail(stat.stderr, 6) || "git diff stat failed" };
  const { text, truncated } = clip(d.stdout, maxBytes);
  return { ok: true, stat: clip(tail(stat.stdout, 60), 12000).text, diff: text, truncated: d.truncated || truncated, stat_truncated: stat.truncated || stat.stdout.split("\n").length > 60 || Buffer.byteLength(tail(stat.stdout, 60)) > 12000, bytes: d.stdoutBytes };

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
  const cmd = str(inputs.cmd);
  const timeoutMs = int(inputs["timeout-ms"], 300_000, 1000, 900_000);
  if (!cmd.trim()) return { ok: false, error: "test.run.v1 requires cmd" };
  if (Buffer.byteLength(cmd) > 16384) return { ok: false, error: "cmd exceeds 16 KiB; refusing to execute a truncated command" };
  const r = await run(["sh", "-c", cmd], { cwd, timeoutMs, maxBytes: MAX_CMD_OUTPUT, captureTail: true });
  const out = r.combined;
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
    tail: clipTail(tail(out, 30), 12000),
    tail_truncated: Buffer.byteLength(tail(out, 30)) > 12000,
    output_bytes: r.stdoutBytes + r.stderrBytes,
    output_truncated: r.truncated,
    retained_bytes: Buffer.byteLength(out),
  };
}

// -------------------------------------------------------------- ci.status --

async function ciStatus(inputs: Record<string, unknown>) {
  const cwd = safeCwd(inputs.cwd);
  const waitMs = int(inputs["wait-ms"], 0, 0, 60_000);
  if (waitMs > 0) await sleep(waitMs, undefined, { signal: signals.getStore() });
  const runId = str(inputs["run-id"]);
  if (inputs["run-id"] === "") return { ok: false, done: "stop", status: "none", error: "no run was selected by the initial probe", run_id: "" };
  if (runId && !/^\d+$/.test(runId)) return { ok: false, done: "stop", error: "run-id must be numeric", run_id: "" };
  const fields = "databaseId,status,conclusion,url,headSha,displayTitle";
  let argv: string[];
  if (runId) argv = ["gh", "run", "view", runId, "--json", fields];
  else {
    const head = await run(["git", "rev-parse", "--verify", "HEAD"], { cwd });
    if (head.code !== 0) return { ok: false, done: "stop", error: "cannot resolve current HEAD for CI", run_id: "" };
    argv = ["gh", "run", "list", "--commit", head.stdout.trim(), "--limit", "1", "--json", fields];
  }
  const r = await run(argv, { cwd, timeoutMs: 30_000 });
  if (r.code !== 0) return { ok: false, done: "stop", error: tail(r.stderr, 6) || "gh run query failed", run_id: runId };
  let latest: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(r.stdout);
    latest = runId ? parsed : Array.isArray(parsed) ? parsed[0] : undefined;
    if (latest && (typeof latest !== "object" || typeof latest.status !== "string" || latest.databaseId === undefined)) throw new Error("shape");
  } catch {
    return { ok: false, done: "stop", error: "gh returned invalid JSON", run_id: runId };
  }
  if (!latest) return { ok: false, done: "stop", status: "none", error: "no CI run for current HEAD", run_id: "" };
  return {
    ok: true, done: latest.status === "completed" ? "stop" : "continue",
    status: str(latest.status, "unknown"), conclusion: str(latest.conclusion), url: str(latest.url),
    run_id: String(latest.databaseId), head_sha: str(latest.headSha), title: str(latest.displayTitle).slice(0, 120),
  };
}

// ------------------------------------------------------------ repo.survey --

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target",
  ".next", ".nuxt", ".cache", ".turbo", "coverage", "__pycache__", ".venv",
  "venv", ".idea", ".vscode-test", "vendor", "pods", ".algal", ".system-one", ".morphogen",
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
  try { if (!(await stat(root)).isDirectory()) return { ok: false, error: "cwd is not a directory" }; }
  catch { return { ok: false, error: "cwd does not exist or is unreadable" }; }
  const maxEntries = int(inputs["max-entries"], 400, 16, 4000);
  const maxReadme = int(inputs["readme-bytes"], 3000, 256, 16000);
  const dirs: string[] = [];
  const manifests: string[] = [];
  const keyFiles: string[] = [];
  let files = 0;
  let visited = 0;
  let truncated = false;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated) return;
    if (depth > 6) { truncated = true; return; }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      truncated = true;
      return;
    }
    for (const e of entries) {
      if (visited++ >= maxEntries) {
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
  let readmeTruncated = false;
  for (const name of ["README.md", "readme.md", "README.txt", "README"]){
    try {
      const p = join(root, name);
      const s = await stat(p);
      if (s.isFile()) {
        const handle = await open(p, "r");
        try {
          const bytes = Buffer.alloc(maxReadme + 1);
          const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
          const readme = clip(bytes.subarray(0, bytesRead).toString("utf8"), maxReadme);
          readmeHead = readme.text;
          readmeTruncated = s.size > maxReadme;
        } finally { await handle.close(); }
        break;
      }
    } catch {
      /* no readme at this name */
    }
  }
  return { ok: true, dirs: dirs.slice(0, 80), manifests: manifests.slice(0, 40), key_files: keyFiles, file_count: files, readme_head: readmeHead, readme_truncated: readmeTruncated, truncated: truncated || dirs.length > 80 || manifests.length > 40 };
}

// ----------------------------------------------------------- search.slice --

async function searchSlice(inputs: Record<string, unknown>) {
  const cwd = safeCwd(inputs.cwd);
  const pattern = str(inputs.pattern);
  const maxMatches = int(inputs["max-matches"], 24, 1, 100);
  const ctxLines = int(inputs["context-lines"], 0, 0, 5);
  const glob = str(inputs.glob);
  if (!pattern) return { ok: false, error: "search.slice.v1 requires pattern" };
  if (Buffer.byteLength(pattern) > 4096 || Buffer.byteLength(glob) > 1024) {
    return { ok: false, error: "pattern or glob exceeds its bound; refusing to change query semantics" };
  }
  // JSON records distinguish match/context/separator lines and preserve colon/newline paths.
  // An extra match per file lets us report truncation even in a single large file.
  const argv = ["rg", "--json", "--color=never", `-m${maxMatches + 1}`];
  if (ctxLines > 0) argv.push(`-C${ctxLines}`);
  if (glob) argv.push("-g", glob);
  argv.push("-e", pattern, "--", ".");
  const r = await run(argv, { cwd, timeoutMs: 30_000, maxBytes: 512_000 });
  if (r.code === 127) return { ok: false, error: "ripgrep (rg) is required; a fallback with different ignore/regex semantics is not safe" };
  if (r.code > 1 || r.timedOut) return { ok: false, error: tail(r.stderr, 6) || "rg failed" };
  type Match = { file: string; line: number; text: string; text_truncated: boolean; context?: Array<{ line: number; text: string; text_truncated: boolean }> };
  const matches: Match[] = [];
  const contexts: Array<{ file: string; line: number; text: string; text_truncated: boolean }> = [];
  let truncated = r.truncated;
  const decode = (value: { text?: string; bytes?: string } | undefined): string => value?.text ?? (value?.bytes ? Buffer.from(value.bytes, "base64").toString("utf8") : "");
  for (const line of r.stdout.split("\n").filter(Boolean)) {
    let record;
    try { record = JSON.parse(line); }
    catch { truncated = true; continue; }
    if (record.type !== "match" && record.type !== "context") continue;
    const data = record.data;
    const file = decode(data.path).replace(/^\.\//, "");
    const bounded = clip(decode(data.lines).trimEnd(), 400);
    if (record.type === "context") {
      if (contexts.length < 1200) contexts.push({ file, line: data.line_number, text: bounded.text, text_truncated: bounded.truncated });
      else truncated = true;
    } else if (matches.length < maxMatches) {
      matches.push({ file, line: data.line_number, text: bounded.text, text_truncated: bounded.truncated });
    } else truncated = true;
  }
  if (ctxLines) for (const match of matches) {
    match.context = contexts.filter((ctx) => ctx.file === match.file && Math.abs(ctx.line - match.line) <= ctxLines)
      .map(({ line, text, text_truncated }) => ({ line, text, text_truncated }));
  }
  while (Buffer.byteLength(JSON.stringify(matches)) > 28000) { matches.pop(); truncated = true; }
  return { ok: true, engine: "rg", matches, total: matches.length, truncated };
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
      signal: signals.getStore() ? AbortSignal.any([ctl.signal, signals.getStore()!]) : ctl.signal,
      redirect: "follow",
      headers: { "user-agent": "system-one-skills/0.3 (+https://github.com/0thernet/system-one-skills)", accept: "text/*,application/json,application/xhtml+xml" },
    });
    const raw = await boundedResponseText(res, Math.min(512_000, maxBytes * 8));
    const ct = res.headers.get("content-type") ?? "";
    if (ct && !/^(?:text\/|application\/(?:json|[^;]+\+json|xml|xhtml\+xml))/i.test(ct)) return { ok: false, status: res.status, content_type: ct.slice(0, 80), error: "unsupported non-text content type" };
    const isHtml = /html|xml/.test(ct);
    const body = isHtml ? htmlToText(raw.text) : raw.text;
    const clipped = clip(body, maxBytes);
    return { ok: res.ok, url: res.url || url, status: res.status, content_type: ct.slice(0, 80), text: clipped.text, truncated: raw.truncated || clipped.truncated, source_bytes: raw.bytes, source_truncated: raw.truncated };
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
      const text = boundedRaw.text; // Inline evidence is literal text; angle brackets may be code or mathematics.
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
      const canonicalRoot = await realpath(root);
      const canonicalPath = await realpath(path);
      if (canonicalPath !== canonicalRoot && !canonicalPath.startsWith(canonicalRoot + sep)) return { ok: false, error: "path symlink escapes cwd" };
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
    .map((sentence, index) => ({ sentence: index + 1, words: sentenceWords[index] ?? 0, text: sentence.slice(0, 180) }))
    .filter((sentence) => sentence.words > 30)
    .slice(0, 12);
  const claimLike = sentences.filter((sentence) => /\b\d+(?:\.\d+)?%?\b|\b(?:always|never|best|worst|only|proven)\b/i.test(sentence));
  const uncitedClaims = claimLike.filter((sentence) => !/https?:\/\/|\[[^\]]+\]\([^)]+\)|\[[0-9]+\]/.test(sentence));
  return {
    ok: true,
    source,
    ...(inputs["include-text"] === true ? { text } : {}),
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
  const commands = ["test", "lint", "typecheck", "build"].map((name) => str(inputs[`cmd-${name}`]));
  if (!commands.some((cmd) => cmd.trim())) return { ok: false, passed: false, error: "no gate commands supplied", stages: [], failed_stage: "" };
  if (commands.some((cmd) => Buffer.byteLength(cmd) > 16384)) return { ok: false, passed: false, error: "gate command exceeds 16 KiB; refusing to truncate it", stages: [], failed_stage: "" };
  const stages: Array<{ name: string; code: number; skipped: boolean; tail: string; output_truncated?: boolean; tail_truncated?: boolean }> = [];
  for (const name of ["test", "lint", "typecheck", "build"] as const) {
    const cmd = str(inputs[`cmd-${name}`]);
    if (!cmd.trim()) {
      stages.push({ name, code: 0, skipped: true, tail: "" });
      continue;
    }
    const r = await run(["sh", "-c", cmd], { cwd, timeoutMs, maxBytes: MAX_CMD_OUTPUT, captureTail: true });
    stages.push({
      name,
      code: r.timedOut ? 124 : r.code,
      skipped: false,
      tail: clipTail(tail(r.combined, 20), 8000),
      tail_truncated: Buffer.byteLength(tail(r.combined, 20)) > 8000,
      output_truncated: r.truncated,
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
    process.stderr.write(`system-one-skills-tool: unknown tool "${name ?? ""}"; expected one of ${Object.keys(TOOLS).join(", ")}\n`);
    process.exit(2);
  }
  const raw = await readStdin();
  let payload: { inputs?: Record<string, unknown> };
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write("system-one-skills-tool: stdin is not JSON\n");
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
