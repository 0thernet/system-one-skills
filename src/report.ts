import type { RunReceipt } from "@hraness/algal";

type PublicInterface = {
  interface?: { outputs?: Record<string, { cell: string; port: string }> };
};

/** Exactly what the default CLI prints. Keep evidence flags, not just prose. */
export function compactReport(receipt: RunReceipt, manifest: PublicInterface, includeSummary = false) {
  const ports = Object.entries(manifest.interface?.outputs ?? {});
  const missing = ports.filter(([,ref]) => !Object.hasOwn(receipt.cells[ref.cell]?.outputs ?? {}, ref.port)).map(([name])=>name);
  // Packaged interfaces reserve fmt for derived human-readable renderings.
  // Keep every substantive port; callers can request the duplicate prose too.
  const visible = !includeSummary && ports.some(([,ref])=>ref.cell !== "fmt") ? ports.filter(([,ref])=>ref.cell !== "fmt") : ports;
  const outputs = Object.fromEntries(visible.map(
    ([name, ref]) => [name, receipt.cells[ref.cell]?.outputs?.[ref.port] ?? null],
  ));
  return {
    program: receipt.manifestKey,
    outcome: receipt.outcome,
    outputs,
    work: receipt.work,
    receipt_digest: receipt.digest,
    ...(missing.length ? { missing_outputs: missing } : {}),
    ...(receipt.failure ? { failure: receipt.failure } : {}),
  };
}

/** A complete execution can still report a failed command or missing evidence. */
export function reportFailed(report: ReturnType<typeof compactReport>): boolean {
  if (report.outcome !== "complete" || report.missing_outputs?.length) return true;
  return Object.values(report.outputs).some(value => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const r = value as Record<string, unknown>;
    return r.ok === false || r.passed === false || (typeof r.code === "number" && r.code !== 0) ||
      (r.status === "completed" && r.conclusion !== "success");
  });
}
