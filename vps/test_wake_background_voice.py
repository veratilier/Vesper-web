import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import vesper_wake_runner as runner
import vesper_wake_store as store


class WakeBackgroundVoiceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        location = patch.object(store, 'PATH', Path(temporary.name) / 'wake.sqlite3')
        location.start()
        self.addCleanup(location.stop)
        self.connection = {
            'provider': 'ElevenLabs', 'baseUrl': 'https://api.elevenlabs.io',
            'apiKey': 'private-test-key', 'voiceId': 'test-voice',
            'model': 'eleven_multilingual_v2', 'groupId': '', 'speed': '1.0',
        }

    def test_voice_key_is_private_and_revocable(self):
        result = store.configure_background_voice({'enabled': True, 'connection': self.connection})
        self.assertTrue(result['backgroundVoice']['enabled'])
        self.assertEqual(store.background_voice()['apiKey'], 'private-test-key')
        self.assertNotIn('private-test-key', str(result))
        self.assertNotIn('private-test-key', str(store.status()))
        result = store.configure_background_voice({'enabled': False})
        self.assertFalse(result['backgroundVoice']['enabled'])
        self.assertIsNone(store.background_voice())

    def test_invalid_connection_never_replaces_saved_voice(self):
        store.configure_background_voice({'enabled': True, 'connection': self.connection})
        changed = dict(self.connection, baseUrl='http://localhost')
        with self.assertRaises(ValueError):
            store.configure_background_voice({'enabled': True, 'connection': changed})
        self.assertEqual(store.background_voice()['apiKey'], 'private-test-key')

    def test_voice_choice_is_offered_only_when_configured(self):
        self.assertNotIn('voice', runner.wake_output_schema(False)['properties'])
        schema = runner.wake_output_schema(False, with_voice=True)
        self.assertEqual(schema['properties']['voice'], {'type': 'boolean'})
        self.assertIn('voice', schema['required'])


if __name__ == '__main__':
    unittest.main()
