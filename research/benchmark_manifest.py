#!/usr/bin/env python3
"""Select opaque task episodes before outcome metrics are inspected.

Provider-specific transcript adapters produce a private candidate JSON array.
This module only validates eligibility metadata and performs deterministic,
stratified sampling. It never reads raw prompts, commands, paths, or outputs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / "bench/benchmark-protocol.json"
PROVIDERS = {"codex", "claude", "devin"}


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def load_protocol() -> dict[str, Any]:
    protocol = json.loads(PROTOCOL.read_text())
    if protocol.get("schema_version") != 1 or set(protocol.get("providers", [])) != PROVIDERS or protocol.get("selection", {}).get("outcome_blind") is not True:
        raise ValueError("benchmark protocol provider/schema inventory changed")
    families = protocol.get("task_families", {})
    if set(families) != {
        "system-one-verify", "system-one-explore", "system-one-ci", "system-one-diff",
        "system-one-digest", "system-one-fetch", "system-one-research", "system-one-triage",
        "system-one-writing", "system-one-evolve", "system-one",
    }:
        raise ValueError("benchmark protocol task-family inventory changed")
    return protocol


def validate_candidates(value: Any, protocol: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError("candidate input must be a JSON array")
    seen: set[str] = set()
    required = {"opaque_episode_id", "provider", "model", "task_family", "task_snapshot_sha256",
                "selection_eligible", "selection_stratum", "stratum_source", "used_for_tuning",
                "task_cluster_hash", "session_hash"}
    rows: list[dict[str, Any]] = []
    for row in value:
        if not isinstance(row, dict) or not required.issubset(row):
            raise ValueError("candidate is missing pre-outcome selection metadata")
        ident = row["opaque_episode_id"]
        if not isinstance(ident, str) or len(ident) != 64 or any(c not in "0123456789abcdef" for c in ident) or ident in seen:
            raise ValueError("candidate IDs must be unique nonempty opaque strings")
        seen.add(ident)
        if row["provider"] not in PROVIDERS or not isinstance(row["model"], str) or not row["model"]:
            raise ValueError("candidate provider/model is invalid")
        if row["task_family"] not in protocol["task_families"]:
            raise ValueError(f"candidate task family is not planned: {row['task_family']}")
        snapshot = row["task_snapshot_sha256"]
        if not isinstance(snapshot, str) or len(snapshot) != 64 or any(c not in "0123456789abcdef" for c in snapshot):
            raise ValueError("candidate task snapshot must be a SHA-256 hex digest")
        if not isinstance(row["selection_eligible"], bool) or not isinstance(row["used_for_tuning"], bool):
            raise ValueError("selection_eligible and used_for_tuning must be booleans")
        if not isinstance(row["selection_stratum"], str) or not row["selection_stratum"]:
            raise ValueError("selection_stratum must be a predeclared nonempty label")
        if row["stratum_source"] not in {"pre_arm_fixture", "historical_development_only", "native_control_presence", "output_size_band"}:
            raise ValueError("stratum_source is not an outcome-blind planned source")
        for key in ("task_cluster_hash", "session_hash"):
            if not isinstance(row[key], str) or len(row[key]) != 64 or any(c not in "0123456789abcdef" for c in row[key]):
                raise ValueError(f"{key} must be an opaque SHA-256 hash")
        # Outcome-like keys are accepted for private adapter bookkeeping but
        # are deliberately ignored by selection. A selector must not inspect
        # them to improve a result.
        rows.append(row)
    return rows


def select(value: Any, protocol: dict[str, Any], seed: str, per_stratum: int) -> dict[str, Any]:
    if not seed or per_stratum < 1:
        raise ValueError("seed and positive per_stratum are required")
    rows = validate_candidates(value, protocol)
    eligible = [r for r in rows if r["selection_eligible"] and not r["used_for_tuning"]]
    ineligible_reasons = Counter()
    for row in rows:
        if not row["selection_eligible"]:
            ineligible_reasons["selection_eligible_false"] += 1
        if row["used_for_tuning"]:
            ineligible_reasons["used_for_tuning"] += 1
    strata: dict[tuple[str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in eligible:
        key = (row["provider"], row["model"], row["task_family"], row["selection_stratum"])
        strata[key].append(row)
    selected: list[dict[str, Any]] = []
    counts: dict[str, Any] = {}
    duplicate_exclusions = 0
    for key, group in sorted(strata.items()):
        provider, model, family, stratum = key
        ordered = sorted(group, key=lambda r: digest(f"{seed}:{r['opaque_episode_id']}"))
        used_clusters: set[str] = set()
        used_sessions: set[str] = set()
        take: list[dict[str, Any]] = []
        for row in ordered:
            if row["task_cluster_hash"] in used_clusters or row["session_hash"] in used_sessions:
                duplicate_exclusions += 1
                continue
            if len(take) >= per_stratum:
                break
            take.append(row)
            used_clusters.add(row["task_cluster_hash"])
            used_sessions.add(row["session_hash"])
        selected.extend(take)
        label = "|".join(key)
        counts[label] = {"eligible": len(group), "selected": len(take), "inclusion_probability": len(take) / len(group), "provider": provider, "model": model, "task_family": family, "selection_stratum": stratum}
    # Public manifest contains no candidate payload beyond safe matching keys.
    manifest = [{
        "opaque_episode_id": row["opaque_episode_id"],
        "provider": row["provider"],
        "model": row["model"],
        "task_family": row["task_family"],
        "task_snapshot_sha256": row["task_snapshot_sha256"],
        "selection_stratum": row["selection_stratum"],
        "inclusion_probability": counts["|".join((row["provider"], row["model"], row["task_family"], row["selection_stratum"]))]["inclusion_probability"],
        "selection_ref": digest(json.dumps({"seed": seed, "protocol_sha256": digest(PROTOCOL.read_text()), "selector_version": protocol["selection"]["selector_version"], "provider": row["provider"], "model": row["model"], "task_family": row["task_family"], "stratum": row["selection_stratum"]}, sort_keys=True)),
    } for row in sorted(selected, key=lambda r: r["opaque_episode_id"])]
    return {
        "schema_version": 1,
        "status": "selected-before-outcome-evaluation",
        "protocol_sha256": digest(PROTOCOL.read_text()),
        "seed_ref": digest(seed),
        "per_stratum_cap": per_stratum,
        "eligible_total": len(eligible),
        "candidate_total": len(rows),
        "ineligible_total": len(rows) - len(eligible),
        "ineligible_reasons": dict(sorted(ineligible_reasons.items())),
        "duplicate_task_or_session_exclusions": duplicate_exclusions,
        "selected_total": len(manifest),
        "eligible_by_provider": dict(sorted(Counter(r["provider"] for r in eligible).items())),
        "selected_by_provider": dict(sorted(Counter(r["provider"] for r in manifest).items())),
        "strata": counts,
        "episodes": manifest,
        "selection_limit": "No outcome, token, correctness, elapsed-time, or measured-savings field was read by the selector.",
    }


def check() -> None:
    protocol = load_protocol()
    assert protocol["selection"]["development_data"]
    assert "outcome" in protocol["selection"]["sampling"]
    print("Benchmark manifest protocol valid; selection is outcome-blind and provider-scoped")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--candidates", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--seed", default="system-one-benchmark-seed-v1")
    parser.add_argument("--per-stratum", type=int, default=30)
    args = parser.parse_args()
    protocol = load_protocol()
    if args.check:
        check()
        return
    if not args.candidates or not args.output:
        parser.error("--candidates and --output are required unless --check is used")
    report = select(json.loads(args.candidates.read_text()), protocol, args.seed, args.per_stratum)
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
