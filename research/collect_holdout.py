#!/usr/bin/env python3
"""Collect a new holdout through the frozen analyzer with one explicit adapter.

Unsupported non-object output metadata is normalized to an empty object. The
archived textual content is unchanged; only already-supported explicit exit
paths can qualify a replay. Both source hashes and normalization counters are
published. This does not revise the provenance of earlier calibration reports.
All original analyzer arguments are accepted. The safer default aggregate path
is research/holdout-session-report.json, never the frozen calibration report.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

BASE_PATH = Path(__file__).with_name("analyze_sessions.py")
_spec = importlib.util.spec_from_file_location("holdout_base_analyzer", BASE_PATH)
analysis = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(analysis)


class Collector(analysis.Collector):
    """Normalize only the unsupported metadata boundary; retain base selection."""

    def output(self, ident, content, timestamp, session, metadata=None, event_id=None):
        if self.eligible(timestamp) and metadata is not None and not isinstance(metadata, dict):
            self.stats["collector_adapter_non_object_metadata_normalized"] += 1
            metadata = {}
        return super().output(ident, content, timestamp, session, metadata, event_id)


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    # Parse only the shared output option to locate the base analyzer's result.
    # The base parser remains authoritative for every argument and validation.
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--output", type=Path)
    known, _ = parser.parse_known_args(args)
    output = known.output
    if output is None:
        output = Path("research/holdout-session-report.json")
        args += ["--output", str(output)]
    base_hash = hashlib.sha256(BASE_PATH.read_bytes()).hexdigest()
    adapter_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    original_collector, original_argv = analysis.Collector, sys.argv
    try:
        analysis.Collector = Collector
        sys.argv = [str(Path(__file__)), *args]
        analysis.main()
    finally:
        analysis.Collector, sys.argv = original_collector, original_argv
    result = json.loads(output.read_text())
    if (result.get("analyzer_sha256") != base_hash
            or hashlib.sha256(BASE_PATH.read_bytes()).hexdigest() != base_hash
            or hashlib.sha256(Path(__file__).read_bytes()).hexdigest() != adapter_hash):
        raise RuntimeError("collector or base analyzer provenance changed during collection")
    result["collector_adapter_sha256"] = adapter_hash
    result["collector_adapter"] = {
        "name": "normalize-non-object-output-metadata",
        "scope": "New holdout collection only; this is an amended parser boundary, not an unchanged calibration collector.",
        "behavior": "Non-null, non-dict metadata becomes {}; textual content and explicit exit parsing are unchanged. No exit code is inferred.",
        "counter": "collector_adapter_non_object_metadata_normalized",
        "counter_semantics": "Selected-window output calls normalized before the base output-fragment deduplication; absent/null metadata needs no normalization.",
    }
    output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
