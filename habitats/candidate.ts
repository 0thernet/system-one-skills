import { readFileSync } from "node:fs";
import { digestCanonical, parseOrganismManifest } from "@hraness/algal";
import type { JsonValue } from "@hraness/algal";

// Generated router data may change its prompt or lower budgets, never add effects,
// alter routing labels, or replace the measured interface before it is evaluated.
export function validateRouterCandidate(candidate: JsonValue): void {
  parseOrganismManifest(candidate);
  const baseline = JSON.parse(readFileSync(new URL("../programs/router.algal.json", import.meta.url), "utf8"));
  const actual = structuredClone(candidate) as typeof baseline;
  const checkBudget = (value: Record<string, number> | undefined, cap: Record<string, number>) => {
    if (!value || Object.keys(value).some((key) => !(key in cap))) throw new Error("candidate changes the allowed budget shape");
    for (const [key, limit] of Object.entries(cap)) {
      if (!Number.isFinite(value[key]) || value[key]! <= 0 || value[key]! > limit) throw new Error(`candidate exceeds ${key} budget`);
    }
  };
  checkBudget(actual.budgets, baseline.budgets);
  actual.budgets = baseline.budgets;
  const route = actual.cells?.find((cell: { id: string }) => cell.id === "route");
  const original = baseline.cells.find((cell: { id: string }) => cell.id === "route");
  if (!route || typeof route.prompt !== "string" || Buffer.byteLength(route.prompt) > 8192) throw new Error("candidate requires a bounded router prompt");
  checkBudget(route.budget, original.budget);
  route.prompt = original.prompt;
  route.budget = original.budget;
  for (const key of ["key", "name", "note"]) actual[key] = baseline[key];
  if (digestCanonical(actual) !== digestCanonical(baseline)) throw new Error("candidate may only change router prompt or lower existing budgets");
}
