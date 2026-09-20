import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("score_verify_replay", ROOT / "research/score_verify_replay.py")
score = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(score)


class VerifyScorecardTests(unittest.TestCase):
    def sample(self, provider="codex", sample_id="a", log="PASS\n", presented=None, compacted=False):
        return {
            "provider": provider,
            "sample_id": sample_id,
            "source_view": "tool_result",
            "log": log,
            "presented_text": log if presented is None else presented,
            "compacted": compacted,
            "exit_code": 0,
            "invariants": {"complete": True, "status": True},
        }

    def test_score_is_provider_scoped_and_text_only(self):
        rows = [self.sample(log="abcdefgh", presented="ab", compacted=True), self.sample("devin", "b", log="1234", presented="1234")]
        result = score.summarize(rows)
        self.assertEqual(result["eligible_outputs"], 2)
        self.assertEqual(result["compacted_outputs"], 1)
        self.assertEqual(result["text_reduction_pct"], 50.0)
        self.assertEqual(result["compacted_text_reduction_pct"], 75.0)

    def test_failed_invariant_is_rejected(self):
        row = self.sample()
        row["invariants"]["status"] = False
        with self.assertRaisesRegex(ValueError, "preservation"):
            score.validate([row])

    def test_public_result_has_no_replay_text(self):
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / "replay.json"
            private.write_text(json.dumps({"samples": [self.sample(log="PRIVATE", presented="PUBLIC")]}))
            result = score.score(private)
            rendered = json.dumps(result)
            self.assertNotIn("PRIVATE", rendered)
            self.assertNotIn("PUBLIC", rendered)
            self.assertIn("not_established", rendered)


if __name__ == "__main__":
    unittest.main()
