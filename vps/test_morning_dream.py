import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import vesper_morning_dream as morning
import vesper_wake_runner as runner
import vesper_wake_store as store


class MorningDreamTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        binding = patch.object(store, 'PATH', Path(directory.name) / 'wake.sqlite3')
        binding.start()
        self.addCleanup(binding.stop)
        self.cycle = {'id': 'sleep:2026-10-19', 'end': 1792364400, 'body': None}
        self.selected = {'thread_id': 'ash-thread', 'conversation_id': 'ash', 'recent': 'user: 晚安'}
        with store.db() as db:
            db.execute('INSERT INTO sleep_cycles(id,start,end) VALUES(?,?,?)', (self.cycle['id'], self.cycle['end'] - 25000, self.cycle['end']))
            db.execute('INSERT INTO jobs(id,source,due,status,created) VALUES(?,?,?,?,?)',
                       ('dream:' + self.cycle['id'], 'morning-dream', self.cycle['end'], 'running', self.cycle['end']))

    def test_same_thread_memory_tool_and_public_trace_are_retained(self):
        body = '我梦见与 Vera 在清晨的海边散步，潮声把昨晚没说完的话轻轻送回来。'
        arguments = {'body': body, 'kind': 'dream', 'source': morning.source(self.cycle)}
        events = [
            {'method': 'item/reasoning/summaryTextDelta', 'params': {'delta': '想到 Vera。'}},
            {'id': 12, 'method': 'item/tool/call', 'params': {'name': 'remember_vesper_memory', 'itemId': 'memory-call', 'arguments': arguments}},
            {'method': 'item/completed', 'params': {'item': {'type': 'agentMessage', 'id': 'greeting-item', 'text': '早上好，Vera。'}}},
            {'method': 'turn/completed', 'params': {'turn': {'status': 'completed'}}},
        ]
        calls = []
        class RPC:
            handler = None
            def call(self, method, params):
                calls.append((method, params))
                if method == 'account/read': return {'account': {'type': 'chatgpt'}}
                if method == 'turn/start': return {'turn': {'id': 'dream-turn'}}
                return {}
            def send(self, packet): calls.append(('send', packet))
            def next(self, timeout): return events.pop(0)
            def close(self): pass
        def http(path, payload=None):
            if payload is None: return {'tools': [{'name': 'remember_vesper_memory'}]}
            args = payload['arguments']
            return {'result': {'stored': True, 'storage': 'shared_memory',
                    'memory': {'id': 'memory-1', 'kind': 'dream', 'body': args['body']}}}
        with (patch.object(runner, 'Rpc', RPC), patch.object(runner, 'http', side_effect=http),
              patch.object(runner, 'dream_permitted', return_value=True),
              patch.object(runner, 'front_busy', return_value=False),
              patch.object(runner, 'recent_chat', return_value=False)):
            result = morning._turn(runner, self.cycle, self.selected, 'dream:' + self.cycle['id'], False)
        self.assertEqual(next(p for m, p in calls if m == 'thread/resume')['threadId'], 'ash-thread')
        self.assertNotIn('thread/start', [m for m, _ in calls])
        self.assertTrue(next(p for m, p in calls if m == 'turn/start')['input'][0]['text'].startswith('[Vesper morning dream — not user content:'))
        self.assertEqual(result['greeting'], '早上好，Vera。')
        self.assertEqual(result['thoughtSummary'], '想到 Vera。')
        self.assertIn(body, result['toolEvents'][0])
        self.assertEqual(json.loads(result['toolEvents'][0].removeprefix('vesper-tool:'))['status'], 'completed')
        with store.db() as db:
            self.assertEqual(db.execute('SELECT memory_id FROM sleep_cycles').fetchone()[0], 'memory-1')
            self.assertEqual(db.execute('SELECT status FROM calls').fetchone()[0], 'done')
            self.assertEqual(store.get(db, 'morning:' + self.cycle['id'])['startedTurnId'], 'dream-turn')

    def test_completed_turn_is_recovered_without_starting_another(self):
        snapshot = {'thread': {'turns': [{'id': 'dream-turn', 'status': 'completed', 'items': [
            {'type': 'reasoning', 'summary': ['想起 Vera。']},
            {'id': 'memory-call', 'type': 'dynamicToolCall', 'tool': 'remember_vesper_memory', 'status': 'completed'},
            {'id': 'greeting-item', 'type': 'agentMessage', 'text': '早上好，Vera。'}]}]}}
        recovered = morning.completed_turn(snapshot, 'dream-turn', True)
        self.assertEqual(recovered['greeting'], '早上好，Vera。')
        self.assertEqual(recovered['thoughtSummary'], '想起 Vera。')
        self.assertIn('remember_vesper_memory', recovered['toolEvents'][0])
        self.assertIsNone(morning.completed_turn(snapshot, 'dream-turn', False))


if __name__ == '__main__': unittest.main()
