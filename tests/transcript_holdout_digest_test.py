"""Synthetic payload checks for private replay provenance; no private logs."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

RESEARCH = Path(__file__).resolve().parents[1] / "research"
spec = importlib.util.spec_from_file_location("assess_holdout", RESEARCH / "assess_holdout.py")
assessment = importlib.util.module_from_spec(spec)
sys.path.insert(0, str(RESEARCH))
try:
    spec.loader.exec_module(assessment)
finally:
    sys.path.pop(0)


class HoldoutReplayDigest(unittest.TestCase):
    def fixture(self):
        return [{"provider": "claude", "sample_id": "f" * 64,
                 "log": 'Unicode é 雪 😀 and "quotes"\n\t\u2028', "exit_code": 2,
                 "invariants": {"preserved": True, "failed": False}}]

    def test_actual_javascript_serialization_matches_python_verification(self):
        samples = self.fixture()
        # Use the same serializer as the frozen replayer, including Unicode.
        result = subprocess.run(["node", "--input-type=module", "-e",
            "import {createHash} from 'node:crypto'; let raw=''; for await(const c of process.stdin)raw+=c; console.log(createHash('sha256').update(JSON.stringify(JSON.parse(raw))).digest('hex'));"],
            input=json.dumps(samples), text=True, capture_output=True, check=True)
        digest = result.stdout.strip()
        self.assertEqual(assessment.verify_replay_digest({"samples": samples, "private_replay_digest": digest}), digest)

    def test_changed_payload_or_missing_digest_is_rejected(self):
        samples = self.fixture()
        digest = hashlib.sha256(json.dumps(samples, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        samples[0]["exit_code"] = 0
        with self.assertRaisesRegex(ValueError, "does not match"):
            assessment.verify_replay_digest({"samples": samples, "private_replay_digest": digest})
        with self.assertRaisesRegex(ValueError, "does not match"):
            assessment.verify_replay_digest({"samples": samples})

    def test_nonfinite_payload_is_rejected(self):
        with self.assertRaises(ValueError):
            assessment.verify_replay_digest({"samples": [{"exit_code": float('nan')}], "private_replay_digest": "0" * 64})


if __name__ == "__main__":
    unittest.main()
