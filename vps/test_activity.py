import sqlite3
import json
import unittest
from vesper_activity import month_activity

class ActivityTests(unittest.TestCase):
    def test_counts_dates_and_exclusions(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.executescript('CREATE TABLE conversations(vesper_conversation_id TEXT, title TEXT); INSERT INTO conversations VALUES("a","Chat"); CREATE TABLE messages(id TEXT PRIMARY KEY, vesper_conversation_id TEXT, role TEXT, content TEXT, status TEXT, metadata_json TEXT, created_at TEXT, source TEXT);')
        def add(i, role='agent', stamp='2026-09-01T16:00:00Z', meta=None, content='hello', status='delivered'):
            db.execute('INSERT OR REPLACE INTO messages VALUES(?,?,?,?,?,?,?,?)', (i,'a',role,content,status,json.dumps(meta or {}),stamp,'codex'))
        add('user', 'user', '2026-08-31T16:00:00Z')
        add('before', stamp='2026-08-31T15:59:59Z')
        add('next', stamp='2026-09-30T16:00:00Z')
        add('answer'); add('answer', content='edited')
        add('tool', meta={'blockType':'execution'})
        add('system', role='system')
        add('failed', status='error')
        add('wake', meta={'wakeRunId':'run'})
        add('test', meta={'source':'verification','wakeRunId':'test'})
        add('image', content='', meta={'attachments':[{'url':'image'}]})
        add('prompt', role='user', meta={'wake':{'requestId':'legacy'}})
        add('deleted'); db.execute('DELETE FROM messages WHERE id="deleted"')
        result=month_activity(db,'2026-09')['days']
        self.assertEqual(result, {'2026-09-01':{'user':1,'agent':0,'autonomous':0,'total':1},'2026-09-02':{'user':0,'agent':2,'autonomous':1,'total':2}})
        for invalid in ('', '2026-13', '26-09', '2026-09-01'):
            with self.assertRaises(ValueError): month_activity(db,invalid)

if __name__=='__main__': unittest.main()
