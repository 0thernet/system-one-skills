#!/usr/bin/env python3
"""Screen real retained outputs for mathematical headroom, not skill efficacy."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import shlex
import sqlite3
import time

import analyze_sessions as base

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / 'research/candidate-protocol.json'
SOURCES = ('research/analyze_sessions.py', 'research/candidate_screen.py',
           'research/candidate-protocol.json')
CHAIN = '''WITH RECURSIVE chain(node_id,parent_node_id,created_at) AS (
 SELECT node_id,parent_node_id,created_at FROM message_nodes WHERE session_id=? AND node_id=?
 UNION
 SELECT m.node_id,m.parent_node_id,m.created_at FROM message_nodes m
 JOIN chain c ON m.node_id=c.parent_node_id WHERE m.session_id=?
) '''


def source_hashes():
    return {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in SOURCES}


def parsed_arguments(value):
    if isinstance(value, dict):
        return value
    try:
        value = json.loads(value)
        return value if isinstance(value, dict) else {}
    except (ValueError, TypeError):
        return {}


def native_control(name, arguments):
    """Recognize explicit controls only; an unresolved parse is never waste."""
    short = re.split(r'__|\.', name or '')[-1].lower()
    args = parsed_arguments(arguments)
    if short == 'glob':
        return 'file_inventory'
    if short == 'grep':
        return {'count': 'match_counts', 'files_with_matches': 'matching_file_names'}.get(
            args.get('output_mode'), 'structured_search_without_recognized_control')
    candidates = base.commands(arguments)
    if len(candidates) != 1:
        return 'unresolved_command'
    command = candidates[0]
    if any(c in command for c in ('`', '$', '\n', '<', '>')):
        return 'unresolved_command'
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=';&|')
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError:
        return 'unresolved_command'
    if tokens[:1] == ['cd']:
        if len(tokens) < 4 or tokens[2] != '&&' or not tokens[1].startswith('/'):
            return 'unresolved_command'
        tokens = tokens[3:]
    if not tokens or any(t in (';', '&&', '||', '|', '&') for t in tokens):
        return 'unresolved_command'
    executable = tokens[0]
    if executable in ('rg', 'grep'):
        # Ignore values of pattern/path/glob options; they are not controls.
        options, skip = [], False
        valued = {'-e', '--regexp', '-f', '--file', '-g', '--glob', '--iglob',
                  '-t', '--type', '-T', '--type-not', '--type-add', '--type-clear',
                  '-m', '--max-count', '-A', '-B', '-C', '--after-context',
                  '--before-context', '--context', '--max-depth', '--encoding',
                  '--max-columns', '--sort', '--sortr', '--replace', '-r'}
        for token in tokens[1:]:
            if skip:
                skip = False
                continue
            if token == '--':
                break
            if token in valued:
                skip = True
                continue
            options.append(token)
        if executable == 'rg' and '--files' in options:
            return 'file_inventory'
        if any(t in ('-l', '--files-with-matches', '--files-without-match') for t in options):
            return 'matching_file_names'
        if any(t in ('-c', '--count', '--count-matches') for t in options):
            return 'match_counts'
        if any(t in ('-q', '--quiet', '--silent') for t in options):
            return 'exit_status_only'
        return 'literal_search_without_recognized_control'
    if executable != 'git':
        return 'unresolved_command'
    tokens = tokens[1:]
    if tokens[:1] == ['-C'] and len(tokens) >= 3:
        tokens = tokens[2:]
    if not tokens:
        return 'unresolved_command'
    verb, options = tokens[0], tokens[1:]
    options = options[:options.index('--')] if '--' in options else options
    if verb == 'status':
        if any(t == '--porcelain' or t.startswith('--porcelain=') for t in options):
            return 'git_porcelain'
        if any(t in ('-s', '--short', '-sb', '-bs') for t in options):
            return 'git_short_status'
    elif verb in ('diff', 'show'):
        for option, label in (('--name-only', 'git_file_names'), ('--name-status', 'git_name_status'),
                              ('--numstat', 'git_numeric_stat'), ('--stat', 'git_diff_stat'),
                              ('--shortstat', 'git_short_stat'), ('--quiet', 'exit_status_only')):
            if any(t == option or t.startswith(option + '=') for t in options):
                return label
    elif verb == 'log' and any(t in ('--oneline', '--format', '--pretty') or t.startswith(('--format=', '--pretty=')) for t in options):
        return 'git_formatted_log'
    elif verb in ('rev-parse', 'ls-files'):
        return 'git_targeted_query'
    return 'literal_git_without_recognized_control'


class Collector(base.Collector):
    def call(self, ident, name, arguments, timestamp, session):
        new = ident not in self.calls
        super().call(ident, name, arguments, timestamp, session)
        if new and ident in self.calls:
            self.calls[ident]['native_control'] = native_control(name, arguments)

    def output(self, ident, content, timestamp, session, metadata=None, event_id=None):
        # No completed-output parsing or status inference is needed in this screen.
        super().output(ident, content, timestamp, session, {}, event_id)


def collect_devin(path, collector):
    """Same active-chain/call boundaries as base, with indexed bounded SQL reads."""
    connection = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    connection.execute('PRAGMA query_only=ON')
    connection.execute('BEGIN')
    deadline = time.monotonic() + 120
    connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
    try:
        sessions = connection.execute('SELECT id,main_chain_id FROM sessions WHERE last_activity_at>=?', (collector.since,)).fetchall()
        collector.stats['database_sessions_considered'] = len(sessions)
        for session, head in sessions:
            query = CHAIN + '''SELECT m.created_at,
              json_extract(m.chat_message,'$.metadata.created_at'),
              json_extract(m.chat_message,'$.message_id'),json_extract(m.chat_message,'$.role'),
              json_extract(m.chat_message,'$.tool_calls'),
              CASE WHEN json_extract(m.chat_message,'$.role')='tool' THEN json_extract(m.chat_message,'$.content') END,
              json_extract(m.chat_message,'$.tool_call_id')
              FROM chain c CROSS JOIN message_nodes m ON m.node_id=c.node_id AND m.session_id=?
              WHERE c.created_at>=? AND json_extract(m.chat_message,'$.role') IN ('assistant','tool')'''
            for created, message_created, ident, role, calls, content, call_id in connection.execute(query, (session, head, session, session, collector.since)):
                timestamp = message_created if base.epoch(message_created) is not None else created
                if role == 'assistant':
                    for call in json.loads(calls) if calls else []:
                        collector.call(call.get('id'), call.get('name', ''), call.get('arguments', {}), timestamp, session)
                else:
                    collector.output(call_id, content or '', timestamp, session, event_id=ident)
    finally:
        connection.rollback()
        connection.close()


def percentile(values, p):
    return sorted(values)[max(0, math.ceil(len(values) * p) - 1)] if values else None


def summarize(rows, calls, budgets, margin):
    values = [r['output_tokens'] for r in rows]
    controls = Counter(c['native_control'] for c in calls)
    return {
        'calls': len(calls), 'calls_with_observed_output': len(rows),
        'calls_without_observed_output': len(calls) - len(rows),
        'output_fragments': sum(r['output_fragments'] for r in rows),
        'multiple_fragment_calls': sum(r['output_fragments'] > 1 for r in rows),
        'output_tokens': sum(values),
        'output_token_quantiles': {name: percentile(values, p) for name, p in [('p25', .25), ('p50', .5), ('p75', .75), ('p90', .90), ('p95', .95), ('max', 1)]},
        'hypothetical_ceiling_screen': [
            {'per_use_overhead_tokens': overhead, 'required_margin_tokens': margin,
             'minimum_output_tokens_even_if_all_deleted': overhead + margin,
             'calls_below_ceiling_requirement': sum(v < overhead + margin for v in values),
             'calls_reaching_ceiling_requirement': sum(v >= overhead + margin for v in values)}
            for overhead in budgets],
        'native_controls': dict(sorted(controls.items())),
    }


def build_provider(collector, protocol, encoding):
    fragments = defaultdict(list)
    for fragment in collector.outputs.values():
        fragments[fragment['call_id']].append(fragment)
    rows, private_rows = [], []
    for ident, call in collector.calls.items():
        if call['workflow'] not in protocol['workflows']:
            continue
        row = {'case_id': base.digest([collector.provider, ident]), 'provider': collector.provider,
                     'workflow': call['workflow'], 'native_control': call['native_control'],
                     'output_fragments': len(fragments[ident]),
                     'output_tokens': sum(len(encoding.encode(f['text'], disallowed_special=())) for f in fragments[ident]) if fragments[ident] else None}
        rows.append(row)
        private_rows.append({**row, 'output_text_sha256': base.digest(sorted(base.digest(f['text']) for f in fragments[ident]))})
    groups = {}
    for workflow in protocol['workflows']:
        groups[workflow] = summarize([r for r in rows if r['workflow'] == workflow and r['output_fragments']],
                                    [c for c in collector.calls.values() if c['workflow'] == workflow],
                                    protocol['hypothetical_per_use_overhead_tokens'], protocol['required_net_margin_tokens'])
    return {'workflow_screen': groups, 'all_observed_calls': len(collector.calls),
            'collection_counters': dict(sorted(collector.stats.items())),
            'source_calls_outputs_evidence_sha256': base.digest(sorted(collector.provenance))}, rows, private_rows


def check(report, protocol):
    if report['source_files_sha256'] != source_hashes():
        raise ValueError('Candidate screen sources changed; regenerate from retained evidence')
    if report['protocol'] != protocol or report['outcome'] != 'retrospective-output-headroom-only-no-candidate-admitted':
        raise ValueError('Scope or protocol changed')
    if set(report['providers']) != set(protocol['providers']):
        raise ValueError('Provider coverage changed')
    seen = set()
    for row in report['cases']:
        if set(row) != {'case_id', 'provider', 'workflow', 'native_control', 'output_fragments', 'output_tokens'}:
            raise ValueError('Unexpected public case fields')
        if not re.fullmatch('[a-f0-9]{64}', row['case_id']) or row['case_id'] in seen:
            raise ValueError('Malformed or duplicate case identity')
        seen.add(row['case_id'])
        if row['provider'] not in protocol['providers'] or row['workflow'] not in protocol['workflows']:
            raise ValueError('Unexpected case scope')
        if type(row['output_fragments']) is not int or row['output_fragments'] < 0:
            raise ValueError('Malformed fragment count')
        if row['output_fragments'] == 0 and row['output_tokens'] is not None:
            raise ValueError('Missing output must remain unknown')
        if row['output_fragments'] and (type(row['output_tokens']) is not int or row['output_tokens'] < 0):
            raise ValueError('Malformed token count')
        if not isinstance(row['native_control'], str) or not re.fullmatch('[a-z_]+', row['native_control']):
            raise ValueError('Malformed native control label')
    if base.digest(report['cases']) != report['cases_sha256']:
        raise ValueError('Case digest changed')
    for name, provider in report['providers'].items():
        if set(provider['workflow_screen']) != set(protocol['workflows']):
            raise ValueError('Workflow coverage changed')
        for workflow, group in provider['workflow_screen'].items():
            rows = [r for r in report['cases'] if r['provider'] == name and r['workflow'] == workflow]
            expected = summarize([r for r in rows if r['output_fragments']], rows,
                                 protocol['hypothetical_per_use_overhead_tokens'], protocol['required_net_margin_tokens'])
            if expected != group:
                raise ValueError('Summary does not recompute from opaque public cases')
            n = group['calls_with_observed_output']
            if group['calls'] != n + group['calls_without_observed_output'] or sum(group['native_controls'].values()) != group['calls']:
                raise ValueError('Call accounting mismatch')
            if group['output_fragments'] < n or not 0 <= group['multiple_fragment_calls'] <= n:
                raise ValueError('Fragment accounting mismatch')
            if [r['per_use_overhead_tokens'] for r in group['hypothetical_ceiling_screen']] != protocol['hypothetical_per_use_overhead_tokens']:
                raise ValueError('Screen budgets changed')
            prior = -1
            for row in group['hypothetical_ceiling_screen']:
                excluded = row['calls_below_ceiling_requirement']
                if excluded + row['calls_reaching_ceiling_requirement'] != n or not prior <= excluded <= n:
                    raise ValueError('Ceiling counts mismatch')
                if row['required_margin_tokens'] != protocol['required_net_margin_tokens'] or row['minimum_output_tokens_even_if_all_deleted'] != row['per_use_overhead_tokens'] + row['required_margin_tokens']:
                    raise ValueError('Ceiling arithmetic mismatch')
                prior = excluded
            quantiles = list(group['output_token_quantiles'].values())
            if n == 0:
                if any(q is not None for q in quantiles) or group['output_tokens']:
                    raise ValueError('Empty group has fabricated token counts')
            elif any(not isinstance(q, int) or q < 0 for q in quantiles) or quantiles != sorted(quantiles) or group['output_tokens'] < quantiles[-1]:
                raise ValueError('Token quantiles malformed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'research/candidate-report.json')
    parser.add_argument('--private-output', type=Path)
    parser.add_argument('--codex-dir', type=Path, default=Path.home() / '.codex/sessions')
    parser.add_argument('--claude-dir', type=Path, default=Path.home() / '.claude/projects')
    parser.add_argument('--devin-db', type=Path, default=Path.home() / '.local/share/devin/cli/sessions.db')
    args = parser.parse_args()
    protocol = json.loads(PROTOCOL.read_text())
    if args.check:
        check(json.loads(args.output.read_text()), protocol)
        print('Candidate output-headroom report: sources, scope and arithmetic valid')
        return
    if not args.private_output:
        parser.error('--private-output is required for per-call audit measurements')
    dest = args.private_output.resolve()
    if dest == ROOT or ROOT in dest.parents:
        parser.error('Private measurements must remain outside the repository')
    import tiktoken
    if importlib.metadata.version('tiktoken') != protocol['tokenizer']['version']:
        raise RuntimeError('Pinned tokenizer version required')
    encoding = tiktoken.get_encoding(protocol['tokenizer']['encoding'])
    before = source_hashes()
    providers, rows, private_rows = {}, [], []
    window = protocol['window']
    for name, path, parse in [('codex', args.codex_dir, base.codex_file), ('claude', args.claude_dir, base.claude_file), ('devin', args.devin_db, collect_devin)]:
        collector = Collector(name, window['since_inclusive_utc'], window['until_exclusive_utc'])
        if name == 'devin':
            if path.exists(): parse(path, collector)
            else: collector.stats['source_unavailable'] += 1
        else:
            paths = sorted(path.rglob('*.jsonl')) if path.exists() else []
            collector.stats['discovered_transcript_files'] = len(paths)
            for source in paths:
                if source.stat().st_mtime < collector.since:
                    collector.stats['files_with_mtime_before_window_excluded'] += 1
                    continue
                collector.stats['transcript_files_scanned'] += 1
                parse(source, collector)
        providers[name], measurements, private_measurements = build_provider(collector, protocol, encoding)
        rows.extend(measurements)
        private_rows.extend(private_measurements)
        print(f'{name}: {len(measurements)} candidate-workflow calls; {sum(bool(r["output_fragments"]) for r in measurements)} with observed output', flush=True)
    if source_hashes() != before:
        raise RuntimeError('Sources changed during collection')
    rows.sort(key=lambda r: (r['provider'], r['workflow'], r['case_id']))
    private = json.dumps(sorted(private_rows, key=lambda r: (r['provider'], r['case_id'])), indent=2) + '\n'
    dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle: handle.write(private)
    os.chmod(dest, 0o600)
    report = {'schema_version': 1, 'collected_at_utc': datetime.now(timezone.utc).isoformat(),
              'protocol': protocol, 'source_files_sha256': before, 'providers': providers,
              'cases': rows, 'cases_sha256': base.digest(rows),
              'private_measurements_sha256': hashlib.sha256(private.encode()).hexdigest(),
              'outcome': 'retrospective-output-headroom-only-no-candidate-admitted'}
    check(report, protocol)
    args.output.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
