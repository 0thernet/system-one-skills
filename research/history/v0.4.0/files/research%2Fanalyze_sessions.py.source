#!/usr/bin/env python3
"""Aggregate authorized local transcripts without publishing private text.

Stdlib only. See METHODOLOGY.md for the population, provider semantics,
deduplication rules, classifier limits, and replay eligibility. Historical
commands are inspected as data and are never executed by this analyzer.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from datetime import datetime, timezone

WORKFLOWS = (
    "validation", "repository_search", "file_read", "git_state", "diff_review",
    "ci_status", "web_research", "dependency_build", "edits", "coordination",
    "process_wait", "mixed_shell", "shell_other", "other", "unmatched_output",
)
CMD_LITERAL = re.compile(r'''(?:["']?(?:cmd|command)["']?)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`)''')


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def epoch(value):
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def text_content(value):
    """Only textual blocks; never count image/audio base64 as prompt text."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(text_content(v) for v in value if isinstance(v, (dict, str)))
    if isinstance(value, dict):
        if value.get("type") in ("image", "image_url", "input_image", "audio"):
            return ""
        if "text" in value:
            return text_content(value["text"])
        if "content" in value:
            return text_content(value["content"])
        return canonical(value)
    return ""


def commands(arguments):
    if isinstance(arguments, dict):
        return [str(arguments[k]) for k in ("cmd", "command") if isinstance(arguments.get(k), str)]
    if not isinstance(arguments, str):
        return []
    try:
        parsed = json.loads(arguments)
        if isinstance(parsed, dict):
            return commands(parsed)
    except (ValueError, TypeError):
        pass
    found = []
    for match in CMD_LITERAL.finditer(arguments):
        raw = match.group(1)
        try:
            found.append(json.loads(raw) if raw.startswith('"') else raw[1:-1])
        except ValueError:
            continue
    return found


def command_workflow(command):
    # Heuristics identify opportunities, not replacements safe without context.
    rules = (
        ("ci_status", r"\bgh\s+(?:run\s+(?:list|view|watch)|pr\s+checks)\b"),
        ("validation", r"\b(?:pytest|vitest|jest|typecheck|eslint|mypy)\b|\b(?:bun|npm|pnpm|yarn|cargo|go)\s+(?:run\s+)?(?:test|check|lint|typecheck)\b|\btsc\b"),
        ("diff_review", r"\bgit\s+(?:-C\s+\S+\s+)?(?:diff|show)\b"),
        ("git_state", r"\bgit\s+(?:-C\s+\S+\s+)?(?:status|log|branch|rev-parse|stash|ls-files)\b"),
        ("repository_search", r"(?:^|[\s;|&])(?:rg|grep|find|fd|ls)\s"),
        ("file_read", r"(?:^|[\s;|&])(?:cat|sed|head|tail|less|nl)\s"),
        ("web_research", r"(?:^|[\s;|&])(?:curl|wget)\s"),
        ("dependency_build", r"\b(?:bun|npm|pnpm|yarn|cargo|go)\s+(?:run\s+)?(?:build|install|add|update|fetch)\b"),
        ("process_wait", r"(?:^|[\s;|&])(?:sleep|wait)\b"),
    )
    found = {name for name, pattern in rules if re.search(pattern, command)}
    return next(iter(found)) if len(found) == 1 else "mixed_shell" if found else "shell_other"


def workflow(name, arguments):
    short = re.split(r"__|\.", name or "")[-1].lower()
    if short in {"exec", "exec_command", "bash", "shell", "local_shell"}:
        found = {command_workflow(c) for c in commands(arguments)}
        return next(iter(found)) if len(found) == 1 else "mixed_shell" if found else "shell_other"
    if short in {"read", "read_file", "readfile"}:
        return "file_read"
    if short in {"grep", "glob", "find_file_by_name", "code_search"}:
        return "repository_search"
    if short in {"edit", "write", "write_file", "apply_patch", "multiedit", "notebookedit"}:
        return "edits"
    if short in {"webfetch", "web_search", "websearch", "web_fetch", "fetch"} or "web__run" in (name or ""):
        return "web_research"
    if short in {"get_output", "write_stdin", "wait", "sleep", "read_subagent", "read_thread_terminal"}:
        return "process_wait"
    if short in {"spawn_agent", "send_message", "wait_agent", "list_agents", "followup_task", "run_subagent", "task", "agent", "todowrite", "todo_write", "interrupt_agent"}:
        return "coordination"
    return "other"


def numeric_fields(value, fields):
    return {k: value[k] for k in fields if isinstance(value.get(k), (int, float)) and value[k] >= 0}


class Collector:
    def __init__(self, provider, since, until, sample_limit=12):
        self.provider, self.since, self.until = provider, epoch(since), epoch(until)
        self.sample_limit = sample_limit
        self.calls, self.outputs, self.usages, self.command_events = {}, {}, {}, {}
        self.sessions, self.provenance = set(), set()
        self.usage_thread_mapping = {}
        self.stats, self.days = collections.Counter(), collections.Counter()
        self.samples = {}

    def eligible(self, timestamp):
        t = epoch(timestamp)
        return t is not None and self.since <= t < self.until

    def record(self, session, timestamp, kind, value):
        self.sessions.add(session)
        self.provenance.add(digest([kind, value]))
        day = datetime.fromtimestamp(epoch(timestamp), timezone.utc).date().isoformat()
        self.days[day] += 1

    def call(self, ident, name, arguments, timestamp, session):
        if not self.eligible(timestamp):
            return
        if not ident:
            self.stats["calls_without_stable_id_excluded"] += 1
            return
        value = {"workflow": workflow(name, arguments), "input_bytes": len((arguments if isinstance(arguments, str) else canonical(arguments)).encode()), "signature": digest([name, arguments])}
        if ident in self.calls:
            self.stats["duplicate_calls_excluded"] += 1
            if value["signature"] != self.calls[ident]["signature"]:
                self.stats["conflicting_call_ids"] += 1
            return
        self.calls[ident] = value
        self.record(session, timestamp, "call", [ident, name, arguments])

    def output(self, ident, content, timestamp, session, metadata=None, event_id=None):
        if not self.eligible(timestamp):
            return
        rendered = text_content(content)
        if event_id is None:
            self.stats["output_fragments_without_stable_event_id"] += 1
        # Distinct identical yields from one call are separate context events.
        # Content-only fallback is conservative and is explicitly counted.
        key = digest([ident, event_id, rendered])
        if key in self.outputs:
            self.stats["duplicate_output_fragments_excluded"] += 1
            return
        self.outputs[key] = {"call_id": ident, "bytes": len(rendered.encode()), "text": rendered, "metadata": metadata or {}}
        self.record(session, timestamp, "output", [ident, event_id, rendered])

    def usage(self, ident, usage, timestamp, session):
        if not self.eligible(timestamp) or not usage:
            return
        if not ident:
            self.stats["usage_without_response_id_excluded"] += 1
            return
        if ident in self.usages:
            self.stats["duplicate_usage_records_excluded"] += 1
            self.usages[ident] = {k: max(usage.get(k, 0), self.usages[ident].get(k, 0)) for k in self.usages[ident].keys() | usage.keys()}
            return
        self.usages[ident] = usage
        self.record(session, timestamp, "usage", [ident, usage])

    def command_event(self, item, timestamp, session):
        """Separate Codex nested shell telemetry from model-visible tool calls."""
        if not self.eligible(timestamp) or not item.get("id"):
            return
        ident = item["id"]
        if ident in self.command_events:
            self.stats["duplicate_completed_command_events_excluded"] += 1
            return
        command = item.get("command") or []
        command_text = " ".join(command) if isinstance(command, list) else str(command)
        log = item.get("aggregated_output")
        if not isinstance(log, str):
            log = str(item.get("stdout") or "") + str(item.get("stderr") or "")
        value = {"workflow": command_workflow(command_text), "output_bytes": len(log.encode()), "log": log, "exit_code": item.get("exit_code")}
        self.command_events[ident] = value
        self.record(session, timestamp, "completed_command_event", [ident, command, log, value["exit_code"]])

    def replay_candidate(self, key, replay, source_view):
        self.stats["replay_eligible_completed_validation_outputs"] += 1
        self.samples[key] = {"provider": self.provider, "sample_id": key, "source_view": source_view, **replay}
        if len(self.samples) > self.sample_limit:
            self.samples.pop(max(self.samples))

    def finish(self):
        groups = {w: {"tool_calls": 0, "tool_input_bytes": 0, "output_fragments": 0, "tool_output_bytes": 0} for w in WORKFLOWS}
        for call in self.calls.values():
            groups[call["workflow"]]["tool_calls"] += 1
            groups[call["workflow"]]["tool_input_bytes"] += call["input_bytes"]
        for key, output in self.outputs.items():
            kind = self.calls.get(output["call_id"], {}).get("workflow", "unmatched_output")
            groups[kind]["output_fragments"] += 1
            groups[kind]["tool_output_bytes"] += output["bytes"]
            if kind == "validation":
                replay = completed_output(output["text"], output["metadata"])
                if replay:
                    self.replay_candidate(key, replay, "tool_result")
                else:
                    self.stats["replay_validation_outputs_without_explicit_exit_excluded"] += 1
        supplemental = collections.defaultdict(lambda: {"completed_command_events": 0, "captured_output_bytes": 0})
        for ident, value in self.command_events.items():
            supplemental[value["workflow"]]["completed_command_events"] += 1
            supplemental[value["workflow"]]["captured_output_bytes"] += value["output_bytes"]
            if value["workflow"] == "validation":
                if isinstance(value["exit_code"], int):
                    self.replay_candidate(digest(["command-event", ident, value["log"]]), {"log": value["log"], "exit_code": value["exit_code"]}, "completed_command_event")
                else:
                    self.stats["replay_validation_outputs_without_explicit_exit_excluded"] += 1
        totals = collections.Counter()
        for usage in self.usages.values():
            totals.update(usage)
        return {
            "sessions_with_selected_evidence": len(self.sessions),
            "session_count_semantics": "Contributing execution/session groups after deduplication, not a user-task count. Codex session_meta.session_id groups multiple agent threads; Claude sessionId can include sidechains; Devin uses DB session identity.",
            **({"recorded_usage_thread_count": len(set(self.usage_thread_mapping.values()))} if self.provider == "codex" else {}),
            "unique_tool_calls": len(self.calls),
            "unique_output_fragments": len(self.outputs),
            "unique_usage_responses": len(self.usages),
            "recorded_usage_fields": dict(sorted(totals.items())),
            "workflow_counts": {k: v for k, v in groups.items() if any(v.values())},
            "supplemental_completed_commands": {
                "unique_events": len(self.command_events),
                "measurement": "Nested Codex shell telemetry; overlaps response-item tool outputs and MUST NOT be summed with model-visible tool-call counts or bytes.",
                "workflow_counts": dict(sorted(supplemental.items())),
            } if self.provider == "codex" else None,
            "selection_and_exclusions": dict(sorted(self.stats.items())),
            "selected_records_by_utc_day": dict(sorted(self.days.items())),
            "selected_evidence_sha256": digest([sorted(self.provenance), sorted(self.usages.items()), sorted(self.usage_thread_mapping.items())]),
        }


def completed_output(text, metadata=None):
    """Recover completed stdout plus exit status, never execute saved commands."""
    metadata = metadata or {}
    try:
        value = json.loads(text)
        if isinstance(value, dict) and isinstance(value.get("exit_code"), int) and isinstance(value.get("output"), str):
            return {"log": value["output"], "exit_code": value["exit_code"]}
        if isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict):
            return completed_output(canonical(value[0]), metadata)
    except (ValueError, TypeError):
        pass
    # Devin's completed exec observation appends this standalone footer.
    # The retained value is explicitly an archived text excerpt; it can still
    # contain provider metadata above the footer, not recoverable raw stdout.
    footer = re.search(r"(?:^|\n)Exit code:\s*(-?\d+)\s*$", text)
    if footer:
        return {"log": text[:footer.start()], "exit_code": int(footer.group(1))}
    # Claude failure tool results can carry an explicit status as a prefix.
    prefix = re.match(r"Exit code\s+(-?\d+)\s*\n", text)
    if prefix:
        return {"log": text[prefix.end():], "exit_code": int(prefix.group(1))}
    # Only the known anchored tool envelope is authoritative. A code string
    # inside arbitrary log text, or multiple concatenated results, is not.
    code = re.match(r"^(?:Chunk ID:[^\n]*\n)?(?:Wall time:[^\n]*\n)?Process exited with code\s+(-?\d+)\s*\n", text)
    status_lines = re.findall(r"(?m)^Process exited with code\s+-?\d+\s*$", text)
    if code and len(status_lines) == 1:
        marker = re.search(r"(?:^|\n)(?:Final output|Output):\s*\n", text)
        if marker:
            return {"log": text[marker.end():], "exit_code": int(code.group(1))}
    if isinstance(metadata.get("exitCode"), int) and isinstance(metadata.get("stdout"), str):
        return {"log": metadata["stdout"] + metadata.get("stderr", ""), "exit_code": metadata["exitCode"]}
    return None


def read_jsonl(path, stats):
    with path.open(encoding="utf-8", errors="replace") as source:
        for line in source:
            try:
                yield json.loads(line)
            except (ValueError, UnicodeError):
                stats["malformed_json_records_excluded"] += 1


def codex_file(path, collector):
    session = digest(str(path))
    for record in read_jsonl(path, collector.stats):
        timestamp, value = record.get("timestamp"), record.get("payload") or {}
        kind = record.get("type")
        if kind == "session_meta":
            session = value.get("session_id") or value.get("id") or session
        elif kind == "token_usage_record":
            collector.usage(value.get("response_id"), numeric_fields(value.get("usage") or {}, ("input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens")), timestamp, session)
            if collector.eligible(timestamp) and value.get("response_id") in collector.usages and value.get("thread_id"):
                collector.usage_thread_mapping[value["response_id"]] = value["thread_id"]
        elif kind == "event_msg" and value.get("type") == "token_count" and collector.eligible(timestamp):
            collector.stats["cumulative_token_count_events_not_summed"] += 1
        elif kind == "event_msg" and value.get("type") == "item_completed":
            item = value.get("item") or {}
            if item.get("type") == "CommandExecution":
                collector.command_event(item, timestamp, session)
        elif kind == "response_item":
            ident = value.get("call_id")
            if value.get("type") in ("function_call", "custom_tool_call"):
                collector.call(ident, value.get("name", ""), value.get("arguments", value.get("input", "")), timestamp, session)
            elif value.get("type") in ("function_call_output", "custom_tool_call_output"):
                event_id = value.get("id") or ([timestamp, record["ordinal"]] if record.get("ordinal") is not None else timestamp)
                collector.output(ident, value.get("output", ""), timestamp, session, event_id=event_id)


def active_chain(nodes, head, parent_key, stats):
    chain, seen = [], set()
    while head is not None:
        if head in seen:
            stats["ancestry_cycles_detected"] += 1
            break
        seen.add(head)
        if head not in nodes:
            stats["missing_ancestry_parents"] += 1
            break
        node = nodes[head]
        chain.append(node)
        head = node.get(parent_key)
    chain.reverse()
    return chain


def claude_file(path, collector):
    records = list(read_jsonl(path, collector.stats))
    nodes = {r["uuid"]: r for r in records if r.get("uuid")}
    if not nodes:
        return
    candidates = [r for r in records if r.get("uuid") and r.get("type") in ("assistant", "user")]
    if not candidates:
        return
    main = [r for r in candidates if not r.get("isSidechain")]
    head = (main or candidates)[-1]["uuid"]
    chain = active_chain(nodes, head, "parentUuid", collector.stats)
    collector.stats["branch_nodes_outside_selected_ancestry"] += len(nodes) - len(chain)
    collector.stats["transcript_files_with_selected_ancestry"] += 1
    for record in chain:
        timestamp = record.get("timestamp")
        session = record.get("sessionId") or digest(str(path))
        message = record.get("message") or {}
        if record.get("type") == "assistant":
            collector.usage(message.get("id"), numeric_fields(message.get("usage") or {}, ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens")), timestamp, session)
        blocks = message.get("content") or []
        for index, block in enumerate(blocks if isinstance(blocks, list) else []):
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                collector.call(block.get("id"), block.get("name", ""), block.get("input", {}), timestamp, session)
            elif block.get("type") == "tool_result":
                collector.output(block.get("tool_use_id"), block.get("content", ""), timestamp, session, record.get("toolUseResult"), [record["uuid"], index])


def devin_database(path, collector):
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    connection.execute("BEGIN")
    sessions = connection.execute("SELECT id, main_chain_id FROM sessions WHERE last_activity_at >= ?", (collector.since,)).fetchall()
    collector.stats["database_sessions_considered"] = len(sessions)
    for session, head in sessions:
        nodes = {row[0]: {"id": row[0], "parent": row[1], "timestamp": row[2]} for row in connection.execute("SELECT node_id,parent_node_id,created_at FROM message_nodes WHERE session_id=?", (session,))}
        chain = active_chain(nodes, head, "parent", collector.stats)
        collector.stats["forest_nodes_outside_active_ancestry"] += len(nodes) - len(chain)
        # Nodes may be rewritten after the cutoff while preserving an older
        # message timestamp. Filter the upper bound on the message, below.
        selected = [n for n in chain if n["timestamp"] >= collector.since]
        collector.stats["active_nodes_inserted_before_window_excluded"] += len(chain) - len(selected)
        for offset in range(0, len(selected), 400):
            ids = [n["id"] for n in selected[offset:offset + 400]]
            placeholders = ",".join("?" for _ in ids)
            sql = f"""SELECT created_at,
              json_extract(chat_message,'$.message_id'),
              json_extract(chat_message,'$.role'),
              json_extract(chat_message,'$.tool_calls'),
              CASE WHEN json_extract(chat_message,'$.role')='tool' THEN json_extract(chat_message,'$.content') END,
              json_extract(chat_message,'$.tool_call_id'),
              json_extract(chat_message,'$.metadata.metrics'),
              json_extract(chat_message,'$.metadata.created_at')
              FROM message_nodes WHERE session_id=? AND node_id IN ({placeholders})"""
            for created, ident, role, calls, content, call_id, metrics, message_created in connection.execute(sql, [session, *ids]):
                timestamp = message_created if epoch(message_created) is not None else created
                if role == "assistant":
                    usage = json.loads(metrics) if metrics else {}
                    collector.usage(ident, numeric_fields(usage, ("input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens")), timestamp, session)
                    for call in json.loads(calls) if calls else []:
                        collector.call(call.get("id"), call.get("name", ""), call.get("arguments", {}), timestamp, session)
                elif role == "tool":
                    collector.output(call_id, content or "", timestamp, session, event_id=ident)
    connection.rollback()
    connection.close()


USAGE_SEMANTICS = {
    "codex": "Sum per-response token_usage_record.usage, deduplicated by response_id. input_tokens includes cached_input_tokens; cached and reasoning fields are subsets, not additive. Cumulative token_count snapshots are not summed. Responses without individual usage records are absent from usage totals.",
    "devin": "Active DB ancestry only; assistant metadata.metrics deduplicated by message_id. input_tokens, cache_read_tokens and cache_creation_tokens are reported separately as recorded. Cache inclusion depends on the selected model/backend; no additive cross-model input total is inferred. Export final_metrics and inactive forest copies are excluded. Compacted-away history is unavailable on this chain.",
    "claude": "Selected latest parentUuid ancestry per JSONL file. Assistant message.usage deduplicated globally by message.id; max per field across blocks of one message. input_tokens, cache_read_input_tokens and cache_creation_input_tokens are distinct buckets; context-input proxy is their sum. This is a best-observable branch selection, not an authoritative exported active-head pointer.",
}


def write_private_samples(directory, samples):
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    # Atomic replace replaces a pre-existing symlink itself; never follow it
    # and accidentally write private transcripts into another target.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, prefix=".samples-", delete=False) as out:
        os.chmod(out.name, 0o600)
        json.dump(samples, out, ensure_ascii=False)
        temporary = Path(out.name)
    os.replace(temporary, directory / "validation-replay-inputs.json")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", default="2026-09-12T00:00:00Z")
    parser.add_argument("--until", default="2026-09-19T00:00:00Z")
    parser.add_argument("--codex-dir", type=Path, default=Path.home() / ".codex/sessions")
    parser.add_argument("--claude-dir", type=Path, default=Path.home() / ".claude/projects")
    parser.add_argument("--devin-db", type=Path, default=Path.home() / ".local/share/devin/cli/sessions.db")
    parser.add_argument("--output", type=Path, default=Path("research/session-report.json"))
    parser.add_argument("--private-samples", type=Path, help="Optional OUTSIDE-repository directory for raw replay logs (mode 0700)")
    args = parser.parse_args()
    if epoch(args.since) is None or epoch(args.until) is None or epoch(args.since) >= epoch(args.until):
        parser.error("--since and --until must define an increasing ISO timestamp interval")
    if args.private_samples:
        repo = Path(__file__).resolve().parents[1]
        dest = args.private_samples.resolve()
        if repo == dest or repo in dest.parents:
            parser.error("private samples must be outside the repository")
    result = {
        "schema_version": 2,
        "window": {"since_inclusive_utc": args.since, "until_exclusive_utc": args.until},
        "population": "One consenting developer's local CLI transcripts; convenience sample, not representative of all agents or tasks.",
        "measurement": "UTF-8 bytes of tool inputs and textual output payloads after provider/call deduplication; transcript JSON envelopes excluded. Bytes are not measured tokens or billed cost.",
        "usage_semantics": USAGE_SEMANTICS,
        "providers": {},
    }
    private = []
    for provider, root, parse in (("codex", args.codex_dir, codex_file), ("claude", args.claude_dir, claude_file), ("devin", args.devin_db, devin_database)):
        collector = Collector(provider, args.since, args.until)
        if provider == "devin":
            if root.exists():
                parse(root, collector)
            else:
                collector.stats["source_unavailable"] += 1
        else:
            paths = sorted(root.rglob("*.jsonl")) if root.exists() else []
            collector.stats["discovered_transcript_files"] = len(paths)
            for path in paths:
                if path.stat().st_mtime < collector.since:
                    collector.stats["files_with_mtime_before_window_excluded"] += 1
                    continue
                collector.stats["transcript_files_scanned"] += 1
                parse(path, collector)
        result["providers"][provider] = collector.finish()
        private.extend(collector.samples.values())
        print(f"{provider}: {len(collector.calls)} unique tool calls; {len(collector.usages)} usage responses", file=__import__("sys").stderr)
    result["analyzer_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    result["corpus_evidence_sha256"] = digest({k: v["selected_evidence_sha256"] for k, v in result["providers"].items()})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if args.private_samples:
        write_private_samples(args.private_samples, sorted(private, key=lambda r: (r["provider"], r["sample_id"])))


if __name__ == "__main__":
    main()
