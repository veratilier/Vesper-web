"""Exercise scoped pagination and literal search against SQLite, no live data."""
import tempfile
from pathlib import Path
import codex_history_server as server

class Request:
    path = ''
    def send_json(self, status, value): self.status, self.value = status, value

with tempfile.TemporaryDirectory() as directory:
    server.DB_PATH = Path(directory) / 'history.sqlite3'
    with server.db() as db:
        for chat in ['one','two']:
            db.execute('INSERT INTO conversations(vesper_conversation_id,title,created_at,updated_at) VALUES(?,?,?,?)', (chat,chat,server.now(),server.now()))
        for i in range(1005):
            db.execute('INSERT INTO messages(id,vesper_conversation_id,role,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', (str(i),'one','user',f'original {i} 100%', 'delivered','2026-01-01T00:00:00Z',server.now()))
        db.execute('INSERT INTO messages(id,vesper_conversation_id,role,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', ('other','two','user','other 100%', 'delivered',server.now(),server.now()))
    request=Request();request.path='/conversations/one?latest=1&limit=200'
    server.Handler.get_conversation(request,'one')
    collected=request.value['messages'];assert collected[-1]['id']=='1004'
    while request.value['hasMore']:
        request.path='/conversations/one?latest=1&limit=200&before='+request.value['before']
        server.Handler.get_conversation(request,'one');collected=request.value['messages']+collected
    assert len(collected)==1005 and len({x['id'] for x in collected})==1005
    request.path='/search?q=100%25&conversationId=two'
    server.Handler.search_messages(request)
    assert [x['id'] for x in request.value['results']]==['other']
    request.path='/search?q=%27%20OR%201%3D1--'
    server.Handler.search_messages(request);assert request.value['results']==[]
    def forbidden_sync(*args): raise AssertionError('Capture must not recover/write history')
    original_sync = server.codex_records.sync
    server.codex_records.sync = forbidden_sync
    try:
        request.path='/conversations/one?captureMessageId=5&captureMessageId=7'
        server.Handler.get_conversation(request,'one')
        assert [row['id'] for row in request.value['messages']]==['5','7']
        assert [row['content'] for row in request.value['messages']]==['original 5 100%','original 7 100%']
        request.path='/conversations/one?captureMessageId=other'
        try: server.Handler.get_conversation(request,'one')
        except ValueError: pass
        else: raise AssertionError('Cross-conversation capture must fail')
    finally:
        server.codex_records.sync = original_sync
print('History pagination and scoped search passed')
