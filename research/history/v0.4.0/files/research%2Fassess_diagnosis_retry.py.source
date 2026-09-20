#!/usr/bin/env python3
"""A separate retry assessment; preserve the published first-launch timeout."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

import assess_diagnosis as core

ROOT = core.ROOT
PROTOCOL = ROOT / 'research/diagnosis-retry-protocol.json'
REPORT = ROOT / 'research/diagnosis-retry-report.json'
PREVIOUS = 'research/diagnosis-observed-report.json'
SOURCES = (*core.SOURCE_PATHS, 'research/assess_diagnosis_retry.py',
           PREVIOUS)
PROTOCOL_PATHS = {'research/diagnosis-retry-protocol.json', 'research/diagnosis-retry-tools-protocol.json'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def hashes(protocol_path='research/diagnosis-retry-protocol.json'):
    return {name: sha(ROOT / name) for name in (*SOURCES, protocol_path)}


def timestamp(value, optional=False):
    if optional and value is None:
        return None
    if not isinstance(value, str):
        raise ValueError('Timestamp must be ISO text or explicit null')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Timestamp must have a timezone')
    return parsed


def assess_metadata(rows, attempts, protocol):
    if len(rows) != len(attempts):
        raise ValueError('Every launch needs its retry-specific metadata')
    result = []
    keys = {'sequence', 'requested_model', 'requested_effort', 'observed_model',
            'observed_effort', 'cli_binary_sha256', 'config_sha256',
            'input_manifest_sha256', 'limits', 'first_start_elapsed_ms',
            'completion_event_count', 'tool_access_status'}
    for row, attempt in zip(rows, attempts):
        if set(row) != keys or row['sequence'] != attempt['sequence']:
            raise ValueError('Metadata fields or launch order changed')
        if row['requested_model'] != protocol['model'] or row['requested_effort'] != protocol['reasoning_effort']:
            raise ValueError('Mixed requested models or reasoning settings are forbidden')
        for field in ('observed_model', 'observed_effort'):
            if row[field] is not None and (not isinstance(row[field], str) or not re.fullmatch(r'[a-zA-Z0-9_.:-]{1,100}', row[field])):
                raise ValueError('Observed configuration must be a bounded identifier or null')
        for field in ('cli_binary_sha256', 'config_sha256', 'input_manifest_sha256'):
            core.require_sha(row[field], field)
        if row['cli_binary_sha256'] != protocol['cli_binary_sha256'] or row['config_sha256'] != protocol['retry_config_sha256']:
            raise ValueError('Executed binary or requested configuration differs from frozen retry')
        if row['input_manifest_sha256'] != digest(protocol['inputs_sha256'][attempt['arm']]) or row['limits'] != protocol['limits']:
            raise ValueError('Frozen arm inputs or retry limits differ')
        core.nonnegative_int(row['completion_event_count'], 'completion_event_count')
        if row['tool_access_status'] not in ('available', 'unavailable', 'unverified'):
            raise ValueError('Unknown tool availability status')
        if len(attempt['usage_snapshots']) > row['completion_event_count']:
            raise ValueError('Completion-counter snapshots lack corresponding completion events')
        if row['completion_event_count'] > 1 and attempt['usage_semantics'] != 'unknown':
            raise ValueError('Multiple completion events need separate counter-semantics qualification')
        first = row['first_start_elapsed_ms']
        if first is not None:
            core.elapsed_value(first)
            if first > attempt['elapsed_ms']:
                raise ValueError('First start event cannot occur after launch ended')
        mismatch = ((row['observed_model'] is not None and row['observed_model'] != protocol['model']) or
                    (row['observed_effort'] is not None and row['observed_effort'] != protocol['reasoning_effort']))
        verified = row['observed_model'] == protocol['model'] and row['observed_effort'] == protocol['reasoning_effort']
        result.append({'sequence': row['sequence'], 'arm': attempt['arm'],
                       'observed_configuration': 'mismatch' if mismatch else 'confirmed' if verified else 'unverified',
                       'tool_access_status': row['tool_access_status'],
                       'first_event_after_launch_ms': first,
                       'observed_turn_interval_ms': None,
                       'launcher_wall_ms': attempt['elapsed_ms']})
    return result


def interpret(assessment, metadata):
    mismatch = any(row['observed_configuration'] == 'mismatch' for row in metadata)
    unavailable = any(row['tool_access_status'] == 'unavailable' for row in metadata)
    paired = len(metadata) == 2
    core_summary = assessment['summary']
    return {
        'operational_status': core_summary['operational_status'],
        'retry_attempts': len(assessment['attempts']),
        'historical_timeout_retained_separately': True,
        'observed_configuration_mismatch': mismatch,
        'tool_access_unavailable': unavailable,
        'tool_unavailable_attempts': sum(row['tool_access_status'] == 'unavailable' for row in metadata),
        'both_observed_configurations_confirmed': paired and all(row['observed_configuration'] == 'confirmed' for row in metadata),
        'descriptive_native_minus_reduced_counters': None if mismatch else core_summary['observed_native_minus_reduced_counters'],
        'descriptive_native_minus_reduced_turn_interval_ms': None,
        'complete_usage_and_correct_answer_pair': not mismatch and not unavailable and core_summary['complete_usage_and_correct_answer_pair'],
        'admission': 'not-admitted-single-exploratory-retry-pair',
        'causal_token_or_latency_improvement_demonstrated': False,
        'reliability_improvement_demonstrated': False,
        'limits': ['one archived task', 'fixed arm order', 'cache effects not controlled',
                   'no immutable provider checkpoint', 'natural skill discovery not measured',
                   'prior request transmission unknown', 'no whole coding task comparison'],
    }


def retry_costs(report):
    """Retain unsuccessful known usage separately from an intended pair's delta."""
    assessments = [report['assessment']]
    prior = report['prior_retry_report']
    if prior is not None:
        previous = json.loads((ROOT / prior['path']).read_text())
        check(previous)
        assessments.insert(0, previous['assessment'])
    attempts = [row for assessment in assessments for row in assessment['attempts']]
    known = [core.normalize_usage(row['usage_snapshots'][-1]) for row in attempts
             if row['usage_snapshots'] and row['usage_semantics'] == 'cumulative-cli-session-total']
    totals = {key: sum(row[key] for row in known if row[key] is not None) if any(row[key] is not None for row in known) else None
              for key in (*core.USAGE_KEYS, 'non_cached_input_tokens', 'input_plus_output_tokens')}
    coverage = {key: sum(row[key] is not None for row in known) for key in totals}
    return {'recorded_retry_launches': len(attempts), 'launches_with_known_counter_semantics': len(known),
            'known_counter_totals': totals,
            'known_counter_observation_counts': coverage,
            'counter_totals_scope': 'Each total sums only observed values; its observation count must be compared with recorded_retry_launches. Missing values are not zero.',
            'all_retry_usage_complete': bool(attempts) and all(row['usage_coverage'] == 'complete' for row in attempts),
            'includes_tool_unavailable_retry': prior is not None or any(row['tool_access_status'] == 'unavailable' for row in report['attempt_metadata']),
            'original_120_second_timeout_usage': None,
            'complete_cost_including_original_timeout_known': False}


def check_blind_review(report):
    projection = report['blind_review_projection']
    assessment = report['assessment']
    scored = [row for row in assessment['attempts'] if any(value is not None for value in row['rubric'].values())]
    if projection is None:
        if scored:
            raise ValueError('Scored arms require a hashed blinded-review projection')
        return
    if set(projection) != {'review_sha256', 'scored_before_arm_reveal', 'answers'} or projection['scored_before_arm_reveal'] is not True:
        raise ValueError('Blinded review schema or ordering not declared')
    if projection['review_sha256'] != assessment['private_provenance']['blind_review_sha256']:
        raise ValueError('Blinded review provenance mismatch')
    seen = set()
    for answer in projection['answers']:
        if set(answer) != {'answer_sha256', 'rubric'}:
            raise ValueError('Only opaque answer hashes and rubric scores may be projected')
        core.require_sha(answer['answer_sha256'], 'reviewed answer')
        if answer['answer_sha256'] in seen:
            raise ValueError('Duplicate reviewed answer identity')
        seen.add(answer['answer_sha256'])
        core.assess_rubric(answer['rubric'])
    if seen != {row['answer_sha256'] for row in scored}:
        raise ValueError('Every scored answer must match the blinded review exactly')
    for row in scored:
        answer = next(answer for answer in projection['answers'] if answer['answer_sha256'] == row['answer_sha256'])
        if row['rubric'] != answer['rubric']:
            raise ValueError('Arm rubric differs from its reviewed canonical answer')


def check(report):
    keys = {'schema_version', 'evidence_kind', 'source_files_sha256', 'protocol_sha256',
            'previous_report', 'assessment', 'attempt_metadata', 'derived_metadata',
            'interpretation', 'assessed_at_utc', 'protocol_path', 'prior_retry_report', 'retry_cost_accounting', 'blind_review_projection'}
    if set(report) != keys or type(report['schema_version']) is not int or report['schema_version'] != 1 or report['evidence_kind'] != 'retry-exploratory-log-diagnosis-pilot':
        raise ValueError('Unexpected retry report schema')
    timestamp(report['assessed_at_utc'])
    if report['protocol_path'] not in PROTOCOL_PATHS:
        raise ValueError('Unsupported retry protocol path')
    protocol_path = ROOT / report['protocol_path']
    protocol = json.loads(protocol_path.read_text())
    if report['source_files_sha256'] != hashes(report['protocol_path']) or report['protocol_sha256'] != sha(protocol_path):
        raise ValueError('Retry source or protocol drift')
    prior = report['prior_retry_report']
    if report['protocol_path'] == 'research/diagnosis-retry-protocol.json':
        if prior is not None:
            raise ValueError('The first retry cannot point to a later retry')
    else:
        if prior != {'path': 'research/diagnosis-retry-report.json', 'sha256': sha(ROOT / 'research/diagnosis-retry-report.json')}:
            raise ValueError('Tool-enabled retry must retain the first retry report')
        earlier = json.loads((ROOT / prior['path']).read_text())
        if earlier['assessment']['private_provenance']['execution_plan_sha256'] != protocol['prior_retry_private_plan_sha256'] or not any(row['capture_sha256'] == protocol['prior_retry_attempt_receipt_sha256'] for row in earlier['assessment']['attempts']):
            raise ValueError('Earlier tool-unavailable attempt must match the amended private plan')
    if report['previous_report'] != {'path': PREVIOUS, 'sha256': sha(ROOT / PREVIOUS)} or protocol['previous_report_sha256'] != sha(ROOT / PREVIOUS):
        raise ValueError('Historical timeout report changed')
    core.check_report(report['assessment'])
    check_blind_review(report)
    assessment = report['assessment']
    frozen = protocol['frozen_original_sources']
    for name, expected in frozen.items():
        if sha(ROOT / name) != expected:
            raise ValueError('Frozen original source changed')
    if assessment['private_provenance']['execution_plan_sha256'] != protocol['private_retry_plan_sha256'] or assessment['private_provenance']['runner_sha256'] != protocol['runner_sha256'] or assessment['private_provenance']['cli_binary_sha256'] != protocol['cli_binary_sha256']:
        raise ValueError('Retry execution provenance differs from protocol')
    if assessment['plan']['order'] != protocol['order'] or assessment['plan']['model'] != protocol['model'] or assessment['plan']['reasoning_effort'] != protocol['reasoning_effort'] or assessment['plan']['cli_version'] != protocol['cli_version'] or assessment['plan']['max_session_launches'] != protocol['max_session_launches']:
        raise ValueError('Retry plan/configuration mismatch')
    # The public projection may follow launch; never substitute its timestamp
    # for the original private plan's creation and prelaunch review evidence.
    timestamp(protocol['public_protocol_projected_at_utc'])
    created_at = timestamp(protocol['private_plan_created_at_utc'])
    if any(timestamp(row['started_at_utc']) < created_at for row in assessment['attempts']):
        raise ValueError('Private retry plan was created after launch')
    derived = assess_metadata(report['attempt_metadata'], assessment['attempts'], protocol)
    if report['derived_metadata'] != derived or report['interpretation'] != interpret(assessment, derived):
        raise ValueError('Retry interpretation does not recompute from every attempt')
    if report['retry_cost_accounting'] != retry_costs(report):
        raise ValueError('Failed retry usage must remain in total observed retry cost')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--input', type=Path)
    parser.add_argument('--protocol', choices=sorted(PROTOCOL_PATHS), default='research/diagnosis-retry-protocol.json')
    parser.add_argument('--output', type=Path, default=REPORT)
    args = parser.parse_args()
    if args.check:
        check(json.loads(args.output.read_text()))
        print('Retry diagnosis report: frozen inputs, all attempts and bounded interpretation valid')
        return
    if args.input is None or args.input.resolve() == ROOT or ROOT in args.input.resolve().parents:
        parser.error('--input must be outside the repository')
    report = json.loads(args.input.read_text())
    now = datetime.now(timezone.utc).isoformat()
    assessment = report['assessment']
    assessment.update(schema_version=1, evidence_kind='observed-exploratory-log-diagnosis-pilot',
                      source_files_sha256=core.source_hashes(), accounting=core.ACCOUNTING,
                      assessed_at_utc=now)
    assessment['summary'] = core.summarize(assessment['attempts'], assessment['plan'])
    protocol_path = ROOT / args.protocol
    protocol = json.loads(protocol_path.read_text())
    derived = assess_metadata(report['attempt_metadata'], assessment['attempts'], protocol)
    report.update(schema_version=1, evidence_kind='retry-exploratory-log-diagnosis-pilot',
                  source_files_sha256=hashes(args.protocol), protocol_sha256=sha(protocol_path),
                  protocol_path=args.protocol,
                  prior_retry_report=None if args.protocol == 'research/diagnosis-retry-protocol.json' else
                  {'path': 'research/diagnosis-retry-report.json', 'sha256': sha(ROOT / 'research/diagnosis-retry-report.json')},
                  previous_report={'path': PREVIOUS, 'sha256': sha(ROOT / PREVIOUS)},
                  derived_metadata=derived, interpretation=interpret(assessment, derived),
                  assessed_at_utc=now)
    report['retry_cost_accounting'] = retry_costs(report)
    check(report)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print('Retry report written without changing prior reports or executing a model')


if __name__ == '__main__':
    main()
