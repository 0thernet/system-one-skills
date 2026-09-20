import assert from "node:assert/strict";
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stageHistoricalEvidence, verifyHistoricalArchive } from "../research/validate-history.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archive = "research/history/v0.4.0";
const manifest = JSON.parse(readFileSync(join(repository, archive, "manifest.json"), "utf8"));

function fixture(body) {
  const root = mkdtempSync(join(tmpdir(), "system-one-history-test-"));
  const copy = (relative) => {
    const source = join(repository, relative);
    const target = join(root, relative);
    if (lstatSync(source).isDirectory()) {
      mkdirSync(target, { recursive: true });
      for (const name of readdirSync(source)) copy(`${relative}/${name}`);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(source));
    }
  };
  try {
    copy(archive);
    for (const path of manifest.retained_artifacts) copy(path);
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("historical closure stages exact original bytes and excludes live runtime changes", () => fixture((root) => {
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/reduce.js"), "current candidate is deliberately different");
  writeFileSync(join(root, "src/new-runtime.js"), "current files cannot enter historical evaluation");
  assert.deepEqual(verifyHistoricalArchive(root), {
    sourceCommit: "49c9ba49212f465c6a7d6054208bed7f39e9b813", files: 54, retainedArtifacts: 21,
  });
  const staged = stageHistoricalEvidence(root);
  try {
    assert.equal(lstatSync(staged.root).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(join(staged.root, "src")).sort(), ["check.js", "process.js", "reduce.js"]);
    for (const entry of manifest.files) {
      assert(readFileSync(join(staged.root, entry.path)).equals(
        readFileSync(join(root, archive, "files", entry.file)),
      ), entry.path);
    }
    assert.equal(JSON.parse(readFileSync(join(staged.root, "package.json"), "utf8")).version, "0.4.0");
  } finally {
    staged.cleanup();
  }
  assert.throws(() => lstatSync(staged.root), { code: "ENOENT" });
}));

test("historical public report mutation fails even while archive is unchanged", () => fixture((root) => {
  writeFileSync(join(root, "research/holdout-report.json"), "{}\n");
  assert.throws(() => verifyHistoricalArchive(root), /Retained historical artifact changed/);
}));

test("historical source mutation fails without rewriting old report hashes", () => fixture((root) => {
  const entry = manifest.files.find((row) => row.path === "src/reduce.js");
  const path = join(root, archive, "files", entry.file);
  const bytes = readFileSync(path);
  bytes[0] ^= 1;
  writeFileSync(path, bytes);
  assert.throws(() => stageHistoricalEvidence(root), /Historical archive content changed/);
}));

test("historical manifest edits cannot rebind a report or introduce traversal", () => fixture((root) => {
  const changed = structuredClone(manifest);
  changed.files[0].path = "../outside";
  writeFileSync(join(root, archive, "manifest.json"), `${JSON.stringify(changed, null, 2)}\n`);
  assert.throws(() => verifyHistoricalArchive(root), /Historical manifest changed/);
}));

test("missing or extra historical entries are rejected", () => fixture((root) => {
  const path = join(root, archive, "files", manifest.files[0].file);
  const saved = readFileSync(path);
  rmSync(path);
  assert.throws(() => verifyHistoricalArchive(root), /missing or extra files/);
  writeFileSync(path, saved);
  writeFileSync(join(root, archive, "files", "private-input.source"), "not part of the public evidence");
  assert.throws(() => verifyHistoricalArchive(root), /missing or extra files/);
}));

test("archive file and retained-report symlinks cannot substitute bytes", () => fixture((root) => {
  const path = join(root, archive, "files", manifest.files[0].file);
  const saved = readFileSync(path);
  const target = join(root, "outside-copy");
  writeFileSync(target, saved);
  rmSync(path);
  symlinkSync(target, path);
  assert.throws(() => verifyHistoricalArchive(root), /Historical archive entry is unsafe/);
  rmSync(path);
  writeFileSync(path, saved);
  const report = join(root, "research/holdout-report.json");
  writeFileSync(target, readFileSync(report));
  rmSync(report);
  symlinkSync(target, report);
  assert.throws(() => verifyHistoricalArchive(root), /Historical path is a symlink/);
}));

test("extra files at archive root and missing public reports fail closed", () => fixture((root) => {
  const extra = join(root, archive, "unreviewed.json");
  writeFileSync(extra, "{}");
  assert.throws(() => verifyHistoricalArchive(root));
  rmSync(extra);
  rmSync(join(root, "research/diagnosis-retry-tools-report.json"));
  assert.throws(() => verifyHistoricalArchive(root), { code: "ENOENT" });
}));
