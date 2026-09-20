#!/usr/bin/env python3
"""Count private replay text locally; emit only aggregate/opaque measurements.

Install research/requirements.txt into an isolated environment. This counts
o200k_base text tokens, not provider billing or complete agent-task usage.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MIN_RAW_BYTES = 8192
MIN_NET_TOKENS = 128
BASELINE_INSTRUCTION_ESTIMATE = "Run the project tests and report the exit status and actionable failures."
BASELINE_INVOCATION = json.dumps({"cmd": "bun test"}, separators=(",", ":"))
SKILL_INVOCATION = json.dumps({"cmd": "system-one-skills check --timeout-ms 900000 -- bun test"}, separators=(",", ":"))


def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def skill_catalog(text):
    """The visible name and description, counted in addition to the full file."""
    name = re.search(r"(?m)^name:\s*(.+)$", text)
    description = re.search(r"(?m)^description:\s*(.+)$", text)
    if not name or not description:
        raise ValueError("Skill must contain name and one-line description")
    return name.group(1) + ": " + description.group(1)


def costs(counter, skill):
    baseline = counter(BASELINE_INVOCATION)
    invocation = counter(SKILL_INVOCATION)
    loaded = counter(skill)
    catalog = counter(skill_catalog(skill))
    return {
        "shared_baseline_instruction_estimate": BASELINE_INSTRUCTION_ESTIMATE,
        "shared_baseline_instruction_estimate_tokens": counter(BASELINE_INSTRUCTION_ESTIMATE),
        "original_recorded_user_and_system_prompt_tokens": None,
        "original_prompt_coverage": "Original complete user/system prompts were not retained in the private replay sample. The shared instruction above is a constructed accounting estimate, not a transcript quotation; it is charged equally to both arms and cancels in their difference.",
        "baseline_invocation": BASELINE_INVOCATION,
        "baseline_invocation_tokens": baseline,
        "skill_invocation": SKILL_INVOCATION,
        "skill_invocation_tokens": invocation,
        "incremental_invocation_tokens": invocation - baseline,
        "full_skill_file_tokens": loaded,
        "catalog_name_description_tokens": catalog,
        "first_use_incremental_tokens": loaded + catalog + invocation - baseline,
        "policy": "Charge full skill instructions and the catalog name/description on every case, plus representative incremental invocation tokens. This conservatively avoids amortizing setup across repeated calls. Shared baseline context is estimated and cancels; provider chat framing, cache treatment, reasoning, retries and later log retrieval are unmeasured.",
    }


def assess_rows(private_rows, counter, overhead, threshold=MIN_RAW_BYTES):
    rows = []
    for case in private_rows:
        if case.get("provider") not in {"codex", "claude", "devin"}:
            raise ValueError("Unknown provider")
        if not re.fullmatch(r"[a-f0-9]{64}", case.get("sample_id", "")):
            raise ValueError("Invalid sample ID")
        raw, shown = case["log"], case["presented_text"]
        raw_tokens, shown_tokens = counter(raw), counter(shown)
        raw_bytes = len(raw.encode())
        saving = raw_tokens - shown_tokens
        # Routing MUST NOT depend on the observed token saving. Otherwise this
        # assessment would cherry-pick successes unavailable before invocation.
        routed = raw_bytes >= threshold
        invariants = case["invariants"]
        if not isinstance(invariants, dict) or not all(isinstance(v, bool) for v in invariants.values()):
            raise ValueError("Replay invariants must be explicit booleans")
        net = saving - overhead["first_use_incremental_tokens"]
        rows.append({
            "provider": case["provider"], "cohort": case["cohort"],
            "sample_id": case["sample_id"], "source_view": case["source_view"],
            "archived_output_bytes": raw_bytes, "presented_output_bytes": len(shown.encode()),
            "archived_output_tokens": raw_tokens, "presented_output_tokens": shown_tokens,
            "output_tokens_saved": saving,
            "first_use_incremental_tokens": overhead["first_use_incremental_tokens"],
            "net_tokens_saved_after_first_use": net,
            "net_tokens_saved_after_invocation_only": saving - overhead["incremental_invocation_tokens"],
            "routed_by_prior_output_size": routed,
            "runtime_compacted": case["compacted"],
            "capture_truncated": case.get("capture_truncated", False),
            "recorded_exit_zero": case["exit_code"] == 0,
            "meets_net_margin": net >= MIN_NET_TOKENS,
            "invariants": invariants,
            "presented_text_sha256": sha(shown),
        })
    return rows


def summarize(rows):
    routed = [r for r in rows if r["routed_by_prior_output_size"]]
    return {
        "sampled_cases": len(rows), "routed_cases": len(routed),
        "nonrouted_cases_retained": len(rows) - len(routed),
        "runtime_compacted_cases": sum(r["runtime_compacted"] for r in rows),
        "all_cases_net_tokens_if_invoked_every_time": sum(r["net_tokens_saved_after_first_use"] for r in rows),
        "all_cases_with_negative_net": sum(r["net_tokens_saved_after_first_use"] < 0 for r in rows),
        "routed_archived_output_tokens": sum(r["archived_output_tokens"] for r in routed),
        "routed_presented_output_tokens": sum(r["presented_output_tokens"] for r in routed),
        "routed_first_use_incremental_tokens": sum(r["first_use_incremental_tokens"] for r in routed),
        "routed_net_tokens_saved": sum(r["net_tokens_saved_after_first_use"] for r in routed),
        "routed_minimum_net_tokens_saved": min((r["net_tokens_saved_after_first_use"] for r in routed), default=None),
        "routed_cases_below_margin": sum(not r["meets_net_margin"] for r in routed),
        "invariant_failures": sum(not value for r in rows for value in r["invariants"].values()),
        "recorded_nonzero_exits": sum(not r["recorded_exit_zero"] for r in rows),
    }


def build_report(private, counter, tokenizer_version, skill_path, corpus_paths):
    skill = skill_path.read_text()
    overhead = costs(counter, skill)
    rows = assess_rows(private["samples"], counter, overhead)
    cohorts = []
    for path in corpus_paths:
        content = path.read_bytes()
        report = json.loads(content)
        cohorts.append({
            "path": path.relative_to(ROOT).as_posix(), "file_sha256": sha(content),
            "corpus_evidence_sha256": report["corpus_evidence_sha256"],
            "window": report["window"],
            "providers": {name: {
                "contributing_session_groups": p["sessions_with_selected_evidence"],
                "unique_tool_calls": p["unique_tool_calls"],
                "eligible_replay_outputs": p["selection_and_exclusions"].get("replay_eligible_completed_validation_outputs", 0),
            } for name, p in report["providers"].items()},
        })
    source_paths = [Path(__file__), ROOT / "research/replay_validation.mjs", ROOT / "research/requirements.txt", ROOT / "research/analyze_sessions.py", skill_path]
    source_paths += sorted((ROOT / "src").rglob("*.js")) + sorted((ROOT / "bin").rglob("*.js"))
    return {
        "schema_version": 2,
        "portfolio": ["system-one-verify"],
        "evaluation_set_role": "Development/calibration cohort used to tune the reducer, including the observed 8207-byte counterexample. It is not an independent holdout set.",
        "tokenizer": {
            "library": "tiktoken", "version": tokenizer_version, "encoding": "o200k_base",
            "scope": "Exact counts for this named public text encoding, computed locally. These are not measured Devin/Claude tokenization, provider billed tokens, or complete task usage.",
            "reference": "https://github.com/openai/tiktoken",
        },
        "routing": {
            "minimum_expected_output_bytes": MIN_RAW_BYTES,
            "minimum_net_token_margin": MIN_NET_TOKENS,
            "rule": "Invoke only when prior runs already establish at least 8KiB of ordinary validation output and the task needs exit status. Replay simulates this selection by treating the archived output size as an available prior observation; it does not establish what the historical agent knew or that the next run has the same size. Never run a command solely to discover its output size. Selection is independent of measured token savings; every selected case must pass the net margin.",
        },
        "overhead": overhead,
        "corpora": cohorts,
        "private_replay_digest": private["private_replay_digest"],
        "summary": summarize(rows),
        "providers": {name: summarize([r for r in rows if r["provider"] == name]) for name in ("codex", "claude", "devin")},
        "threshold_sensitivity": [{"minimum_output_bytes": threshold, **summarize(assess_rows(private["samples"], counter, overhead, threshold))} for threshold in (4096, 8192, 16384, 32768)],
        "limitations": [
            "One developer's retained transcripts; deterministic convenience sample, not a representative population or randomized experiment.",
            "This cohort was used to tune the reducer and threshold presentation. Independent held-out agent tasks are still required to assess generalization.",
            "Original user/system prompt history is unavailable in replay; shared baseline instruction overhead is an explicit estimate, not recovered transcript text.",
            "Every nonrouted case remains visible, including added skill/invocation overhead despite byte-exact passthrough.",
            "Preserved exit metadata, bounded excerpts and a complete saved log do not establish diagnostic completeness or original task success.",
            "Later full-log retrieval, repairs, reasoning and cache/billing behavior are not measured. There is no claim of end-to-end or billed token savings.",
            "The exact presented strings include replay artifact paths with a cohort label, opaque sample hash, and temporary-directory nonce. These paths are longer than the default CLI log path and add conservative path overhead; fresh nonces can slightly change token counts on rerun.",
            "CI call frequency alone does not establish savings versus native gh run watch; CI is not an admitted skill.",
        ],
        "evaluated_source_sha256": {p.relative_to(ROOT).as_posix(): sha(p.read_bytes()) for p in source_paths},
        "samples": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("private_replay", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "research/admission-report.json")
    parser.add_argument("--corpus", type=Path, action="append", required=True)
    args = parser.parse_args()
    path = args.private_replay.resolve()
    if path == ROOT or ROOT in path.parents:
        parser.error("Private replay text must remain outside the repository")
    os.environ.setdefault("TIKTOKEN_CACHE_DIR", str(path.parent / "tokenizer-cache"))
    import tiktoken
    if tiktoken.__version__ != "0.12.0":
        parser.error("Use pinned tiktoken==0.12.0 for this assessment")
    encoding = tiktoken.get_encoding("o200k_base")
    counter = lambda value: len(encoding.encode(value, disallowed_special=()))
    report = build_report(json.loads(path.read_text()), counter, tiktoken.__version__, ROOT / "skills/system-one-verify/SKILL.md", [p.resolve() for p in args.corpus])
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"summary": report["summary"], "providers": report["providers"], "overhead": {k: v for k, v in report["overhead"].items() if k.endswith("tokens")}}, indent=2))


if __name__ == "__main__":
    main()
