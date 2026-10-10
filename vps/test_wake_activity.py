import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import patch_desire_activity_runner as installer
import test_wake_required_desire as fixtures
import vesper_wake_activity as activity
import vesper_wake_runner as runner
import vesper_wake_store as store
import vesper_wake_workflow as workflow


MISSING = object()
STATE = {'longing': 22, 'tenderness': 45, 'playfulness': 36, 'intensity': 31,
         'attachment': 63, 'possessiveness': 12, 'style': 'quiet'}
PLAN = {'activity': '继续读 Library 中的书，在停下的段落留批注。', 'reason': '刚读到的意象还想展开。'}


class ActivityTests(unittest.TestCase):
    setUp = fixtures.RequiredDesireTests.setUp

    def run_turn(self, next_activity=PLAN, share=False, tool_calls=(), fail=False, before_final=None):
        owner = self
        with store.db() as con:
            con.execute('UPDATE jobs SET conversation_id=?,user_message_id=? WHERE id=?', ('chat', 'user', self.job['id']))

        class RPC:
            handler = None
            def call(self, method, params):
                if method == 'account/read': return {'account': {'type': 'chatgpt'}}
                if method == 'thread/start':
                    owner.instructions = params['developerInstructions']
                    return {'thread': {'id': 'thread'}}
                if method == 'turn/start':
                    owner.prompt = params['input'][0]['text']
                    owner.schema = params['outputSchema']
                    fixtures.assert_strict_output_schema(owner.schema)
                    for i, (name, args) in enumerate(tool_calls):
                        self.handler({'id': 'activity-' + str(i), 'method': 'tool/call', 'params': {'name': name, 'arguments': args}})
                    if before_final: before_final()
                    decision = {'share': share, 'message': 'A real observation.' if share else '', 'silentReason': '' if share else 'Reading quietly', 'desire': None}
                    if next_activity is not MISSING: decision['nextActivity'] = next_activity
                    self.handler({'method': 'item/completed', 'params': {'item': {'type': 'agentMessage', 'text': json.dumps(decision)}}})
                    self.handler({'method': 'turn/completed', 'params': {'turn': {'status': 'failed' if fail else 'completed'}}})
                    return {'turn': {'id': 'turn'}}
                return {}
            def send(self, value): pass
            def close(self): pass

        def http(path, body=None, **kwargs):
            if path.endswith('/messages'):
                owner.messages.append(body); return {}
            if path == '/api/wake': return {'delivered': 1}
            if body is None:
                return {'tools': [{'name': name} for name in ['desire_status', 'desire_encounter', 'read_vesper_state', 'write_vesper_state']]}
            owner.calls.append(body)
            if body['name'] == 'desire_status': return {'result': STATE}
            if body['name'] == 'write_vesper_state': return {'result': {'saved': True, 'section': 'notes'}}
            return {'result': {'text': 'A real returned paragraph'}}

        with patch.object(runner, 'Rpc', RPC), patch.object(runner, 'http', side_effect=http), \
             patch.object(runner, 'context', return_value='Real recent chat'), \
             patch.object(runner, 'current_preferences', return_value={}), patch.object(runner, 'front_busy', return_value=False), \
             patch.object(runner.policy, 'history', return_value=[{'id': 'user', 'vesper_conversation_id': 'chat'}]), \
             patch.object(runner.policy, 'normal', return_value=True):
            runner.execute(self.job)

    def pending(self):
        with store.db() as con: return store.get(con, activity.key(self.job))

    def second(self):
        store.request('second', source='automation')
        self.job = dict(self.job, id='second')

    def test_silent_activity_uses_actual_desire_and_saves_continuation(self):
        self.run_turn(tool_calls=[('read_vesper_state', {'kind': 'notes'}), ('write_vesper_state', {'kind': 'note', 'text': 'A real observation'})])
        self.assertIn(json.dumps(STATE, ensure_ascii=False), self.prompt)
        self.assertIn('nextActivity', self.schema['required'])
        self.assertEqual([call['name'] for call in self.calls], ['desire_status', 'read_vesper_state', 'write_vesper_state'])
        self.assertEqual(self.messages, [])
        self.assertEqual(self.pending()['activity'], PLAN['activity'])
        self.assertEqual(self.pending()['status'], 'planned')
        with store.db() as con:
            self.assertEqual(con.execute("SELECT status FROM jobs WHERE id='test'").fetchone()[0], 'silent')
            receipt = json.loads(con.execute("SELECT workflow_json FROM calls WHERE name='write_vesper_state'").fetchone()[0])
            self.assertEqual(receipt['completion'], 'completed')
            self.assertFalse(any('xinchao' in row[0] for row in con.execute('SELECT key FROM runtime')))

    def test_saved_references_and_owner_addendum_reach_turn_without_duplicate_rules(self):
        reference = 'Rowan 自己保存的活动提示词：\nA saved interest.'
        addendum = 'Vera 的补充提示词：\nAn owner preference.'
        with patch.object(store, 'task_prompt', return_value=store.DEFAULT_PROMPT+'\n\n'+reference+'\n\n'+addendum):
            self.run_turn()
        self.assertEqual(self.instructions, store.DEFAULT_PROMPT)
        self.assertNotIn(store.DEFAULT_PROMPT, self.prompt)
        self.assertIn(reference, self.prompt)
        self.assertIn(addendum, self.prompt)

    def test_legacy_owner_prompt_still_reaches_turn(self):
        with store.db() as con:
            store.put(con, 'permission_mode', False)
            store.put(con, 'task_prompt', 'A legacy owner preference.')
        self.run_turn()
        self.assertEqual(self.instructions, store.DEFAULT_PROMPT)
        self.assertIn('A legacy owner preference.', self.prompt)

    def test_recent_chat_permits_quiet_saved_activity_and_suppresses_extra_text(self):
        with patch.object(runner,'recent_chat',return_value=True):
            self.run_turn(share=True,tool_calls=[('read_vesper_state',{'kind':'notes'}),('write_vesper_state',{'kind':'note','text':'Actual thought'})])
        self.assertEqual([c['name'] for c in self.calls],['desire_status','read_vesper_state','write_vesper_state'])
        self.assertEqual(self.messages,[])
        self.assertEqual(self.pending()['activity'],PLAN['activity'])

    def test_next_turn_receives_pending_plan_and_real_receipts(self):
        self.run_turn(tool_calls=[('read_vesper_state', {'kind': 'notes'})])
        self.second()
        self.run_turn(next_activity=MISSING)
        self.assertIn(PLAN['activity'], self.prompt)
        self.assertIn('读取完成。', self.prompt)
        self.assertIn('"jobId": "test"', self.prompt)
        self.assertEqual(self.pending()['jobId'], 'test')

    def test_null_clears_plan_and_context_is_scoped_to_conversation(self):
        self.run_turn()
        other = activity.context(store, dict(self.job, conversation_id='other'), STATE)
        self.assertIsNone(other['pendingActivity'])
        self.second(); self.run_turn(next_activity=None)
        self.assertIsNone(self.pending())

    def test_shared_message_also_retains_plan(self):
        self.run_turn(share=True)
        self.assertEqual(len(self.messages), 1)
        self.assertEqual(self.pending()['activity'], PLAN['activity'])

    def test_failed_or_invalid_turn_does_not_replace_plan(self):
        self.run_turn(); old = self.pending(); self.second()
        with self.assertRaisesRegex(RuntimeError, 'did not complete'):
            self.run_turn(next_activity=None, fail=True)
        self.assertEqual(self.pending(), old)
        with self.assertRaisesRegex(RuntimeError, 'Invalid next activity'):
            self.run_turn(next_activity={'activity': ' ', 'reason': 'invalid'})
        self.assertEqual(self.pending(), old)

    def test_disable_before_commit_does_not_replace_plan(self):
        self.run_turn(); old = self.pending(); self.second()
        def disable():
            with store.db() as con: store.put(con, 'config', {'enabled': False})
        self.run_turn(next_activity=None, before_final=disable)
        self.assertEqual(self.pending(), old)

    def test_authorized_read_without_encounter_permission(self):
        with store.db() as con: store.put(con, 'permissions', {'tools': ['desire_status'], 'messages': []})
        self.run_turn()
        self.assertEqual([call['name'] for call in self.calls], ['desire_status'])
        self.assertIn(json.dumps(STATE, ensure_ascii=False), self.prompt)
        self.assertNotIn('desire', self.schema['properties'])

    def test_unavailable_state_is_not_guessed(self):
        with store.db() as con: store.put(con, 'permissions', {'tools': [], 'messages': []})
        self.run_turn(next_activity=None)
        self.assertEqual(self.calls, [])
        self.assertIn('"desire": null', self.prompt)

    def test_verification_has_no_activity_plan_or_schema(self):
        self.job = dict(self.job, source='verification')
        self.run_turn(tool_calls=[('desire_status', {}), ('read_vesper_state', {'kind': 'notes'})])
        self.assertNotIn('nextActivity', self.schema['properties'])
        self.assertNotIn('自主活动：', self.prompt)
        self.assertIsNone(self.pending())

    def test_failed_uncertain_and_unconfirmed_receipts_keep_distinct_status(self):
        with store.db() as con:
            con.execute("UPDATE jobs SET conversation_id='chat',finished=1,status='silent' WHERE id='test'")
            for index, status in enumerate(['failed', 'started', 'done']):
                receipt = workflow.step('write_vesper_state', {'kind': 'note'}, {'saved': False})
                if status != 'done': receipt.update(completion='completed', result='Should never be claimed')
                con.execute('INSERT INTO calls(job_id,item_id,name,status,started,workflow_json) VALUES(?,?,?,?,?,?)',
                            ('test', str(index), 'write_vesper_state', status, index, json.dumps(receipt)))
        value = activity.context(store, dict(self.job, id='next'), STATE)
        receipts = value['recentActivities'][0]['toolReceipts']
        self.assertEqual([r['completion'] for r in receipts], ['failed', 'unknown', 'request_accepted'])
        self.assertNotIn('Should never be claimed', json.dumps(value))


class MigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.current = Path(runner.__file__).read_text()
        # Reconstruct the pre-migration layout without depending on Git history;
        # CI checks out only the new commit. Exercise the complete runner text.
        text = cls.current
        for _, insertion, _ in installer.INSERTIONS: text = text.replace(insertion, '')
        text = text.replace(installer.READ_AFTER, installer.READ_BEFORE)
        text = text.replace('import vesper_wake_store as store\n', 'import vesper_wake_store as store\n' + installer.XINCHAO_HOOKS[0])
        text = text.replace("        prompt+='只返回 JSON", installer.XINCHAO_HOOKS[1] + "        prompt+='只返回 JSON")
        anchor = "        with store.db() as con:records=con.execute('SELECT * FROM calls WHERE job_id=?',(ident,)).fetchall()\n"
        text = text.replace(anchor, anchor + installer.XINCHAO_HOOKS[2])
        text = text.replace('def tick():\n    now=time.time()\n', 'def tick():\n    now=time.time()\n' + installer.XINCHAO_HOOKS[3])
        cls.original = text

    def test_old_runner_migrates_without_xinchao_or_loss_of_local_fields(self):
        text = self.original.replace("    return schema\n", "    schema['properties']['nextWake']={'type':'null'}\n    schema['required'].append('nextWake')\n    return schema\n", 1)
        text += '\n# Custom live selfPrompt and nextWake implementation remains here.\n'
        changed = installer.patched(text)
        self.assertNotIn('xinchao.', changed)
        self.assertIn("schema['properties']['nextWake']", changed)
        self.assertIn('Custom live selfPrompt', changed)
        self.assertIn('prompt += activity.prompt', changed)
        self.assertEqual(installer.patched(changed), changed)
        before_prompt = text[text.index('INSTRUCTIONS=policy.WAKE_PROMPT'):text.index('def iso()')]
        self.assertIn(before_prompt, changed)

    def test_original_without_sidecar_is_supported(self):
        text = self.original
        for hook in installer.XINCHAO_HOOKS: text = text.replace(hook, '')
        self.assertIn('activity.output_schema', installer.patched(text))

    def test_current_runner_is_idempotent(self):
        self.assertEqual(installer.patched(self.current), self.current)

    def test_partial_or_unknown_runner_is_rejected_before_writes(self):
        for text in [self.original.replace(installer.XINCHAO_HOOKS[0], ''),
                     self.original.replace('        schema=wake_output_schema(required_desire)\n', ''),
                     self.current.replace('        activity.validate(decision, job)\n', '')]:
            with self.assertRaises(ValueError): installer.patched(text)

    def test_check_then_install_keeps_private_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            live = Path(directory)/'vesper_wake_runner.py'; live.write_text(self.original); live.chmod(0o640)
            command = ['python3', installer.__file__, str(live)]
            subprocess.run(command + ['--check'], check=True, capture_output=True)
            self.assertEqual(live.read_text(), self.original)
            subprocess.run(command, check=True, capture_output=True)
            backups = list(Path(directory).glob('*.before-desire-activity-*'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_text(), self.original)
            self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)
            self.assertEqual(live.stat().st_mode & 0o777, 0o640)
            self.assertTrue(live.with_name('vesper_wake_activity.py').exists())
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(len(list(Path(directory).glob('*.before-desire-activity-*'))), 1)


if __name__ == '__main__': unittest.main()
