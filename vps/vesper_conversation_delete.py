"""Permanent conversation deletion helpers. Stores only irreversible ID hashes."""
import hashlib, json, os, queue, sqlite3, subprocess, threading, time
from pathlib import Path

CODEX_HOME = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
WAKE_DB = Path(os.environ.get("VESPER_WAKE_DB", str(Path.home() / ".vesper/wake.sqlite3")))

def identifier_hash(value):
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest() if value else None

def is_deleted(con, conversation_id=None, thread_id=None):
    ch, th = identifier_hash(conversation_id), identifier_hash(thread_id)
    return con.execute("SELECT 1 FROM deleted_conversations WHERE conversation_hash=? OR (? IS NOT NULL AND thread_hash=?) LIMIT 1",
                       (ch, th, th)).fetchone() is not None

def block(con, conversation_id, thread_id):
    con.execute("""INSERT INTO deleted_conversations(conversation_hash,thread_hash,deleted_at) VALUES(?,?,?)
      ON CONFLICT(conversation_hash) DO UPDATE SET thread_hash=COALESCE(excluded.thread_hash,deleted_conversations.thread_hash),deleted_at=excluded.deleted_at""",
      (identifier_hash(conversation_id), identifier_hash(thread_id), int(time.time())))

def thread_is_shared(thread_id):
    path = CODEX_HOME / "state_5.sqlite"
    if not thread_id or not path.exists(): return False
    with sqlite3.connect(path) as con:
        return con.execute("SELECT 1 FROM thread_spawn_edges WHERE parent_thread_id=? OR child_thread_id=? LIMIT 1",
                           (thread_id, thread_id)).fetchone() is not None

class Rpc:
    def __init__(self):
        env={k:v for k,v in os.environ.items() if k not in {"OPENAI_API_KEY","CODEX_API_KEY"}}
        self.process=subprocess.Popen(["/usr/bin/codex","app-server"],cwd=Path.home(),env=env,stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1)
        self.queue=queue.Queue();self.seq=0
        def read():
            for line in self.process.stdout:
                try:self.queue.put(json.loads(line))
                except ValueError:pass
            self.queue.put({"_closed":True})
        threading.Thread(target=read,daemon=True).start()
    def send(self,value):
        self.process.stdin.write(json.dumps(value,ensure_ascii=False)+"\n");self.process.stdin.flush()
    def call(self,method,params,timeout=45):
        self.seq+=1;ident=self.seq;self.send({"id":ident,"method":method,"params":params});end=time.time()+timeout
        while time.time()<end:
            value=self.queue.get(timeout=max(.1,end-time.time()))
            if value.get("_closed"):raise RuntimeError("Codex app-server closed")
            if value.get("id")==ident and "method" not in value:
                if "error" in value:raise RuntimeError(str(value["error"].get("message","Codex request failed"))[:180])
                return value.get("result",{})
        raise TimeoutError(method)
    def close(self):
        self.process.terminate()
        try:self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:self.process.kill();self.process.wait()

def delete_codex_thread(thread_id):
    if not thread_id:return "none"
    if thread_is_shared(thread_id):return "retained-shared"
    rpc=Rpc()
    try:
        rpc.call("initialize",{"clientInfo":{"name":"vesper_history","version":"1.0"},"capabilities":{"experimentalApi":True}})
        rpc.send({"method":"initialized"})
        try:rpc.call("thread/delete",{"threadId":thread_id})
        except RuntimeError as error:
            if not any(word in str(error).lower() for word in ("not found","does not exist","unknown thread","no rollout found")):raise
        return "deleted"
    finally:rpc.close()

def purge_wake(conversation_id):
    if not WAKE_DB.exists():return 0
    with sqlite3.connect(WAKE_DB,timeout=15) as con:
        con.execute("BEGIN IMMEDIATE")
        ids=[r[0] for r in con.execute("SELECT id FROM jobs WHERE conversation_id=?",(conversation_id,))]
        con.executemany("DELETE FROM calls WHERE job_id=?",[(v,) for v in ids])
        con.executemany("DELETE FROM jobs WHERE id=?",[(v,) for v in ids])
        return len(ids)
