"""Synthetic fixtures for an additive holdout collector; no private transcripts."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / "research/collect_holdout.py"
spec = importlib.util.spec_from_file_location("collect_holdout", MODULE)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
SINCE, UNTIL, NOW = "2026-09-01T00:00:00Z", "2026-09-12T00:00:00Z", "2026-09-04T12:00:00Z"
COUNTER = "collector_adapter_non_object_metadata_normalized"


class HoldoutCollector(unittest.TestCase):
    def collect(self, metadata, text="unverified success", timestamp=NOW):
        c = adapter.Collector("claude", SINCE, UNTIL)
        c.call("call", "Bash", {"command": "bun test"}, NOW, "session")
        c.output("call", text, timestamp, "session", metadata, event_id="output")
        return c, c.finish()

    def test_string_and_list_metadata_without_text_exit_are_excluded(self):
        for metadata in ['{"exitCode":0,"stdout":"not-authoritative"}', [{"exitCode": 0}], "", []]:
            with self.subTest(metadata=metadata):
                c, report = self.collect(metadata)
                self.assertEqual(len(c.samples), 0)
                self.assertEqual(report["selection_and_exclusions"][COUNTER], 1)
                self.assertEqual(report["selection_and_exclusions"]["replay_validation_outputs_without_explicit_exit_excluded"], 1)
                self.assertEqual(next(iter(c.outputs.values()))["metadata"], {})

    def test_explicit_text_exit_and_original_log_are_preserved(self):
        for metadata in ["unsupported", [{"is_error": True}]]:
            for text, expected in [
                ("Exit code 2\nFAIL unicode é\n", {"exit_code": 2, "log": "FAIL unicode é\n"}),
                ('{"exit_code":0,"output":"PASS\\n"}', {"exit_code": 0, "log": "PASS\n"}),
                ("verbatim\nExit code: 7", {"exit_code": 7, "log": "verbatim"}),
            ]:
                with self.subTest(metadata=metadata, text=text):
                    c, _ = self.collect(metadata, text)
                    sample = next(iter(c.samples.values()))
                    self.assertEqual({k: sample[k] for k in expected}, expected)
                    self.assertEqual(next(iter(c.outputs.values()))["text"], text)

    def test_normal_metadata_is_passed_unchanged(self):
        metadata = {"exitCode": 3, "stdout": "OUT\n", "stderr": "ERR\n"}
        c, report = self.collect(metadata)
        self.assertIs(next(iter(c.outputs.values()))["metadata"], metadata)
        sample = next(iter(c.samples.values()))
        self.assertEqual(sample["exit_code"], 3)
        self.assertEqual(sample["log"], "OUT\nERR\n")
        self.assertNotIn(COUNTER, report["selection_and_exclusions"])
        for missing in [None, {}]:
            c, report = self.collect(missing)
            self.assertEqual(len(c.samples), 0)
            self.assertNotIn(COUNTER, report["selection_and_exclusions"])

    def test_outside_window_does_not_increment_normalization(self):
        c, report = self.collect("unsupported", timestamp=UNTIL)
        self.assertEqual(len(c.outputs), 0)
        self.assertNotIn(COUNTER, report["selection_and_exclusions"])

    def test_cli_uses_base_selection_publishes_both_hashes_and_no_raw_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "claude"
            source.mkdir()
            private = root / "private"
            output = root / "public.json"
            records = [
                {"uuid": "a", "type": "assistant", "timestamp": NOW, "sessionId": "session", "message": {"content": [{"type": "tool_use", "id": "call", "name": "Bash", "input": {"command": "bun test"}}]}},
                {"uuid": "b", "parentUuid": "a", "type": "user", "timestamp": NOW, "sessionId": "session", "toolUseResult": "unsupported metadata", "message": {"content": [{"type": "tool_result", "tool_use_id": "call", "content": "Exit code 1\nPRIVATE-FIXTURE-LOG"}]}},
            ]
            (source / "fixture.jsonl").write_text("".join(json.dumps(r) + "\n" for r in records))
            base_hash = hashlib.sha256(adapter.BASE_PATH.read_bytes()).hexdigest()
            with contextlib.redirect_stderr(io.StringIO()):
                adapter.main(["--since", SINCE, "--until", UNTIL, "--codex-dir", str(root / "none"), "--claude-dir", str(source), "--devin-db", str(root / "none.db"), "--output", str(output), "--private-samples", str(private)])
            report = json.loads(output.read_text())
            self.assertEqual(report["analyzer_sha256"], base_hash)
            self.assertEqual(report["collector_adapter_sha256"], hashlib.sha256(MODULE.read_bytes()).hexdigest())
            self.assertEqual(hashlib.sha256(adapter.BASE_PATH.read_bytes()).hexdigest(), base_hash)
            self.assertEqual(report["providers"]["claude"]["selection_and_exclusions"][COUNTER], 1)
            self.assertNotIn("PRIVATE-FIXTURE-LOG", output.read_text())
            self.assertNotIn("unsupported metadata", output.read_text())
            samples = json.loads((private / "validation-replay-inputs.json").read_text())
            self.assertEqual(samples[0]["log"], "PRIVATE-FIXTURE-LOG")
            self.assertEqual(samples[0]["exit_code"], 1)
            self.assertEqual((private / "validation-replay-inputs.json").stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
