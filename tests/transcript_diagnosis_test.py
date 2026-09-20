"""Synthetic accounting fixtures, never observed diagnosis outcomes."""
import sys
import copy
import json
from pathlib import Path
import unittest
from historical_evidence_fixture import historical_sources

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'research'))
import assess_diagnosis as assessment


def usage(input_tokens=100, cached=40, output=20, reasoning=10):
    return {'input_tokens': input_tokens, 'cached_input_tokens': cached,
            'output_tokens': output, 'reasoning_output_tokens': reasoning,
            'cache_write_input_tokens': None}


def attempt(arm='reduced', sequence=1, tokens=100):
    return {'sequence': sequence, 'arm': arm, 'attempt_id_sha256': str(sequence) * 64,
            'capture_sha256': 'a' * 64, 'stdout_sha256': 'b' * 64,
            'stderr_sha256': 'c' * 64, 'session_id_sha256': str(sequence + 2) * 64,
            'started_at_utc': '2026-09-20T00:00:00Z', 'ended_at_utc': '2026-09-20T00:00:01Z',
            'elapsed_ms': 1000, 'exit_code': 0, 'status': 'completed',
            'model_request_observed': True, 'isolation_attested': False,
            'capture_complete': True, 'usage_coverage': 'complete',
            'usage_semantics': 'cumulative-cli-session-total',
            'usage_snapshots': [usage(tokens)], 'answer_sha256': 'd' * 64,
            'rubric': dict.fromkeys(assessment.RUBRIC_KEYS, True),
            'rubric_review_sha256': 'e' * 64}


PLAN = {'max_session_launches': 2, 'order': ['reduced', 'native'], 'case_count': 1}


def fixture_report():
    readiness = json.loads((assessment.ROOT / 'research/diagnosis-pilot-report.json').read_text())
    failure = json.loads((assessment.ROOT / 'research/failure-report.json').read_text())
    plan = {**PLAN, 'provider': 'codex', 'cli_version': readiness['planned_cli_version'],
            'model': readiness['planned_model'], 'reasoning_effort': readiness['planned_reasoning_effort'],
            'counterbalanced': False, 'immutable_provider_checkpoint': None, 'whole_coding_task': False,
            'private_payload_execution_authorized': True}
    rows = [attempt(), attempt('native', 2)]
    provenance = dict.fromkeys(('execution_plan_sha256', 'runner_sha256', 'cli_binary_sha256',
                              'capture_manifest_sha256'), 'f' * 64)
    provenance.update(original_plan_sha256=readiness['private_plan_sha256'],
                      source_log_sha256=readiness['source_log_sha256'],
                      source_annotation_sha256=readiness['source_annotation_sha256'],
                      replay_sha256=failure['private_replay_file_sha256'],
                      blind_review_sha256='e' * 64)
    return {'schema_version': 1, 'evidence_kind': 'observed-exploratory-log-diagnosis-pilot',
            'source_files_sha256': assessment.source_hashes(), 'plan': plan,
            'all_attempts_included': True, 'launch_inventory_count': 2, 'attempts': rows,
            'private_provenance': provenance, 'accounting': assessment.ACCOUNTING,
            'summary': assessment.summarize(rows, plan), 'assessed_at_utc': '2026-09-20T00:00:00Z'}


class DiagnosisAccountingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        context = historical_sources(assessment)
        context.__enter__()
        cls.addClassCleanup(context.__exit__, None, None, None)

    def setUp(self):
        assessment.check_report(fixture_report())

    def test_cached_and_reasoning_are_not_added_to_total(self):
        result = assessment.normalize_usage(usage())
        self.assertEqual(result['input_plus_output_tokens'], 120)
        self.assertEqual(result['non_cached_input_tokens'], 60)
        self.assertIsNone(result['cache_write_input_tokens'])

    def test_cumulative_snapshots_use_last_not_sum(self):
        result = assessment.latest_cumulative_usage([usage(), usage(), usage(200, 80, 30, 12)])
        self.assertEqual(result['snapshots'], 3)
        self.assertEqual(result['latest']['input_plus_output_tokens'], 230)
        self.assertTrue(result['counters_nondecreasing'])

    def test_missing_usage_is_not_zero(self):
        self.assertIsNone(assessment.normalize_usage(None))
        self.assertIsNone(assessment.latest_cumulative_usage([])['latest'])

    def test_decreasing_cumulative_counter_is_incomplete_evidence(self):
        self.assertFalse(assessment.latest_cumulative_usage([usage(200), usage()])['counters_nondecreasing'])

    def test_invalid_counter_types_and_subsets_fail(self):
        for row in [usage(cached=101), usage(reasoning=21), usage(input_tokens=True), usage(output=-1)]:
            with self.assertRaises(ValueError):
                assessment.normalize_usage(row)
        with self.assertRaises(ValueError):
            assessment.normalize_usage({})

    def test_rubric_requires_every_key_and_unknown_remains_unknown(self):
        with self.assertRaises(ValueError):
            assessment.assess_rubric({})
        rubric = dict.fromkeys(assessment.RUBRIC_KEYS, None)
        self.assertEqual(assessment.assess_rubric(rubric)['scored_criteria'], 0)
        self.assertFalse(assessment.assess_rubric(rubric)['all_criteria_passed'])
        rubric = dict.fromkeys(assessment.RUBRIC_KEYS, True)
        self.assertTrue(assessment.assess_rubric(rubric)['all_criteria_passed'])
        rubric[assessment.RUBRIC_KEYS[0]] = 1
        with self.assertRaises(ValueError):
            assessment.assess_rubric(rubric)

    def test_isolation_unknown_does_not_erase_actual_counter_difference(self):
        rows = [attempt(tokens=200), attempt('native', 2, 100)]
        result = assessment.summarize(rows, PLAN)
        self.assertEqual(result['observed_native_minus_reduced_counters']['input_plus_output_tokens'], -100)
        self.assertEqual(result['isolation_attested_attempts'], 0)
        self.assertFalse(result['causal_token_or_latency_improvement_demonstrated'])
        self.assertEqual(result['admission'], 'not-admitted-single-exploratory-pair')

    def test_timeout_with_no_usage_or_answer_is_an_observation(self):
        row = attempt()
        row.update(status='timed-out', exit_code=-15, model_request_observed=None,
                   isolation_attested=None, capture_complete=False, usage_coverage='missing',
                   usage_semantics='unknown', usage_snapshots=[], answer_sha256=None,
                   rubric=dict.fromkeys(assessment.RUBRIC_KEYS, None), rubric_review_sha256=None,
                   session_id_sha256=None)
        result = assessment.summarize([row], PLAN)
        self.assertEqual(result['launched_attempts'], 1)
        self.assertEqual(result['model_request_status_unknown'], 1)
        self.assertIsNone(result['per_arm']['reduced']['usage']['latest'])
        self.assertIsNone(result['observed_native_minus_reduced_counters'])
        self.assertFalse(result['complete_usage_and_correct_answer_pair'])

    def test_all_attempts_order_identity_and_budget_are_enforced(self):
        rows = [attempt(), attempt('native', 2)]
        for broken in [[rows[1]], list(reversed(rows)), rows + [attempt('native', 3)]]:
            with self.assertRaises(ValueError):
                assessment.summarize(broken, PLAN)
        duplicate = copy.deepcopy(rows)
        duplicate[1]['attempt_id_sha256'] = duplicate[0]['attempt_id_sha256']
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            assessment.summarize(duplicate, PLAN)

    def test_a_failed_answer_is_retained_with_its_usage(self):
        rows = [attempt(), attempt('native', 2)]
        rows[0]['rubric']['observed_error_identified'] = False
        result = assessment.summarize(rows, PLAN)
        self.assertEqual(result['answers_passing_all_criteria'], 1)
        self.assertFalse(result['complete_usage_and_correct_answer_pair'])
        self.assertIsNotNone(result['observed_native_minus_reduced_counters'])

    def test_partial_counter_fields_remain_unknown_without_erasing_known_values(self):
        value = usage()
        value['cached_input_tokens'] = None
        result = assessment.normalize_usage(value)
        self.assertIsNone(result['non_cached_input_tokens'])
        self.assertEqual(result['input_plus_output_tokens'], 120)

    def test_no_vacuous_complete_usage_or_scoring_claim(self):
        missing = attempt()
        missing['usage_snapshots'] = []
        with self.assertRaisesRegex(ValueError, 'Missing usage'):
            assessment.derive_attempt(missing)
        unbound = attempt()
        unbound['rubric_review_sha256'] = None
        with self.assertRaisesRegex(ValueError, 'provenance'):
            assessment.derive_attempt(unbound)

    def test_public_report_recomputes_summary_and_rejects_staleness(self):
        report = fixture_report()
        assessment.check_report(report)
        wrong = copy.deepcopy(report)
        wrong['summary']['answers_passing_all_criteria'] = 1
        with self.assertRaisesRegex(ValueError, 'recompute'):
            assessment.check_report(wrong)
        wrong = copy.deepcopy(report)
        wrong['source_files_sha256']['research/assess_diagnosis.py'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'source or assessment changed'):
            assessment.check_report(wrong)

    def test_public_schema_excludes_raw_answer_fields_and_missing_inventory(self):
        report = fixture_report()
        report['attempts'][0]['raw_answer'] = 'private fixture answer'
        with self.assertRaisesRegex(ValueError, 'closed public schema'):
            assessment.check_report(report)
        report = fixture_report()
        report['launch_inventory_count'] = 1
        with self.assertRaisesRegex(ValueError, 'inventory'):
            assessment.check_report(report)

    def test_missing_scope_and_review_bindings_cannot_pass(self):
        report = fixture_report()
        report['plan']['private_payload_execution_authorized'] = False
        with self.assertRaisesRegex(ValueError, 'payload authority'):
            assessment.check_report(report)
        report = fixture_report()
        report['private_provenance']['blind_review_sha256'] = None
        with self.assertRaisesRegex(ValueError, 'shared blinded review'):
            assessment.check_report(report)

    def test_unknown_counter_semantics_preserve_observations_but_not_delta(self):
        rows = [attempt(), attempt('native', 2)]
        rows[0].update(usage_semantics='unknown', usage_coverage='partial')
        result = assessment.summarize(rows, PLAN)
        self.assertEqual(result['per_arm']['reduced']['usage']['latest']['input_tokens'], 100)
        self.assertIsNone(result['observed_native_minus_reduced_counters'])
        self.assertFalse(result['counter_delta_semantics_known'])

    def test_assessment_timestamp_cannot_contain_arbitrary_text(self):
        for value in ['private raw fixture text', '2026-09-20T00:00:00', None]:
            report = fixture_report()
            report['assessed_at_utc'] = value
            with self.assertRaises((ValueError, TypeError)):
                assessment.check_report(report)


if __name__ == '__main__':
    unittest.main()
