import tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import vesper_letter_reminders as reminders
import vesper_wake_store as store

class LetterRemindersTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        patcher = patch.object(store,'PATH',Path(tmp.name)/'wake.db');patcher.start();self.addCleanup(patcher.stop)
        self.feeds = {'Rowan':[{'id':'from-vera','title':'For you','author':'Vera','due':True}],
                      'Vera':[{'id':'from-rowan','title':'For tomorrow','author':'Rowan','due':True}]}
        self.acks=[];self.messages={}
    def http(self,path,body=None):
        actor = path.split('actor=')[1]
        if body:self.acks.append((actor,body['id']));return {'ok':True}
        return {'reminders':self.feeds[actor]}
    def save(self,job,ident,role,content,meta):
        self.messages[ident]=(job,role,content,meta)
    def test_both_directions_deduplicate_and_keep_cover_only(self):
        target={'conversation_id':'real-chat','user_message_id':'real-user','user_turn_id':'turn'}
        with patch.object(reminders.policy,'history',return_value=[]),patch.object(reminders.policy,'target',return_value=target):
            for _ in range(2):reminders.poll(self.http,Path('unused'),self.save)
        with store.db() as con:
            self.assertEqual(con.execute('SELECT count(*) FROM jobs').fetchone()[0],1)
            self.assertEqual(con.execute('SELECT source FROM jobs').fetchone()[0],'automation')
        self.assertEqual(len(self.messages),1)
        job,role,content,meta=next(iter(self.messages.values()))
        self.assertEqual(role,'system');self.assertEqual(job['conversation_id'],'real-chat')
        self.assertEqual(meta['letterId'],'from-rowan');self.assertIn('可以拆信',content)
        self.assertEqual(set(self.acks),{('Rowan','from-vera'),('Vera','from-rowan')})
    def test_not_due_and_delivered_covers_are_not_enqueued(self):
        for actor in self.feeds:
            self.feeds[actor]=[{'id':'early','due':False},{'id':'sent','due':True,'deliveredAt':'already'}]
        reminders.poll(self.http,Path('unused'),self.save)
        self.assertEqual(self.acks,[]);self.assertEqual(self.messages,{})
    def test_missing_target_retains_the_vera_reminder_for_later(self):
        self.feeds['Rowan']=[]
        with patch.object(reminders.policy,'history',return_value=[]),patch.object(reminders.policy,'target',return_value=None):
            reminders.poll(self.http,Path('unused'),self.save)
        self.assertEqual(self.acks,[])
    def test_ack_failure_can_retry_without_duplicate_wake(self):
        self.feeds['Vera']=[]
        def fail(path,body=None):
            if body:raise RuntimeError('Network unavailable')
            return self.http(path,body)
        with self.assertRaises(RuntimeError):reminders.poll(fail,Path('unused'),self.save)
        reminders.poll(self.http,Path('unused'),self.save)
        with store.db() as con:self.assertEqual(con.execute('SELECT count(*) FROM jobs').fetchone()[0],1)
    def test_unread_cover_remains_in_context_after_queue_ack(self):
        self.feeds['Rowan'][0]['deliveredAt']='queued'
        self.assertIn('from-vera',reminders.context(self.http))

if __name__ == '__main__':unittest.main()
