#!/usr/bin/env python3
"""Measure native Bun reporters on one inspected current repository test file."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shlex
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ('research/candidate_native.py', 'tests/trial-assessment.test.ts',
           'bench/assess-trials.ts', 'package.json', 'bun.lock')
MODES = [('normal', []), ('dots', ['--dots']), ('only_failures', ['--only-failures'])]
PLAN = {
    'recorded_before_execution_utc': '2026-09-20T02:31:18Z',
    'scope': 'One inspected current repository check, not a historical command or agent task. The tested assessor uses synthetic unit-test inputs; those inputs are not efficacy observations.',
    'command': ['bun', 'test', 'tests/trial-assessment.test.ts'],
    'selection': 'One fixed existing test file chosen before reporter output measurement because it is self-contained and has no historical project command execution. No added/repeated test cases to inflate output.',
    'order': ['normal', 'dots', 'only_failures'],
    'repetitions_per_mode': 1,
    'terminal_environment': {'NO_COLOR': '1', 'FORCE_COLOR': '0', 'TERM': 'dumb'},
    'measurement': 'Combined stdout/stderr UTF-8 text, exact o200k_base tokens plus exact literal invocation tokens. All three modes reported. No elapsed-time comparison because order is fixed and repetitions are insufficient.',
    'correctness_scope': 'Recorded exit code and parsed aggregate pass/fail/assertion counts only. Passing this file does not prove preserved warning visibility, historical-project compatibility or failure diagnosis.',
    'tokenizer': {'package': 'tiktoken', 'version': '0.12.0', 'encoding': 'o200k_base'},
}


def hashes():
    return {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in SOURCES}


def counts(text):
    result = {}
    for key, pattern in [('pass', r'(?m)^\s*(\d+) pass\s*$'),
                         ('fail', r'(?m)^\s*(\d+) fail\s*$'),
                         ('assertions', r'(?m)^\s*(\d+) expect\(\) calls\s*$')]:
        values = re.findall(pattern, text)
        result[key] = int(values[0]) if len(values) == 1 else None
    return result


def check(report):
    if report['source_files_sha256'] != hashes() or report['plan'] != PLAN:
        raise ValueError('Native reporter source or plan changed')
    if [r['mode'] for r in report['results']] != PLAN['order']:
        raise ValueError('Reporter modes missing or reordered')
    baseline = report['results'][0]
    for row, (mode, flags) in zip(report['results'], MODES):
        if row['argv'] != PLAN['command'] + flags or row['mode'] != mode:
            raise ValueError('Command changed')
        if type(row['exit_code']) is not int:
            raise ValueError('Malformed exit code')
        if not isinstance(row['test_counts'], dict) or set(row['test_counts']) != {'pass', 'fail', 'assertions'}:
            raise ValueError('Missing or unexpected test count keys')
        if any(value is not None and (type(value) is not int or value < 0) for value in row['test_counts'].values()):
            raise ValueError('Malformed test count')
        for field in ('output_bytes', 'output_tokens', 'invocation_tokens'):
            if type(row[field]) is not int or row[field] < 0:
                raise ValueError('Malformed measurement')
        if row['total_text_tokens'] != row['output_tokens'] + row['invocation_tokens']:
            raise ValueError('Token total mismatch')
        if row['tokens_fewer_than_normal'] != baseline['total_text_tokens'] - row['total_text_tokens']:
            raise ValueError('Token difference mismatch')
        known = all(v is not None for v in baseline['test_counts'].values()) and all(v is not None for v in row['test_counts'].values())
        if row['same_observed_exit_and_counts_as_normal'] != (known and row['exit_code'] == baseline['exit_code'] and row['test_counts'] == baseline['test_counts']):
            raise ValueError('Observation parity mismatch')
        if not re.fullmatch('[a-f0-9]{64}', row['output_sha256']):
            raise ValueError('Output provenance missing')
    if report['outcome'] != 'native-reporter-demonstration-not-skill-efficacy':
        raise ValueError('Unsupported efficacy claim')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'research/candidate-native-report.json')
    parser.add_argument('--private-output', type=Path)
    args = parser.parse_args()
    if args.check:
        check(json.loads(args.output.read_text()))
        print('Native reporter demonstration: sources and arithmetic valid')
        return
    if not args.private_output or args.private_output.resolve() == ROOT or ROOT in args.private_output.resolve().parents:
        parser.error('--private-output must be outside the repository')
    import tiktoken
    if importlib.metadata.version('tiktoken') != PLAN['tokenizer']['version']:
        raise RuntimeError('Pinned tokenizer version required')
    encoding = tiktoken.get_encoding(PLAN['tokenizer']['encoding'])
    before = hashes()
    results, private = [], []
    environment = {**os.environ, **PLAN['terminal_environment']}
    version = subprocess.run(['bun', '--version'], cwd=ROOT, text=True, capture_output=True, check=True).stdout.strip()
    for mode, flags in MODES:
        argv = PLAN['command'] + flags
        output = subprocess.run(argv, cwd=ROOT, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
        text = output.stdout.decode('utf-8', errors='replace')
        tokens = len(encoding.encode(text, disallowed_special=()))
        invocation = len(encoding.encode(shlex.join(argv), disallowed_special=()))
        results.append({'mode': mode, 'argv': argv, 'exit_code': output.returncode,
                        'test_counts': counts(text), 'output_bytes': len(output.stdout),
                        'output_tokens': tokens, 'invocation_tokens': invocation,
                        'total_text_tokens': tokens + invocation,
                        'output_sha256': hashlib.sha256(output.stdout).hexdigest()})
        private.append({'mode': mode, 'output': text})
    baseline = results[0]
    for row in results:
        known = all(v is not None for v in baseline['test_counts'].values()) and all(v is not None for v in row['test_counts'].values())
        row['tokens_fewer_than_normal'] = baseline['total_text_tokens'] - row['total_text_tokens']
        row['same_observed_exit_and_counts_as_normal'] = known and row['exit_code'] == baseline['exit_code'] and row['test_counts'] == baseline['test_counts']
    if hashes() != before:
        raise RuntimeError('Sources changed during demonstration')
    raw = json.dumps(private, indent=2) + '\n'
    dest = args.private_output.resolve()
    dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle: handle.write(raw)
    os.chmod(dest, 0o600)
    report = {'schema_version': 1, 'plan': PLAN, 'source_files_sha256': before,
              'collected_at_utc': datetime.now(timezone.utc).isoformat(), 'bun_version': version,
              'results': results, 'private_capture_sha256': hashlib.sha256(raw.encode()).hexdigest(),
              'outcome': 'native-reporter-demonstration-not-skill-efficacy'}
    check(report)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
