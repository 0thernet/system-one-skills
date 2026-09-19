#!/usr/bin/env bun
// system-one-skills — package entry point.
//
//   system-one-skills list                                  list packaged programs
//   system-one-skills run <program> --args <json|@file>     run a program in-process
//                                                    [--dir store] [--executor spec]*
//   system-one-skills tools                                 print the resolved cmd:
//                                                    tool registry as JSON
//   system-one-skills evolve [flags...]                     habitat promotion driver
//   system-one-skills verify <receipt> <manifest>           replay a run bit-for-bit
//   system-one-skills install-skills [--target <dir>]       copy skills/ into a
//                                                    skill registry directory

import { closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { executorCapabilities, PROGRAMS_DIR, PKG, runProgram, verifyRun } from "../src/run-program.ts";
import { compactReport, reportFailed } from "../src/report.ts";

const SKILLS = join(PKG, "skills");

async function resolvedTools(): Promise<string> {
  const registry = JSON.parse(await readFile(join(PKG, "tools", "shell.tools.json"), "utf8"));
  const quoted = "'" + PKG.replaceAll("'", "'\\''") + "'";
  for (const entry of Object.values(registry) as Array<{exec:string}>) entry.exec = entry.exec.replaceAll("__PKG__", quoted);
  return JSON.stringify(registry, null, 1) + "\n";
}

async function list() {
  const rows: Array<Record<string, unknown>> = [];
  for (const f of readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith(".algal.json")).sort()) {
    const m = JSON.parse(await readFile(join(PROGRAMS_DIR, f), "utf8"));
    rows.push({
      id: f.replace(".algal.json", ""),
      key: m.key,
      agent_calls: m.budgets?.maxAgentCalls ?? "?",
      note: m.note ?? "",
    });
  }
  process.stdout.write(JSON.stringify({ package: "system-one-skills", programs: rows }, null, 1) + "\n");
}

async function readArgs(flag: string | undefined): Promise<Record<string, Record<string, import("@hraness/algal").JsonValue>>> {
  if (!flag) return {};
  const raw = flag.startsWith("@") ? await readFile(resolve(flag.slice(1)), "utf8") : flag;
  return JSON.parse(raw);
}

async function installSkills(targetFlag: string | undefined) {
  const target = targetFlag ? resolve(targetFlag) : join(process.cwd(), ".devin", "skills");
  if (!existsSync(SKILLS)) {
    process.stderr.write("system-one-skills: no skills/ directory in this package\n");
    process.exit(2);
  }
  for (const entry of readdirSync(SKILLS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dest = join(target, entry.name);
    mkdirSync(dest, { recursive: true });
    cpSync(join(SKILLS, entry.name), dest, { recursive: true });
    process.stdout.write(`installed ${entry.name} -> ${dest}\n`);
  }
}

function flags(rest: string[], allowed: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a?.startsWith("--") || !allowed.includes(a.slice(2))) throw new Error(`unknown argument ${a}`);
    if (a?.startsWith("--")) {
      if (out[a.slice(2)] && a !== "--executor") throw new Error(`duplicate argument ${a}`);
      if (a === "--full-receipt" || a === "--include-summary") { out[a.slice(2)] = ["true"]; continue; }
      const v = rest[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`missing value for ${a}`);
      (out[a.slice(2)] ??= []).push(v);
    }
  }
  return out;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "list":
    case undefined:
      await list();
      return;
    case "tools":
      process.stdout.write(await resolvedTools());
      return;
    case "capabilities":
      process.stdout.write(JSON.stringify(await executorCapabilities(), null, 1) + "\n");
      return;
    case "run": {
      const [program, ...restFlags] = rest;
      if (!program) {
        process.stderr.write("usage: system-one-skills run <program> --args <json|@file> [--dir d] [--executor spec]*\n");
        process.exit(2);
      }
      const f = flags(restFlags, ["args","dir","executor","responses","receipt","full-receipt","include-summary"]);
      if (f.responses && f.executor) throw new Error("use either --responses or --executor");
      const manifest = program.endsWith(".algal.json")
        ? resolve(program)
        : join(PROGRAMS_DIR, `${program}.algal.json`);
      if (!existsSync(manifest)) {
        process.stderr.write(`system-one-skills: unknown program "${program}" — see 'system-one-skills list'\n`);
        process.exit(2);
      }
      const args = await readArgs(f.args?.[0]);
      const receiptFd = f.receipt?.[0] ? openSync(resolve(f.receipt[0]), "wx", 0o600) : undefined;
      let receipt;
      try { receipt = await runProgram({
        manifestPath: manifest,
        args,
        dir: f.dir?.[0],
        executorSpecs: f.executor ?? (f.responses ? [`scripted:${f.responses[0]}`] : []),
      });
      if (receiptFd !== undefined) writeFileSync(receiptFd, JSON.stringify(receipt) + "\n");
      } finally { if (receiptFd !== undefined) closeSync(receiptFd); }
      const report = compactReport(receipt, JSON.parse(await readFile(manifest, "utf8")), Boolean(f["include-summary"]) || dirname(manifest) !== PROGRAMS_DIR);
      process.stdout.write(JSON.stringify(f["full-receipt"] ? receipt : report) + "\n");
      process.exitCode = reportFailed(report) ? 1 : 0;
      return;
    }
    case "evolve": {
      const r = Bun.spawnSync(["bun", join(PKG, "habitats", "evolve.ts"), ...rest], { stdio: ["inherit", "inherit", "inherit"] });
      process.exit(r.exitCode);
    }
    case "verify": {
      const [receiptFile, manifestFile] = rest;
      if (!receiptFile || !manifestFile) {
        process.stderr.write("usage: system-one-skills verify <receipt.json> <manifest.algal.json>\n");
        process.exit(2);
      }
      const report = await verifyRun(
        JSON.parse(await readFile(resolve(receiptFile), "utf8")),
        JSON.parse(await readFile(existsSync(resolve(manifestFile)) ? resolve(manifestFile) : join(PROGRAMS_DIR, `${manifestFile}.algal.json`), "utf8")),
        flags(rest.slice(2), ["dir"]).dir?.[0],
      );
      process.stdout.write(JSON.stringify(report, null, 1) + "\n");
      process.exit(report.ok ? 0 : 1);
    }
    case "install-skills": {
      await installSkills(flags(rest, ["target"]).target?.[0]);
      return;
    }
    default:
      process.stderr.write(`system-one-skills: unknown command "${cmd}"\n`);
      process.exit(2);
  }
}

await main();
