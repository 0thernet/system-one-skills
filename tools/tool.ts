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

async function webFetch(inputs: Record<string, unknown>) {
  const url = str(inputs.url);
  const maxBytes = int(inputs["max-bytes"], 16_000, 512, 128_000);
  if (!/^https?:\/\/[^\s]{1,2000}$/.test(url)) return { ok: false, error: "web.fetch.v1 requires an http(s) url" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "user-agent": "algal-skills/0.1 (+https://github.com/hraness/algal-skills)", accept: "text/*,application/json,application/xhtml+xml" },
    });
    const raw = await res.text();
    const ct = res.headers.get("content-type") ?? "";
    const isHtml = /html|xml/.test(ct);
    const body = isHtml ? htmlToText(raw) : raw;
    const { text, truncated } = clip(body, maxBytes);
    return { ok: res.ok, status: res.status, content_type: ct.slice(0, 80), text, truncated, source_bytes: Buffer.from(raw, "utf8").length };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${String(e).slice(0, 200)}` };
  } finally {
    clearTimeout(timer);
  }
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
  "check.run.v1": checkRun,
};

async function main() {
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
