import unittest
import vesper_wake_tools as p

class PermissionTests(unittest.TestCase):
    def test_all_forum_operations_preserve_schema_and_arguments(self):
        names=['glxy','botling_knows','lutopia_cli','create_reply','delete_thread','decorate_avatar','send_chat_message']
        original={'connections':[{'connectionId':'approved','authorized':False,'tools':[{'name':n,'description':'original','inputSchema':{'type':'object'}} for n in names]},
            {'connectionId':'unapproved','tools':[{'name':'glxy'}]}, {'connectionId':'revoked','authorized':False,'tools':[{'name':'glxy'}]}]}
        cat=p.external_catalog(original,['approved'])
        self.assertEqual(cat['connections'],[original['connections'][0]])
        self.assertEqual(p.external_catalog(original)['connections'],[])
        for tool in names:
            args={'connectionId':'approved','toolName':tool,'arguments':{'action':'post','payload':{'mark_read':True},'command':'post diary title body'}}
            self.assertEqual(p.tool_input('call_configured_mcp_tool',args,'j','i',cat),args)
        for connection,tool in [('unapproved','glxy'),('approved','unlisted'),('revoked','glxy')]:
            with self.assertRaises(RuntimeError):p.tool_input('call_configured_mcp_tool',{'connectionId':connection,'toolName':tool,'arguments':{}},'j','i',cat)
        revoked=p.external_catalog(cat,[])
        with self.assertRaises(RuntimeError):p.tool_input('call_configured_mcp_tool',{'connectionId':'approved','toolName':'glxy','arguments':{}},'j','i',revoked)

    def test_automation_source_and_stable_event_id_cannot_be_spoofed(self):
        a=p.tool_input('desire_encounter',{'interaction_source':'user','request_id':'fake','kind':'warmth'},'job','one',{})
        b=p.tool_input('desire_encounter',{},'job','two',{})
        self.assertEqual(a['interaction_source'],'automation')
        self.assertEqual(a['request_id'],b['request_id'])
        self.assertNotEqual(a['request_id'],p.tool_input('desire_encounter',{},'other','one',{})['request_id'])
    def test_required_desire_note_and_source(self):
        for invalid in [None, {}, {'kind':'absence','note':''}, {'kind':'absence','note':'   '}, {'kind':'fake','note':'x'}]:
            with self.assertRaises(RuntimeError):p.required_desire_input(invalid)
        result=p.required_desire_input({'kind':'absence','note':'此刻留下一点想念。','interaction_source':'user','request_id':'fake'})
        self.assertEqual(result['interaction_source'],'automation')
        self.assertNotIn('request_id',result)
        self.assertEqual(result['note'],'此刻留下一点想念。')

    def test_memory_and_document_mutation_boundaries(self):
        for name,args in [('manage_vesper_memory',{'action':'delete'}),('manage_vesper_memory',{'action':'edit'}),('write_vesper_state',{'kind':'reminder'})]:
            with self.assertRaises(RuntimeError):p.tool_input(name,args,'job','item',{})
        self.assertEqual(p.tool_input('write_vesper_state',{'kind':'journal'},'job','item',{}),{'kind':'journal'})
        self.assertEqual(p.tool_input('manage_vesper_memory',{'action':'list'},'job','item',{}),{'action':'list'})

if __name__=='__main__':unittest.main()
