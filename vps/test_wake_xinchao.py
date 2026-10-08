import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import patch_xinchao_runner as installer
import vesper_wake_store as store
import vesper_wake_runner as runner
import vesper_xinchao as xinchao


NOW = 1790827200


def stamp(at):
    return datetime.fromtimestamp(at, timezone.utc).isoformat()


class SelectionTests(unittest.TestCase):
    def choose(self, state=None, text='好奇（涨）', allowed=('reading_room_read',), ledger=None):
        return xinchao.select(state or {'drives': {'curiosity': .7}}, text, allowed, ledger or {}, NOW)

    def test_rising_only_suggests_authorized_tools(self):
        choice = self.choose()
        self.assertEqual(choice['key'], 'curiosity')
        self.assertEqual(choice['tools'], ['reading_room_read'])
        self.assertIsNone(self.choose(allowed=[]))

    def test_satisfied_or_cooling_drive_does_not_keep_asking(self):
        self.assertIsNone(self.choose(ledger={'last': {'curiosity': NOW - 100}}))
        state = {'drives': {'curiosity': .7}, 'satisfactionPlateaus': {'curiosity': {'until': stamp(NOW + 100)}}}
        self.assertIsNone(self.choose(state))

    def test_two_hour_steady_signal_requires_real_trail(self):
        state = {'drives': {'curiosity': .7}, 'driveTrail': [
            {'at': stamp(NOW - 8000), 'drives': {'curiosity': .7}},
            {'at': stamp(NOW - 100), 'drives': {'curiosity': .7}}]}
        self.assertIsNotNone(self.choose(state, text='好奇（满）'))
        state['driveTrail'][0]['drives']['curiosity'] = .5
        self.assertIsNone(self.choose(state, text='好奇（满）'))

    def test_invalid_and_sleeping_states_are_not_action_candidates(self):
        for value in (float('nan'), True, 'high', 2, -.5):
            self.assertIsNone(self.choose({'drives': {'curiosity': value}}))
        self.assertIsNone(self.choose({'consciousness': 'sleeping', 'drives': {'curiosity': .7}}))

    def test_short_names_and_subtypes_are_supported(self):
        choice = self.choose({'drives': {'possess': .7}}, text='想她（涌·想黏着）', allowed=['letter_create'])
        self.assertEqual(choice['key'], 'possess')
        self.assertIsNone(self.choose({'drives': {'reflection': .5}}, text='反思（涨）', allowed=['jotting_create']))


class AdapterTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        for manager in (patch.object(store, 'PATH', Path(temp.name)/'wake.sqlite3'),
                        patch.dict(os.environ, {'VESPER_XINCHAO_ENABLED': 'true'}),
                        patch.object(xinchao.time, 'time', return_value=NOW)):
            manager.start()
            self.addCleanup(manager.stop)
        self.job = {'id': 'run-1', 'source': 'automation'}

    def record(self, name='jotting_create', status='done', result=None):
        return {'name': name, 'status': status, 'result': json.dumps(result if result is not None else {'stored': True})}

    def test_unavailable_sidecar_falls_back_without_blocking_wake(self):
        with patch.object(xinchao, 'Client', side_effect=OSError('offline')):
            self.assertIsNone(xinchao.prepare(store, self.job, ['reading_room_read']))
        with store.db() as con:
            self.assertFalse(store.get(con, 'xinchao_health')['available'])
        self.assertEqual(xinchao.prompt(None), '')

    def test_verification_and_disabled_mode_do_not_contact_sidecar(self):
        with patch.object(xinchao, 'Client') as client:
            xinchao.prepare(store, {'source': 'verification'}, [])
            xinchao.completed(store, {'source': 'verification'}, None, [self.record()])
            with patch.dict(os.environ, {'VESPER_XINCHAO_ENABLED': 'false'}):
                xinchao.prepare(store, self.job, [])
                xinchao.completed(store, self.job, None, [self.record()])
                xinchao.presence(store, [{'role': 'user', 'id': 'u', 'created_at': stamp(NOW)}])
            client.assert_not_called()

    def test_only_completed_confirmed_tools_receive_feedback(self):
        with patch.object(xinchao, 'Client') as client:
            client.return_value.own_action.return_value = {'interaction': {'applied': True}}
            xinchao.completed(store, self.job, None, [self.record(), self.record(), self.record('reading_room_read', result={'text': 'Real book page'}),
                self.record(status='failed'), self.record(result={'stored': False}), self.record('letter_list')])
            self.assertEqual({call.args[1] for call in client.return_value.own_action.call_args_list}, {'reflection', 'discovery'})
            self.assertEqual(client.return_value.own_action.call_count, 2)
            xinchao.completed(store, self.job, None, [self.record()])
            self.assertEqual(client.return_value.own_action.call_count, 2)
        with store.db() as con:
            self.assertEqual({v['status'] for v in store.get(con, 'xinchao_feedback').values()}, {'applied'})

    def test_failed_or_throttled_feedback_is_not_claimed_as_state_change(self):
        with patch.object(xinchao, 'Client') as client:
            client.return_value.own_action.side_effect = TimeoutError()
            xinchao.completed(store, self.job, None, [self.record()])
            xinchao.completed(store, self.job, None, [self.record()])
            self.assertEqual(client.return_value.own_action.call_count, 1)
        with store.db() as con:
            self.assertEqual(next(iter(store.get(con, 'xinchao_feedback').values()))['status'], 'uncertain')
        with patch.object(xinchao, 'Client') as client:
            client.return_value.own_action.return_value = {'interaction': {'applied': False}}
            xinchao.completed(store, {'id': 'run-2', 'source': 'automation'}, None, [self.record()])
        with store.db() as con:
            self.assertIn('received_without_effect', {v['status'] for v in store.get(con, 'xinchao_feedback').values()})

    def test_failed_and_false_storage_receipts_do_not_emit_events(self):
        with patch.object(xinchao, 'Client') as client:
            xinchao.completed(store, self.job, None, [self.record(status='failed'), self.record(result={'stored': False}),
                self.record('reading_room_read', result={'books': ['Catalog only']}),
                self.record('music_search', result={'matches': []}),
                self.record('remember_vesper_memory', result={'candidate': {'id': 'pending'}}),
                self.record(result={'replayed': True, 'jotting': {'id': 'old'}})])
            client.assert_not_called()

    def test_ticks_and_old_or_agent_messages_do_not_fake_presence(self):
        with patch.object(xinchao, 'Client') as client:
            xinchao.presence(store, [])
            xinchao.presence(store, [{'role': 'agent', 'id': 'a', 'created_at': stamp(NOW)},
                                   {'role': 'user', 'id': 'old', 'created_at': stamp(NOW - 400)}])
            client.assert_not_called()
            row = {'role': 'user', 'id': 'u', 'created_at': stamp(NOW - 40)}
            xinchao.presence(store, [row])
            xinchao.presence(store, [row])
            self.assertEqual(client.return_value.request.call_count, 1)
            path, event = client.return_value.request.call_args.args
            self.assertEqual(path, '/v1/conversation-event')
            self.assertNotIn('interaction_type', event)
            self.assertNotIn('exchange', event)

    def test_token_permissions_and_remote_urls_are_rejected(self):
        with patch.dict(os.environ, {'VESPER_XINCHAO_URL': 'https://example.com'}):
            with self.assertRaises(ValueError):
                xinchao.Client()
        token = store.PATH.parent/'token'
        token.write_text('f'*64)
        token.chmod(0o644)
        with patch.dict(os.environ, {'VESPER_XINCHAO_TOKEN_FILE': str(token), 'VESPER_XINCHAO_URL': 'http://127.0.0.1:18110'}):
            with self.assertRaises(ValueError):
                xinchao.Client()

    def test_silent_runner_executes_activity_and_records_sidecar_feedback(self):
        store.request('run-1', source='automation')
        job = {**self.job, 'conversation_id': 'chat', 'user_message_id': 'user'}
        owner = self
        native_calls, messages = [], []
        class RPC:
            def call(self, method, params):
                if method == 'account/read':
                    return {'account': {'type': 'chatgpt'}}
                if method == 'thread/start':
                    return {'thread': {'id': 'thread'}}
                if method == 'turn/start':
                    owner.assertIn('本轮行动候选：好奇', params['input'][0]['text'])
                    owner.assertIn('share=false', params['input'][0]['text'])
                    self.handler({'id': 'read', 'method': 'tool/call', 'params': {'name': 'reading_room_read', 'arguments': {'bookId': 'book', 'page': 0}}})
                    self.handler({'method': 'item/completed', 'params': {'item': {'type': 'agentMessage', 'text': json.dumps({'share': False, 'message': '', 'silentReason': 'Read quietly.'})}}})
                    self.handler({'method': 'turn/completed', 'params': {'turn': {'status': 'completed'}}})
                    return {'turn': {'id': 'turn'}}
                return {}
            def send(self, value):
                if value.get('id') == 'read':
                    owner.assertTrue(value['result']['success'])
            def close(self):
                pass
        def http(path, body=None, **kwargs):
            if path.endswith('/messages') or path == '/api/wake':
                messages.append(body)
                return {}
            if body is None:
                return {'tools': [{'name': 'reading_room_read'}]}
            native_calls.append(body['name'])
            return {'result': {'id': 'book', 'text': 'A real returned page'}}
        with patch.object(xinchao, 'Client') as client, patch.object(runner, 'Rpc', RPC), patch.object(runner, 'http', side_effect=http), \
                patch.object(runner, 'context', return_value=''), patch.object(runner, 'current_preferences', return_value={}), \
                patch.object(runner, 'front_busy', return_value=False), patch.object(runner, 'sleep_gate', return_value=False), \
                patch.object(runner, 'recent_chat', return_value=False), patch.object(runner.policy, 'normal', return_value=True), \
                patch.object(runner.policy, 'history', return_value=[{'id': 'user', 'vesper_conversation_id': 'chat'}]):
            client.return_value.request.side_effect = [{'ok': True, 'text': '好奇（涨）'}, {'drives': {'curiosity': .7}}]
            client.return_value.own_action.return_value = {'interaction': {'applied': True}}
            runner.execute(job)
            self.assertEqual(client.return_value.own_action.call_args.args[1], 'discovery')
        self.assertEqual(native_calls, ['desire_status', 'reading_room_read'])
        self.assertEqual(messages, [])
        with store.db() as con:
            self.assertEqual(con.execute("SELECT status FROM jobs WHERE id='run-1'").fetchone()[0], 'silent')


class InstallerTests(unittest.TestCase):
    def test_patch_preserves_live_prompt_and_next_wake_additions(self):
        integrated = Path(__file__).with_name('vesper_wake_runner.py').read_text()
        raw = integrated
        for _, insertion, _ in installer.INSERTIONS:
            raw = raw.replace(insertion, '')
        raw = raw.replace("prompt+='只返回 JSON", "prompt+='live nextWake and selfPrompt preference\\n'\n        prompt+='只返回 JSON")
        result = installer.patched(raw)
        self.assertIn('live nextWake and selfPrompt preference', result)
        self.assertEqual(installer.patched(result), result)
        compile(result, 'runner', 'exec')

    def test_partial_or_unknown_runner_is_rejected(self):
        with self.assertRaises(ValueError):
            installer.patched('import vesper_xinchao as xinchao\n')
        with self.assertRaises(ValueError):
            installer.patched('print("different runtime")\n')


@unittest.skipUnless(os.environ.get('XINCHAO_TEST_SOURCE') and shutil.which('node'), 'Set XINCHAO_TEST_SOURCE for upstream HTTP integration')
class UpstreamIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        cls.token = root/'token'
        cls.token.write_text('a'*64)
        cls.token.chmod(0o600)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        env = {**os.environ, 'PORT': str(cls.port), 'SERVICE_TOKEN': 'a'*64, 'MCP_ENABLED': 'true',
               'MODEL_ENABLED': 'false', 'DREAM_ENABLED': 'false', 'BARK_ENABLED': 'false', 'DASHBOARD_ENABLED': 'false',
               'OAUTH_ENABLED': 'false', 'BRIDGE_ENABLED': 'false', 'DAYTIME_EMERGENCE_ENABLED': 'false'}
        for key, name in [('STATE_PATH', 'state.json'), ('PERSONALITY_PATH', 'personality.json'),
                          ('TRANSITION_JOURNAL_PATH', 'journal.jsonl'), ('OAUTH_STATE_PATH', 'oauth.json'),
                          ('BOX_STATE_PATH', 'box.json'), ('CABIN_STATE_PATH', 'cabin.json')]:
            env[key] = str(root/name)
        cls.log = (root/'server.log').open('w')
        cls.server = subprocess.Popen(['node', 'src/server.js'], cwd=os.environ['XINCHAO_TEST_SOURCE'], env=env, stdout=cls.log, stderr=cls.log)
        cls.env_patch = patch.dict(os.environ, {'VESPER_XINCHAO_URL': f'http://127.0.0.1:{cls.port}', 'VESPER_XINCHAO_TOKEN_FILE': str(cls.token)})
        cls.env_patch.start()
        cls.addClassCleanup(cls.cleanup)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                cls.client = xinchao.Client()
                cls.client.request('/v1/state')
                return
            except Exception:
                if cls.server.poll() is not None:
                    raise RuntimeError((root/'server.log').read_text())
                time.sleep(.05)
        raise RuntimeError('Upstream service failed to become ready')

    @classmethod
    def cleanup(cls):
        cls.server.terminate()
        try:
            cls.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait()
        cls.log.close()
        cls.env_patch.stop()
        cls.temp.cleanup()

    def test_real_mcp_action_changes_drive_without_fake_user_arrival(self):
        self.client.request('/v1/conversation-event', {'event_id': 'real-user', 'session_id': 'real-user'})
        before = self.client.request('/v1/state')
        receipt = self.client.own_action('actual-note', 'reflection')
        after = self.client.request('/v1/state')
        self.assertTrue(receipt['interaction']['applied'])
        self.assertLess(after['drives']['reflection'], before['drives']['reflection'])
        self.assertEqual(after['lastHeartbeatAt'], before['lastHeartbeatAt'])
        duplicate = self.client.own_action('actual-note', 'reflection')
        again = self.client.request('/v1/state')
        self.assertFalse(duplicate['interaction']['applied'])
        self.assertEqual(again['drives'], after['drives'])
        self.assertIsInstance(self.client.request('/v1/now')['text'], str)


if __name__ == '__main__':
    unittest.main()
