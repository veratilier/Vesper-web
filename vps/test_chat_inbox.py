"""Unread cover feed excludes self-sends, drafts, activities and archived rooms."""
import json, tempfile
from pathlib import Path
import codex_history_server as server
class Request:
    def send_json(self,status,value):self.status,self.value=status,value
with tempfile.TemporaryDirectory() as directory:
    server.DB_PATH=Path(directory)/'history.sqlite3'
    with server.db() as db:
        for chat in ['one','two','archived']:
            db.execute('INSERT INTO conversations(vesper_conversation_id,title,created_at,updated_at,archived_at) VALUES(?,?,?,?,?)',(chat,chat,server.now(),server.now(),'gone' if chat=='archived' else None))
        def add(ident,chat,role='agent',status='delivered',metadata=None,content='Synthetic message'):
            db.execute('INSERT INTO messages(id,vesper_conversation_id,role,content,status,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',(ident,chat,role,content,status,json.dumps(metadata or {}),server.now(),server.now()))
        add('old','one');add('new','one');add('own-send','one','user');add('thinking','one','system',metadata={'blockType':'execution'})
        add('commentary','one',metadata={'phase':'commentary'});add('stream','one',status='streaming')
        add('empty','one',content='');add('attachment','two',metadata={'attachments':[{'url':'https://fixture.test/photo'}]},content='')
        add('hidden','archived')
    request=Request();server.Handler.inbox(request)
    assert request.status==200
    assert {(r['conversationId'],r['messageId']) for r in request.value['incoming']}=={('one','new'),('two','attachment')}
    assert all('content' not in r for r in request.value['incoming'])
    with server.db() as db:
        db.execute("DELETE FROM messages WHERE id='new'")
    server.Handler.inbox(request);assert next(r for r in request.value['incoming'] if r['conversationId']=='one')['messageId']=='old'
print('PASS chat inbox: incoming identities, archived isolation, own sends, commentary, tool activity, empty/streaming records, attachments and deletion.')
