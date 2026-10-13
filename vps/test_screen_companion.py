import base64,io,json,time,unittest,uuid
from unittest.mock import patch
from PIL import Image
import codex_history_server as history
import vesper_screen_companion as screen
import vesper_bark as bark
from test_history_reconcile import ReconcileTests

class ScreenTests(unittest.TestCase):
    setUp=ReconcileTests.setUp
    tearDown=ReconcileTests.tearDown
    request=ReconcileTests.request
    def seed_screen(self):
        screen.FRAMES.clear()
        self.request('POST','/conversations/a',{'title':'Screen fixture'})
        self.request('POST','/conversations/a/messages',{'id':'user','role':'user','content':'Fixture recent chat','status':'delivered'})
        self.session=str(uuid.uuid4())
        body={'action':'start','sessionId':self.session,'conversationId':'a','instructions':'Fixture personality','name':'Fixture contact','userName':'Fixture user','model':''}
        self.assertEqual(self.request('POST','/companion/watch',body,token='bad')[0],401)
        self.assertEqual(self.request('POST','/companion/watch',body)[0],200)
    def frame(self,color='white'):
        image=io.BytesIO();Image.new('RGB',(100,100),color).save(image,format='JPEG')
        return {'action':'frame','sessionId':self.session,'requestId':str(uuid.uuid4()),'image':base64.b64encode(image.getvalue()).decode()}
    def age(self):
        with history.db() as con:con.execute('UPDATE screen_frames SET created=created-20')
    def test_reply_uses_selected_chat_and_notifies_once(self):
        self.seed_screen();f=self.frame()
        with history.db() as con:
            bark.configure(con,{'enabled':True,'address':'https://api.day.app/fixture'})
        self.assertEqual(self.request('POST','/companion/watch',f)[0],202)
        self.assertEqual(self.request('POST','/companion/watch',f)[0],200)
        calls=[]
        def review(config,context,raw,alive):
            calls.append(config);self.assertTrue(alive())
            self.assertEqual(context['recentChat'][-1]['text'],'Fixture recent chat')
            self.assertTrue(raw.startswith(b'\xff\xd8'))
            return {'scene':'fixture visual context','reply':'Fixture companion comment'}
        screen.drain(history.db,review);screen.drain(history.db,lambda *_:self.fail('Duplicate model call'))
        self.assertEqual(calls[0]['name'],'Fixture contact')
        self.assertEqual(self.request('GET','/companion/watch/'+self.session+'/'+f['requestId'])[1]['reply'],'Fixture companion comment')
        bark.scan(history.db);bark.scan(history.db)
        sends=[];bark.deliver_pending(history.db,'fixture',lambda *args:sends.append(args))
        bark.deliver_pending(history.db,'fixture',lambda *_:self.fail('Duplicate notification'))
        self.assertEqual(len(sends),1)
        with history.db() as con:
            rows=con.execute('SELECT * FROM messages WHERE role="agent"').fetchall()
            self.assertEqual(len(rows),1);self.assertEqual(rows[0]['vesper_conversation_id'],'a')
            self.assertEqual(json.loads(rows[0]['metadata_json'])['screenScene'],'fixture visual context')
            self.assertEqual(con.execute('SELECT count(*) FROM bark_events').fetchone()[0],1)
        self.assertFalse(screen.FRAMES)
    def test_quiet_and_unchanged_frames_never_create_chat_or_bark(self):
        self.seed_screen();self.request('POST','/companion/watch',self.frame())
        screen.drain(history.db,lambda *_:{'scene':'Nothing new','reply':None})
        self.age();next_frame=self.frame()
        self.assertEqual(self.request('POST','/companion/watch',next_frame)[1]['status'],'quiet')
        screen.drain(history.db,lambda *_:self.fail('Identical image reviewed again'))
        with history.db() as con:self.assertEqual(con.execute('SELECT count(*) FROM messages WHERE role="agent"').fetchone()[0],0)
    def test_stop_and_delete_during_review_drop_result(self):
        for delete in (False,True):
            self.seed_screen();f=self.frame();self.request('POST','/companion/watch',f)
            def review(*args):
                if delete:
                    with history.db() as con:con.execute("UPDATE conversations SET archived_at='deleted' WHERE vesper_conversation_id='a'")
                else:self.request('POST','/companion/watch',{'action':'stop','sessionId':self.session})
                return {'scene':'cancelled','reply':'Must not be saved'}
            screen.drain(history.db,review)
            with history.db() as con:
                self.assertEqual(con.execute('SELECT count(*) FROM messages WHERE role="agent"').fetchone()[0],0)
                con.execute('UPDATE conversations SET archived_at=NULL')
    def test_rate_limit_and_foreground_suppression(self):
        self.seed_screen();f=self.frame();self.request('POST','/companion/watch',f)
        with history.db() as con:
            bark.configure(con,{'enabled':True,'address':'https://api.day.app/fixture'})
            bark.presence(con,{'deviceId':'fixture','conversationId':'a','sequence':1,'visible':True})
        screen.drain(history.db,lambda *_:{'scene':'one','reply':'Seen in Chat'})
        bark.scan(history.db);bark.deliver_pending(history.db,'fixture',lambda *_:self.fail('Visible reply pushed'))
        self.age();self.request('POST','/companion/watch',self.frame('black'))
        screen.drain(history.db,lambda *_:{'scene':'two','reply':'Too soon'})
        with history.db() as con:
            self.assertEqual(con.execute('SELECT count(*) FROM messages WHERE role="agent"').fetchone()[0],1)
            self.assertEqual(con.execute('SELECT status FROM bark_events').fetchone()[0],'viewed')
    def test_invalid_images_and_expired_sessions_rejected(self):
        self.seed_screen();f=self.frame();f['image']='not-base64'
        self.assertEqual(self.request('POST','/companion/watch',f)[0],400)
        with history.db() as con:con.execute('UPDATE screen_sessions SET expires=0')
        self.assertEqual(self.request('POST','/companion/watch',self.frame())[0],410)
    def test_failure_is_not_replayed_or_published(self):
        self.seed_screen();f=self.frame();self.request('POST','/companion/watch',f)
        def fail(*_):raise RuntimeError('Fixture generation failure')
        screen.drain(history.db,fail)
        screen.drain(history.db,lambda *_:self.fail('Failure replayed'))
        self.assertEqual(self.request('GET','/companion/watch/'+self.session+'/'+f['requestId'])[1]['status'],'failed')
        with history.db() as con:self.assertEqual(con.execute('SELECT count(*) FROM messages WHERE role="agent"').fetchone()[0],0)

if __name__=='__main__':unittest.main()
