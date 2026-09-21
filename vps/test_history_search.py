from test_history_deletion import DeletionTests, history
from urllib.parse import urlencode

class SearchTests(DeletionTests):
    def test_search_and_context(self):
        self.seed('a'); self.seed('b')
        with history.db() as db:
            for i in range(1205):
                db.execute("INSERT INTO messages(id,vesper_conversation_id,role,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", (f'm{i:04}', 'a','user', '哎 100%_ Hello' if i == 1001 else 'ordinary', 'completed', f'2026-09-20T{i:06}', 'now'))
        status, result = self.request('GET', '/search?' + urlencode({'q':'哎'}))
        self.assertEqual(status, 200); self.assertEqual([m['id'] for m in result['results']], ['m1001'])
        for q in ['100%_', 'hello']:
            self.assertEqual(len(self.request('GET','/search?'+urlencode({'q':q}))[1]['results']),1)
        self.assertEqual(self.request('GET','/search?'+urlencode({'q':'哎','conversationId':'b'}))[1]['results'],[])
        self.assertEqual(self.request('GET','/search?q=test',token='wrong')[0],401)
        status, page = self.request('GET','/conversations/a?around=m1001&limit=20')
        self.assertEqual(status,200); self.assertIn('m1001',[m['id'] for m in page['messages']]); self.assertTrue(page['hasMore'])
        newer=self.request('GET','/conversations/a?latest=1&limit=10')[1]
        older=self.request('GET','/conversations/a?latest=1&limit=10&before='+newer['before'])[1]
        self.assertFalse(set(m['id'] for m in newer['messages']) & set(m['id'] for m in older['messages']))
        self.request('DELETE','/conversations/a/messages/m1001')
        self.assertEqual(self.request('GET','/search?'+urlencode({'q':'哎'}))[1]['results'],[])
