import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import vesper_emotion_settler as settler
from test_wake_required_desire import assert_strict_output_schema

VALUES={k:40 for k in settler.KEYS}
class SettlerTests(unittest.TestCase):
    def context(self,pending=True):
        return {'state':{'version':4,'initialized':True,'values':VALUES,'reason':'Actual preceding state','unresolved':'','runtime':{'model':'old'}},'pending':[{'id':'real','text':'A real exchange','kind':'user'}] if pending else [],'background':[]}
    def rpc(self,models=None):
        class RPC:
            def call(r,method,params):
                if method=='model/list':return {'data':[{'model':settler.MODEL}] if models is None else models}
                if method=='thread/start':
                    self.assertTrue(params['ephemeral']);self.assertEqual(params['dynamicTools'],[])
                    self.assertEqual(params['model'],settler.MODEL)
                    return {'thread':{'id':'separate-emotion-thread'}}
                if method=='turn/start':
                    assert_strict_output_schema(params['outputSchema'])
                    context=json.loads(params['input'][0]['text'])
                    value={'values':VALUES,'reason':'Current state continues.','unresolved':'','eventIds':[e['id'] for e in context['pending']],'cadence':{'minutes':45,'mode':'calm','reason':'Read quietly.'}}
                    r.handler({'method':'item/completed','params':{'item':{'type':'agentMessage','text':json.dumps(value)}}})
                    r.handler({'method':'turn/completed','params':{'turn':{'status':'completed'}}})
                    return {'turn':{'id':'assessment'}}
                return {}
            def send(r,p):pass
            def close(r):pass
        return RPC()
    def test_assessment_uses_fresh_small_context_with_no_tools_and_can_keep_values(self):
        for pending in (True,False):
            result=settler.assess(settler.bounded(self.context(pending)),self.rpc())
            self.assertEqual(result['values'],VALUES)
            self.assertEqual(result['eventIds'],['real'] if pending else [])
    def test_model_unavailable_has_no_formula_fallback(self):
        with self.assertRaisesRegex(RuntimeError,'unavailable'):settler.assess(self.context(),self.rpc(models=[]))
    def test_context_bound_and_counted_background(self):
        c=self.context();c['pending']=[{'id':str(i),'text':'文'*4000} for i in range(100)]
        c['background']=[{'id':'old','text':'Already counted','alreadyCounted':True}]
        small=settler.bounded(c)
        self.assertLess(len(json.dumps(small,ensure_ascii=False)),18000)
        self.assertNotIn('runtime',small['state']);self.assertTrue(small['background'][0]['alreadyCounted'])
    def test_one_run_commits_once_and_never_sends_chat_or_runs_activities(self):
        requests=[]
        def http(path,body=None):
            requests.append((path,body))
            if path.endswith('view=context'):return {'data':self.context()}
            return {'committed':True}
        with tempfile.TemporaryDirectory() as d,patch.object(settler.host,'WORK',Path(d)),patch.object(settler,'events',return_value=[]),patch.object(settler.host,'http',side_effect=http),patch.object(settler.host,'Rpc',side_effect=lambda:self.rpc()):settler.run()
        commits=[b for _,b in requests if b and b.get('action')=='commit']
        self.assertEqual(len(commits),1);self.assertEqual(commits[0]['candidate']['baseVersion'],4)
        self.assertEqual(commits[0]['candidate']['source'],'settlement')
        self.assertFalse(any('/messages' in p or '/codex/tools' in p or '/wake' in p for p,_ in requests))
    def test_conflict_deferred_once_with_pending_events_and_failure_receipt(self):
        requests=[]
        def http(path,body=None):
            requests.append((path,body))
            if path.endswith('view=context'):return {'data':self.context()}
            if body and body.get('action')=='commit':raise RuntimeError('HTTP 409 conflict')
            return {}
        with tempfile.TemporaryDirectory() as d,patch.object(settler.host,'WORK',Path(d)),patch.object(settler,'events',return_value=[]),patch.object(settler.host,'http',side_effect=http),patch.object(settler.host,'Rpc',side_effect=lambda:self.rpc()):settler.run()
        self.assertEqual(len([b for _,b in requests if b and b.get('action')=='commit']),1)
        self.assertIn('409',requests[-1][1]['error'])
if __name__=='__main__':unittest.main()
