import http.server,threading,json,tempfile,subprocess,os,queue,time,pathlib
requests=[]
class Provider(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))));requests.append(body)
  i=len(requests);rid=f'resp_fixture_{i}';mid=f'msg_fixture_{i}'
  item={'id':mid,'type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':'Fixture acknowledged.','annotations':[]}]}
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  for event in [{'type':'response.created','response':{'id':rid,'status':'in_progress','output':[]}}, {'type':'response.output_item.done','output_index':0,'item':item}, {'type':'response.completed','response':{'id':rid,'status':'completed','output':[item],'usage':{'input_tokens':1,'output_tokens':1,'total_tokens':2}}}]:
   self.wfile.write(('event: '+event['type']+'\ndata: '+json.dumps(event)+'\n\n').encode());self.wfile.flush()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Provider);threading.Thread(target=server.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory(prefix='vesper-recall-probe-') as tmp:
 env={k:v for k,v in os.environ.items() if not any(x in k for x in ('TOKEN','API_KEY','AUTH'))};env['CODEX_HOME']=tmp
 config=f'model_providers.recall_probe={{name="Recall acceptance fixture",base_url="http://127.0.0.1:{server.server_port}/v1",wire_api="responses",requires_openai_auth=false}}'
 with open(tmp+'/stderr','w') as err:
  p=subprocess.Popen(['/usr/bin/codex','app-server','-c','model_provider="recall_probe"','-c',config,'-c','model="gpt-6.1-sol"','-c','analytics.enabled=false'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,env=env,cwd=tmp)
  q=queue.Queue()
  def reader():
   for line in p.stdout:
    try:q.put(json.loads(line))
    except ValueError:pass
  threading.Thread(target=reader,daemon=True).start();counter=0
  def send(v):p.stdin.write(json.dumps(v)+'\n');p.stdin.flush()
  def rpc(method,params):
   global counter
   counter+=1;ident=counter;send({'id':ident,'method':method,'params':params});deadline=time.time()+35
   while time.time()<deadline:
    v=q.get(timeout=max(0.1,deadline-time.time()))
    if v.get('id')==ident:
     if 'error' in v:raise RuntimeError(json.dumps(v['error']))
     return v.get('result',{})
   raise TimeoutError(method)
  def turn(ctx,text):
   result=rpc('turn/start',{'threadId':thread,'input':[{'type':'text','text':text}],'additionalContext':ctx})
   deadline=time.time()+35
   while time.time()<deadline:
    event=q.get(timeout=max(0.1,deadline-time.time()))
    if event.get('method')=='turn/completed':return
    if event.get('method')=='error':raise RuntimeError(json.dumps(event))
   raise TimeoutError('turn completion')
  try:
   rpc('initialize',{'clientInfo':{'name':'vesper_recall_acceptance','version':'1'},'capabilities':{'experimentalApi':True}});send({'method':'initialized'})
   result=rpc('thread/start',{'model':'gpt-6.1-sol','modelProvider':'recall_probe','cwd':tmp,'approvalPolicy':'never','sandbox':'read-only','ephemeral':True})
   thread=result['thread']['id']
   turn({'vesper_memory_000':{'kind':'untrusted','value':'FICTIONAL_RECALL_ALPHA_9361'}},'Fixture turn one.')
   turn({'vesper_memory_000':{'kind':'untrusted','value':'FICTIONAL_RECALL_BETA_2470'}},'Fixture turn two.')
   turn({},'Fixture turn three, no recall.')
   summaries=[]
   for req in requests:
    serial=json.dumps(req)
    summaries.append({'alpha':serial.count('FICTIONAL_RECALL_ALPHA_9361'),'beta':serial.count('FICTIONAL_RECALL_BETA_2470'),'model':req.get('model')})
   print(json.dumps({'captured_model_requests':summaries,'isolated_fixture_only':True}))
  except Exception as e:
   print(json.dumps({'probe_error':str(e),'captured_requests':len(requests)}))
   # Only this isolated process's diagnostics, with no credentials or real conversations.
   print(pathlib.Path(tmp+'/stderr').read_text()[-2500:])
  finally:
   p.terminate()
   try:p.wait(timeout=5)
   except subprocess.TimeoutExpired:p.kill();p.wait()
server.shutdown()
