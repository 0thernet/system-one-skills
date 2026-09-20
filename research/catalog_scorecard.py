#!/usr/bin/env python3
"""Build the public numeric screen for every catalog entry.

This report separates a measured reduction from a retrospective opportunity
screen. Workflow volume and a token headroom ceiling are useful for choosing
the next experiment, but they are not a skill result: no candidate is assigned
a reduction percentage without paired arms, correctness, and timing evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROVIDERS = ("codex", "claude", "devin")
OVERHEAD = 128
MARGIN = 128
THRESHOLD = OVERHEAD + MARGIN


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path: str) -> dict:
    return json.loads((ROOT / path).read_text())


def workflow(report: dict, name: str) -> dict:
    rows = [
        report["providers"][provider]["workflow_screen"][name]
        for provider in PROVIDERS
    ]
    calls = sum(row["calls"] for row in rows)
    output_tokens = sum(row["output_tokens"] for row in rows)
    threshold_rows = []
    for row in rows:
        match = next(
            (item for item in row["hypothetical_ceiling_screen"]
             if item["per_use_overhead_tokens"] == OVERHEAD
             and item["required_margin_tokens"] == MARGIN),
            None,
        )
        if match is None:
            raise ValueError(f"missing {OVERHEAD}+{MARGIN} ceiling row for {name}")
        threshold_rows.append(match)
    eligible = sum(item["calls_reaching_ceiling_requirement"] for item in threshold_rows)
    return {
        "observed_calls": calls,
        "calls_with_observed_output": sum(row["calls_with_observed_output"] for row in rows),
        "calls_without_observed_output": sum(row["calls_without_observed_output"] for row in rows),
        "output_fragments": sum(row["output_fragments"] for row in rows),
        "multiple_fragment_calls": sum(row["multiple_fragment_calls"] for row in rows),
        "observed_output_tokens": output_tokens,
        "output_token_quantiles_by_provider": {
            provider: report["providers"][provider]["workflow_screen"][name]["output_token_quantiles"]
            for provider in PROVIDERS
        },
        "native_controls": {
            control: sum(row["native_controls"].get(control, 0) for row in rows)
            for control in sorted({control for row in rows for control in row["native_controls"]})
        },
        "headroom_screen": {
            "per_use_overhead_tokens": OVERHEAD,
            "required_margin_tokens": MARGIN,
            "threshold_tokens": THRESHOLD,
            "calls_reaching_threshold": eligible,
            "calls_reaching_threshold_pct": round(100 * eligible / calls, 2) if calls else None,
            "interpretation": "Optimistic deletion ceiling only; it assumes the candidate could remove every output token and proves neither a replacement, correctness, nor a saving.",
        },
        "by_provider": {
            provider: {
                "calls": report["providers"][provider]["workflow_screen"][name]["calls"],
                "calls_with_observed_output": report["providers"][provider]["workflow_screen"][name]["calls_with_observed_output"],
                "output_tokens": report["providers"][provider]["workflow_screen"][name]["output_tokens"],
                "calls_reaching_threshold": next(
                    item["calls_reaching_ceiling_requirement"]
                    for item in report["providers"][provider]["workflow_screen"][name]["hypothetical_ceiling_screen"]
                    if item["per_use_overhead_tokens"] == OVERHEAD and item["required_margin_tokens"] == MARGIN
                ),
            }
            for provider in PROVIDERS
        },
    }


def build() -> dict:
    candidate = load("research/candidate-report.json")
    ci = load("research/ci-pilot-report.json")
    verify = load("research/verify-current-report.json")
    sources = [
        "research/catalog_scorecard.py",
        "research/candidate-report.json",
        "research/analyze_sessions.py",
        "research/candidate_screen.py",
        "research/candidate-protocol.json",
        "research/ci-pilot-report.json",
        "research/verify-current-report.json",
    ]
    screens = {
        "system-one-explore": workflow(candidate, "repository_search"),
        "system-one-digest": workflow(candidate, "git_state"),
        "system-one-diff": workflow(candidate, "diff_review"),
        "system-one-fetch": workflow(candidate, "web_research"),
        # Fetch and research share the same coarse web proxy. Preserve the
        # shared denominator instead of claiming two independent cohorts.
        "system-one-research": {
            **workflow(candidate, "web_research"),
            "shared_proxy_with": "system-one-fetch",
            "shared_cohort_id": "web_research_v1",
            "counted_once_as": "web_research",
        },
    }
    ci_result = ci["result"]
    screens["system-one-ci"] = {
        "observed_calls": ci_result["observed_ci_calls"],
        "identity_resolved_calls": ci_result["identity_resolved_calls"],
        "identity_resolved_groups": ci_result["identity_resolved_groups"],
        "repeated_identity_groups": ci_result["repeated_identity_groups"],
        "avoidable_model_turns_established": any(
            sequence.get("avoidable_model_turns_established") is True
            for sequence in ci_result["selected_sequences"]
        ) if ci_result["selected_sequences"] else None,
        "selected_sequence_count": len(ci_result["selected_sequences"]),
        "measured_token_savings": ci.get("measured_token_savings"),
        "status": "native_baseline_preferred",
        "interpretation": "Native run watching is the baseline. The pilot did not establish an avoidable model turn, so it does not produce a reduction percentage.",
    }
    screens["system-one-explore"]["status"] = "retrospective_headroom_only"
    screens["system-one-digest"]["status"] = "retrospective_headroom_only"
    screens["system-one-diff"]["status"] = "retrospective_headroom_only"
    screens["system-one-fetch"]["status"] = "shared_proxy_retrospective_only"
    screens["system-one-fetch"]["shared_proxy_with"] = "system-one-research"
    screens["system-one-fetch"]["shared_cohort_id"] = "web_research_v1"
    screens["system-one-fetch"]["counted_once_as"] = "web_research"
    screens["system-one-research"]["status"] = "shared_proxy_retrospective_only"
    zero = {
        "observed_calls": 0,
        "reduction_pct": None,
        "status": "no_dedicated_cohort",
        "interpretation": "No dedicated, labeled episodes were observed; zero is a coverage count, not a measured saving.",
    }
    for name in ("system-one-triage", "system-one-writing", "system-one-evolve", "system-one"):
        screens[name] = zero.copy()
    return {
        "schema_version": 1,
        "measurement": "The verify percentage is a text-boundary replay result. All other percentages are omitted: their candidate screens report real workflow volume and an optimistic output-token headroom ceiling only. Whole-task token reductions require paired native-versus-skill task results.",
        "token_screen": {"per_use_overhead_tokens": OVERHEAD, "required_margin_tokens": MARGIN, "threshold_tokens": THRESHOLD},
        "skills": {
            "system-one-verify": {
                "reduction_pct": verify["all_providers"]["text_reduction_pct"],
                "metric_kind": "verified_text_boundary_only",
                "status": "verified_text_boundary_only",
                "reduction_scope": "UTF-8 text at the tool-result boundary across 563 replayed validation outputs",
                "whole_task_provider_token_result": verify["whole_task_provider_token_result"]["status"],
                "preservation_failures": verify["all_providers"]["preservation_invariant_failures"],
                "whole_task_provider_tokens": None,
            },
            **{
                name: {
                    "reduction_pct": None,
                    "metric_kind": "no_paired_result",
                    "whole_task_provider_token_result": "not_established",
                    **value,
                }
                for name, value in screens.items()
            },
        },
        "sources": {path: sha(ROOT / path) for path in sources},
        "limitations": [
            "Candidate workflow labels are discovery evidence, not task boundaries.",
            "Headroom percentages assume total deletion of a tool result and do not measure any implementation.",
            "Fetch and research deliberately share one web-research proxy and must not be added together.",
            "No unimplemented candidate receives a reduction percentage.",
        ],
    }


def check(report: dict) -> None:
    if report.get("schema_version") != 1 or set(report.get("skills", {})) != {
        "system-one-verify", "system-one-explore", "system-one-ci", "system-one-diff",
        "system-one-digest", "system-one-fetch", "system-one-research", "system-one-triage",
        "system-one-writing", "system-one-evolve", "system-one",
    }:
        raise ValueError("catalog coverage is incomplete")
    verify = load("research/verify-current-report.json")
    expected_verify = verify["all_providers"]["text_reduction_pct"]
    if report["skills"]["system-one-verify"]["reduction_pct"] != expected_verify:
        raise ValueError("verify scorecard does not match its report")
    for name, value in report["skills"].items():
        if name != "system-one-verify" and value["reduction_pct"] is not None:
            raise ValueError(f"unpaired candidate has a reduction percentage: {name}")
    if report["skills"]["system-one-fetch"].get("shared_proxy_with") != "system-one-research":
        raise ValueError("fetch/research proxy guard missing")
    if report["skills"]["system-one-research"].get("shared_proxy_with") != "system-one-fetch":
        raise ValueError("research/fetch proxy guard missing")
    for path, expected in report["sources"].items():
        if sha(ROOT / path) != expected:
            raise ValueError(f"source changed: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "research/catalog-scorecard.json")
    args = parser.parse_args()
    if args.check:
        check(json.loads(args.output.read_text()))
        print("catalog scorecard valid")
        return
    report = build()
    check(report)
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
