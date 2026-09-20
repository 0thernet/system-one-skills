#!/usr/bin/env python3
"""Explore exact-run CI observations in authorized Devin history; never run commands."""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shlex
import sqlite3
import time

from analyze_sessions import commands, completed_output, digest, epoch, text_content, workflow

ROOT = Path(__file__).resolve().parents[1]
SINCE, UNTIL = '2026-09-12T00:00:00Z', '2026-09-19T14:00:00Z'
SOURCE_PATHS = ('research/analyze_sessions.py', 'research/ci_pilot.py',
                'research/session-report.json', 'research/supplemental-session-report.json')
CHAIN = '''WITH RECURSIVE chain(node_id,parent_node_id,created_at) AS (
 SELECT node_id,parent_node_id,created_at FROM message_nodes WHERE session_id=? AND node_id=?
 UNION
 SELECT m.node_id,m.parent_node_id,m.created_at FROM message_nodes m
 JOIN chain c ON m.node_id=c.parent_node_id WHERE m.session_id=?
) '''


def source_hashes():
    return {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in SOURCE_PATHS}


def parsed_arguments(value):
    if isinstance(value, dict):
        return value
    try:
        result = json.loads(value)
        return result if isinstance(result, dict) else {}
    except (ValueError, TypeError):
        return {}


def resolve_run(arguments):
    """Reject ambiguous shell syntax; context must be explicit in this call."""
    candidates = commands(arguments)
    if len(candidates) != 1:
        return None, 'not_one_literal_command'
    command = candidates[0]
    if any(c in command for c in ('`', '$', '\n', '<', '>')):
        return None, 'dynamic_or_multiline_shell'
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=';&|')
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError:
        return None, 'invalid_shell_quoting'
    data = parsed_arguments(arguments)
    cwd_values = [data[k] for k in ('cwd', 'workdir', 'working_directory')
                  if isinstance(data.get(k), str) and data[k].startswith('/')]
    cwd = cwd_values[0] if len(set(cwd_values)) == 1 else None
    if tokens[:1] == ['cd']:
        if len(tokens) < 4 or tokens[2] != '&&' or not tokens[1].startswith('/'):
            return None, 'unresolved_directory_change'
        cwd, tokens = tokens[1], tokens[3:]
    # A pipe/filter, compound statement or second gh call can change semantics.
    if any(t in (';', '&&', '||', '|', '&') for t in tokens):
        return None, 'compound_or_filtered_command'
    if tokens[:2] != ['gh', 'run'] or len(tokens) < 4 or tokens[2] not in ('view', 'watch'):
        return None, 'not_explicit_run_view_or_watch'
    verb, args = tokens[2], tokens[3:]
    run_id = args[0] if re.fullmatch(r'[0-9]+', args[0]) else None
    if run_id is None:
        return None, 'run_id_not_literal_first_position'
    repo = None
    fields = None
    query_tokens = []
    i = 1
    while i < len(args):
        token = args[i]
        if token in ('-R', '--repo', '--json', '--jq', '-q', '--interval', '-i'):
            if i+1 >= len(args):
                return None, 'missing_option_value'
            value = args[i+1]
            if token in ('-R', '--repo'):
                if repo is not None or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', value):
                    return None, 'ambiguous_repository'
                repo = value.lower()
            elif token == '--json':
                fields = value.split(',')
            query_tokens.extend([token, value]); i += 2
        elif token.startswith('--repo='):
            value = token.split('=', 1)[1]
            if repo is not None or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', value):
                return None, 'ambiguous_repository'
            repo = value.lower(); query_tokens.append(token); i += 1
        elif token in ('--exit-status', '--compact', '--verbose', '--log', '--log-failed', '--web'):
            query_tokens.append(token); i += 1
        else:
            return None, 'unsupported_option_or_extra_argument'
    context = ('repo', repo) if repo else ('explicit_cwd', cwd) if cwd else None
    if context is None:
        return None, 'no_explicit_repository_or_cwd'
    status_fields = {'status', 'conclusion', 'databaseId', 'headSha', 'url', 'workflowName', 'number', 'attempt'}
    status_only = verb == 'view' and fields is not None and bool(fields) and set(fields) <= status_fields and not any(t in query_tokens for t in ('--log', '--log-failed', '--web', '--jq', '-q'))
    return {'run_id': run_id, 'context': context, 'verb': verb,
            'query_digest': digest([verb, query_tokens]), 'status_only': status_only}, None


def explicit_state(content):
    rendered = text_content(content)
    completed = completed_output(rendered, {})
    if completed and completed['exit_code'] != 0:
        return None
    body = completed['log'] if completed else rendered
    try:
        data = json.loads(body.strip())
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict) or data.get('status') not in ('queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'):
        return None
    conclusion = data.get('conclusion')
    if conclusion not in (None, '', 'success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale', 'startup_failure'):
        return None
    # Explicit record fields only; absent attempt/SHA remain absent, never guessed.
    return {'status': data['status'], 'conclusion': conclusion,
            'head_sha': data.get('headSha'), 'attempt': data.get('attempt')}


def collect(db):
    stats, exclusions, days = Counter(), Counter(), Counter()
    calls, provenance = {}, set()
    connection = sqlite3.connect(db.resolve().as_uri()+'?mode=ro', uri=True)
    connection.execute('PRAGMA query_only=ON')
    connection.execute('BEGIN')
    deadline = time.monotonic() + 120
    connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
    sessions = connection.execute('SELECT id,main_chain_id FROM sessions WHERE last_activity_at>=?', (epoch(SINCE),)).fetchall()
    stats['sessions_considered'] = len(sessions)
    for session, head in sessions:
        params = (session, head, session, session, epoch(SINCE))
        query = CHAIN + '''SELECT m.created_at,json_extract(m.chat_message,'$.metadata.created_at'),
          json_extract(m.chat_message,'$.tool_calls') FROM chain c
          CROSS JOIN message_nodes m ON m.node_id=c.node_id AND m.session_id=?
          WHERE c.created_at>=? AND json_extract(m.chat_message,'$.role')='assistant'
          AND json_extract(m.chat_message,'$.tool_calls') IS NOT NULL'''
        session_calls = set()
        for created, message_created, raw in connection.execute(query, params):
            timestamp = epoch(message_created) if epoch(message_created) is not None else created
            if not epoch(SINCE) <= timestamp < epoch(UNTIL):
                continue
            for call in json.loads(raw):
                if workflow(call.get('name', ''), call.get('arguments', {})) != 'ci_status':
                    continue
                ident = call.get('id')
                if not ident:
                    exclusions['calls_without_stable_id'] += 1; continue
                signature = digest([call.get('name'), call.get('arguments')])
                if ident in calls:
                    stats['duplicate_calls_excluded'] += 1
                    if calls[ident]['signature'] != signature:
                        stats['conflicting_call_ids'] += 1
                    continue
                resolved, reason = resolve_run(call.get('arguments', {}))
                row = {'session': session, 'timestamp': timestamp, 'signature': signature,
                       'resolved': resolved, 'outputs': []}
                calls[ident] = row; session_calls.add(ident)
                days[datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat()] += 1
                if reason: exclusions[reason] += 1
                provenance.add(digest(['call', session, ident, timestamp, signature]))
        if not session_calls:
            continue
        placeholders = ','.join('?' for _ in session_calls)
        query = CHAIN + f'''SELECT m.created_at,json_extract(m.chat_message,'$.metadata.created_at'),
          json_extract(m.chat_message,'$.message_id'),json_extract(m.chat_message,'$.tool_call_id'),
          json_extract(m.chat_message,'$.content') FROM chain c
          CROSS JOIN message_nodes m ON m.node_id=c.node_id AND m.session_id=?
          WHERE c.created_at>=? AND json_extract(m.chat_message,'$.role')='tool'
          AND json_extract(m.chat_message,'$.tool_call_id') IN ({placeholders})'''
        seen = set()
        for created, message_created, event, ident, content in connection.execute(query, (*params, *sorted(session_calls))):
            timestamp = epoch(message_created) if epoch(message_created) is not None else created
            if not epoch(SINCE) <= timestamp < epoch(UNTIL): continue
            key = digest([ident, event, text_content(content)])
            if key in seen: continue
            seen.add(key)
            state = explicit_state(content or '')
            calls[ident]['outputs'].append(state)
            provenance.add(digest(['output', session, key, timestamp]))
    connection.rollback(); connection.close()
    groups = defaultdict(list)
    for ident, row in calls.items():
        resolved = row['resolved']
        if resolved:
            key = digest([row['session'], resolved['context'], resolved['run_id']])
            groups[key].append(row)
    repeated = {k: sorted(v,key=lambda r:r['timestamp']) for k,v in groups.items() if len(v)>1}
    selected = sorted(repeated)[:20]
    summaries = []
    for key in selected:
        rows = repeated[key]
        states = [r['outputs'][0] if len(r['outputs'])==1 else None for r in rows]
        same_query_pairs = sum(a['resolved']['query_digest']==b['resolved']['query_digest'] for a,b in zip(rows,rows[1:]))
        same_status_pairs = sum(a is not None and b is not None and a==b for a,b in zip(states,states[1:]))
        summaries.append({'sequence_id': key, 'observations': len(rows),
            'span_seconds': round(rows[-1]['timestamp']-rows[0]['timestamp'],3),
            'identity_basis': rows[0]['resolved']['context'][0],
            'view_calls':sum(r['resolved']['verb']=='view' for r in rows),
            'native_watch_calls':sum(r['resolved']['verb']=='watch' for r in rows),
            'status_only_queries':sum(r['resolved']['status_only'] for r in rows),
            'single_output_parsed_states':sum(s is not None for s in states),
            'adjacent_same_query_pairs':same_query_pairs,
            'adjacent_same_parsed_state_pairs':same_status_pairs,
            'avoidable_model_turns_established':False})
    resolved_count = sum(r['resolved'] is not None for r in calls.values())
    return {'collection': dict(sorted(stats.items())), 'observed_ci_calls': len(calls),
            'selected_records_by_utc_day':dict(sorted(days.items())),
            'unresolved_calls':len(calls)-resolved_count, 'resolution_exclusions':dict(sorted(exclusions.items())),
            'identity_resolved_calls':resolved_count, 'identity_resolved_groups':len(groups),
            'repeated_identity_groups':len(repeated), 'selected_sequence_count':len(selected),
            'selected_sequences':summaries, 'selected_sequence_digest':digest(selected),
            'source_snapshot_evidence_sha256':digest(sorted(provenance))}


def check(report):
    if report['source_files_sha256'] != source_hashes(): raise ValueError('CI pilot source changed; remeasure the dated snapshot')
    result = report['result']
    if result['observed_ci_calls'] != result['unresolved_calls']+result['identity_resolved_calls']: raise ValueError('Call counts do not reconcile')
    if result['selected_sequence_count'] != len(result['selected_sequences']) or result['selected_sequence_count'] != min(20,result['repeated_identity_groups']): raise ValueError('Selection counts do not reconcile')
    if result['selected_sequence_digest'] != digest([s['sequence_id'] for s in result['selected_sequences']]): raise ValueError('Sequence digest changed')
    if report['outcome'] != 'inconclusive-no-comparative-efficacy-evidence': raise ValueError('Pilot cannot establish efficacy')
    if report['window'] != {'since_inclusive_utc':SINCE,'until_exclusive_utc':UNTIL}: raise ValueError('Window changed')
    if sum(result['selected_records_by_utc_day'].values()) != result['observed_ci_calls']: raise ValueError('Day counts do not reconcile')
    if sum(n for k,n in result['resolution_exclusions'].items() if k!='calls_without_stable_id') != result['unresolved_calls']: raise ValueError('Exclusions do not reconcile')
    expected=sum(json.loads((ROOT/p).read_text())['providers']['devin']['workflow_counts']['ci_status']['tool_calls'] for p in SOURCE_PATHS[2:])
    if report['original_aggregate_ci_calls'] != expected or report['difference_from_original_aggregate'] != result['observed_ci_calls']-expected: raise ValueError('Original aggregate comparison changed')
    if not 0 <= result['repeated_identity_groups'] <= result['identity_resolved_groups'] <= result['identity_resolved_calls']: raise ValueError('Group counts invalid')
    if [s['sequence_id'] for s in result['selected_sequences']] != sorted({s['sequence_id'] for s in result['selected_sequences']}): raise ValueError('Sequences must be sorted unique opaque identities')
    for name in ['measured_avoidable_model_turns','measured_token_savings','measured_latency_change','measured_reliability_change']:
        if report[name] is not None: raise ValueError('Pilot cannot create an efficacy measurement')
    for sequence in result['selected_sequences']:
        if sequence['observations']<2 or sequence['avoidable_model_turns_established']: raise ValueError('Invalid sequence interpretation')
        if not re.fullmatch(r'[a-f0-9]{64}',sequence['sequence_id']): raise ValueError('Invalid opaque identity')
        if sequence['view_calls']+sequence['native_watch_calls'] != sequence['observations']: raise ValueError('Sequence call counts differ')
        if not 0 <= sequence['status_only_queries'] <= sequence['view_calls']: raise ValueError('Status query count invalid')
        if not 0 <= sequence['single_output_parsed_states'] <= sequence['observations']: raise ValueError('State count invalid')
        for key in ['adjacent_same_query_pairs','adjacent_same_parsed_state_pairs']:
            if not 0 <= sequence[key] < sequence['observations']: raise ValueError('Adjacent-pair count invalid')
    return True


def self_test():
    assert resolve_run({'command':'gh run view 123 --repo owner/repo --json status,conclusion'})[0]['status_only']
    assert resolve_run({'command':'gh run watch 123 --repo owner/repo --exit-status'})[0]['verb']=='watch'
    assert resolve_run({'command':'cd /fixture/repository && gh run view 123'})[0]['context'][0]=='explicit_cwd'
    assert resolve_run({'command':'gh run view 123','cwd':'/fixture/repository'})[0]
    for command in ('gh run list --repo owner/repo','gh pr checks 3 --repo owner/repo','gh run view 123','gh run view "$ID" --repo owner/repo','gh run view 123 --repo owner/repo | cat'):
        assert resolve_run({'command':command})[0] is None
    assert explicit_state('{"status":"completed","conclusion":"success"}')['status']=='completed'
    assert explicit_state('reported success in prose') is None
    print('CI pilot parser: 11 focused synthetic assertions passed; no commands executed')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--devin-db', type=Path, default=Path.home()/'.local/share/devin/cli/sessions.db')
    parser.add_argument('--output', type=Path, default=ROOT/'research/ci-pilot-report.json')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--self-test', action='store_true')
    args=parser.parse_args()
    if args.self_test: self_test(); return
    if args.check:
        check(json.loads(args.output.read_text())); print('CI pilot source and public arithmetic current'); return
    before=source_hashes()
    result=collect(args.devin_db)
    if before!=source_hashes(): raise ValueError('Source changed during collection')
    original=sum(json.loads((ROOT/p).read_text())['providers']['devin']['workflow_counts']['ci_status']['tool_calls'] for p in SOURCE_PATHS[2:])
    report={'schema_version':1,'recorded_at_utc':datetime.now(timezone.utc).isoformat(),
      'window':{'since_inclusive_utc':SINCE,'until_exclusive_utc':UNTIL},
      'population':'One consenting developer; current retained Devin active ancestry only. Other providers are not part of this pilot.',
      'source_files_sha256':before, 'method':{
        'access':'Read-only SQLite transaction, indexed current active parent chain; matching assistant calls and their own outputs only. A 120-second collection budget aborts without publishing partial results.',
        'classification':'Unchanged analyzer ci_status workflow; mixed-shell and generic process-wait calls excluded.',
        'identity':'Literal numeric run ID plus explicit repo option or absolute call/leading-cd cwd; session context never pooled across sessions. No identity inference from run lists, PR checks, variables or output prose.',
        'selection':'At most 20 repeated exact-identity groups, smallest opaque digest first. Single-observation groups counted but not inspected as repeated sequences.',
        'baseline':'Native provider run-watch for one explicit run; it already waits without repeated model polling. Different query details may have a legitimate purpose.',
        'provenance':'Opaque digests bind selected record signatures and output content within this read transaction; no database file hash is claimed for a live WAL database.'},
      'original_aggregate_ci_calls':original,
      'difference_from_original_aggregate':result['observed_ci_calls']-original,
      'result':result,
      'outcome':'inconclusive-no-comparative-efficacy-evidence',
      'measured_avoidable_model_turns':None,'measured_token_savings':None,'measured_latency_change':None,'measured_reliability_change':None,
      'limitations':[
       'Exploratory identity-resolution pilot, not a randomized experiment, independent task holdout, or token benchmark.',
       'Current active ancestry can differ from earlier snapshots after compaction or rewinds; differences from the original 128-call aggregate remain explicit.',
       'Conservative syntax exclusions leave unresolved work. Unresolved or absent repeated groups do not prove no repeated polling occurred.',
       'Same run/context and even identical parsed state do not prove an avoidable model turn: task intent, intervening work, retries and required evidence were not adjudicated.',
       'Native run watching is already a strong zero-model-polling baseline. No new skill is admitted and no saving is inferred from status-call frequency.',
       'Only exact JSON status objects are parsed; human-readable output, filtered scalars and ambiguous multiple outputs remain unknown. No archived command executes.',
       'This pilot does not measure provider usage, agent completion time, CI latency, API load or diagnostic correctness.']}
    check(report)
    args.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'outcome':report['outcome'],'original_aggregate_ci_calls':original,'result':result},indent=2))

if __name__=='__main__': main()
