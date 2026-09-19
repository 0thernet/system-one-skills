#!/usr/bin/env bun
// run-program — the algal-skills in-process runner.
//
// Runs a packaged (or user-supplied) organism manifest through the ALGAL
// library with the package's tool implementations wired in-process as a
// ToolRegistry — no tool subprocess, no host-side 30 s command cap, and no
// install-time path templating. Nondeterminism stays exactly where the
// contract puts it: inside the tool boundary, recorded on the receipt.
//
// Programmatic surface for the bin wrapper and tests:
//   runProgram({ manifestPath, args, dir, executorSpecs, modulesDir })
//     -> RunReceipt
//   packageTools() -> ToolRegistry
//   verifyRun(receiptJson, manifestJson, dir) -> VerifyReport

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  builtinRegistry,
  commandExecutor,
  credentialResolver,
  credentialStatus,
  FileStore,
  JEV_DEFAULT_MODEL,
  jevExecutor,
  parseOrganismManifest,
  parseToolSignature,
  runOrganism,
  scriptedExecutor,
  verifyReceipt,
  vercelGatewayExecutor,
} from "@hraness/algal";
import type {
  Executor,
  JsonValue,
  RunReceipt,
  ToolRegistry,
  VerifyReport,
} from "@hraness/algal";
import { TOOLS } from "../tools/tool.ts";

export const PKG = resolve(new URL("..", import.meta.url).pathname);
export const PROGRAMS_DIR = join(PKG, "programs");

/** In-process tool registry: every packaged tool returns one `report` port. */
export function packageTools(): ToolRegistry {
  const reg: ToolRegistry = new Map();
  for (const [name, impl] of Object.entries(TOOLS)) {
    reg.set(name, {
      signature: parseToolSignature({
        inputs: signatureInputs[name] ?? {},
        outputs: { report: { type: "json" } },
        effect: name === "test.run.v1" || name === "check.run.v1" ? "write" : "read",
        cost: 100,
        maxOutputBytes: 131072,
      }),
      tool: async (inputs) => {
        try {
          return { report: (await impl(inputs)) as JsonValue };
        } catch (e) {
          return { report: { ok: false, error: `tool error: ${String(e).slice(0, 300)}` } };
        }
      },
    });
  }
  return reg;
}

// Mirrors tools/shell.tools.json so the in-process registry and the cmd:
// registry cannot drift — the JSON file remains the source of truth.
import registrySpec from "../tools/shell.tools.json" with { type: "json" };
const signatureInputs = Object.fromEntries(
  Object.entries(registrySpec as unknown as Record<string, { signature: { inputs: Record<string, { type: string; optional?: boolean }> } }>).map(
    ([k, v]) => [k, v.signature.inputs],
  ),
);

export async function loadModulesInto(dir: string, store: FileStore): Promise<number> {
  let n = 0;
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".algal.json")) continue;
    await store.putManifest(
      parseOrganismManifest(JSON.parse(await readFile(join(dir, f), "utf8"))),
    );
    n++;
  }
  return n;
}

export async function executorCapabilities() {
  const status = await credentialStatus("jev");
  return {
    jev: {
      available: status.configured,
      source: status.source ?? null,
      model: JEV_DEFAULT_MODEL,
      effects: ["classifier", "decide"],
    },
  };
}

export async function makeExecutors(
  specs: string[],
  options: { autoJev?: boolean } = {},
): Promise<Executor[]> {
  const out: Executor[] = [];
  if (specs.length === 0 && options.autoJev && (await credentialStatus("jev")).configured) {
    out.push(jevExecutor({ credential: credentialResolver("jev") }));
  }
  for (const spec of specs) {
    if (spec.startsWith("scripted:")) {
      out.push(scriptedExecutor(JSON.parse(await readFile(resolve(spec.slice(9)), "utf8"))));
    } else if (spec.startsWith("cmd:")) {
      out.push(commandExecutor(spec.slice(4)));
    } else if (spec.startsWith("gateway:")) {
      out.push(vercelGatewayExecutor({ model: spec.slice(8) }));
    } else if (spec === "jev" || spec.startsWith("jev:")) {
      const model = spec === "jev" ? undefined : spec.slice(4);
      out.push(jevExecutor({
        credential: credentialResolver("jev"),
        ...(model ? { model } : {}),
      }));
    } else {
      throw new Error(`unknown executor spec "${spec}" (want scripted:<f> | cmd:<sh> | gateway:<model> | jev[:model])`);
    }
  }
  return out;
}

export type RunProgramOpts = {
  manifestPath: string;
  args?: Record<string, Record<string, JsonValue>>;
  dir?: string;
  executorSpecs?: string[];
  modulesDir?: string;
  tools?: ToolRegistry;
};

export async function runProgram(opts: RunProgramOpts): Promise<RunReceipt> {
  const store = new FileStore(resolve(opts.dir ?? ".algal"));
  await loadModulesInto(opts.modulesDir ?? PROGRAMS_DIR, store);
  const manifest = parseOrganismManifest(
    JSON.parse(await readFile(resolve(opts.manifestPath), "utf8")),
  );
  const executorSpecs = opts.executorSpecs ?? [];
  const autoJev = executorSpecs.length === 0 && manifest.cells.some(
    (cell) => cell.kind === "classifier" || cell.kind === "decide",
  );
  return runOrganism({
    manifest,
    args: opts.args ?? {},
    fns: builtinRegistry(),
    store,
    executors: await makeExecutors(executorSpecs, { autoJev }),
    tools: opts.tools ?? packageTools(),
  });
}

export async function verifyRun(
  receiptJson: JsonValue,
  manifestJson: JsonValue,
  dir?: string,
): Promise<VerifyReport> {
  const store = new FileStore(resolve(dir ?? ".algal"));
  await loadModulesInto(PROGRAMS_DIR, store);
  return verifyReceipt(receiptJson, manifestJson, store, builtinRegistry(), undefined, packageTools());
}
