"""Synthetic parser fixtures; real private transcripts never belong in tests."""
import collections
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / "research/analyze_sessions.py"
spec = importlib.util.spec_from_file_location("analyze_sessions", MODULE)
analysis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analysis)
SINCE, UNTIL, NOW = "2026-09-12T00:00:00Z", "2026-09-19T00:00:00Z", "2026-09-16T12:00:00Z"


class TranscriptParsers(unittest.TestCase):
    def collector(self, provider="codex"):
        return analysis.Collector(provider, SINCE, UNTIL)

    def fixture(self, records, callback):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.jsonl"
            path.write_text("".join(json.dumps(r) + "\n" for r in records))
            return callback(path)

    def test_codex_deduplicates_calls_fragments_and_response_usage_not_cumulative(self):
        c = self.collector()
        records = [
            {"timestamp": NOW, "type": "response_item", "payload": {"type": "function_call", "call_id": "c", "name": "exec_command", "arguments": '{"cmd":"git status"}'}},
            {"timestamp": NOW, "type": "response_item", "payload": {"type": "function_call_output", "call_id": "c", "output": "é"}},
            {"timestamp": NOW, "type": "token_usage_record", "payload": {"response_id": "r", "usage": {"input_tokens": 100, "cached_input_tokens": 80, "output_tokens": 10}}},
            {"timestamp": NOW, "type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 999999}}}},
        ]
        self.fixture(records * 2, lambda p: analysis.codex_file(p, c))
        report = c.finish()
        self.assertEqual(report["unique_tool_calls"], 1)
        self.assertEqual(report["unique_output_fragments"], 1)
        self.assertEqual(report["recorded_usage_fields"]["input_tokens"], 100)
        self.assertEqual(report["workflow_counts"]["git_state"]["tool_output_bytes"], 2)
        self.assertEqual(report["selection_and_exclusions"]["cumulative_token_count_events_not_summed"], 2)

    def test_window_is_half_open_and_missing_timestamps_excluded(self):
        c = self.collector()
        for ident, ts in [("before", "2026-09-11T23:59:59Z"), ("start", SINCE), ("end", UNTIL), ("none", None)]:
            c.call(ident, "read", {}, ts, "s")
        self.assertEqual(list(c.calls), ["start"])

    def test_distinct_identical_yields_are_retained_but_fork_copies_deduplicate(self):
        c = self.collector()
        c.call("call", "exec", {"cmd": "bun test"}, NOW, "s")
        c.output("call", "still running", NOW, "s", event_id="event1")
        c.output("call", "still running", NOW, "s", event_id="event2")
        c.output("call", "still running", NOW, "fork", event_id="event1")
        self.assertEqual(c.finish()["unique_output_fragments"], 2)

    def test_effective_streamed_usage_changes_fingerprint(self):
        first, second = self.collector(), self.collector()
        for collector in [first, second]:
            collector.usage("same-response", {"input_tokens": 10, "output_tokens": 2}, NOW, "s")
        second.usage("same-response", {"input_tokens": 10, "output_tokens": 9}, NOW, "s")
        self.assertNotEqual(first.finish()["selected_evidence_sha256"], second.finish()["selected_evidence_sha256"])

    def test_codex_execution_group_and_agent_thread_counts_are_distinct(self):
        c = self.collector()
        records = [{"timestamp": NOW, "type": "session_meta", "payload": {"session_id": "execution-group", "id": "agent1"}}]
        for index in range(2):
            records.append({"timestamp": NOW, "type": "token_usage_record", "payload": {"response_id": f"r{index}", "thread_id": f"agent{index}", "usage": {"input_tokens": 5}}})
        self.fixture(records, lambda p: analysis.codex_file(p, c))
        report = c.finish()
        self.assertEqual(report["sessions_with_selected_evidence"], 1)
        self.assertEqual(report["recorded_usage_thread_count"], 2)

    def test_codex_nested_command_events_remain_a_separate_nonadditive_view(self):
        c = self.collector()
        item = {"id": "nested", "type": "CommandExecution", "command": ["sh", "-c", "bun test"], "aggregated_output": "pass", "exit_code": 0}
        c.command_event(item, NOW, "s")
        c.command_event(item, NOW, "fork")
        report = c.finish()
        self.assertEqual(report["unique_tool_calls"], 0)
        self.assertEqual(report["supplemental_completed_commands"]["unique_events"], 1)
        self.assertEqual(report["supplemental_completed_commands"]["workflow_counts"]["validation"]["captured_output_bytes"], 4)
        self.assertEqual(len(c.samples), 1)
        self.assertEqual(next(iter(c.samples.values()))["source_view"], "completed_command_event")

    def test_private_sample_write_replaces_symlink_without_following_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public = root / "public.json"
            public.write_text("unchanged")
            private = root / "private"
            private.mkdir()
            (private / "validation-replay-inputs.json").symlink_to(public)
            analysis.write_private_samples(private, [{"log": "private transcript"}])
            self.assertEqual(public.read_text(), "unchanged")
            self.assertFalse((private / "validation-replay-inputs.json").is_symlink())
            self.assertEqual((private / "validation-replay-inputs.json").stat().st_mode & 0o777, 0o600)

    def test_claude_selects_latest_parent_chain_and_maxes_one_message_usage(self):
        c = self.collector("claude")
        def message(uuid, parent, kind, content, ident=None, usage=None):
            return {"uuid": uuid, "parentUuid": parent, "timestamp": NOW, "sessionId": "s", "type": kind, "message": {"id": ident, "content": content, "usage": usage}}
        records = [
            message("u", None, "user", []),
            message("obsolete", "u", "assistant", [{"type": "tool_use", "id": "old", "name": "Read", "input": {}}], "old-response", {"input_tokens": 500}),
            message("a", "u", "assistant", [{"type": "tool_use", "id": "new", "name": "Read", "input": {}}], "response", {"input_tokens": 3, "cache_read_input_tokens": 100, "output_tokens": 2}),
            message("a2", "a", "assistant", [], "response", {"input_tokens": 3, "cache_read_input_tokens": 100, "output_tokens": 7}),
            message("tool", "a2", "user", [{"type": "tool_result", "tool_use_id": "new", "content": "abcdef"}]),
        ]
        self.fixture(records, lambda p: analysis.claude_file(p, c))
        r = c.finish()
        self.assertEqual(list(c.calls), ["new"])
        self.assertEqual(r["recorded_usage_fields"]["input_tokens"], 3)
        self.assertEqual(r["recorded_usage_fields"]["output_tokens"], 7)
        self.assertEqual(r["workflow_counts"]["file_read"]["tool_output_bytes"], 6)
        self.assertEqual(r["selection_and_exclusions"]["branch_nodes_outside_selected_ancestry"], 1)

    def test_devin_active_ancestry_dedup_parallel_attribution_and_rewritten_dates(self):
        c = self.collector("devin")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sessions.db"
            db = sqlite3.connect(path)
            db.execute("CREATE TABLE sessions(id TEXT,main_chain_id INTEGER,last_activity_at INTEGER)")
            db.execute("CREATE TABLE message_nodes(session_id TEXT,node_id INTEGER,parent_node_id INTEGER,created_at INTEGER,chat_message TEXT)")
            after_cutoff = int(analysis.epoch("2026-09-19T12:00:00Z"))
            db.execute("INSERT INTO sessions VALUES('s',4,?)", (after_cutoff,))
            def insert(node, parent, role, **fields):
                message = {"message_id": f"m{node}", "role": role, "metadata": {"created_at": NOW}, **fields}
                db.execute("INSERT INTO message_nodes VALUES('s',?,?,?,?)", (node, parent, after_cutoff, json.dumps(message)))
            insert(0, None, "assistant", tool_calls=[{"id": "inactive", "name": "exec", "arguments": {"command": "git status"}}])
            usage = {"created_at": NOW, "metrics": {"input_tokens": 3, "cache_read_tokens": 20, "cache_creation_tokens": 10, "output_tokens": 4}}
            calls = [{"id": "a", "name": "read", "arguments": {}}, {"id": "b", "name": "grep", "arguments": {}}]
            insert(1, None, "assistant", message_id="stable", metadata=usage, tool_calls=calls)
            insert(2, 1, "assistant", message_id="stable", metadata=usage, tool_calls=calls)
            insert(3, 2, "tool", tool_call_id="b", content="two")
            insert(4, 3, "tool", tool_call_id="a", content="four")
            db.commit()
            db.close()
            analysis.devin_database(path, c)
        report = c.finish()
        self.assertEqual(report["unique_tool_calls"], 2)
        self.assertEqual(report["recorded_usage_fields"]["input_tokens"], 3)
        self.assertEqual(report["recorded_usage_fields"]["cache_read_tokens"], 20)
        self.assertEqual(report["workflow_counts"]["file_read"]["tool_output_bytes"], 4)
        self.assertEqual(report["workflow_counts"]["repository_search"]["tool_output_bytes"], 3)
        self.assertEqual(report["selection_and_exclusions"]["forest_nodes_outside_active_ancestry"], 1)

    def test_ancestry_cycle_and_missing_parent_are_bounded(self):
        stats = collections.Counter()
        self.assertEqual(len(analysis.active_chain({1: {"parent": 1}}, 1, "parent", stats)), 1)
        self.assertEqual(stats["ancestry_cycles_detected"], 1)
        self.assertEqual(analysis.active_chain({}, 1, "parent", stats), [])
        self.assertEqual(stats["missing_ancestry_parents"], 1)

    def test_commands_are_data_and_categories_never_publish_arbitrary_names(self):
        text = 'text(await tools.exec_command({cmd:"bun test"})); $(touch /SHOULD_NOT_EXIST)'
        self.assertEqual(analysis.workflow("exec", text), "validation")
        self.assertEqual(analysis.workflow("exec", '{"cmd":"git diff && git status"}'), "mixed_shell")
        self.assertEqual(analysis.workflow("private_service", {}), "other")
        self.assertEqual(analysis.workflow("Bash", {"command": "pytest"}), "validation")

    def test_replay_requires_explicit_completed_exit_status(self):
        self.assertIsNone(analysis.completed_output("tests passed"))
        self.assertIsNone(analysis.completed_output("error", {"is_error": True}))
        self.assertEqual(analysis.completed_output('{"exit_code":2,"output":"FAIL\\n"}'), {"exit_code": 2, "log": "FAIL\n"})
        self.assertEqual(analysis.completed_output("Process exited with code 1\nFinal output:\nFAIL"), {"exit_code": 1, "log": "FAIL"})
        self.assertEqual(analysis.completed_output("hello\nExit code: 0"), {"exit_code": 0, "log": "hello"})
        self.assertEqual(analysis.completed_output("Exit code 2\nFAIL"), {"exit_code": 2, "log": "FAIL"})
        self.assertIsNone(analysis.completed_output('[{"exit_code":0,"output":"a"},{"exit_code":1,"output":"b"}]'))
        self.assertIsNone(analysis.completed_output("example source: exit_code: 0\nOutput:\nnot a provider envelope"))
        self.assertIsNone(analysis.completed_output("Process exited with code 0\nFinal output:\nA\nProcess exited with code 9\nFinal output:\nB"))

    def test_public_report_contains_no_commands_ids_or_private_text(self):
        c = self.collector()
        c.call("SECRET-CALL-ID", "exec", {"cmd": "cat /SECRET/PATH"}, NOW, "SECRET-SESSION")
        c.output("SECRET-CALL-ID", "SECRET-DOCUMENT-TEXT", NOW, "SECRET-SESSION")
        self.assertNotIn("SECRET", json.dumps(c.finish()))
        self.assertEqual(analysis.text_content([{"type": "text", "text": "a"}, {"type": "image", "data": "AAAA"}]), "a\n")


if __name__ == "__main__":
    unittest.main()
