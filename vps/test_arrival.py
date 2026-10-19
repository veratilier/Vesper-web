import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import vesper_wake_store as store
import vesper_wake_runner as runner


class ArrivalTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        location = patch.object(store, 'PATH', Path(directory.name) / 'wake.sqlite3')
        location.start()
        self.addCleanup(location.stop)

    def intent(self, ident='trip-1'):
        return {'intentId': ident, 'conversationId': 'ash-chat', 'userMessageId': 'user-1',
                'placeName': 'School', 'expiresAt': time.time() + 3600}

    def test_arrival_queues_once_and_never_sends_coordinates(self):
        self.assertEqual(store.arm_arrival(self.intent())['status'], 'armed')
        event = {'intentId': 'trip-1', 'eventId': 'event-1',
                 'evidence': {'geofence': True, 'wifiMatched': False}}
        self.assertEqual(store.record_arrival(event), store.record_arrival(event))
        with store.db() as con:
            jobs = con.execute("SELECT * FROM jobs WHERE source='place-arrival'").fetchall()
        self.assertEqual(len(jobs), 1)
        job = dict(jobs[0])
        self.assertEqual((job['conversation_id'], job['user_message_id']), ('ash-chat', 'user-1'))
        self.assertEqual(json.loads(job['arrival_json'])['placeName'], 'School')
        self.assertNotIn('latitude', job['arrival_json'])
        self.assertNotIn('longitude', job['arrival_json'])

    def test_cancel_prevents_late_arrival_and_queued_delivery(self):
        store.arm_arrival(self.intent())
        store.cancel_arrival({'intentId': 'trip-1'})
        with self.assertRaises(ValueError):
            store.record_arrival({'intentId': 'trip-1', 'eventId': 'event-1',
                                  'evidence': {'geofence': True, 'wifiMatched': False}})
        store.arm_arrival(self.intent('trip-2'))
        store.record_arrival({'intentId': 'trip-2', 'eventId': 'event-2',
                              'evidence': {'geofence': True, 'wifiMatched': True}})
        store.cancel_arrival({'intentId': 'trip-2'})
        with store.db() as con:
            self.assertEqual(con.execute("SELECT status FROM jobs WHERE id='arrival:trip-2'").fetchone()[0], 'cancelled')

    def test_second_trip_replaces_first(self):
        store.arm_arrival(self.intent())
        store.arm_arrival(self.intent('trip-2'))
        with self.assertRaises(ValueError):
            store.record_arrival({'intentId': 'trip-1', 'eventId': 'event-1',
                                  'evidence': {'geofence': True, 'wifiMatched': False}})

    def test_arrival_push_exempts_recent_chat_and_disabled_auto_wake(self):
        store.arm_arrival(self.intent())
        store.record_arrival({'intentId': 'trip-1', 'eventId': 'event-1',
                              'evidence': {'geofence': True, 'wifiMatched': False}})
        with store.db() as con:
            con.execute("UPDATE jobs SET status='saved',notification='Near school' WHERE id='arrival:trip-1'")
            store.put(con, 'config', {'enabled': False})
        sent = []
        with patch.object(runner, 'sleep_gate', return_value=False), \
             patch.object(runner, 'recent_chat', return_value=True), \
             patch.object(runner, 'current_preferences', return_value={}), \
             patch.object(runner, 'front_busy', return_value=False), \
             patch.object(runner, 'http', side_effect=lambda path, body: sent.append((path, body)) or {'delivered': 1}):
            runner.deliver('arrival:trip-1', 'Near school')
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][1]['conversationId'], 'ash-chat')


if __name__ == '__main__':
    unittest.main()
