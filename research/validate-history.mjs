#!/usr/bin/env node
// Historical integrity is distinct from admission of the current runtime.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE = "research/history/v0.4.0";
const MANIFEST_SHA256 = "251645655ecf1e88bcf4204974d3af8877b816054db95fb5ce67e044944065d4";
const SOURCE_COMMIT = "49c9ba49212f465c6a7d6054208bed7f39e9b813";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function keys(value, expected) {
  assert(value && typeof value === "object" && !Array.isArray(value), "Expected closed object");
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), "Unexpected manifest fields");
}

function safePath(path) {
  assert.equal(typeof path, "string");
  assert(path.length > 0 && path.length <= 256 && !path.includes("\\"), "Unsafe historical path");
  assert(path.split("/").every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== ".."), "Unsafe historical path");
  return path;
}

function regularFile(root, relative, maximumBytes) {
  const parts = safePath(relative).split("/");
  let path = root;
  for (let index = 0; index < parts.length; index++) {
    path = join(path, parts[index]);
    const metadata = lstatSync(path);
    assert(!metadata.isSymbolicLink(), `Historical path is a symlink: ${relative}`);
    if (index < parts.length - 1) assert(metadata.isDirectory(), `Historical parent is not a directory: ${relative}`);
    else {
      assert(metadata.isFile() && metadata.nlink === 1, `Historical file is not independent and regular: ${relative}`);
      assert(metadata.size <= maximumBytes, `Historical file exceeds bound: ${relative}`);
    }
  }
  return readFileSync(path);
}

function loadArchive(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const raw = regularFile(root, `${ARCHIVE}/manifest.json`, 32_768);
  assert.equal(sha256(raw), MANIFEST_SHA256, "Historical manifest changed");
  const manifest = JSON.parse(raw.toString("utf8"));
  keys(manifest, ["schema_version", "evidence_role", "source_commit", "source_tree", "files", "retained_artifacts"]);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.evidence_role, "immutable-historical-v0.4-evidence");
  assert.equal(manifest.source_commit, SOURCE_COMMIT);
  assert.match(manifest.source_tree, /^[a-f0-9]{40}$/);
  assert(Array.isArray(manifest.files) && manifest.files.length === 54);
  assert(Array.isArray(manifest.retained_artifacts) && manifest.retained_artifacts.length === 21);
  assert.deepEqual(readdirSync(join(root, ARCHIVE)).sort(), ["README.md", "files", "manifest.json"]);
  const archiveFiles = join(root, ARCHIVE, "files");
  const metadata = lstatSync(archiveFiles);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink(), "Historical archive directory is unsafe");
  assert.deepEqual(readdirSync(archiveFiles).sort(), manifest.files.map((entry) => entry.file).sort(), "Historical archive has missing or extra files");
  const bytes = new Map();
  for (const entry of manifest.files) {
    keys(entry, ["path", "file", "sha256", "bytes", "mode"]);
    safePath(entry.path);
    assert(!bytes.has(entry.path), "Duplicate historical source path");
    assert.equal(entry.file, `${encodeURIComponent(entry.path)}.source`);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= 524_288);
    assert(["100644", "100755"].includes(entry.mode));
    const file = join(archiveFiles, entry.file);
    const stat = lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, `Historical archive entry is unsafe: ${entry.path}`);
    assert.equal(stat.size, entry.bytes, `Historical archive size changed: ${entry.path}`);
    const contents = readFileSync(file);
    assert.equal(sha256(contents), entry.sha256, `Historical archive content changed: ${entry.path}`);
    bytes.set(entry.path, contents);
  }
  for (const path of manifest.retained_artifacts) {
    safePath(path);
    assert(bytes.has(path), "Retained artifact is outside historical closure");
    const contents = regularFile(root, path, 524_288);
    assert(contents.equals(bytes.get(path)), `Retained historical artifact changed: ${path}`);
  }
  return { manifest, bytes };
}

/** Verify immutable public history, without qualifying the current runtime. */
export function verifyHistoricalArchive(repositoryRoot = ROOT) {
  const { manifest } = loadArchive(repositoryRoot);
  return { sourceCommit: manifest.source_commit, files: manifest.files.length, retainedArtifacts: manifest.retained_artifacts.length };
}

/** Reconstruct only the explicit, verified public source/report closure. */
export function stageHistoricalEvidence(repositoryRoot = ROOT) {
  const { manifest, bytes } = loadArchive(repositoryRoot);
  const root = mkdtempSync(join(tmpdir(), "system-one-history-"));
  chmodSync(root, 0o700);
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  try {
    for (const entry of manifest.files) {
      const path = join(root, entry.path);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, bytes.get(entry.path), { flag: "wx", mode: entry.mode === "100755" ? 0o700 : 0o600 });
    }
    return { root, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

const historicalCommands = [
  ["synthetic-contract", "bun", ["-e", "import {benchmarkFingerprint} from './bench/source-fingerprint.ts'; const r=await Bun.file('./bench/report/bench-report.json').json(); if(r.source_fingerprint!==benchmarkFingerprint())throw new Error('Historical synthetic fingerprint mismatch');"]],
  ["transcript-admission", "bun", ["research/validate-admission.ts"]],
  ["portfolio-and-unused-cohort", "bun", ["research/validate-evidence.ts"]],
  ["runtime-measurement", "node", ["bench/measure-runtime.mjs", "--check"]],
  ["ci-pilot", "python3", ["research/ci_pilot.py", "--check"]],
  ["candidate-screen", "python3", ["research/candidate_screen.py", "--check"]],
  ["native-reporter", "python3", ["research/candidate_native.py", "--check"]],
  ["failure-replay", "python3", ["research/failure_assess.py", "--check"]],
  ["diagnosis-attempt", "python3", ["research/assess_diagnosis.py", "--check"]],
  ["diagnosis-retry", "python3", ["research/assess_diagnosis_retry.py", "--check"]],
  ["diagnosis-retry-tools", "python3", ["research/assess_diagnosis_retry.py", "--check", "--output", "research/diagnosis-retry-tools-report.json"]],
];

/** Run the original validators against their original bytes and report graph. */
export function validateHistoricalEvidence(repositoryRoot = ROOT) {
  const staged = stageHistoricalEvidence(repositoryRoot);
  try {
    for (const [name, command, args] of historicalCommands) {
      const result = spawnSync(command, args, {
        cwd: staged.root, encoding: "utf8", timeout: 30_000, maxBuffer: 262_144,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      });
      assert(!result.error && result.status === 0,
        `Historical ${name} failed: ${result.error ?? `${result.stdout ?? ""}\n${result.stderr ?? ""}`.slice(-1800)}`);
    }
    return { sourceCommit: SOURCE_COMMIT, integrityChecks: historicalCommands.length };
  } finally {
    staged.cleanup();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, "Historical validation accepts no input or override flags");
  const result = validateHistoricalEvidence();
  console.log(`Historical v0.4 evidence intact: ${result.integrityChecks} original integrity checks; no current-runtime efficacy claim.`);
}
