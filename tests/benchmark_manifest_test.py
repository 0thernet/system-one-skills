import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "research"))
import benchmark_manifest as manifest


def candidate(ident, provider="codex", family="system-one-explore", stratum="large"):
    episode = (ident * 64)[:64]
    return {
        "opaque_episode_id": episode, "provider": provider, "model": "fixture-model",
        "task_family": family, "task_snapshot_sha256": "a" * 64,
        "selection_eligible": True, "selection_stratum": stratum, "stratum_source": "pre_arm_fixture", "used_for_tuning": False,
        "task_cluster_hash": ("b" * 63) + ident[-1], "session_hash": ("c" * 63) + ident[-1],
        "outcome": {"task_pass": False, "tokens": 999999},
    }


class ManifestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.protocol = manifest.load_protocol()

    def test_selection_ignores_outcome_fields(self):
        first = manifest.select([candidate("b"), candidate("a")], self.protocol, "seed", 1)
        changed = [candidate("b"), {**candidate("a"), "outcome": {"task_pass": True, "tokens": 1}}]
        second = manifest.select(changed, self.protocol, "seed", 1)
        self.assertEqual(first["episodes"], second["episodes"])

    def test_provider_and_family_counts_remain_separate(self):
        report = manifest.select([candidate("a"), candidate("b", "claude")], self.protocol, "seed", 30)
        self.assertEqual(report["selected_by_provider"], {"claude": 1, "codex": 1})
        self.assertEqual(len(report["strata"]), 2)

    def test_unplanned_family_rejected(self):
        with self.assertRaises(ValueError):
            manifest.validate_candidates([candidate("a", family="unplanned")], self.protocol)

    def test_duplicate_task_or_session_does_not_fill_cap(self):
        first = candidate("a")
        duplicate = {**candidate("b"), "task_cluster_hash": first["task_cluster_hash"], "session_hash": first["session_hash"]}
        report = manifest.select([first, duplicate], self.protocol, "seed", 2)
        self.assertEqual(report["selected_total"], 1)
        self.assertEqual(report["duplicate_task_or_session_exclusions"], 1)


if __name__ == "__main__":
    unittest.main()
