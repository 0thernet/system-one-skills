import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'research'))
spec = importlib.util.spec_from_file_location('candidate_screen', ROOT / 'research/candidate_screen.py')
screen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(screen)
native_spec = importlib.util.spec_from_file_location('candidate_native', ROOT / 'research/candidate_native.py')
native = importlib.util.module_from_spec(native_spec)
native_spec.loader.exec_module(native)


class CandidateScreenTests(unittest.TestCase):
    def test_native_controls_are_explicit(self):
        self.assertEqual(screen.native_control('exec_command', {'cmd': 'git status --porcelain=v1'}), 'git_porcelain')
        self.assertEqual(screen.native_control('Bash', {'command': 'cd /tmp/repo && git diff --name-only'}), 'git_file_names')
        self.assertEqual(screen.native_control('Grep', {'output_mode': 'count'}), 'match_counts')
        self.assertEqual(screen.native_control('exec', {'cmd': 'rg -l needle src'}), 'matching_file_names')

    def test_pattern_values_are_not_flags(self):
        for command in ['rg -- --files', 'rg -e --files', 'grep --regexp -l', 'rg -g --files needle']:
            self.assertEqual(screen.native_control('exec', {'cmd': command}), 'literal_search_without_recognized_control')

    def test_dynamic_and_compound_commands_are_unknown(self):
        for command in ['rg needle | head -20', 'git status; git diff', 'rg "$QUERY"', 'git diff $(git rev-parse HEAD)']:
            self.assertEqual(screen.native_control('exec', {'cmd': command}), 'unresolved_command')

    def test_ceiling_boundary_missing_and_empty_are_distinct(self):
        rows = [{'output_tokens': x, 'output_fragments': 1} for x in [0, 191, 192]]
        calls = [{'native_control': 'unresolved_command'} for _ in range(4)]
        value = screen.summarize(rows, calls, [64], 128)
        self.assertEqual(value['calls_without_observed_output'], 1)
        self.assertEqual(value['hypothetical_ceiling_screen'][0]['calls_below_ceiling_requirement'], 2)
        self.assertEqual(value['hypothetical_ceiling_screen'][0]['calls_reaching_ceiling_requirement'], 1)
        self.assertEqual(value['output_token_quantiles']['p50'], 191)

    def make_report(self):
        protocol = json.loads(screen.PROTOCOL.read_text())
        cases = [{'case_id': 'a' * 64, 'provider': 'codex', 'workflow': 'repository_search',
                  'native_control': 'unresolved_command', 'output_fragments': 1, 'output_tokens': 25}]
        providers = {}
        for name in protocol['providers']:
            groups = {}
            for workflow in protocol['workflows']:
                rows = [r for r in cases if r['provider'] == name and r['workflow'] == workflow]
                groups[workflow] = screen.summarize(rows, rows, protocol['hypothetical_per_use_overhead_tokens'], protocol['required_net_margin_tokens'])
            providers[name] = {'workflow_screen': groups}
        return protocol, {'protocol': protocol, 'source_files_sha256': screen.source_hashes(),
                          'providers': providers, 'cases': cases, 'cases_sha256': screen.base.digest(cases),
                          'outcome': 'retrospective-output-headroom-only-no-candidate-admitted'}

    def test_public_report_recomputes_all_summaries(self):
        protocol, report = self.make_report()
        screen.check(report, protocol)
        report['providers']['codex']['workflow_screen']['repository_search']['output_tokens'] += 1
        with self.assertRaisesRegex(ValueError, 'recompute'):
            screen.check(report, protocol)

    def test_duplicate_missing_provider_and_stale_source_fail(self):
        protocol, report = self.make_report()
        duplicate = copy.deepcopy(report)
        duplicate['cases'] *= 2
        duplicate['cases_sha256'] = screen.base.digest(duplicate['cases'])
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            screen.check(duplicate, protocol)
        missing = copy.deepcopy(report)
        del missing['providers']['claude']
        with self.assertRaisesRegex(ValueError, 'coverage'):
            screen.check(missing, protocol)
        stale = copy.deepcopy(report)
        stale['source_files_sha256']['research/analyze_sessions.py'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'sources changed'):
            screen.check(stale, protocol)

    def test_missing_output_cannot_be_rewritten_as_zero(self):
        protocol, report = self.make_report()
        report['cases'][0]['output_fragments'] = 0
        with self.assertRaisesRegex(ValueError, 'remain unknown'):
            screen.check(report, protocol)

    def test_native_report_does_not_infer_missing_summary_counts(self):
        self.assertEqual(native.counts('21 pass\n0 fail\n106 expect() calls\n'), {'pass': 21, 'fail': 0, 'assertions': 106})
        self.assertEqual(native.counts('finished successfully'), {'pass': None, 'fail': None, 'assertions': None})
        self.assertIsNone(native.counts('21 pass\n21 pass\n')['pass'])

    def test_native_report_rejects_changed_token_difference_or_counts(self):
        report = json.loads((ROOT / 'research/candidate-native-report.json').read_text())
        native.check(report)
        wrong_difference = copy.deepcopy(report)
        wrong_difference['results'][1]['tokens_fewer_than_normal'] += 1
        with self.assertRaisesRegex(ValueError, 'difference'):
            native.check(wrong_difference)
        wrong_parity = copy.deepcopy(report)
        wrong_parity['results'][1]['test_counts']['pass'] = None
        with self.assertRaisesRegex(ValueError, 'parity'):
            native.check(wrong_parity)

    def test_native_parity_requires_complete_typed_counts_and_exit(self):
        report = json.loads((ROOT / 'research/candidate-native-report.json').read_text())
        missing = copy.deepcopy(report)
        for row in missing['results']:
            row['test_counts'] = {}
        with self.assertRaisesRegex(ValueError, 'count keys'):
            native.check(missing)
        for invalid in [-1, True, '21', 21.0]:
            malformed = copy.deepcopy(report)
            malformed['results'][0]['test_counts']['pass'] = invalid
            with self.assertRaisesRegex(ValueError, 'Malformed test count'):
                native.check(malformed)
        for invalid in [None, True, '0', 0.0]:
            malformed = copy.deepcopy(report)
            malformed['results'][0]['exit_code'] = invalid
            with self.assertRaisesRegex(ValueError, 'Malformed exit code'):
                native.check(malformed)


if __name__ == '__main__':
    unittest.main()
