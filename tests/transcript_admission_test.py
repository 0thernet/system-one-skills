import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("admission", Path(__file__).resolve().parents[1] / "research/assess_admission.py")
admission = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(admission)


class AdmissionAccounting(unittest.TestCase):
    def row(self, size, shown, **extra):
        return {"provider": "devin", "sample_id": "a" * 64, "source_view": "tool_result", "cohort": "fixture", "log": "x" * size, "presented_text": "x" * shown, "compacted": shown < size, "exit_code": 0, "invariants": {"preserved": True}, **extra}

    def test_routing_is_size_based_not_postselected_by_savings(self):
        overhead = {"first_use_incremental_tokens": 200, "incremental_invocation_tokens": 10}
        rows = admission.assess_rows([self.row(9000, 8990), self.row(4000, 1)], len, overhead)
        self.assertTrue(rows[0]["routed_by_prior_output_size"])
        self.assertFalse(rows[0]["meets_net_margin"])
        self.assertFalse(rows[1]["routed_by_prior_output_size"])
        self.assertTrue(rows[1]["meets_net_margin"])
        self.assertEqual(admission.summarize(rows)["routed_cases_below_margin"], 1)

    def test_passthrough_retains_full_first_use_cost_as_negative(self):
        overhead = {"first_use_incremental_tokens": 200, "incremental_invocation_tokens": 10}
        row = admission.assess_rows([self.row(100, 100)], len, overhead)[0]
        self.assertEqual(row["output_tokens_saved"], 0)
        self.assertEqual(row["net_tokens_saved_after_first_use"], -200)
        self.assertEqual(row["net_tokens_saved_after_invocation_only"], -10)

    def test_all_invariant_failures_are_counted_including_nonrouted(self):
        overhead = {"first_use_incremental_tokens": 0, "incremental_invocation_tokens": 0}
        rows = admission.assess_rows([self.row(10, 10, invariants={"preserved": False})], len, overhead)
        self.assertEqual(admission.summarize(rows)["invariant_failures"], 1)

    def test_shared_baseline_estimate_cancels_without_fabricated_original_tokens(self):
        skill = "---\nname: verify\ndescription: bounded validation\n---\nUse it for noisy output."
        cost = admission.costs(len, skill)
        self.assertIsNone(cost["original_recorded_user_and_system_prompt_tokens"])
        self.assertEqual(cost["first_use_incremental_tokens"], cost["full_skill_file_tokens"] + cost["catalog_name_description_tokens"] + cost["skill_invocation_tokens"] - cost["baseline_invocation_tokens"])


if __name__ == "__main__":
    unittest.main()
