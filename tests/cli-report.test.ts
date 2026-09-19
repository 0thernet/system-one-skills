import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PKG } from "../src/run-program.ts";

test("CLI emits declared outputs, preserves failure, and saves replay receipt separately", () => {
  const dir = mkdtempSync(join(tmpdir(), "system-one-cli-"));
  try {
    const receipt = join(dir, "receipt.json");
    const r = Bun.spawnSync(["bun", join(PKG, "bin/system-one-skills.js"), "run", "test-sift", "--args", JSON.stringify({src:{cmd:"printf 'error: deliberate failure'; exit 7",cwd:dir}}), "--dir", join(dir,"store"), "--receipt", receipt], {cwd:dir});
    expect(r.exitCode).toBe(1);
    const report = JSON.parse(r.stdout.toString());
    expect(report.outputs.report.code).toBe(7);
    expect(report.outputs.verdict).toBeUndefined();
    expect(report.outputs.report.failures.join(" ")).toContain("deliberate failure");
    expect(report.effects).toBeUndefined();
    expect(report.cells).toBeUndefined();
    const full = JSON.parse(readFileSync(receipt,"utf8"));
    expect(full.digest).toBe(report.receipt_digest);
    expect(full.effects.length).toBeGreaterThan(0);
    const verify = Bun.spawnSync(["bun",join(PKG,"bin/system-one-skills.js"),"verify",receipt,join(PKG,"programs/test-sift.algal.json"),"--dir",join(dir,"store")],{cwd:dir});
    expect(verify.exitCode).toBe(0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("blocked decision outputs produce nonzero status", () => {
  const dir = mkdtempSync(join(tmpdir(),"system-one-blocked-"));
  try {
    const r=Bun.spawnSync(["bun",join(PKG,"bin/system-one-skills.js"),"run","diff-review","--args",JSON.stringify({src:{cwd:join(dir,"missing")}}),"--dir",join(dir,"store")],{cwd:dir});
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stdout.toString()).missing_outputs.length).toBeGreaterThan(0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("legacy CLI invokes renamed CLI", () => {
  const r = Bun.spawnSync(["bun", join(PKG,"bin/algal-skills.js"),"list"]);
  expect(r.exitCode).toBe(0);
  expect(JSON.parse(r.stdout.toString()).package).toBe("system-one-skills");
});

test("receipt collision and misspelled flags fail before executing a command", () => {
  const dir=mkdtempSync(join(tmpdir(),"system-one-preflight-"));
  try {
    const receipt=join(dir,"existing.json"); writeFileSync(receipt,"keep");
    const base=["bun",join(PKG,"bin/system-one-skills.js"),"run","test-sift","--args",JSON.stringify({src:{cmd:"touch executed",cwd:dir}}),"--dir",join(dir,"store")];
    expect(Bun.spawnSync([...base,"--receipt",receipt],{cwd:dir}).exitCode).not.toBe(0);
    expect(Bun.spawnSync([...base,"--arg","{}"],{cwd:dir}).exitCode).not.toBe(0);
    expect(existsSync(join(dir,"executed"))).toBe(false);
    expect(readFileSync(receipt,"utf8")).toBe("keep");
    expect(Bun.spawnSync(["bun",join(PKG,"bin/system-one-skills.js"),"install-skills","--target"],{cwd:dir}).exitCode).not.toBe(0);
    expect(existsSync(join(dir,".devin"))).toBe(false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
