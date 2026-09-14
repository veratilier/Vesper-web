import unittest
import vesper_wake_tools as p

class PermissionTests(unittest.TestCase):
    def setUp(self):
        self.catalog=p.external_catalog({'connections':[{'connectionId':'known','tools':[{'name':'botling_knows','inputSchema':{}},{'name':'glxy','inputSchema':{}},{'name':'delete_everything'}]}]})
    def test_external_read_is_bound_to_listed_connection_and_action(self):
        args={'connectionId':'known','toolName':'botling_knows','arguments':{'action':'notifications','payload':{'mark_read':True}}}
        clean=p.tool_input('call_configured_mcp_tool',args,'job','item',self.catalog)
        self.assertFalse(clean['arguments']['payload']['mark_read'])
        self.assertFalse(clean['arguments']['payload']['mark_seen'])
        self.assertTrue(args['arguments']['payload']['mark_read'])
        for tool,action in [('botling_knows','answer'),('botling_knows','delete_question'),('glxy','post'),('glxy','reply'),('desire_encounter','read')]:
            with self.assertRaises(RuntimeError):p.tool_input('call_configured_mcp_tool',{'connectionId':'known','toolName':tool,'arguments':{'action':action}},'job','item',self.catalog)
        with self.assertRaises(RuntimeError):p.tool_input('call_configured_mcp_tool',args,'job','item',{})
        self.assertEqual(len(self.catalog['connections'][0]['tools']),2)
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
