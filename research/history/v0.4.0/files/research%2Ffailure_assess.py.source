#!/usr/bin/env python3
"""Audit archived failure text without publishing text, paths or commands."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

from assess_admission import build_report, ROOT
from assess_holdout import verify_replay_digest

PROTOCOL = ROOT / 'research/failure-protocol.json'
CORPUS = ROOT / 'research/failure-corpus-report.json'
REPORT = ROOT / 'research/failure-report.json'
EVALUATED_SOURCES = {'research/assess_admission.py','research/assess_holdout.py','research/replay_validation.mjs','research/requirements.txt','research/analyze_sessions.py','skills/system-one-verify/SKILL.md','src/check.js','src/process.js','src/reduce.js','bin/system-one-skills.js'}
FROZEN_SOURCES = EVALUATED_SOURCES - {'research/assess_holdout.py'} | {'research/collect_holdout.py','research/failure_collect.py'}
SHA = re.compile(r'^[a-f0-9]{64}$')
SGR = re.compile(r'\x1b\[[0-9;:]*m')
TRUNCATION = re.compile(r'output (?:was )?truncated|truncated \d+ (?:tokens|characters|lines)|(?:\d+|\.\.\.) (?:tokens|characters|lines) truncated|output exceeded|showing (?:first|last) \d+', re.I)

def sha(value): return hashlib.sha256(value).hexdigest()
def read(path): return json.loads(path.read_text())

def aggregate(rows):
    raw = sum(r['archived_output_tokens'] for r in rows)
    shown = sum(r['presented_output_tokens'] for r in rows)
    overhead = sum(r['first_use_incremental_tokens'] for r in rows)
    retrieval = sum(r['archived_output_tokens'] for r in rows if r['annotation']['requires_log_for_any_annotated_detail'])
    return {
        'selected_cases': len(rows), 'source_truncation_marked_cases': sum(r['source_truncation_marker_present'] for r in rows),
        'compacted_cases': sum(r['runtime_compacted'] for r in rows),
        'archived_output_tokens': raw, 'presented_output_tokens': shown, 'first_use_incremental_tokens': overhead,
        'net_tokens_saved': raw-shown-overhead,
        'net_reduction_percent': (raw-shown-overhead)*100/raw if raw else None,
        'cases_with_positive_net_savings': sum(r['net_tokens_saved_after_first_use'] > 0 for r in rows),
        'cases_below_128_token_margin': sum(not r['meets_net_margin'] for r in rows),
        'narrow_invariant_failures': sum(not flag for r in rows for flag in r['invariants'].values()),
        'assessable_first_failure_cases': sum(r['annotation']['first_failure_assessable'] for r in rows),
        'first_failure_identity_and_message_retained_cases': sum(r['annotation']['first_failure_identity_and_message_retained'] for r in rows),
        'annotated_detail_units': sum(r['annotation']['detail_units'] for r in rows),
        'retained_detail_units': sum(r['annotation']['retained_detail_units'] for r in rows),
        'cases_requiring_log_for_any_annotated_detail': sum(r['annotation']['requires_log_for_any_annotated_detail'] for r in rows),
        'full_archived_log_retrieval_tokens_sensitivity': retrieval,
        'net_tokens_saved_after_one_full_retrieval_when_detail_missing': raw-shown-overhead-retrieval,
    }

def assess_annotation(row, annotation):
    """Exact spans are necessary evidence; not a diagnosis or repair oracle."""
    log, shown = row['log'], row['presented_text']
    units = annotation['detail_units']
    if not isinstance(units, list): raise ValueError('Missing explicit annotations')
    first, retained = [], []
    for unit in units:
        if unit['role'] not in ('first_identity', 'first_message', 'additional_identity', 'additional_message', 'first_location', 'additional_location'):
            raise ValueError('Unknown annotation role')
        spans = unit['spans']
        if not spans or not all(isinstance(s, str) and s.strip() and s in log for s in spans):
            raise ValueError('Every annotated span must occur in archived source')
        ok = all(s in shown for s in spans)
        retained.append(ok)
        if unit['role'] in ('first_identity', 'first_message'): first.append((unit['role'], ok))
    assessable = set(role for role, _ in first) == {'first_identity', 'first_message'}
    return {
        'coverage': annotation['coverage'],
        'first_failure_assessable': assessable,
        'first_failure_identity_and_message_retained': assessable and all(flag for _, flag in first),
        'detail_units': len(units), 'retained_detail_units': sum(retained),
        'requires_log_for_any_annotated_detail': not all(retained),
        'units': [{'role': u['role'], 'source_span_sha256': [sha(s.encode()) for s in u['spans']], 'retained': ok}
                  for u, ok in zip(units, retained)],
    }

def color_free_summary(rows):
    rows=[r['color_free_sensitivity'] for r in rows]
    return {'meaning':'Constructed SGR-stripped source and another frozen reducer text replay, not an observed native reporter run.',
        'cases':len(rows),'routed_cases':sum(r['would_route_by_normalized_prior_bytes'] for r in rows),
        'archived_output_tokens':sum(r['archived_output_tokens'] for r in rows),
        'presented_output_tokens_if_wrapped':sum(r['presented_output_tokens'] for r in rows),
        'net_tokens_saved_if_all_wrapped':sum(r['net_tokens_saved_if_wrapped'] for r in rows)}

def check():
    report, protocol, corpus = read(REPORT), read(PROTOCOL), read(CORPUS)
    assert report['protocol_sha256'] == corpus['protocol_sha256'] == sha(PROTOCOL.read_bytes())
    assert report['corpus_file_sha256'] == sha(CORPUS.read_bytes())
    if 'collection_protocol_sha256' in corpus:
        assert corpus['collection_protocol_sha256'] == protocol['amendments'][0]['initial_protocol_sha256']
    assert set(report['evaluated_source_sha256']) == EVALUATED_SOURCES
    assert set(protocol['frozen_sources']) == FROZEN_SOURCES
    for rel, expected in report['evaluated_source_sha256'].items():
        assert sha((ROOT / rel).read_bytes()) == expected, f'Report source drift: {rel}'
    assert report['report_generator_sha256'] == sha(Path(__file__).read_bytes())
    assert corpus['window'] == protocol['window']
    assert set(corpus['providers']) == set(report['providers']) == {'codex','claude','devin'}
    assert report['private_source_samples_sha256'] == corpus['private_samples_sha256']
    assert len(report['corpora']) == 1
    assert report['corpora'][0]['file_sha256'] == sha(CORPUS.read_bytes())
    assert report['corpora'][0]['corpus_evidence_sha256'] == corpus['corpus_evidence_sha256']
    assert report['corpora'][0]['window'] == corpus['window']
    assert set(report['corpora'][0]['providers']) == {'codex','claude','devin'}
    for rel, expected in protocol['frozen_sources'].items():
        assert sha((ROOT / rel).read_bytes()) == expected, f'Frozen source drift: {rel}'
    assert corpus['collector_sha256'] == protocol['frozen_sources']['research/failure_collect.py']
    for key in ('private_source_samples_sha256', 'private_replay_file_sha256', 'private_annotations_sha256', 'annotation_lock_sha256', 'private_normalized_replay_file_sha256'):
        assert SHA.fullmatch(report[key])
    rows = report['samples']
    assert len({(r['provider'], r['sample_id']) for r in rows}) == len(rows)
    for row in rows:
        assert row['provider'] in ('codex','claude','devin') and SHA.fullmatch(row['sample_id'])
        for key in ('archived_output_bytes','presented_output_bytes','archived_output_tokens','presented_output_tokens','first_use_incremental_tokens'):
            assert type(row[key]) is int and row[key] >= 0
        assert type(row['source_truncation_marker_present']) is bool
        assert row['routed_by_prior_output_size'] is True
        assert row['output_tokens_saved'] == row['archived_output_tokens'] - row['presented_output_tokens']
        assert row['net_tokens_saved_after_invocation_only'] == row['output_tokens_saved'] - report['overhead']['incremental_invocation_tokens']
        assert row['archived_output_bytes'] >= 8192 and not row['recorded_exit_zero']
        assert row['first_use_incremental_tokens'] == protocol['first_use_incremental_tokens'] == 258
        assert row['net_tokens_saved_after_first_use'] == row['archived_output_tokens'] - row['presented_output_tokens'] - 258
        assert row['meets_net_margin'] == (row['net_tokens_saved_after_first_use'] >= 128)
        assert all(type(v) is bool for v in row['invariants'].values())
        a = row['annotation']
        assert a['coverage'] in ('all-distinct-observed','bounded-first-only','unassessable')
        assert all(u['role'] in ('first_identity','first_message','first_location','additional_identity','additional_message','additional_location') and u['source_span_sha256'] for u in a['units'])
        assert a['detail_units'] == len(a['units'])
        assert a['retained_detail_units'] == sum(u['retained'] for u in a['units'])
        assert all(type(u['retained']) is bool and all(SHA.fullmatch(s) for s in u['source_span_sha256']) for u in a['units'])
        assert a['requires_log_for_any_annotated_detail'] == (a['retained_detail_units'] < a['detail_units'])
        first = [u for u in a['units'] if u['role'] in ('first_identity', 'first_message')]
        assert a['first_failure_assessable'] == (set(u['role'] for u in first) == {'first_identity', 'first_message'})
        assert a['first_failure_identity_and_message_retained'] == (a['first_failure_assessable'] and all(u['retained'] for u in first))
    assert report['summary'] == aggregate(rows)
    for row in rows:
        n = row['color_free_sensitivity']
        assert all(type(n[k]) is int and n[k] >= 0 for k in ('archived_output_bytes','archived_output_tokens','presented_output_tokens'))
        assert type(n['runtime_compacted']) is bool
        assert n['would_route_by_normalized_prior_bytes'] == (n['archived_output_bytes'] >= 8192)
        assert n['net_tokens_saved_if_wrapped'] == n['archived_output_tokens'] - n['presented_output_tokens'] - 258
    assert report['color_free_sensitivity_summary'] == color_free_summary(rows)
    for provider, data in corpus['providers'].items():
        counts = data['selection_and_exclusions']
        selected = [r for r in rows if r['provider'] == provider]
        assert len(selected) == counts.get('selected_noisy_nonzero_excerpts',0) == min(12, counts.get('distinct_noisy_nonzero_excerpts',0))
        assert counts.get('explicit_exit_zero',0) + counts.get('explicit_exit_nonzero',0) == counts.get('replay_eligible_completed_validation_outputs',0)
        assert counts.get('nonzero_below_8192_bytes',0) + counts.get('nonzero_at_least_8192_bytes_before_text_dedup',0) == counts.get('explicit_exit_nonzero',0)
        assert counts.get('duplicate_failure_text_and_exit_excluded',0) + counts.get('distinct_noisy_nonzero_excerpts',0) == counts.get('nonzero_at_least_8192_bytes_before_text_dedup',0)
        assert report['providers'][provider] == aggregate(selected)
        assert report['corpora'][0]['providers'][provider] == {
            'contributing_session_groups':data['sessions_with_selected_evidence'],
            'unique_tool_calls':data['unique_tool_calls'],
            'eligible_replay_outputs':counts.get('replay_eligible_completed_validation_outputs',0)}
    print(json.dumps({'check':'failure-evidence-integrity','cases':len(rows),'status':'passed'}))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true')
    parser.add_argument('--samples',type=Path)
    parser.add_argument('--replay',type=Path)
    parser.add_argument('--annotations',type=Path)
    parser.add_argument('--normalized-replay',type=Path)
    parser.add_argument('--annotation-lock',type=Path)
    args=parser.parse_args()
    if args.check: return check()
    paths=[args.samples,args.replay,args.annotations,args.annotation_lock,args.normalized_replay]
    if any(p is None for p in paths): parser.error('All private input files are required')
    if any(p.resolve()==ROOT or ROOT in p.resolve().parents for p in paths): parser.error('Private inputs must stay outside repository')
    protocol,corpus=read(PROTOCOL),read(CORPUS)
    samples,replay,annotations,lock,normalized_replay=map(read,paths)
    assert sha(args.samples.read_bytes()) == corpus['private_samples_sha256'] == lock['private_samples_sha256']
    assert sha(args.annotations.read_bytes()) == lock['private_annotations_sha256']
    assert lock['protocol_sha256'] == protocol.get('annotation_lock_protocol_sha256',sha(PROTOCOL.read_bytes()))
    verify_replay_digest(replay)
    verify_replay_digest(normalized_replay)
    fields=('provider','sample_id','source_view','log','exit_code')
    normalize=lambda rows: sorted([{k:r.get(k,'tool_result') if k=='source_view' else r[k] for k in fields} for r in rows],key=lambda r:(r['provider'],r['sample_id']))
    assert normalize(samples)==normalize(replay['samples'])
    assert normalize([{**r,'log':SGR.sub('',r['log'])} for r in samples]) == normalize(normalized_replay['samples'])
    nmap={(r['provider'],r['sample_id']):r for r in normalized_replay['samples']}
    amap={(r['provider'],r['sample_id']):r for r in annotations['samples']}
    assert len(amap)==len(samples) and set(amap)=={(r['provider'],r['sample_id']) for r in samples}
    os.environ.setdefault('TIKTOKEN_CACHE_DIR',str(args.samples.parent.parent/'tokenizer-cache'))
    import tiktoken
    assert tiktoken.__version__=='0.12.0'
    enc=tiktoken.get_encoding('o200k_base')
    report=build_report(replay,lambda s:len(enc.encode(s,disallowed_special=())),tiktoken.__version__,ROOT/'skills/system-one-verify/SKILL.md',[CORPUS])
    for row, private in zip(report['samples'],replay['samples']):
        n=nmap[(row['provider'],row['sample_id'])]
        count=lambda s:len(enc.encode(s,disallowed_special=()))
        row['color_free_sensitivity']={'archived_output_bytes':len(n['log'].encode()),'archived_output_tokens':count(n['log']),
            'presented_output_tokens':count(n['presented_text']),'runtime_compacted':n['compacted'],
            'would_route_by_normalized_prior_bytes':len(n['log'].encode())>=8192,
            'net_tokens_saved_if_wrapped':count(n['log'])-count(n['presented_text'])-258}
        row['source_truncation_marker_present']=bool(TRUNCATION.search(private['log']))
        row['annotation']=assess_annotation(private,amap[(row['provider'],row['sample_id'])])
    report['evaluated_source_sha256']['research/assess_holdout.py']=sha((ROOT/'research/assess_holdout.py').read_bytes())
    report['evaluation_set_role']=protocol['purpose']
    report['protocol_sha256']=sha(PROTOCOL.read_bytes())
    report['corpus_file_sha256']=sha(CORPUS.read_bytes())
    report['report_generator_sha256']=sha(Path(__file__).read_bytes())
    report['private_source_samples_sha256']=sha(args.samples.read_bytes())
    report['private_replay_file_sha256']=sha(args.replay.read_bytes())
    report['private_annotations_sha256']=sha(args.annotations.read_bytes())
    report['private_normalized_replay_file_sha256']=sha(args.normalized_replay.read_bytes())
    report['annotation_lock_sha256']=sha(args.annotation_lock.read_bytes())
    report['annotation_method']={'recorded_before_replay_at_utc':lock['recorded_at_utc'],'review':annotations['review'],'meaning':'Exact spans manually chosen from archived text before seeing reducer output. Retention does not establish diagnosis or repair correctness. An absent truncation marker does not prove original stdout completeness.'}
    report['summary']=aggregate(report['samples'])
    report['color_free_sensitivity_summary']=color_free_summary(report['samples'])
    report['providers']={p:aggregate([r for r in report['samples'] if r['provider']==p]) for p in ('codex','claude','devin')}
    report['limitations']=[
        'Retrospective selection overlaps prior analysis periods and is not an independent whole-task or provider-billing experiment.',
        'Selection targets archived noisy failures, not a representative task sample; related sessions and repeated failures can remain correlated after exact text deduplication.',
        'Explicit exit status establishes completed observation, not completeness of the archived text. Source truncation and runtime capture truncation are different.',
        'Manual annotations are descriptive evidence spans, not a blinded diagnosis or repair-success score. More than one plausible diagnostic message may exist.',
        'The full-log sensitivity charges one complete archived excerpt when any annotated detail is omitted. Actual bounded lookup, repeated retrieval, invocation and reasoning costs are unmeasured.',
        'Text replay models prior-size routing by observed archived size; it does not prove the historical agent knew the next run would be noisy.',
        'Native quiet modes and task-specific bounded diagnostics are not reconstructed; their savings can be better than this raw-output baseline.'
    ]
    # Avoid carrying unrelated development-cohort routing sensitivity into this targeted audit.
    report.pop('threshold_sensitivity', None)
    REPORT.write_text(json.dumps(report,indent=2)+'\n')
    check()
    print(json.dumps(report['summary'],indent=2))

if __name__=='__main__': main()
