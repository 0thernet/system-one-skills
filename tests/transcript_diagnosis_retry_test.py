"""Synthetic retry schema fixtures; no observed arm answers or usage."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'research'))
import assess_diagnosis_retry as retry
from transcript_diagnosis_test import attempt, fixture_report


def fixture():
    protocol = json.loads(retry.PROTOCOL.read_text())
    assessment = fixture_report()
    provenance = assessment['private_provenance']
    provenance.update(execution_plan_sha256=protocol['private_retry_plan_sha256'],
                      runner_sha256=protocol['runner_sha256'],
                      cli_binary_sha256=protocol['cli_binary_sha256'])
    metadata = []
    for row in assessment['attempts']:
        row['answer_sha256'] = str(row['sequence'] + 5) * 64
        row['started_at_utc'] = '2026-09-20T16:00:00Z'
        row['ended_at_utc'] = '2026-09-20T16:00:01Z'
        metadata.append({'sequence': row['sequence'], 'requested_model': protocol['model'],
                         'requested_effort': protocol['reasoning_effort'],
                         'observed_model': None, 'observed_effort': None,
                         'cli_binary_sha256': protocol['cli_binary_sha256'],
                         'config_sha256': protocol['retry_config_sha256'],
                         'input_manifest_sha256': retry.digest(protocol['inputs_sha256'][row['arm']]),
                         'limits': protocol['limits'], 'first_start_elapsed_ms': 50,
                         'completion_event_count': 1, 'tool_access_status': 'available'})
    assessment['summary'] = retry.core.summarize(assessment['attempts'], assessment['plan'])
    derived = retry.assess_metadata(metadata, assessment['attempts'], protocol)
    report = {'schema_version': 1, 'evidence_kind': 'retry-exploratory-log-diagnosis-pilot',
            'source_files_sha256': retry.hashes(), 'protocol_sha256': retry.sha(retry.PROTOCOL),
            'protocol_path': 'research/diagnosis-retry-protocol.json', 'prior_retry_report': None,
            'blind_review_projection': {'review_sha256': 'e' * 64, 'scored_before_arm_reveal': True,
                                       'answers': [{'answer_sha256': row['answer_sha256'], 'rubric': row['rubric'].copy()} for row in assessment['attempts']]},
            'previous_report': {'path': retry.PREVIOUS, 'sha256': retry.sha(retry.ROOT / retry.PREVIOUS)},
            'assessment': assessment, 'attempt_metadata': metadata, 'derived_metadata': derived,
            'interpretation': retry.interpret(assessment, derived),
            'assessed_at_utc': '2026-09-20T16:01:00Z'}
    report['retry_cost_accounting'] = retry.retry_costs(report)
    return report


class RetryAssessmentTests(unittest.TestCase):
    def test_unknown_configuration_does_not_invent_isolation_or_causal_success(self):
        report = fixture()
        retry.check(report)
        result = report['interpretation']
        self.assertFalse(result['both_observed_configurations_confirmed'])
        self.assertFalse(result['causal_token_or_latency_improvement_demonstrated'])
        self.assertIsNotNone(result['descriptive_native_minus_reduced_counters'])
        self.assertIsNone(result['descriptive_native_minus_reduced_turn_interval_ms'])

    def test_requested_model_or_effort_mismatch_rejected(self):
        for key in ('requested_model', 'requested_effort'):
            report = fixture()
            report['attempt_metadata'][0][key] = 'different'
            with self.assertRaisesRegex(ValueError, 'Mixed requested'):
                retry.check(report)

    def test_observed_model_mismatch_is_retained_but_comparison_disqualified(self):
        report = fixture()
        report['attempt_metadata'][0]['observed_model'] = 'different-model'
        protocol = json.loads(retry.PROTOCOL.read_text())
        derived = retry.assess_metadata(report['attempt_metadata'], report['assessment']['attempts'], protocol)
        result = retry.interpret(report['assessment'], derived)
        self.assertTrue(result['observed_configuration_mismatch'])
        self.assertIsNone(result['descriptive_native_minus_reduced_counters'])
        self.assertFalse(result['complete_usage_and_correct_answer_pair'])

    def test_every_attempt_needs_metadata_and_frozen_bounds(self):
        report = fixture()
        report['attempt_metadata'].pop()
        with self.assertRaisesRegex(ValueError, 'Every launch'):
            retry.check(report)
        report = fixture()
        report['attempt_metadata'][0]['limits'] = {**report['attempt_metadata'][0]['limits'], 'total_wall_seconds': 900}
        with self.assertRaisesRegex(ValueError, 'retry limits'):
            retry.check(report)

    def test_multiple_completion_counters_need_explicit_semantics(self):
        report = fixture()
        report['attempt_metadata'][0]['completion_event_count'] = 2
        with self.assertRaisesRegex(ValueError, 'Multiple completion'):
            retry.check(report)

    def test_stale_history_and_source_hashes_rejected(self):
        report = fixture()
        report['previous_report']['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'Historical timeout'):
            retry.check(report)
        report = fixture()
        report['source_files_sha256']['research/assess_diagnosis_retry.py'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'source or protocol drift'):
            retry.check(report)

    def test_first_event_cannot_be_after_launch_ended(self):
        report = fixture()
        report['attempt_metadata'][0]['first_start_elapsed_ms'] = 1001
        with self.assertRaisesRegex(ValueError, 'after launch ended'):
            retry.check(report)

    def test_negative_cost_and_bad_answer_never_disappear(self):
        report = fixture()
        assessment = report['assessment']
        assessment['attempts'][0]['usage_snapshots'][0]['input_tokens'] = 500
        assessment['attempts'][0]['rubric']['observed_error_identified'] = False
        report['blind_review_projection']['answers'][0]['rubric']['observed_error_identified'] = False
        assessment['summary'] = retry.core.summarize(assessment['attempts'], assessment['plan'])
        report['interpretation'] = retry.interpret(assessment, report['derived_metadata'])
        report['retry_cost_accounting'] = retry.retry_costs(report)
        retry.check(report)
        self.assertEqual(report['interpretation']['descriptive_native_minus_reduced_counters']['input_plus_output_tokens'], -400)
        self.assertFalse(report['interpretation']['complete_usage_and_correct_answer_pair'])

    def test_timeout_and_unlaunched_native_are_not_zero_cost_or_bad_diagnosis(self):
        report = fixture()
        assessment = report['assessment']
        assessment['attempts'] = assessment['attempts'][:1]
        assessment['launch_inventory_count'] = 1
        row = assessment['attempts'][0]
        row.update(status='timed-out', exit_code=-15, model_request_observed=None,
                   capture_complete=False, usage_coverage='missing', usage_semantics='unknown',
                   usage_snapshots=[], answer_sha256=None, rubric_review_sha256=None,
                   rubric=dict.fromkeys(retry.core.RUBRIC_KEYS, None))
        assessment['summary'] = retry.core.summarize(assessment['attempts'], assessment['plan'])
        report['attempt_metadata'] = report['attempt_metadata'][:1]
        report['blind_review_projection'] = None
        report['attempt_metadata'][0].update(first_start_elapsed_ms=None, completion_event_count=0)
        report['derived_metadata'] = retry.assess_metadata(report['attempt_metadata'], assessment['attempts'], json.loads(retry.PROTOCOL.read_text()))
        report['interpretation'] = retry.interpret(assessment, report['derived_metadata'])
        report['retry_cost_accounting'] = retry.retry_costs(report)
        retry.check(report)
        self.assertEqual(assessment['summary']['unlaunched_arms'], ['native'])
        self.assertIsNone(report['interpretation']['descriptive_native_minus_reduced_counters'])

    def test_unavailable_tools_never_form_intended_successful_comparison(self):
        report = fixture()
        report['attempt_metadata'][0]['tool_access_status'] = 'unavailable'
        report['derived_metadata'] = retry.assess_metadata(report['attempt_metadata'], report['assessment']['attempts'], json.loads(retry.PROTOCOL.read_text()))
        report['interpretation'] = retry.interpret(report['assessment'], report['derived_metadata'])
        report['retry_cost_accounting'] = retry.retry_costs(report)
        retry.check(report)
        self.assertTrue(report['interpretation']['tool_access_unavailable'])
        self.assertFalse(report['interpretation']['complete_usage_and_correct_answer_pair'])
        self.assertEqual(report['retry_cost_accounting']['known_counter_totals']['input_plus_output_tokens'], 240)
        self.assertFalse(report['retry_cost_accounting']['complete_cost_including_original_timeout_known'])

    def test_partial_cached_usage_is_a_labeled_subtotal(self):
        report = fixture()
        report['assessment']['attempts'][0]['usage_snapshots'][0]['cached_input_tokens'] = None
        cost = retry.retry_costs(report)
        self.assertEqual(cost['known_counter_totals']['cached_input_tokens'], 40)
        self.assertEqual(cost['known_counter_observation_counts']['cached_input_tokens'], 1)
        self.assertEqual(cost['known_counter_observation_counts']['input_plus_output_tokens'], 2)
        self.assertEqual(cost['recorded_retry_launches'], 2)

    def test_changed_canonical_answer_or_grade_cannot_pass(self):
        report = fixture()
        report['assessment']['attempts'][0]['answer_sha256'] = 'a' * 64
        with self.assertRaisesRegex(ValueError, 'match the blinded review'):
            retry.check(report)
        report = fixture()
        report['blind_review_projection']['answers'][0]['rubric']['observed_error_identified'] = False
        with self.assertRaisesRegex(ValueError, 'rubric differs'):
            retry.check(report)


if __name__ == '__main__':
    unittest.main()
