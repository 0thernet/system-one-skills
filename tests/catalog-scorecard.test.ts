import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(new URL("../research/catalog-scorecard.json", import.meta.url), "utf8"));

test("catalog scorecard covers every skill without inventing reductions", () => {
  const names = [
    "system-one-verify", "system-one-explore", "system-one-ci", "system-one-diff",
    "system-one-digest", "system-one-fetch", "system-one-research", "system-one-triage",
    "system-one-writing", "system-one-evolve", "system-one",
  ];
  expect(Object.keys(report.skills).sort()).toEqual(names.sort());
  expect(report.skills["system-one-verify"].reduction_pct).toBe(35.2);
  for (const name of names.filter(name => name !== "system-one-verify")) {
    expect(report.skills[name].reduction_pct).toBe(null);
  }
  expect(report.skills["system-one-explore"].headroom_screen.calls_reaching_threshold).toBe(213);
  expect(report.skills["system-one-diff"].headroom_screen.calls_reaching_threshold).toBe(31);
  expect(report.skills["system-one-digest"].headroom_screen.calls_reaching_threshold).toBe(28);
  expect(report.skills["system-one-fetch"].shared_proxy_with).toBe("system-one-research");
  expect(report.skills["system-one-research"].shared_proxy_with).toBe("system-one-fetch");
  expect(report.skills["system-one-explore"].status).toBe("retrospective_headroom_only");
  expect(report.skills["system-one-ci"].status).toBe("native_baseline_preferred");
  expect(report.skills["system-one-writing"].status).toBe("no_dedicated_cohort");
  expect(report.skills["system-one-ci"].measured_token_savings).toBe(null);
});
