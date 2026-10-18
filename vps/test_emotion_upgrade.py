import hashlib,unittest
from unittest.mock import patch
import upgrade_emotion_host as upgrade
class UpgradeTests(unittest.TestCase):
 def test_unknown_host_change_refuses_replacement(self):
  with self.assertRaisesRegex(ValueError,'changed since review'):upgrade.runner('unknown live code','new code')
  with self.assertRaisesRegex(ValueError,'changed since review'):upgrade.policy('unknown live policy','new policy')
 def test_existing_v03_install_is_idempotent(self):
  for function,marker in [(upgrade.runner,'# Desire v0.3 compatibility upgrade'),(upgrade.policy,'# Desire v0.3 semantic policy')]:
   text=marker+'\npreserved live code';self.assertEqual(function(text,'canonical'),text)
 def test_policy_preserves_live_planning_and_custom_prompt_rules(self):
  live='WAKE_PROMPT = """nextWake and selfPrompt rules; 听音乐、阅读。"""\ndef target():return "unchanged"\ndef desire_values(result):return "old formula"\n'
  canonical='def desire_values(result):return "committed semantic advice"\n'
  with patch.object(upgrade,'LIVE_POLICY',hashlib.sha256(live.encode()).hexdigest()):result=upgrade.policy(live,canonical)
  self.assertIn('nextWake and selfPrompt rules',result);self.assertIn('def target():return "unchanged"',result)
  self.assertNotIn('old formula',result);self.assertNotIn('听音乐',result);self.assertIn('committed semantic advice',result)
  compile(result,'upgraded-policy','exec')
 def test_unrecognized_anchor_never_silently_partially_patches(self):
  with self.assertRaises(ValueError):upgrade.replace_once('duplicate duplicate','duplicate','new')
if __name__=='__main__':unittest.main()
