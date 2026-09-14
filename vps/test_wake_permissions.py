import tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import vesper_wake_store as store
import vesper_wake_tools as permissions
import vesper_wake_runner as runner

class SwitchTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        patcher=patch.object(store,'PATH',Path(temp.name)/'wake.db');patcher.start();self.addCleanup(patcher.stop)

    def test_persist_and_ignore_legacy_prompt_after_switch_save(self):
        store.configure({'enabled':True,'intervalMinutes':60,'prompt':'old custom text'})
        value={'tools':['read_vesper_state'],'messages':[]}
        result=store.configure({'enabled':True,'intervalMinutes':60,'permissions':value})
        self.assertEqual(result['permissions'],value)
        self.assertEqual(store.task_prompt(),store.DEFAULT_PROMPT)
        with self.assertRaises(ValueError):store.configure({'enabled':True,'permissions':{'tools':['shell'],'messages':[]}})
        self.assertEqual(store.access(),value)

    def test_tool_and_message_permissions_both_required(self):
        value={'tools':['album_send_photos','read_vesper_state'],'messages':[]}
        self.assertEqual(permissions.allowed_tools(value,runner.ALLOWED),{'read_vesper_state'})
        value['messages']=['photos']
        self.assertIn('album_send_photos',permissions.allowed_tools(value,runner.ALLOWED))
        value['tools']=[]
        self.assertFalse(permissions.message_allowed(value,{'name':'album_send_photos'}))

    def test_revocation_blocks_pending_text_delivery(self):
        ident=store.request('pending')
        store.configure({'enabled':True,'intervalMinutes':60,'permissions':{'tools':[],'messages':[]}})
        with patch.object(runner,'http') as http:
            runner.deliver(ident,'Do not send');http.assert_not_called()

    def test_adaptive_does_not_read_disabled_desire(self):
        store.configure({'enabled':True,'intervalMinutes':None,'permissions':{'tools':[],'messages':[]}})
        with patch.object(runner,'http') as http:
            runner.reschedule();http.assert_not_called()
        self.assertEqual(store.status()['schedule']['seconds'],7200)

if __name__=='__main__':unittest.main()
