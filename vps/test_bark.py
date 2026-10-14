import json
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
import vesper_bark as bark
import codex_history_server as history
from test_history_reconcile import ReconcileTests

class BarkTests(unittest.TestCase):
    setUp = ReconcileTests.setUp
    tearDown = ReconcileTests.tearDown
    request = ReconcileTests.request
    def seed(self):
        self.request('POST', '/conversations/a', {'title': 'Fixture'})
        self.request('POST', '/conversations/b', {'title': 'Other'})
        with closing(history.db()) as con, con:
            config = bark.configure(con, {'enabled': True, 'address': 'https://api.day.app/fixture-key'})
            config['since'] = time.time() - 10; config['name'] = 'Ash'; config['icon'] = 'https://fixture.test/avatar.jpg'
            bark.store_settings(con, config)
        return time.time()
    def test_authenticated_config_and_invalid_targets(self):
        self.assertEqual(self.request('GET', '/notifications/bark', token='wrong')[0], 401)
        for url in ['http://api.day.app/key', 'https://localhost/key', 'https://api.day.app/key/more', 'https://user@api.day.app/key']:
            self.assertEqual(self.request('POST', '/notifications/bark', {'enabled': True, 'address': url})[0], 400)
        self.assertEqual(self.request('POST', '/notifications/bark', {'enabled': True, 'address': 'https://api.day.app/fixture-key/'})[0], 200)
        self.assertEqual(self.request('GET', '/notifications/bark')[1]['address'], 'https://api.day.app/fixture-key')
    def test_completed_turn_combines_bubbles_and_sends_once_with_name_avatar_link(self):
        now = self.seed()
        for i, text in enumerate(['第一句', '第二句']):
            self.request('POST', '/conversations/a/messages', {'id': 'm'+str(i), 'role': 'agent', 'content': text,
                'metadata': {'threadId': 'thread', 'turnId': 'turn'}})
        with closing(history.db()) as con, con:
            bark.enqueue(con, 'turn:thread:turn', 'a', 'fallback', now)
            bark.enqueue(con, 'turn:thread:turn', 'a', 'duplicate', now)
        sent = []
        with patch('vesper_codex_records.sync', return_value={}):
            bark.deliver_pending(history.db, 'fixture', lambda body: sent.append(body))
            bark.deliver_pending(history.db, 'fixture', lambda body: sent.append(body))
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]['body'], '第一句\n第二句')
        self.assertEqual(sent[0]['title'], 'Ash'); self.assertEqual(sent[0]['icon'], 'https://fixture.test/avatar.jpg')
        self.assertEqual(sent[0]['url'], 'vesper://chat?backend=vps&conversationId=a')
    def test_proactive_voice_notification_identifies_audio_once(self):
        self.seed()
        self.request('POST', '/conversations/a/messages', {
            'id': 'wake:fixture:final', 'role': 'agent', 'content': '想跟你说句话。',
            'metadata': {'wakeRunId': 'fixture', 'voiceMessage': True},
        })
        bark.scan(history.db)
        bark.scan(history.db)
        sent = []
        bark.deliver_pending(history.db, 'fixture', sent.append)
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]['body'], '🎙️ 语音 · 想跟你说句话。')
    def test_matching_visible_chat_suppressed_even_if_user_leaves_before_poll(self):
        now = self.seed()
        with closing(history.db()) as con, con:
            bark.presence(con, {'deviceId': 'phone', 'sequence': 1, 'conversationId': 'a', 'visible': True}, now-2)
            bark.presence(con, {'deviceId': 'phone', 'sequence': 2, 'conversationId': 'a', 'visible': False}, now+1)
            bark.enqueue(con, 'viewed', 'a', 'No notification', now)
            self.assertEqual(con.execute("SELECT status FROM bark_events WHERE id='viewed'").fetchone()[0], 'viewed')
        sent=[]; bark.deliver_pending(history.db, 'fixture', sent.append)
        self.assertEqual(sent, [])
    def test_background_other_chat_and_expired_lease_do_not_suppress(self):
        now = self.seed()
        with closing(history.db()) as con, con:
            bark.presence(con, {'deviceId': 'phone', 'sequence': 10, 'conversationId': 'b', 'visible': True}, now)
            bark.presence(con, {'deviceId': 'phone', 'sequence': 9, 'conversationId': 'a', 'visible': True}, now)
            self.assertFalse(bark.watching(con, 'a', now))
            self.assertTrue(bark.watching(con, 'b', now+1))
            self.assertFalse(bark.watching(con, 'b', now+36))
            bark.enqueue(con, 'other-room', 'a', 'Reply', now)
        sent=[]; bark.deliver_pending(history.db, 'fixture', sent.append)
        self.assertEqual(len(sent), 1)
    def test_incremental_scan_waits_for_task_complete_and_survives_relaunch(self):
        now = self.seed(); path = Path(self.temp.name)/'rollout.jsonl'
        stamp = bark.datetime.fromtimestamp(now, bark.timezone.utc).isoformat()
        def event(kind): return json.dumps({'type': 'event_msg', 'timestamp': stamp, 'payload': {'type': kind, 'turn_id': 'turn', 'last_agent_message': 'Final'}})+'\n'
        path.write_text(event('item_completed')+event('item_completed'))
        with closing(history.db()) as con, con:
            bark.scan_thread(con, 'a', 'thread', path, now-10)
            self.assertEqual(con.execute('SELECT count(*) FROM bark_events').fetchone()[0], 0)
        with path.open('a') as f: f.write(event('task_complete'))
        with closing(history.db()) as con, con: bark.scan_thread(con, 'a', 'thread', path, now-10)
        with closing(history.db()) as con, con:
            bark.scan_thread(con, 'a', 'thread', path, now-10)
            self.assertEqual(con.execute('SELECT count(*) FROM bark_events').fetchone()[0], 1)
    def test_uncertain_receipt_never_blindly_repeats_and_deleted_room_cancels(self):
        now = self.seed()
        with closing(history.db()) as con, con:
            bark.enqueue(con, 'uncertain', 'a', 'Reply', now)
            bark.enqueue(con, 'removed', 'b', 'No reply', now)
            con.execute("UPDATE conversations SET archived_at='deleted' WHERE vesper_conversation_id='b'")
        calls=[]
        def fail(body): calls.append(body); raise TimeoutError()
        bark.deliver_pending(history.db, 'fixture', fail)
        bark.deliver_pending(history.db, 'fixture', fail)
        self.assertEqual(len(calls), 1)
        with closing(history.db()) as con:
            self.assertEqual(dict(con.execute('SELECT id,status FROM bark_events')), {'uncertain':'uncertain','removed':'cancelled'})
    def test_enabling_does_not_replay_historic_replies_and_key_change_cancels_pending(self):
        now = self.seed()
        with closing(history.db()) as con, con:
            bark.enqueue(con, 'old', 'a', 'Old', now-20)
            self.assertEqual(con.execute('SELECT count(*) FROM bark_events').fetchone()[0], 0)
            bark.enqueue(con, 'new', 'a', 'New', now-1)
            bark.configure(con, {'enabled': True, 'address': 'https://api.day.app/new-fixture-key'})
        calls=[]; bark.deliver_pending(history.db, 'fixture', calls.append)
        self.assertEqual(calls, [])
    def test_large_existing_avatar_becomes_a_small_notification_preview(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest('Pillow is installed on the deployed VPS')
        import base64
        from io import BytesIO
        output=BytesIO()
        Image.effect_noise((1100,1100),100).convert('RGB').save(output,format='PNG')
        raw=output.getvalue(); self.assertGreater(len(raw),512_000)
        with patch.object(bark,'ROOT',Path(self.temp.name)/'avatars'):
            with closing(history.db()) as con, con:
                value=bark.set_profile(con,{'agentName':'Ash','agentAvatar':'data:image/png;base64,'+base64.b64encode(raw).decode()},'fixture')
            self.assertTrue(value['icon'])
            file=next(bark.ROOT.glob('*.image'))
            self.assertLess(file.stat().st_size,40_000)
            with Image.open(file) as image:
                self.assertLessEqual(image.width,160); self.assertLessEqual(image.height,160)

    def test_avatar_signed_capability_changes_with_current_profile(self):
        import base64
        root=Path(self.temp.name)/'avatars'
        with patch.object(bark, 'ROOT', root):
            with closing(history.db()) as con, con:
                first=bark.set_profile(con, {'agentName':'Ash','agentAvatar':'data:image/jpeg;base64,'+base64.b64encode(b'\xff\xd8fixture').decode()}, 'fixture')
                second=bark.set_profile(con, {'agentName':'Sol','agentAvatar':'data:image/jpeg;base64,'+base64.b64encode(b'\xff\xd8changed').decode()}, 'fixture')
            self.assertEqual(second['name'], 'Sol'); self.assertNotEqual(first['icon'], second['icon'])
            digest=second['icon'].split('/icon/')[1].split('?')[0]
            self.assertEqual(self.request('GET','/notifications/bark/icon/'+digest)[0],404)
            self.assertNotEqual(bark.icon_ticket(digest,'fixture'),bark.icon_ticket(digest,'other'))

if __name__ == '__main__': unittest.main()
