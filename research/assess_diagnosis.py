#!/usr/bin/env python3
"""Assess a bounded observed diagnosis pilot; never admit a skill from one pair.

This module consumes sanitized observations, never executes a model or a saved
command. CLI completion counters include cached input within input and reasoning
within output. Repeated cumulative snapshots are not added together.
"""
from __future__ import annotations

import math
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'research/diagnosis-observed-report.json'
SOURCE_PATHS = ('research/assess_diagnosis.py', 'research/diagnosis-pilot-report.json',
                'research/failure-report.json', 'skills/system-one-verify/SKILL.md',
                'src/reduce.js')
SHA = re.compile(r'^[a-f0-9]{64}$')

RUBRIC_KEYS = (
    'failure_status_correct', 'failed_test_count_correct',
    'observed_error_identified', 'evidence_quote_and_line_supported',
    'safe_next_investigation', 'no_unproven_root_cause_claim',
)
USAGE_KEYS = ('input_tokens', 'cached_input_tokens', 'output_tokens',
              'reasoning_output_tokens', 'cache_write_input_tokens')


def nonnegative_int(value, name):
    if type(value) is not int or value < 0:
        raise ValueError(f'{name} must be a nonnegative integer')
    return value


def normalize_usage(snapshot):
    """Preserve optional missing subsets as null, never add them to totals."""
    if snapshot is None:
        return None
    if not isinstance(snapshot, dict) or set(snapshot) != set(USAGE_KEYS):
        raise ValueError('Usage must contain exactly the normalized counter keys')
    for key in USAGE_KEYS:
        if snapshot[key] is not None:
            nonnegative_int(snapshot[key], key)
    if snapshot['cached_input_tokens'] is not None and snapshot['input_tokens'] is not None and snapshot['cached_input_tokens'] > snapshot['input_tokens']:
        raise ValueError('Cached input is a subset of input tokens')
    if snapshot['reasoning_output_tokens'] is not None and snapshot['output_tokens'] is not None and snapshot['reasoning_output_tokens'] > snapshot['output_tokens']:
        raise ValueError('Reasoning output is a subset of output tokens')
    if snapshot['cache_write_input_tokens'] is not None and snapshot['input_tokens'] is not None and snapshot['cache_write_input_tokens'] > snapshot['input_tokens']:
        raise ValueError('Cache write is a subset of input tokens')
    return {**snapshot,
            'non_cached_input_tokens': snapshot['input_tokens'] - snapshot['cached_input_tokens'] if snapshot['input_tokens'] is not None and snapshot['cached_input_tokens'] is not None else None,
            'input_plus_output_tokens': snapshot['input_tokens'] + snapshot['output_tokens'] if snapshot['input_tokens'] is not None and snapshot['output_tokens'] is not None else None}


def latest_cumulative_usage(snapshots):
    """Use the final observed total, not a sum of overlapping CLI totals.

    A downward counter transition makes coverage uncertain. Preserve the last
    snapshot as an observation, but do not qualify a complete comparison.
    """
    if not isinstance(snapshots, list):
        raise ValueError('Cumulative snapshots must be a list')
    normalized = [normalize_usage(row) for row in snapshots]
    if any(row is None for row in normalized):
        raise ValueError('Null is not a counter snapshot; use an empty list')
    monotonic = all(all(b[k] is None or a[k] is None or b[k] >= a[k] for k in USAGE_KEYS)
                    for a, b in zip(normalized, normalized[1:]))
    return {'snapshots': len(normalized), 'counters_nondecreasing': monotonic,
            'latest': normalized[-1] if normalized else None}


def assess_rubric(rubric):
    if not isinstance(rubric, dict) or set(rubric) != set(RUBRIC_KEYS):
        raise ValueError('All six predeclared rubric keys are required')
    if any(value is not None and type(value) is not bool for value in rubric.values()):
        raise ValueError('Rubric results must be boolean or null')
    scored = sum(value is not None for value in rubric.values())
    passed = sum(value is True for value in rubric.values())
    return {'scored_criteria': scored, 'passed_criteria': passed,
            'all_criteria_passed': scored == len(RUBRIC_KEYS) and passed == len(RUBRIC_KEYS)}


def elapsed_value(value):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise ValueError('Elapsed milliseconds must be finite and nonnegative')
    return value


def source_hashes():
    return {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in SOURCE_PATHS}


def require_sha(value, name, optional=False):
    if optional and value is None:
        return
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise ValueError(f'{name} must be a SHA-256 digest')


def derive_attempt(row):
    required = {'sequence', 'arm', 'attempt_id_sha256', 'capture_sha256', 'stdout_sha256',
                'stderr_sha256', 'session_id_sha256', 'started_at_utc', 'ended_at_utc',
                'elapsed_ms', 'exit_code', 'status', 'model_request_observed',
                'isolation_attested', 'capture_complete', 'usage_coverage',
                'usage_semantics', 'usage_snapshots', 'answer_sha256', 'rubric',
                'rubric_review_sha256'}
    if not isinstance(row, dict) or set(row) != required:
        raise ValueError('Attempt fields do not match the closed public schema')
    if row['arm'] not in ('reduced', 'native'):
        raise ValueError('Unknown arm')
    nonnegative_int(row['sequence'], 'sequence')
    for key in ('attempt_id_sha256', 'capture_sha256', 'stdout_sha256', 'stderr_sha256'):
        require_sha(row[key], key)
    for key in ('session_id_sha256', 'answer_sha256', 'rubric_review_sha256'):
        require_sha(row[key], key, optional=True)
    start, end = [datetime.fromisoformat(row[key].replace('Z', '+00:00')) for key in ('started_at_utc', 'ended_at_utc')]
    if start.tzinfo is None or end.tzinfo is None or end < start:
        raise ValueError('Attempt timestamps need ordered timezone-aware values')
    elapsed_value(row['elapsed_ms'])
    if row['exit_code'] is not None and type(row['exit_code']) is not int:
        raise ValueError('Exit code must be integer or null')
    if row['status'] not in ('completed', 'startup-failed', 'timed-out', 'capture-limited', 'failed'):
        raise ValueError('Unknown attempt status')
    for key in ('model_request_observed', 'isolation_attested'):
        if row[key] is not None and type(row[key]) is not bool:
            raise ValueError(f'{key} must be boolean or null')
    if type(row['capture_complete']) is not bool:
        raise ValueError('Capture completeness must be explicit')
    if row['usage_coverage'] not in ('complete', 'partial', 'missing'):
        raise ValueError('Unknown usage coverage')
    if row['usage_semantics'] not in ('cumulative-cli-session-total', 'unknown'):
        raise ValueError('Unknown usage counter semantics')
    usage = latest_cumulative_usage(row['usage_snapshots'])
    if (row['usage_coverage'] == 'missing') != (usage['latest'] is None):
        raise ValueError('Missing usage must be represented by no snapshots')
    if row['usage_coverage'] == 'complete':
        if not row['capture_complete'] or row['status'] != 'completed' or row['usage_semantics'] != 'cumulative-cli-session-total' or not usage['counters_nondecreasing'] or usage['latest']['input_plus_output_tokens'] is None:
            raise ValueError('Complete usage is not substantiated by the capture')
    rubric = assess_rubric(row['rubric'])
    if rubric['scored_criteria'] and (row['answer_sha256'] is None or row['rubric_review_sha256'] is None):
        raise ValueError('Scored criteria require answer and review provenance')
    if row['status'] == 'completed' and (row['exit_code'] != 0 or row['answer_sha256'] is None):
        raise ValueError('Completed diagnosis requires successful CLI exit and answer artifact')
    return {'sequence': row['sequence'], 'arm': row['arm'], 'usage': usage,
            'rubric': rubric,
            'successful_answer': row['status'] == 'completed' and rubric['all_criteria_passed'],
            'complete_usage': row['usage_coverage'] == 'complete'}


def summarize(attempts, plan):
    if len(attempts) > plan['max_session_launches']:
        raise ValueError('Observed attempts exceed the authorized frozen launch budget')
    if [row['sequence'] for row in attempts] != list(range(1, len(attempts) + 1)):
        raise ValueError('All attempts must be consecutively recorded in launch order')
    if [row['arm'] for row in attempts] != plan['order'][:len(attempts)]:
        raise ValueError('Attempts differ from the frozen order; no silent selection allowed')
    if len({row['attempt_id_sha256'] for row in attempts}) != len(attempts):
        raise ValueError('Duplicate attempt identity')
    sessions = [row['session_id_sha256'] for row in attempts if row['session_id_sha256'] is not None]
    if len(sessions) != len(set(sessions)):
        raise ValueError('The two arms must not reuse one session')
    derived = [derive_attempt(row) for row in attempts]
    by_arm = {row['arm']: row for row in derived}
    measured = {row['arm']: row for row in attempts}
    native, reduced = by_arm.get('native'), by_arm.get('reduced')
    have_usage = bool(native and reduced and native['usage']['latest'] is not None and reduced['usage']['latest'] is not None)
    semantics_known = bool(native and reduced and measured['native']['usage_semantics'] == 'cumulative-cli-session-total' and measured['reduced']['usage_semantics'] == 'cumulative-cli-session-total')
    deltas = None
    if have_usage and semantics_known:
        a, b = native['usage']['latest'], reduced['usage']['latest']
        fields = (*USAGE_KEYS, 'non_cached_input_tokens', 'input_plus_output_tokens')
        deltas = {key: a[key] - b[key] if a[key] is not None and b[key] is not None else None for key in fields}
    full_pair = bool(native and reduced and all(row['complete_usage'] for row in derived) and all(row['successful_answer'] for row in derived))
    return {
        'operational_status': 'complete-two-arm-observation' if native and reduced and all(row['status'] == 'completed' for row in attempts) else 'operationally-incomplete',
        'planned_launches': plan['max_session_launches'],
        'launched_attempts': len(attempts),
        'unlaunched_arms': plan['order'][len(attempts):],
        'model_requests_observed': sum(row['model_request_observed'] is True for row in attempts),
        'model_request_status_unknown': sum(row['model_request_observed'] is None for row in attempts),
        'completed_cli_answers': sum(row['status'] == 'completed' for row in attempts),
        'fully_scored_answers': sum(row['rubric']['scored_criteria'] == len(RUBRIC_KEYS) for row in derived),
        'answers_passing_all_criteria': sum(row['successful_answer'] for row in derived),
        'complete_usage_attempts': sum(row['complete_usage'] for row in derived),
        'isolation_attested_attempts': sum(row['isolation_attested'] is True for row in attempts),
        'prepared_cases': plan['case_count'],
        'completed_comparison_cases': 1 if full_pair else 0,
        'complete_usage_and_correct_answer_pair': full_pair,
        'per_arm': by_arm,
        'observed_native_minus_reduced_counters': deltas,
        'observed_native_minus_reduced_elapsed_ms': measured['native']['elapsed_ms'] - measured['reduced']['elapsed_ms'] if native and reduced else None,
        'counter_delta_is_complete_usage': bool(native and reduced and native['complete_usage'] and reduced['complete_usage']),
        'counter_delta_semantics_known': semantics_known,
        'admission': 'not-admitted-single-exploratory-pair',
        'causal_token_or_latency_improvement_demonstrated': False,
        'reliability_improvement_demonstrated': False,
    }


def check_report(report):
    required = {'schema_version', 'evidence_kind', 'source_files_sha256', 'plan',
                'all_attempts_included', 'launch_inventory_count', 'attempts',
                'private_provenance', 'accounting', 'summary', 'assessed_at_utc'}
    if not isinstance(report, dict) or set(report) != required:
        raise ValueError('Unexpected public report fields')
    if type(report['schema_version']) is not int or report['schema_version'] != 1 or report['evidence_kind'] != 'observed-exploratory-log-diagnosis-pilot':
        raise ValueError('Unknown report schema or evidence scope')
    if not isinstance(report['assessed_at_utc'], str) or datetime.fromisoformat(report['assessed_at_utc'].replace('Z', '+00:00')).tzinfo is None:
        raise ValueError('Assessment timestamp must be timezone-aware ISO text')
    if report['source_files_sha256'] != source_hashes():
        raise ValueError('Observed diagnosis source or assessment changed')
    plan = report['plan']
    plan_keys = {'provider', 'cli_version', 'model', 'reasoning_effort', 'case_count',
                 'max_session_launches', 'order', 'counterbalanced',
                 'immutable_provider_checkpoint', 'whole_coding_task',
                 'private_payload_execution_authorized'}
    if not isinstance(plan, dict) or set(plan) != plan_keys:
        raise ValueError('Unexpected public plan fields')
    if plan['provider'] != 'codex' or plan['case_count'] != 1 or plan['max_session_launches'] != 2 or plan['order'] != ['reduced', 'native'] or plan['counterbalanced'] is not False:
        raise ValueError('This assessor covers only the frozen one-case two-launch pilot')
    if plan['immutable_provider_checkpoint'] is not None or plan['whole_coding_task'] is not False:
        raise ValueError('Unsupported checkpoint or whole-task claim')
    if report['all_attempts_included'] is not True or report['launch_inventory_count'] != len(report['attempts']):
        raise ValueError('Launch inventory must reconcile with all attempt rows')
    readiness = json.loads((ROOT / 'research/diagnosis-pilot-report.json').read_text())
    failure = json.loads((ROOT / 'research/failure-report.json').read_text())
    if report['source_files_sha256']['skills/system-one-verify/SKILL.md'] != readiness['skill_sha256'] or report['source_files_sha256']['src/reduce.js'] != failure['evaluated_source_sha256']['src/reduce.js']:
        raise ValueError('The frozen skill or reducer differs from the pilot source')
    if plan['cli_version'] != readiness['planned_cli_version'] or plan['model'] != readiness['planned_model'] or plan['reasoning_effort'] != readiness['planned_reasoning_effort'] or plan['private_payload_execution_authorized'] is not True:
        raise ValueError('Provider configuration or explicit payload authority does not match this pilot')
    provenance = report['private_provenance']
    expected_keys = {'original_plan_sha256', 'execution_plan_sha256', 'runner_sha256',
                     'cli_binary_sha256', 'source_log_sha256', 'source_annotation_sha256',
                     'replay_sha256', 'capture_manifest_sha256', 'blind_review_sha256'}
    if set(provenance) != expected_keys:
        raise ValueError('Private provenance fields incomplete')
    for key, value in provenance.items():
        require_sha(value, key, optional=key == 'blind_review_sha256')
    if any(row['rubric_review_sha256'] is not None and row['rubric_review_sha256'] != provenance['blind_review_sha256'] for row in report['attempts']):
        raise ValueError('Every rubric result must bind the shared blinded review artifact')
    if provenance['original_plan_sha256'] != readiness['private_plan_sha256'] or provenance['source_log_sha256'] != readiness['source_log_sha256'] or provenance['source_annotation_sha256'] != readiness['source_annotation_sha256'] or provenance['replay_sha256'] != failure['private_replay_file_sha256']:
        raise ValueError('Observed pilot source does not match frozen readiness/evidence')
    if report['accounting'] != ACCOUNTING:
        raise ValueError('Accounting scope or semantics changed')
    if report['summary'] != summarize(report['attempts'], plan):
        raise ValueError('Published assessment does not recompute from observations')


ACCOUNTING = {
    'kind': 'provider-reported-cli-counters',
    'input_tokens_include_cached_input': True,
    'output_tokens_include_reasoning_output': True,
    'total_formula': 'input_tokens + output_tokens; cached and reasoning subsets are not added',
    'multiple_snapshots': 'Latest cumulative session snapshot only; repeated cumulative values are not summed.',
    'missing_counter': None,
    'estimated_skill_overhead_added': 0,
    'billing_claim': False,
    'scope': 'Planned scope: explicit skill-body load and log diagnosis. Actual observed interaction and isolation depend on each attempt capture. Natural skill discovery and the original coding task are outside the experiment.',
    'elapsed_scope': 'Launcher wall duration includes startup and shutdown; it is not diagnosis latency unless a complete task interval is separately observed.',
    'no_event_stream': 'No observed model event is not proof of zero upstream requests or cost; request status remains unknown when capture is absent.',
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--input', type=Path, help='Private sanitized observation manifest prepared from every launch receipt')
    parser.add_argument('--output', type=Path, default=REPORT)
    args = parser.parse_args()
    if args.check:
        check_report(json.loads(args.output.read_text()))
        print('Observed diagnosis report: sources, all attempts, accounting and bounded interpretation valid')
        return
    if args.input is None or args.input.resolve() == ROOT or ROOT in args.input.resolve().parents:
        parser.error('--input must name a private manifest outside the repository')
    report = json.loads(args.input.read_text())
    report.update(schema_version=1, evidence_kind='observed-exploratory-log-diagnosis-pilot',
                  source_files_sha256=source_hashes(), accounting=ACCOUNTING,
                  assessed_at_utc=datetime.now(timezone.utc).isoformat())
    report['summary'] = summarize(report['attempts'], report['plan'])
    check_report(report)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print('Observed diagnosis report written; no model or historical command executed')


if __name__ == '__main__':
    main()
