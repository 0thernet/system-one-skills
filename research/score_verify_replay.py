#!/usr/bin/env python3
"""Create a public, text-free scorecard from a private verify replay.

The replay contains archived validation text and is required to stay outside
the repository. This scorer publishes only provider counts, byte totals,
percentages, preservation checks, and a digest binding the private input.
UTF-8 bytes are deliberately reported separately from provider-native tokens.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROVIDERS = ("codex", "claude", "devin")


def digest(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def outside(path: Path) -> Path:
    resolved = path.resolve()
    if resolved == ROOT or ROOT in resolved.parents:
        raise ValueError("private replay must remain outside the repository")
    return resolved


def validate(rows: object) -> list[dict]:
    if not isinstance(rows, list) or not rows:
        raise ValueError("private replay must contain samples")
    seen: set[tuple[str, str]] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("sample must be an object")
        provider, sample_id = row.get("provider"), row.get("sample_id")
        if provider not in PROVIDERS or not isinstance(sample_id, str):
            raise ValueError("invalid provider or sample id")
        key = (provider, sample_id)
        if key in seen:
            raise ValueError("duplicate sample")
        seen.add(key)
        if not isinstance(row.get("log"), str) or not isinstance(row.get("presented_text"), str):
            raise ValueError("replay text is missing")
        if not isinstance(row.get("compacted"), bool) or not isinstance(row.get("invariants"), dict):
            raise ValueError("replay metadata is missing")
        if not all(value is True for value in row["invariants"].values()):
            raise ValueError(f"preservation invariant failed for {provider}:{sample_id}")
    return rows


def summarize(rows: list[dict]) -> dict:
    baseline = sum(len(row["log"].encode()) for row in rows)
    presented = sum(len(row["presented_text"].encode()) for row in rows)
    compacted = [row for row in rows if row["compacted"]]
    compact_baseline = sum(len(row["log"].encode()) for row in compacted)
    compact_presented = sum(len(row["presented_text"].encode()) for row in compacted)

    def percentage(old: int, new: int) -> float | None:
        return round(100 * (old - new) / old, 2) if old else None

    return {
        "eligible_outputs": len(rows),
        "compacted_outputs": len(compacted),
        "baseline_text_bytes": baseline,
        "presented_text_bytes": presented,
        "text_reduction_pct": percentage(baseline, presented),
        "compacted_baseline_text_bytes": compact_baseline,
        "compacted_presented_text_bytes": compact_presented,
        "compacted_text_reduction_pct": percentage(compact_baseline, compact_presented),
        "preservation_invariant_failures": 0,
        "exit_code_counts": {str(code): sum(row.get("exit_code") == code for row in rows) for code in sorted({row.get("exit_code") for row in rows})},
    }


def score(private_replay: Path) -> dict:
    private_replay = outside(private_replay)
    document = json.loads(private_replay.read_text())
    rows = validate(document.get("samples"))
    by_provider = {provider: summarize([row for row in rows if row["provider"] == provider]) for provider in PROVIDERS}
    source_rows = [{key: row[key] for key in ("provider", "sample_id", "source_view", "log", "exit_code")} for row in rows]
    result = {
        "schema_version": 1,
        "skill": "system-one-verify",
        "measurement": "UTF-8 bytes of complete recorded validation output versus the reducer presentation. This is a text-size result, not provider-native token usage, billed cost, or complete agent-task usage.",
        "source": {
            "private_replay_sha256": hashlib.sha256(private_replay.read_bytes()).hexdigest(),
            "sample_content_sha256": digest(source_rows),
            "providers": {provider: by_provider[provider]["eligible_outputs"] for provider in PROVIDERS},
        },
        "all_providers": summarize(rows),
        "by_provider": by_provider,
        "whole_task_provider_token_result": {
            "status": "not_established",
            "reason": "These are replayed tool results. No fresh paired native-versus-skill agent sessions with provider-native accounting, correctness scoring, and latency gates were run.",
        },
        "other_skills": {
            "status": "no_numeric_result",
            "reason": "The remaining catalog entries have no executable adapter in the package and were not assigned a percentage from workflow counts.",
        },
        "limitations": [
            "A replay remeasures the reducer's presentation boundary, not the original agent's complete task.",
            "Short outputs pass through, so the all-output percentage is lower than the compacted-only percentage.",
            "The private corpus is a convenience sample from one developer's local Codex, Claude Code, and Devin records; it is not representative.",
        ],
    }
    return result


def check_public(path: Path) -> None:
    """Check the committed aggregate without requiring private replay text."""
    document = json.loads(path.read_text())
    if document.get("schema_version") != 1 or document.get("skill") != "system-one-verify":
        raise ValueError("invalid verify scorecard identity")
    all_rows = document.get("all_providers")
    by_provider = document.get("by_provider")
    if not isinstance(all_rows, dict) or not isinstance(by_provider, dict):
        raise ValueError("scorecard summaries are missing")
    if set(by_provider) != set(PROVIDERS):
        raise ValueError("provider coverage is incomplete")
    if all_rows.get("eligible_outputs") != sum(by_provider[p]["eligible_outputs"] for p in PROVIDERS):
        raise ValueError("provider counts do not reconcile")
    if all_rows.get("preservation_invariant_failures") != 0 or any(
        by_provider[p].get("preservation_invariant_failures") != 0 for p in PROVIDERS
    ):
        raise ValueError("preservation failures cannot be published as a pass")
    if document.get("whole_task_provider_token_result", {}).get("status") != "not_established":
        raise ValueError("missing whole-task token limitation")
    if document.get("other_skills", {}).get("status") != "no_numeric_result":
        raise ValueError("unmeasured skills must not receive a numeric result")
    rendered = json.dumps(document, ensure_ascii=False)
    for marker in ("PRIVATE", "\nPASS\n", "\nFAIL\n"):
        if marker in rendered:
            raise ValueError("public scorecard contains raw replay text")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("private_replay", type=Path, nargs="?")
    parser.add_argument("output", type=Path, nargs="?")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        check_public(ROOT / "research/verify-current-report.json")
        print("verify scorecard valid")
        return
    if args.private_replay is None or args.output is None:
        parser.error("private_replay and output are required unless --check is used")
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        # The public report is intentionally the only output allowed in-repo.
        pass
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(score(args.private_replay), indent=2) + "\n")


if __name__ == "__main__":
    main()
