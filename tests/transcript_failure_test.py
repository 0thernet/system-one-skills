"""Synthetic boundary tests; these fixtures are not efficacy observations."""
import importlib.util
import contextlib
import hashlib
import io
import json
import tempfile
from unittest import mock
from pathlib import Path
import sys
import unittest
from historical_evidence_fixture import historical_sources

RESEARCH = Path(__file__).resolve().parents[1] / 'research'
sys.path.insert(0, str(RESEARCH))
import failure_collect as collector
import failure_assess as assessment

class FailureSelection(unittest.TestCase):
    def test_size_exit_and_duplicate_denominators(self):
        c = collector.Collector('claude','2026-08-01T00:00:00Z','2026-09-19T00:00:00Z')
        for i, (log, code) in enumerate([('a'*8192,1),('a'*8192,1),('b'*8192,0),('c'*8191,2),('a'*8192,2)]):
            c.replay_candidate(f'{i:064x}',{'log':log,'exit_code':code},'tool_result')
        report=c.finish()['selection_and_exclusions']
        self.assertEqual(report['replay_eligible_completed_validation_outputs'],5)
        self.assertEqual(report['explicit_exit_nonzero'],4)
        self.assertEqual(report['nonzero_below_8192_bytes'],1)
        self.assertEqual(report['nonzero_at_least_8192_bytes_before_text_dedup'],3)
        self.assertEqual(report['duplicate_failure_text_and_exit_excluded'],1)
        self.assertEqual(report['distinct_noisy_nonzero_excerpts'],2)
        self.assertEqual(len(c.samples),2)

    def test_sample_cap_uses_hash_order_not_arrival_order(self):
        c = collector.Collector('devin','2026-08-01T00:00:00Z','2026-09-19T00:00:00Z')
        for i in reversed(range(15)):
            c.replay_candidate(f'{i:064x}',{'log':str(i)+'a'*8192,'exit_code':1},'tool_result')
        c.finish()
        self.assertEqual(list(c.samples),[f'{i:064x}' for i in range(12)])

class AnnotationEvidence(unittest.TestCase):
    def annotation(self):
        return {'coverage':'all-distinct-observed','detail_units':[
            {'role':'first_identity','spans':['FAIL render.test.ts > renders empty']},
            {'role':'first_message','spans':['Expected: 2','Received: 1']},
            {'role':'additional_message','spans':['Error: fixture missing']},
        ]}
    def test_generic_failure_is_not_exact_actionable_span(self):
        raw='FAIL render.test.ts > renders empty\nExpected: 2\nReceived: 1\nError: fixture missing\n'
        result=assessment.assess_annotation({'log':raw,'presented_text':'exit=1\nFAIL\nError\n'},self.annotation())
        self.assertTrue(result['first_failure_assessable'])
        self.assertFalse(result['first_failure_identity_and_message_retained'])
        self.assertEqual(result['retained_detail_units'],0)
        self.assertTrue(result['requires_log_for_any_annotated_detail'])
    def test_first_retention_does_not_hide_later_omission(self):
        raw='FAIL render.test.ts > renders empty\nExpected: 2\nReceived: 1\nError: fixture missing\n'
        result=assessment.assess_annotation({'log':raw,'presented_text':raw.replace('Error: fixture missing','[…]')},self.annotation())
        self.assertTrue(result['first_failure_identity_and_message_retained'])
        self.assertEqual(result['retained_detail_units'],2)
        self.assertTrue(result['requires_log_for_any_annotated_detail'])
    def test_annotations_must_be_verbatim_source_spans(self):
        with self.assertRaises(ValueError):
            assessment.assess_annotation({'log':'Error','presented_text':'Error'},self.annotation())
    def test_truncation_markers_are_distinct_from_exit_completion(self):
        self.assertTrue(assessment.TRUNCATION.search('Output truncated to 10000 characters'))
        self.assertTrue(assessment.TRUNCATION.search('3000 tokens truncated'))
        self.assertFalse(assessment.TRUNCATION.search('Process exited with code 1'))


class PublicIntegrity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        context = historical_sources(assessment)
        context.__enter__()
        cls.addClassCleanup(context.__exit__, None, None, None)

    def setUp(self):
        # Establish a valid fixture outside each mutation's assertRaises block,
        # so unrelated source drift cannot make a negative test pass vacuously.
        with contextlib.redirect_stdout(io.StringIO()):
            assessment.check()

    def modified_report(self, change):
        corpus=json.loads(assessment.CORPUS.read_text())
        report=json.loads(assessment.REPORT.read_text())
        with tempfile.TemporaryDirectory() as directory:
            cp=Path(directory)/'corpus.json';rp=Path(directory)/'report.json'
            change(corpus,report)
            cp.write_text(json.dumps(corpus))
            digest=hashlib.sha256(cp.read_bytes()).hexdigest()
            report['corpus_file_sha256']=digest
            report['corpora'][0]['file_sha256']=digest
            rp.write_text(json.dumps(report))
            with mock.patch.object(assessment,'CORPUS',cp), mock.patch.object(assessment,'REPORT',rp):
                with contextlib.redirect_stdout(io.StringIO()):
                    assessment.check()
    def test_missing_empty_provider_is_rejected(self):
        def remove(corpus,report):
            del corpus['providers']['codex']
            del report['providers']['codex']
        with self.assertRaises(AssertionError): self.modified_report(remove)
    def test_private_sample_binding_is_not_just_a_hash_shape(self):
        with self.assertRaises(AssertionError):
            self.modified_report(lambda c,r:r.update(private_source_samples_sha256='0'*64))
    def test_corpus_evidence_hash_must_match(self):
        def change(corpus,report): report['corpora'][0]['corpus_evidence_sha256']='0'*64
        with self.assertRaises(AssertionError): self.modified_report(change)
    def test_missing_source_binding_is_rejected(self):
        def change(corpus,report): del report['evaluated_source_sha256']['research/assess_holdout.py']
        with self.assertRaises(AssertionError): self.modified_report(change)
    def test_changed_historical_runtime_source_is_rejected(self):
        source = assessment.ROOT / 'src/reduce.js'
        original = source.read_bytes()
        try:
            source.write_bytes(original + b'\n// changed historical fixture\n')
            with self.assertRaisesRegex(AssertionError, 'Report source drift: src/reduce.js'):
                assessment.check()
        finally:
            source.write_bytes(original)

    def test_unchanged_public_report_passes(self):
        self.modified_report(lambda c,r:None)

if __name__=='__main__': unittest.main()
