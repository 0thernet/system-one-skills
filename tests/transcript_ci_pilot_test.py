import copy
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'research'))
import ci_pilot as pilot


class CIPilotTests(unittest.TestCase):
    def test_explicit_identity_and_no_inferred_cwd(self):
        run, error = pilot.resolve_run({'command': 'gh run view 123 --repo owner/repo --json status,conclusion'})
        self.assertIsNone(error)
        self.assertTrue(run['status_only'])
        self.assertEqual(run['context'], ('repo', 'owner/repo'))
        self.assertIsNone(pilot.resolve_run({'command': 'gh run view 123'})[0])
        self.assertEqual(pilot.resolve_run({'command': 'gh run view 123', 'cwd': '/fixture/project'})[0]['context'][0], 'explicit_cwd')
        self.assertEqual(pilot.resolve_run({'command': 'cd "/fixture/project space" && gh run watch 123'})[0]['verb'], 'watch')

    def test_ambiguous_shell_and_other_ci_targets_are_excluded(self):
        for command in ['gh run view "$RUN" --repo owner/repo',
                        'gh run view 123 --repo owner/repo | cat',
                        'gh run view 123 --repo owner/repo && gh run view 456 --repo owner/repo',
                        'gh run view 123 --repo owner/repo --repo other/repo',
                        'gh run list --repo owner/repo',
                        'gh pr checks 5 --repo owner/repo',
                        'cd relative && gh run view 123',
                        'gh run view 123 --repo owner/repo --unknown']:
            with self.subTest(command=command):
                self.assertIsNone(pilot.resolve_run({'command': command})[0])

    def test_query_scope_and_unknown_status_remain_explicit(self):
        base = 'gh run view 123 --repo owner/repo'
        self.assertFalse(pilot.resolve_run({'command': base})[0]['status_only'])
        self.assertFalse(pilot.resolve_run({'command': base+' --json jobs,status'})[0]['status_only'])
        self.assertFalse(pilot.resolve_run({'command': base+' --json status --jq .status'})[0]['status_only'])
        self.assertEqual(pilot.explicit_state('{"status":"completed","conclusion":"success"}')['status'], 'completed')
        self.assertIsNone(pilot.explicit_state('completed successfully'))
        self.assertIsNone(pilot.explicit_state('"completed"'))
        self.assertIsNone(pilot.explicit_state('{"status":"invented"}'))

    def test_active_ancestry_and_distinct_sessions_are_not_pooled(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'fixture.sqlite'
            connection = sqlite3.connect(db)
            connection.executescript('''
                CREATE TABLE sessions(id TEXT,main_chain_id INTEGER,last_activity_at INTEGER);
                CREATE TABLE message_nodes(session_id TEXT,node_id INTEGER,parent_node_id INTEGER,created_at INTEGER,chat_message TEXT,UNIQUE(session_id,node_id));
            ''')
            timestamp = pilot.epoch('2026-09-17T12:00:00Z')
            command = 'gh run view 123 --repo owner/repo --json status,conclusion'
            def put(session, node, parent, role, ident):
                message = {'message_id':session+str(node), 'role':role}
                if role == 'assistant':
                    message['tool_calls']=[{'id':ident, 'name':'exec', 'arguments':{'command':command}}]
                else:
                    message.update(tool_call_id=ident,content='{"status":"in_progress","conclusion":""}')
                connection.execute('INSERT INTO message_nodes VALUES (?,?,?,?,?)',(session,node,parent,timestamp+node,json.dumps(message)))
            connection.execute('INSERT INTO sessions VALUES (?,?,?)',('s1',4,timestamp+9))
            connection.execute('INSERT INTO sessions VALUES (?,?,?)',('s2',2,timestamp+9))
            for values in [('s1',1,None,'assistant','a'),('s1',2,1,'tool','a'),('s1',3,2,'assistant','b'),('s1',4,3,'tool','b'),('s1',5,None,'assistant','inactive'),('s2',1,None,'assistant','c'),('s2',2,1,'tool','c')]: put(*values)
            connection.commit(); connection.close()
            report = pilot.collect(db)
            self.assertEqual(report['observed_ci_calls'],3)
            self.assertEqual(report['identity_resolved_groups'],2)
            self.assertEqual(report['repeated_identity_groups'],1)
            sequence=report['selected_sequences'][0]
            self.assertEqual(sequence['observations'],2)
            self.assertEqual(sequence['adjacent_same_query_pairs'],1)
            self.assertEqual(sequence['adjacent_same_parsed_state_pairs'],1)
            self.assertFalse(sequence['avoidable_model_turns_established'])
            connection=sqlite3.connect(db)
            self.assertEqual(connection.execute('SELECT count(*) FROM message_nodes').fetchone()[0],7)
            connection.close()

    def test_public_integrity_rejects_missing_or_positive_efficacy_claims(self):
        report=json.loads((pilot.ROOT/'research/ci-pilot-report.json').read_text())
        self.assertTrue(pilot.check(report))
        for mutate in [lambda r:r['result'].__setitem__('observed_ci_calls',999),
                       lambda r:r.__setitem__('measured_token_savings',100),
                       lambda r:r['result']['selected_sequences'][0].__setitem__('avoidable_model_turns_established',True),
                       lambda r:r['result'].__setitem__('selected_sequence_digest','0'*64)]:
            corrupt=copy.deepcopy(report); mutate(corrupt)
            with self.assertRaises(ValueError):pilot.check(corrupt)


if __name__ == '__main__': unittest.main()
