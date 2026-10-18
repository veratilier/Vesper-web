"""Shared model transport. Business services own prompts, tools and delivery policies."""
import json, os, queue, subprocess, threading, time
from pathlib import Path
WORK = Path.home()/'.vesper/wake-workspace'
CONFIG={'apps._default.enabled':False,
        'apps.asdk_app_6a92be9d9e1c819197f58017d0e2b985.enabled':False,
        'apps.app_6a92be9d9e1c819197f58017d0e2b985.enabled':False,
        'features.shell_tool':False}

class Rpc:
    def __init__(self, workspace=None):
        workspace = Path(workspace) if workspace is not None else WORK
        workspace.mkdir(parents=True,exist_ok=True)
        # stdio is owned by the VPS runner, never by a browser socket.
        clean_env={k:v for k,v in os.environ.items() if k not in {'OPENAI_API_KEY','CODEX_API_KEY'}}
        self.p=subprocess.Popen(['/usr/bin/codex','app-server'],cwd=workspace,env=clean_env,
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1)
        self.q=queue.Queue();self.seq=0;self.pending=[];self.handler=lambda m:None
        def reader():
            for line in self.p.stdout:
                try:self.q.put(json.loads(line))
                except ValueError:pass
            self.q.put({'_closed':True})
        threading.Thread(target=reader,daemon=True).start()
    def send(self,msg):self.p.stdin.write(json.dumps(msg,ensure_ascii=False)+'\n');self.p.stdin.flush()
    def next(self,timeout=30):
        msg=self.q.get(timeout=timeout)
        if msg.get('_closed'):raise RuntimeError('Codex process closed')
        return msg
    def call(self,method,params,timeout=90):
        self.seq+=1;ident=self.seq;self.send({'id':ident,'method':method,'params':params});end=time.time()+timeout
        while time.time()<end:
            msg=self.next(max(.1,end-time.time()))
            if msg.get('id')==ident and 'method' not in msg:
                if 'error' in msg:raise RuntimeError(f'Codex {method}: {str(msg["error"].get("message","failed"))[:180]}')
                return msg.get('result',{})
            self.handler(msg)
        raise TimeoutError(method)
    def close(self):
        self.p.terminate()
        try:self.p.wait(timeout=10)
        except subprocess.TimeoutExpired:self.p.kill();self.p.wait()
