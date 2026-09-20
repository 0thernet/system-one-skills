import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'research'))
import candidate_opportunities as screen


class Encoding:
    def encode(self, text, **kwargs):
        return list(text.encode())


class ReadOpportunityTests(unittest.TestCase):
    def collector(self):
        return screen.Collector('codex', '2026-09-12T00:00:00Z', '2026-09-19T14:00:00Z')

    def read(self, c, ident, second, text='same', session='one', query=None):
        c.call(ident, 'Read', query or {'file_path': '/private/a'}, f'2026-09-13T00:00:{second:02d}Z', session)
        if text is not None:
            c.output(ident, text, f'2026-09-13T00:00:{second + 1:02d}Z', session, event_id=ident)

    def rows(self, c):
        return screen.build_rows(c, Encoding())[0]

    def test_exact_repeat_has_prior_output_and_no_intervening_call(self):
        c = self.collector()
        self.read(c, 'a', 0)
        self.read(c, 'b', 5)
        rows = self.rows(c)
        self.assertEqual(rows[1]['previous_exact_case_id'], rows[0]['case_id'])
        self.assertEqual(screen.summary(rows)['adjacent_exact_repeated_observations']['calls'], 1)
        self.assertIsNone(screen.summary(rows)['measured_savings_tokens'])

    def test_changed_query_output_session_or_source_is_not_repeat(self):
        for change in ('query', 'output', 'session', 'source'):
            c = self.collector()
            self.read(c, 'a', 0)
            if change == 'source': c.source = 'another'
            self.read(c, 'b', 5, text='different' if change == 'output' else 'same',
                      session='two' if change == 'session' else 'one',
                      query={'file_path': '/private/b'} if change == 'query' else None)
            self.assertIsNone(self.rows(c)[1]['previous_exact_case_id'], change)

    def test_intervening_write_or_read_excludes_adjacent_subset(self):
        for name in ('Edit', 'Read', 'unknown_tool'):
            c = self.collector()
            self.read(c, 'a', 0)
            c.call('x', name, {}, '2026-09-13T00:00:03Z', 'one')
            self.read(c, 'b', 5)
            rows = self.rows(c)
            self.assertEqual(screen.summary(rows)['adjacent_exact_repeated_observations']['calls'], 0)
            self.assertEqual(screen.summary(rows)['exact_repeated_observations']['calls'], 1)

    def test_tied_calls_or_prior_output_after_call_cannot_establish_order(self):
        for second in (0, 1):
            c = self.collector()
            self.read(c, 'a', 0)
            self.read(c, 'b', second)
            row = self.rows(c)[1]
            self.assertFalse(row['previous_output_precedes_call'])
            self.assertIsNone(row['intervening_observed_calls'])

    def test_multiple_fragments_and_missing_output_stay_in_denominator(self):
        c = self.collector()
        self.read(c, 'a', 0)
        c.output('a', 'same', '2026-09-13T00:00:02Z', 'one', event_id='a2')
        self.read(c, 'b', 5)
        self.read(c, 'c', 10, text=None)
        rows = self.rows(c)
        self.assertFalse(rows[0]['single_fragment_same_scope'])
        self.assertIsNone(rows[1]['previous_exact_case_id'])
        self.assertIsNone(rows[2]['output_tokens'])
        self.assertEqual(screen.summary(rows)['file_read_calls'], 3)

    def test_duplicate_transcript_events_do_not_create_repeat(self):
        c = self.collector()
        self.read(c, 'a', 0)
        self.read(c, 'a', 0)
        self.assertEqual(len(self.rows(c)), 1)

    def test_bounds_and_dynamic_commands_are_distinct(self):
        for command, expected in [('sed -n "5,10p" /x', 'native_line_range'),
                                  ('head -n 10 /x', 'native_head_or_tail'),
                                  ('cat /x', 'literal_no_recognized_limit'),
                                  ('cat "$X"', 'unresolved'), ('cat /x | head -10', 'unresolved')]:
            self.assertEqual(screen.read_control('exec', {'cmd': command}), expected)
        self.assertEqual(screen.read_control('Read', {'offset': 10}), 'structured_no_recognized_limit')
        self.assertEqual(screen.read_control('Read', {'limit': 10}), 'structured_explicit_limit')

    def test_json_format_count_does_not_strip_envelopes_or_accept_scalars(self):
        self.assertTrue(screen.structured_container('{"a":1,"b":2}'))
        for text in ('[1]', '2', 'Output:\n{"a":1,"b":2}', '{broken}'):
            self.assertFalse(screen.structured_container(text))

    def report(self):
        c = self.collector()
        self.read(c, 'a', 0)
        self.read(c, 'b', 5)
        rows = self.rows(c)
        protocol = json.loads(screen.PROTOCOL.read_text())
        return protocol, {'source_files_sha256': screen.hashes(), 'protocol': protocol,
                         'cases': rows, 'cases_sha256': screen.base.digest(rows),
                         'outcome': 'opportunity-screen-only-no-candidate-admitted',
                         'providers': {p: {'screen': screen.summary([r for r in rows if r['provider'] == p])}
                                       for p in protocol['providers']}}

    def test_public_summary_and_private_field_injection_rejected(self):
        protocol, report = self.report()
        screen.check(report, protocol)
        report['providers']['codex']['screen']['measured_savings_tokens'] = 4
        with self.assertRaisesRegex(ValueError, 'recompute'): screen.check(report, protocol)
        protocol, report = self.report()
        report['cases'][0]['command'] = 'private'
        report['cases_sha256'] = screen.base.digest(report['cases'])
        with self.assertRaisesRegex(ValueError, 'public case'): screen.check(report, protocol)

    def test_fabricated_repeat_reference_and_unknown_output_rejected(self):
        protocol, report = self.report()
        report['cases'][1]['previous_exact_case_id'] = 'f' * 64
        report['cases_sha256'] = screen.base.digest(report['cases'])
        with self.assertRaisesRegex(ValueError, 'Repeat accounting'): screen.check(report, protocol)
        protocol, report = self.report()
        report['cases'][0]['output_fragments'] = 0
        report['cases_sha256'] = screen.base.digest(report['cases'])
        with self.assertRaisesRegex(ValueError, 'remain unknown'): screen.check(report, protocol)

    def test_nonfinite_interval_flags_controls_and_repeat_cycles_rejected(self):
        for field, value in [('seconds_since_previous_call', float('nan')),
                             ('previous_output_precedes_call', 1), ('native_control', 'private text')]:
            protocol, report = self.report()
            report['cases'][1][field] = value
            report['cases_sha256'] = screen.base.digest(report['cases'])
            with self.assertRaises(ValueError): screen.check(report, protocol)
        protocol, report = self.report()
        report['cases'][0]['previous_exact_case_id'] = report['cases'][1]['case_id']
        report['cases'][0]['seconds_since_previous_call'] = 0
        report['cases_sha256'] = screen.base.digest(report['cases'])
        with self.assertRaisesRegex(ValueError, 'cycle'): screen.check(report, protocol)


if __name__ == '__main__':
    unittest.main()
