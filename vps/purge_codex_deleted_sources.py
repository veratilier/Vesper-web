#!/usr/bin/env python3
"""Remove exact Codex records/files matching Vesper's hashed deletion ledger."""
import hashlib, json, os, re, sqlite3
from pathlib import Path
import codex_history_server as history

def digest(value):return hashlib.sha256(value.encode()).hexdigest()

def main():
    with history.db() as con:deleted={r[0] for r in con.execute('SELECT thread_hash FROM deleted_conversations WHERE thread_hash IS NOT NULL')}
    roots=[Path.home()/'.codex',Path.home()/'vesper-codex-backups']
    dbs=sorted({p for root in roots if root.exists() for p in root.rglob('*.sqlite')})
    removed_rows=0;removed_files=0;removed_bytes=0;shared_retained=0
    paths=set()
    for path in dbs:
        try:con=sqlite3.connect(path,timeout=20)
        except sqlite3.Error:continue
        try:
            tables={r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            ids=set()
            for table,column in [('threads','id'),('thread_items','thread_id'),('thread_turns','thread_id'),
                                 ('thread_history_projection_state','thread_id'),('thread_realtime_items','thread_id'),
                                 ('queued_items','thread_id'),('queued_thread_revisions','thread_id'),('logs','thread_id')]:
                if table in tables:
                    for (value,) in con.execute(f'SELECT DISTINCT {column} FROM {table} WHERE {column} IS NOT NULL'):
                        if digest(value) in deleted:ids.add(value)
            safe=set(ids)
            if 'thread_spawn_edges' in tables:
                for value in list(safe):
                    if con.execute('SELECT 1 FROM thread_spawn_edges WHERE parent_thread_id=? OR child_thread_id=? LIMIT 1',(value,value)).fetchone():
                        safe.remove(value);shared_retained+=1
            if 'threads' in tables:
                for value in safe:
                    row=con.execute('SELECT rollout_path FROM threads WHERE id=?',(value,)).fetchone()
                    if row and row[0]:paths.add(Path(row[0]))
            con.execute('BEGIN IMMEDIATE')
            for table,column in [('thread_artifacts','thread_id'),('thread_dynamic_tools','thread_id'),('thread_items','thread_id'),
                                 ('thread_turns','thread_id'),('thread_history_projection_state','thread_id'),
                                 ('thread_realtime_items','thread_id'),('queued_items','thread_id'),
                                 ('queued_thread_revisions','thread_id'),('logs','thread_id'),('threads','id')]:
                if table in tables:
                    for value in safe:removed_rows+=con.execute(f'DELETE FROM {table} WHERE {column}=?',(value,)).rowcount
            con.commit()
            if safe:con.execute('VACUUM')
        finally:con.close()
    uuid_re=re.compile(r'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',re.I)
    for root in roots:
        if not root.exists():continue
        for path in root.rglob('*.jsonl'):
            matches=uuid_re.findall(path.name)
            if any(digest(value) in deleted for value in matches):paths.add(path)
    allowed=[root.resolve() for root in roots]
    for path in paths:
        try:resolved=path.resolve()
        except OSError:continue
        if not any(resolved==root or root in resolved.parents for root in allowed) or not resolved.is_file():continue
        removed_bytes+=resolved.stat().st_size;resolved.unlink();removed_files+=1
    print(json.dumps({'databasesChecked':len(dbs),'rowsDeleted':removed_rows,'filesDeleted':removed_files,
                      'fileBytesDeleted':removed_bytes,'sharedReferencesRetained':shared_retained}))

if __name__=='__main__':main()
