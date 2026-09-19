#!/usr/bin/env bun
// evolve — the system-one-skills habitat promotion driver.
//
// Runs the router-habitat organism for a bounded number of generations
// against labeled cases, scores every candidate manifest the generator
// emits, and promotes a strictly-improving winner into the store's
// router-champion slot with a lineage record. The habitat organism does
// the proposing and evaluating; this host only repeats it and decides
// promotion — evolution never mutates a running manifest.
//
// Usage:
//   bun habitats/evolve.ts [--generations N] [--cases file] [--dir .algal]
//                         [--executor scripted:<file> | cmd:<shell> | gateway:<model>]
//                         [--min-score 0..1] [--seed-champion]
//
// Exit codes: 0 promotion evaluated (report on stdout), 2 usage/IO error.

import { validateRouterCandidate } from "./candidate.ts";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  builtinRegistry,
  commandExecutor,
  digestCanonical,
  FileStore,
  parseOrganismManifest,
  runOrganism,
  scriptedExecutor,
  vercelGatewayExecutor,
} from "@hraness/algal";
import type { Executor, JsonValue, OrganismManifest } from "@hraness/algal";

const PKG = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SLOT = "router-champion";
const DEFAULT_CASES = join(PKG, "fixtures", "router-cases.json");
const HABITAT = join(PKG, "programs", "router-habitat.algal.json");
const EVAL_INNER = join(PKG, "programs", "hab-eval-inner.algal.json");
const ROUTER = join(PKG, "programs", "router.algal.json");

type Case = { args: Record<string, JsonValue>; expect: JsonValue; key: string };

function usage(msg: string): never {
  process.stderr.write(`evolve: ${msg}\n`);
  process.exit(2);
}

function parseFlags(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined || !a.startsWith("--")) usage(`unexpected arg ${a}`);
    const key = a.slice(2);
    if (!["generations", "cases", "dir", "executor", "min-score", "seed-champion"].includes(key)) usage(`unknown flag --${key}`);
    if (key === "seed-champion") { out[key] = "true"; continue; }
    out[key] = argv[++i] ?? usage(`--${key} needs a value`);
  }
  return out;
}

async function loadModules(dir: string, store: FileStore): Promise<number> {
  let n = 0;
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".algal.json")) continue;
    await store.putManifest(parseOrganismManifest(JSON.parse(await readFile(join(dir, f), "utf8"))));
    n++;
  }
  return n;
}

async function makeExecutor(spec: string): Promise<Executor> {
  if (spec.startsWith("scripted:")) {
    return scriptedExecutor(JSON.parse(await readFile(resolve(spec.slice(9)), "utf8")));
  }
  if (spec.startsWith("cmd:")) {
    return commandExecutor(spec.slice(4));
  }
  if (spec.startsWith("gateway:")) {
    return vercelGatewayExecutor({ model: spec.slice(8) });
  }
  return usage(`unknown --executor ${spec}`);
}

async function evalScore(
  inner: OrganismManifest,
  cases: Case[],
  candidate: JsonValue,
  executors: Executor[],
  store: FileStore,
): Promise<{ passed: number; total: number; score: number }> {
  let passed = 0;
  for (const item of cases) {
    const receipt = await runOrganism({
      manifest: inner,
      args: { src: { item, candidate } },
      fns: builtinRegistry(),
      store,
      executors,
    });
    const v = receipt.cells["verdict"]?.outputs?.out as { ok?: boolean } | undefined;
    if (v?.ok === true) passed++;
  }
  return { passed, total: cases.length, score: cases.length ? passed / cases.length : 0 };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const generations = Number(flags.generations ?? 3);
  const minScore = Number(flags["min-score"] ?? 0);
  if (!Number.isInteger(generations) || generations < 1 || generations > 8) usage("generations must be an integer from 1 to 8");
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) usage("min-score must be between 0 and 1");
  const dir = resolve(flags.dir ?? ".algal");
  const executorSpec = flags.executor ?? "scripted:" + join(PKG, "fixtures", "habitat.responses.json");
  const cases = JSON.parse(await readFile(resolve(flags.cases ?? DEFAULT_CASES), "utf8")) as Case[];
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > 32) {
    usage("cases must be a non-empty array of at most 32 items");
  }

  if (cases.some((item) => !item || typeof item.args !== "object" || Array.isArray(item.args) || typeof item.args?.task !== "string" || item.key !== "lane" || !["survey", "digest", "diff", "test", "ci", "search", "fetch", "gate", "direct"].includes(String(item.expect)))) usage("cases require {args: {task: text}, key: lane, expect: known lane}");

  const store = new FileStore(dir);
  await loadModules(join(PKG, "programs"), store);
  const executor = await makeExecutor(executorSpec);
  const executors: Executor[] = [{ ...executor, execute: async (request, signal) => {
    const output = await executor.execute(request, signal);
    if (request.cellId === "gen") validateRouterCandidate(output);
    return output;
  }, ...(executor.executeEffect ? { executeEffect: async (request, signal) => {
    const result = await executor.executeEffect!(request, signal);
    if (request.cellId === "gen") validateRouterCandidate(result.output);
    return result;
  } } : {}) }];
  const fns = builtinRegistry();
  const habitat = parseOrganismManifest(JSON.parse(await readFile(HABITAT, "utf8")));
  const inner = parseOrganismManifest(JSON.parse(await readFile(EVAL_INNER, "utf8")));

  // Seed the champion slot from the packaged default when asked.
  let champion = (await store.getSlot(SLOT)) as JsonValue | undefined;
  if (champion === undefined && flags["seed-champion"] !== undefined) {
    const seed = JSON.parse(await readFile(ROUTER, "utf8")) as JsonValue;
    await store.setSlot(SLOT, seed);
    champion = seed;
  }
  if (champion) validateRouterCandidate(champion);
  const championDigest = champion ? digestCanonical(champion) : null;

  // Measure the incumbent on identical cases — promotion must beat this.
  const incumbent = champion
    ? await evalScore(inner, cases, champion, executors, store)
    : { passed: 0, total: cases.length, score: -1 };

  const lineage: Array<Record<string, JsonValue>> = [];
  let best: { manifest: JsonValue; digest: string; score: number; receipt: string } | null = null;
  let feedback = "";
  for (let g = 0; g < generations; g++) {
    const receipt = await runOrganism({
      manifest: habitat,
      args: {
        src: {
          cases,
          ...(champion !== undefined ? { champion } : {}),
          ...(feedback ? { feedback } : {}),
        },
      },
      fns,
      store,
      executors,
    });
    if (receipt.outcome !== "complete") {
      lineage.push({ generation: g, error: receipt.failure?.message ?? "run failed" });
      continue;
    }
    const candidate = receipt.cells["gen"]?.outputs?.out as JsonValue;
    const score = receipt.cells["score"]?.outputs?.out as { score?: number; passed?: number } | undefined;
    const digest = digestCanonical(candidate);
    const s = typeof score?.score === "number" ? score.score : 0;
    lineage.push({ generation: g, digest, score: s, passed: score?.passed ?? 0 });
    if (s >= minScore && (best === null || s > best.score)) {
      best = { manifest: candidate, digest, score: s, receipt: receipt.digest };
    }
    feedback = `generation ${g}: score ${s}`;
  }

  const promoted = best !== null && best.score > incumbent.score;
  if (promoted && best) {
    await store.putManifest(parseOrganismManifest(best.manifest));
    await store.setSlot(SLOT, best.manifest);
    await store.setSlot(`${SLOT}-lineage`, {
      digest: best.digest,
      score: best.score,
      incumbent_score: incumbent.score,
      incumbent_digest: championDigest,
      receipt: best.receipt,
      cases_digest: digestCanonical(cases),
      generations: lineage,
    });
  }

  if (best === null && lineage.every((entry) => entry.error !== undefined)) process.exitCode = 1;
  process.stdout.write(
    JSON.stringify(
      {
        slot: SLOT,
        store: dir,
        generations: lineage,
        incumbent,
        best: best ? { digest: best.digest, score: best.score } : null,
        promoted,
        champion_digest: promoted && best ? best.digest : championDigest,
      },
      null,
      1,
    ) + "\n",
  );
}

await main();
