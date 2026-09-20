#!/usr/bin/env python3
"""Frozen-parser retrospective failure excerpts. Never execute saved commands."""
from __future__ import annotations
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import sys

from collect_holdout import Collector as BaseCollector, analysis
ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / 'research/failure-protocol.json'

class Collector(BaseCollector):
    def replay_candidate(self, key, replay, source_view):
        self.stats['replay_eligible_completed_validation_outputs'] += 1
        self.stats['explicit_exit_zero' if replay['exit_code'] == 0 else 'explicit_exit_nonzero'] += 1
        if replay['exit_code'] == 0:
            return
        if len(replay['log'].encode()) < 8192:
            self.stats['nonzero_below_8192_bytes'] += 1
            return
        self.stats['nonzero_at_least_8192_bytes_before_text_dedup'] += 1
        self.samples[key] = {'provider': self.provider, 'sample_id': key, 'source_view': source_view, **replay}

    def finish(self):
        result = super().finish()
        seen, unique = set(), []
        for row in sorted(self.samples.values(), key=lambda r: r['sample_id']):
            key = analysis.digest([row['log'], row['exit_code']])
            if key in seen:
                self.stats['duplicate_failure_text_and_exit_excluded'] += 1
                continue
            seen.add(key)
            unique.append(row)
        self.stats['distinct_noisy_nonzero_excerpts'] = len(unique)
        self.samples = {r['sample_id']: r for r in unique[:12]}
        self.stats['selected_noisy_nonzero_excerpts'] = len(self.samples)
        result['selection_and_exclusions'] = dict(sorted(self.stats.items()))
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--private-samples', required=True, type=Path)
    args = parser.parse_args()
    dest = args.private_samples.resolve()
    if dest == ROOT or ROOT in dest.parents:
        parser.error('Private samples must remain outside repository')
    protocol = json.loads(PROTOCOL.read_text())
    for rel, expected in protocol['frozen_sources'].items():
        if hashlib.sha256((ROOT / rel).read_bytes()).hexdigest() != expected:
            parser.error('Frozen source changed: ' + rel)
    since, until = protocol['window'].values()
    result = {'schema_version': 1, 'protocol_sha256': hashlib.sha256(PROTOCOL.read_bytes()).hexdigest(),
              'window': protocol['window'], 'providers': {}, 'collector_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    private = []
    for provider, path, parse in (
        ('codex', Path.home() / '.codex/sessions', analysis.codex_file),
        ('claude', Path.home() / '.claude/projects', analysis.claude_file),
        ('devin', Path.home() / '.local/share/devin/cli/sessions.db', analysis.devin_database),
    ):
        collector = Collector(provider, since, until)
        if provider == 'devin':
            if path.exists(): parse(path, collector)
            else: collector.stats['source_unavailable'] += 1
        else:
            paths = sorted(path.rglob('*.jsonl')) if path.exists() else []
            collector.stats['discovered_transcript_files'] = len(paths)
            for item in paths:
                if item.stat().st_mtime < collector.since:
                    collector.stats['files_with_mtime_before_window_excluded'] += 1
                    continue
                collector.stats['transcript_files_scanned'] += 1
                parse(item, collector)
        result['providers'][provider] = collector.finish()
        private.extend(collector.samples.values())
        print(json.dumps({'provider': provider, 'counts': result['providers'][provider]['selection_and_exclusions']}), flush=True)
    result['corpus_evidence_sha256'] = analysis.digest({k: v['selected_evidence_sha256'] for k, v in result['providers'].items()})
    analysis.write_private_samples(dest, sorted(private, key=lambda r: (r['provider'], r['sample_id'])))
    result['private_samples_sha256'] = hashlib.sha256((dest / 'validation-replay-inputs.json').read_bytes()).hexdigest()
    (ROOT / 'research/failure-corpus-report.json').write_text(json.dumps(result, indent=2) + '\n')

if __name__ == '__main__': main()
