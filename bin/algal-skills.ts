#!/usr/bin/env bun
// algal-skills — package entry point.
//
//   algal-skills list                                  list packaged programs
//   algal-skills run <program> --args <json|@file>     run a program in-process
//                                                    [--dir store] [--executor spec]*
//   algal-skills tools                                 print the resolved cmd:
//                                                    tool registry as JSON
//   algal-skills evolve [flags...]                     habitat promotion driver
//   algal-skills verify <receipt> <manifest>           replay a run bit-for-bit
//   algal-skills install-skills [--target <dir>]       copy skills/ into a
//                                                    skill registry directory

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { PROGRAMS_DIR, PKG, runProgram, verifyRun } from "../src/run-program.ts";

const SKILLS = join(PKG, "skills");

async function resolvedToolsFile(): Promise<string> {
  const raw = await readFile(join(PKG, "tools", "shell.tools.json"), "utf8");
  const resolved = raw.replaceAll("__PKG__", PKG);
  const name = `algal-skills-${createHash("sha256").update(PKG).digest("hex").slice(0, 12)}.tools.json`;
  const path = join(tmpdir(), name);
  writeFileSync(path, resolved);
  return path;
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
  process.stdout.write(JSON.stringify({ package: "algal-skills", programs: rows }, null, 1) + "\n");
}

async function readArgs(flag: string | undefined): Promise<Record<string, Record<string, import("@hraness/algal").JsonValue>>> {
  if (!flag) return {};
  const raw = flag.startsWith("@") ? await readFile(resolve(flag.slice(1)), "utf8") : flag;
  return JSON.parse(raw);
}

async function installSkills(targetFlag: string | undefined) {
  const target = targetFlag ? resolve(targetFlag) : join(process.cwd(), ".devin", "skills");
  if (!existsSync(SKILLS)) {
    process.stderr.write("algal-skills: no skills/ directory in this package\n");
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

function flags(rest: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a?.startsWith("--")) {
      const v = rest[++i];
      if (v !== undefined) (out[a.slice(2)] ??= []).push(v);
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
      process.stdout.write(await readFile(await resolvedToolsFile(), "utf8"));
      return;
    case "run": {
      const [program, ...restFlags] = rest;
      if (!program) {
        process.stderr.write("usage: algal-skills run <program> --args <json|@file> [--dir d] [--executor spec]*\n");
        process.exit(2);
      }
      const f = flags(restFlags);
      const manifest = program.endsWith(".algal.json")
        ? resolve(program)
        : join(PROGRAMS_DIR, `${program}.algal.json`);
      if (!existsSync(manifest)) {
        process.stderr.write(`algal-skills: unknown program "${program}" — see 'algal-skills list'\n`);
        process.exit(2);
      }
      const receipt = await runProgram({
        manifestPath: manifest,
        args: await readArgs(f.args?.[0]),
        dir: f.dir?.[0],
        executorSpecs: f.executor ?? (f.responses ? [`scripted:${f.responses[0]}`] : []),
      });
      process.stdout.write(JSON.stringify(receipt) + "\n");
      return;
    }
    case "evolve": {
      const r = Bun.spawnSync(["bun", join(PKG, "habitats", "evolve.ts"), ...rest], { stdio: ["inherit", "inherit", "inherit"] });
      process.exit(r.exitCode);
    }
    case "verify": {
      const [receiptFile, manifestFile] = rest;
      if (!receiptFile || !manifestFile) {
        process.stderr.write("usage: algal-skills verify <receipt.json> <manifest.algal.json>\n");
        process.exit(2);
      }
      const report = await verifyRun(
        JSON.parse(await readFile(resolve(receiptFile), "utf8")),
        JSON.parse(await readFile(resolve(manifestFile), "utf8")),
        flags(rest.slice(2)).dir?.[0],
      );
      process.stdout.write(JSON.stringify(report, null, 1) + "\n");
      process.exit(report.ok ? 0 : 1);
    }
    case "install-skills": {
      const i = rest.indexOf("--target");
      await installSkills(i >= 0 ? rest[i + 1] : undefined);
      return;
    }
    default:
      process.stderr.write(`algal-skills: unknown command "${cmd}"\n`);
      process.exit(2);
  }
}

await main();
