import io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock,patch
from vesper_backend import codex_provider as provider

class ModelProviderTests(unittest.TestCase):
    def test_stdio_transport_keeps_login_environment_routes_notifications_and_closes_process(self):
        process=Mock();process.stdin=io.StringIO();process.stdout=io.StringIO(json.dumps({'method':'fixture/event','params':{}})+'\n'+json.dumps({'id':1,'result':{'ok':True}})+'\n')
        with tempfile.TemporaryDirectory() as tmp,patch.object(provider.subprocess,'Popen',return_value=process) as spawn,patch.dict(provider.os.environ,{'OPENAI_API_KEY':'fixture-do-not-forward','CODEX_API_KEY':'fixture-do-not-forward'}):
            rpc=provider.Rpc(Path(tmp));events=[];rpc.handler=events.append
            self.assertEqual(rpc.call('initialize',{'clientInfo':{'name':'fixture'}}),{'ok':True})
            self.assertEqual(events[0]['method'],'fixture/event')
            sent=json.loads(process.stdin.getvalue());self.assertEqual(sent['id'],1);self.assertEqual(sent['method'],'initialize')
            self.assertEqual(spawn.call_args.kwargs['cwd'],Path(tmp))
            self.assertNotIn('OPENAI_API_KEY',spawn.call_args.kwargs['env']);self.assertNotIn('CODEX_API_KEY',spawn.call_args.kwargs['env'])
            with self.assertRaises(RuntimeError):rpc.next()
            rpc.close();process.terminate.assert_called_once();process.wait.assert_called()
    def test_background_services_use_provider_without_importing_automation_business_code(self):
        root=Path(__file__).parent
        for filename in ['vesper_companion_poke.py','vesper_screen_companion.py']:
            text=(root/filename).read_text()
            self.assertIn('from vesper_backend.codex_provider import Rpc, CONFIG, WORK',text)
            self.assertNotIn('from vesper_wake_runner import Rpc',text)

if __name__=='__main__':unittest.main()
