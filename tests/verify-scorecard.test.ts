import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(new URL("../research/verify-current-report.json", import.meta.url), "utf8"));

test("public verify scorecard keeps provider denominators and explicit limits", () => {
  expect(report.all_providers.eligible_outputs).toBe(563);
  expect(report.all_providers.text_reduction_pct).toBe(35.2);
  expect(report.all_providers.preservation_invariant_failures).toBe(0);
  expect(report.by_provider.codex.eligible_outputs).toBe(356);
  expect(report.by_provider.devin.eligible_outputs).toBe(207);
  expect(report.by_provider.claude.text_reduction_pct).toBe(null);
  expect(report.whole_task_provider_token_result.status).toBe("not_established");
  expect(report.other_skills.status).toBe("no_numeric_result");
});
