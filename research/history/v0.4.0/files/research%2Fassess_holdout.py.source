#!/usr/bin/env python3
"""Assess the locally predeclared replay window; keep negative results public."""
import argparse
import hashlib
import json
from pathlib import Path
import os

from assess_admission import ROOT, build_report


def verify_replay_digest(replay):
    """Reproduce JSON.stringify(samples) for the frozen replay schema.

    Replay samples contain ordered objects, strings, booleans and integer exit
    codes. Python's JSON reader retains emitted key order; compact UTF-8 JSON
    matches the JS serializer for this schema. Reject stale or altered metadata
    before publishing the separately hashed complete private file.
    """
    payload = json.dumps(replay['samples'], ensure_ascii=False,
                         separators=(',', ':'), allow_nan=False).encode('utf-8')
    actual = hashlib.sha256(payload).hexdigest()
    if replay.get('private_replay_digest') != actual:
        raise ValueError('Private replay digest does not match its sample payload')
    return actual


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('private_replay', type=Path)
    parser.add_argument('--samples', type=Path, required=True,
                        help='Exact private sample file emitted with the frozen-window corpus report')
    args = parser.parse_args()
    private = args.private_replay.resolve()
    if private == ROOT or ROOT in private.parents:
        parser.error('Private text must remain outside the repository')
    samples_path = args.samples.resolve()
    if samples_path == ROOT or ROOT in samples_path.parents:
        parser.error('Private source samples must remain outside the repository')
    protocol_path = ROOT / 'research/holdout-protocol.json'
    protocol = json.loads(protocol_path.read_text())
    for path, expected in protocol['evaluated_source_sha256'].items():
        if hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != expected:
            parser.error(f'Frozen source changed: {path}; do not relabel a tuned cohort as unseen')
    corpus_path = ROOT / 'research/holdout-session-report.json'
    corpus = json.loads(corpus_path.read_text())
    assert corpus['window'] == protocol['window'], 'Window differs from predeclared protocol'
    adapter_hash = hashlib.sha256((ROOT / 'research/collect_holdout.py').read_bytes()).hexdigest()
    assert protocol['collector_adapter_sha256'] == corpus['collector_adapter_sha256'] == adapter_hash
    samples_bytes, replay_bytes = samples_path.read_bytes(), private.read_bytes()
    samples, replay = json.loads(samples_bytes), json.loads(replay_bytes)
    verify_replay_digest(replay)
    fields = ('provider', 'sample_id', 'source_view', 'log', 'exit_code')
    def normalized(rows):
        return sorted([{k: row.get(k, 'tool_result') if k == 'source_view' else row[k]
                        for k in fields} for row in rows],
                      key=lambda row: (row['provider'], row['sample_id']))
    assert normalized(samples) == normalized(replay['samples']), 'Replay differs from collected sample text, identity, provenance or exit status'
    assert len({(r['provider'], r['sample_id']) for r in samples}) == len(samples)
    for provider, data in corpus['providers'].items():
        eligible = data['selection_and_exclusions'].get('replay_eligible_completed_validation_outputs', 0)
        assert sum(r['provider'] == provider for r in samples) == min(12, eligible)
    assert all(r['cohort'] == 'holdout' for r in replay['samples'])
    os.environ.setdefault('TIKTOKEN_CACHE_DIR', str(private.parent.parent / 'tokenizer-cache'))
    import tiktoken
    assert tiktoken.__version__ == '0.12.0'
    encoding = tiktoken.get_encoding('o200k_base')
    counter = lambda value: len(encoding.encode(value, disallowed_special=()))
    report = build_report(replay, counter, tiktoken.__version__,
                          ROOT / 'skills/system-one-verify/SKILL.md', [corpus_path])
    report['evaluation_set_role'] = protocol['purpose']
    report['protocol_sha256'] = hashlib.sha256(protocol_path.read_bytes()).hexdigest()
    report['report_generator_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    report['collector_adapter_sha256'] = adapter_hash
    report['private_source_samples_sha256'] = hashlib.sha256(samples_bytes).hexdigest()
    report['private_replay_file_sha256'] = hashlib.sha256(replay_bytes).hexdigest()
    report['limitations'] = [s for s in report['limitations'] if 'used to tune' not in s]
    report['limitations'].append('This is previously unused historical text under a frozen protocol, not randomized agent tasks. Tasks and excerpts can be correlated; no generalization, diagnostic-quality, latency or billed-savings claim follows.')
    report['limitations'].append('The protocol was recorded locally before collection and analysis; its timestamp is not an independent public preregistration. Private collector and replay files are identity/text/exit-matched and bound by hashes, not published.')
    summary = report['summary']
    report['outcome'] = ('preservation-failure' if summary['invariant_failures'] else
                         'routed-token-margin-failure' if summary['routed_cases_below_margin'] else
                         'no-eligible-routed-cases' if not summary['routed_cases'] else
                         'selected-replays-clear-token-margin')
    (ROOT / 'research/holdout-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'outcome': report['outcome'], 'summary': summary,
                      'providers': report['providers']}, indent=2))


if __name__ == '__main__':
    main()
