#!/usr/bin/env python3
"""Count exact repeated read observations; never infer safe cache hits or savings."""
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
import signal

import analyze_sessions as base
import candidate_screen as prior

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / 'research/candidate-opportunities-protocol.json'
SOURCES = ('research/analyze_sessions.py', 'research/candidate_screen.py',
           'research/candidate_opportunities.py', 'research/candidate-opportunities-protocol.json')


def hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCES}


def read_control(name, arguments):
    short = re.split(r'__|\.', name or '')[-1].lower()
    args = prior.parsed_arguments(arguments)
    if short in ('read', 'read_file', 'readfile'):
        # Offset alone does not bound returned length. No assumption about defaults.
        return 'structured_explicit_limit' if any(type(args.get(k)) is int and args[k] > 0 for k in ('limit', 'max_lines')) else 'structured_no_recognized_limit'
    commands = base.commands(arguments)
    if len(commands) != 1 or any(c in commands[0] for c in ('`', '$', '\n', '<', '>')):
        return 'unresolved'
    try:
        lexer = shlex.shlex(commands[0], posix=True, punctuation_chars=';&|')
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError:
        return 'unresolved'
    if tokens[:1] == ['cd'] and len(tokens) >= 4 and tokens[1].startswith('/') and tokens[2] == '&&':
        tokens = tokens[3:]
    if not tokens or any(t in (';', '&&', '||', '|', '&') for t in tokens):
        return 'unresolved'
    if tokens[0] in ('head', 'tail'):
        # A recognized native selection, not a promise of a particular token cap.
        return 'native_head_or_tail'
    if len(tokens) >= 4 and tokens[:2] == ['sed', '-n'] and re.fullmatch(r'\d+(?:,\d+)?p', tokens[2]):
        return 'native_line_range'
    if tokens[0] in ('cat', 'nl'):
        return 'literal_no_recognized_limit'
    return 'unresolved'


class Collector(base.Collector):
    source = 'database'

    def call(self, ident, name, arguments, timestamp, session):
        new = ident not in self.calls
        super().call(ident, name, arguments, timestamp, session)
        if new and ident in self.calls:
            self.calls[ident].update(scope=base.digest([session, self.source]),
                time=base.epoch(timestamp), control=read_control(name, arguments))

    def output(self, ident, content, timestamp, session, metadata=None, event_id=None):
        rendered = base.text_content(content)
        key = base.digest([ident, event_id, rendered])
        new = key not in self.outputs
        super().output(ident, content, timestamp, session, {}, event_id)
        if new and key in self.outputs:
            self.outputs[key].update(scope=base.digest([session, self.source]), time=base.epoch(timestamp))

    def usage(self, *args):
        pass

    def command_event(self, *args):
        pass


def structured_container(text):
    try:
        value = json.loads(text)
    except (TypeError, ValueError):
        return False
    return isinstance(value, (dict, list)) and len(value) >= 2


def build_rows(collector, encoding):
    fragments, scopes, repeated = defaultdict(list), defaultdict(list), {}
    for fragment in collector.outputs.values():
        fragments[fragment['call_id']].append(fragment)
    for ident, call in collector.calls.items():
        scopes[call['scope']].append((call['time'], ident))
    for values in scopes.values():
        values.sort()
    rows, private = [], []
    calls = sorted(collector.calls.items(), key=lambda item: (item[1]['time'], str(item[0])))
    for ident, call in calls:
        if call['workflow'] != 'file_read':
            continue
        observed = fragments[ident]
        eligible = len(observed) == 1 and observed[0]['scope'] == call['scope']
        text_hash = hashlib.sha256(observed[0]['text'].encode()).hexdigest() if eligible else None
        key = (call['scope'], call['signature'], text_hash)
        previous = repeated.get(key) if eligible else None
        prior_ident, prior_call, prior_output = previous if previous else (None, None, None)
        strict = bool(previous and prior_call['time'] <= prior_output['time'] < call['time'])
        # Includes calls tied with either endpoint: concurrency/order is uncertain.
        intervening = sum(prior_call['time'] <= t <= call['time'] and i not in (prior_ident, ident)
                          for t, i in scopes[call['scope']]) if strict else None
        row = {
            'case_id': base.digest([collector.provider, ident]), 'provider': collector.provider,
            'native_control': call['control'], 'output_fragments': len(observed),
            'output_bytes': sum(f['bytes'] for f in observed) if observed else None,
            'output_tokens': sum(len(encoding.encode(f['text'], disallowed_special=())) for f in observed) if observed else None,
            'single_fragment_same_scope': eligible,
            'structured_container': eligible and structured_container(observed[0]['text']),
            'previous_exact_case_id': base.digest([collector.provider, prior_ident]) if previous else None,
            'previous_output_precedes_call': strict,
            'intervening_observed_calls': intervening,
            'seconds_since_previous_call': round(call['time'] - prior_call['time'], 6) if previous else None,
        }
        rows.append(row)
        private.append({**row, 'scope_sha256': call['scope'], 'query_sha256': call['signature'],
                        'single_fragment_sha256': text_hash, 'call_time': call['time'],
                        'output_times': [f['time'] for f in observed]})
        if eligible:
            repeated[key] = (ident, call, observed[0])
    return rows, private


def summary(rows):
    repeated = [r for r in rows if r['previous_exact_case_id']]
    adjacent = [r for r in repeated if r['previous_output_precedes_call'] and r['intervening_observed_calls'] == 0]
    def mass(selected):
        return {'calls': len(selected), 'output_tokens': sum(r['output_tokens'] for r in selected),
                'output_bytes': sum(r['output_bytes'] for r in selected)}
    return {
        'file_read_calls': len(rows), 'calls_with_observed_output': sum(r['output_fragments'] > 0 for r in rows),
        'calls_without_observed_output': sum(r['output_fragments'] == 0 for r in rows),
        'multiple_fragment_calls': sum(r['output_fragments'] > 1 for r in rows),
        'output_tokens': sum(r['output_tokens'] or 0 for r in rows),
        'output_bytes': sum(r['output_bytes'] or 0 for r in rows),
        'single_fragment_same_scope_calls': sum(r['single_fragment_same_scope'] for r in rows),
        'native_controls': dict(sorted(Counter(r['native_control'] for r in rows).items())),
        'exact_repeated_observations': mass(repeated),
        'repeats_with_prior_output_before_next_call': sum(r['previous_output_precedes_call'] for r in repeated),
        'adjacent_exact_repeated_observations': mass(adjacent),
        'complete_json_containers': mass([r for r in rows if r['structured_container']]),
        'measured_savings_tokens': None, 'proven_safe_reuse_calls': None,
    }


FIELDS = {'case_id', 'provider', 'native_control', 'output_fragments', 'output_bytes', 'output_tokens',
          'single_fragment_same_scope', 'structured_container', 'previous_exact_case_id',
          'previous_output_precedes_call', 'intervening_observed_calls', 'seconds_since_previous_call'}
CONTROLS = {'structured_explicit_limit', 'structured_no_recognized_limit', 'native_head_or_tail',
            'native_line_range', 'literal_no_recognized_limit', 'unresolved'}


def check(report, protocol):
    if report['source_files_sha256'] != hashes() or report['protocol'] != protocol:
        raise ValueError('Source or protocol changed')
    if set(report['providers']) != set(protocol['providers']) or report['outcome'] != 'opportunity-screen-only-no-candidate-admitted':
        raise ValueError('Provider coverage or claim changed')
    rows = report['cases']
    index = {r['case_id']: r for r in rows}
    if len(index) != len(rows) or report['cases_sha256'] != base.digest(rows):
        raise ValueError('Duplicate case or digest mismatch')
    for amendment in report.get('post_collection_integrity_amendments', []):
        source = amendment['source']
        if source != 'research/candidate_opportunities.py' or amendment['before_sha256'] != report['collection_source_files_sha256'][source] or amendment['after_sha256'] != report['source_files_sha256'][source]:
            raise ValueError('Integrity amendment source binding changed')
    for row in rows:
        if set(row) != FIELDS or not re.fullmatch('[a-f0-9]{64}', row['case_id']) or row['provider'] not in protocol['providers']:
            raise ValueError('Unexpected public case fields or identity')
        if row['native_control'] not in CONTROLS or any(type(row[k]) is not bool for k in ('single_fragment_same_scope', 'structured_container', 'previous_output_precedes_call')):
            raise ValueError('Unexpected control or non-boolean flag')
        n = row['output_fragments']
        if type(n) is not int or n < 0:
            raise ValueError('Malformed fragments')
        for k in ('output_tokens', 'output_bytes'):
            if (not n and row[k] is not None) or (n and (type(row[k]) is not int or row[k] < 0)):
                raise ValueError('Missing output must remain unknown')
        if row['single_fragment_same_scope'] and n != 1:
            raise ValueError('Single-fragment eligibility changed')
        prior_id = row['previous_exact_case_id']
        if prior_id:
            prior_row = index.get(prior_id)
            if not prior_row or prior_id == row['case_id'] or prior_row['provider'] != row['provider'] or not row['single_fragment_same_scope'] or not prior_row['single_fragment_same_scope'] or prior_row['output_bytes'] != row['output_bytes'] or prior_row['output_tokens'] != row['output_tokens']:
                raise ValueError('Repeat accounting invalid')
            if type(row['seconds_since_previous_call']) not in (int, float) or not math.isfinite(row['seconds_since_previous_call']) or row['seconds_since_previous_call'] < 0:
                raise ValueError('Repeat interval invalid')
        elif row['previous_output_precedes_call'] or row['seconds_since_previous_call'] is not None:
            raise ValueError('Unpaired chronology fabricated')
        if row['previous_output_precedes_call']:
            if type(row['intervening_observed_calls']) is not int or row['intervening_observed_calls'] < 0:
                raise ValueError('Missing chronology accounting')
        elif row['intervening_observed_calls'] is not None:
            raise ValueError('Unknown chronology must remain unknown')
        if row['structured_container'] and not row['single_fragment_same_scope']:
            raise ValueError('Structured-content eligibility changed')
        seen, previous = {row['case_id']}, prior_id
        while previous is not None:
            if previous in seen:
                raise ValueError('Repeat references contain a cycle')
            seen.add(previous)
            previous = index[previous]['previous_exact_case_id']
    for provider, value in report['providers'].items():
        if value['screen'] != summary([r for r in rows if r['provider'] == provider]):
            raise ValueError('Summary does not recompute')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'research/candidate-opportunities-report.json')
    parser.add_argument('--private-output', type=Path)
    args = parser.parse_args()
    protocol = json.loads(PROTOCOL.read_text())
    if args.check:
        check(json.loads(args.output.read_text()), protocol)
        print('Read opportunity screen: provenance, scope and arithmetic valid')
        return
    if not args.private_output or ROOT in args.private_output.resolve().parents or args.private_output.resolve() == ROOT:
        parser.error('--private-output must be outside the repository')
    os.umask(0o077)
    import tiktoken
    if importlib.metadata.version('tiktoken') != protocol['tokenizer']['version']:
        raise RuntimeError('Pinned tokenizer required')
    encoding = tiktoken.get_encoding(protocol['tokenizer']['encoding'])
    def expired(*_):
        raise TimeoutError('Fixed 300-second local collection bound reached; no partial success report')
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(300)
    before, rows, private, providers = hashes(), [], [], {}
    window = protocol['window']
    for name, path, parse in [('codex', Path.home() / '.codex/sessions', base.codex_file),
                              ('claude', Path.home() / '.claude/projects', base.claude_file),
                              ('devin', Path.home() / '.local/share/devin/cli/sessions.db', prior.collect_devin)]:
        collector = Collector(name, window['since_inclusive_utc'], window['until_exclusive_utc'])
        if name == 'devin':
            if path.exists():
                parse(path, collector)
            else:
                collector.stats['source_unavailable'] += 1
        else:
            paths = sorted(path.rglob('*.jsonl')) if path.exists() else []
            collector.stats['discovered_transcript_files'] = len(paths)
            for source in paths:
                if source.stat().st_mtime < collector.since:
                    collector.stats['files_with_mtime_before_window_excluded'] += 1
                    continue
                collector.source = str(source)
                collector.stats['transcript_files_scanned'] += 1
                parse(source, collector)
        measurements, private_measurements = build_rows(collector, encoding)
        rows.extend(measurements)
        private.extend(private_measurements)
        providers[name] = {'all_observed_calls': len(collector.calls),
            'scopes_with_read_calls': len({r['scope_sha256'] for r in private_measurements}),
            'collection_counters': dict(sorted(collector.stats.items())),
            'source_calls_outputs_evidence_sha256': base.digest(sorted(collector.provenance)),
            'screen': summary(measurements)}
        print(f'{name}: {len(measurements)} file-read calls screened', flush=True)
    signal.alarm(0)
    if hashes() != before:
        raise RuntimeError('Sources changed during collection')
    rows.sort(key=lambda r: (r['provider'], r['case_id']))
    private_text = json.dumps(private, indent=2) + '\n'
    args.private_output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    args.private_output.write_text(private_text)
    os.chmod(args.private_output, 0o600)
    report = {'schema_version': 1, 'collected_at_utc': datetime.now(timezone.utc).isoformat(),
        'source_files_sha256': before, 'protocol': protocol, 'providers': providers,
        'cases': rows, 'cases_sha256': base.digest(rows),
        'private_measurements_sha256': hashlib.sha256(private_text.encode()).hexdigest(),
        'outcome': 'opportunity-screen-only-no-candidate-admitted'}
    check(report, protocol)
    args.output.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
