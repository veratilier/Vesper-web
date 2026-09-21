#!/usr/bin/env python3
"""One-time purge for rows archived by the former DELETE implementation.

Prints counts and sizes only. It never prints IDs, titles, message bodies, or tokens.
"""
import json, os, sqlite3, sys
from pathlib import Path
import codex_history_server as history
import vesper_conversation_delete as deletion

def size(paths):
    return sum(p.stat().st_size for p in paths if p.exists() and p.is_file())

def sqlite_files():
    roots=[Path.home()/'.vesper/backups',Path.home()/'vesper-codex-backups']
    result=[]
    for root in roots:
        if root.exists():result.extend(p for p in root.rglob('*.sqlite*') if p.is_file() and not p.name.endswith(('-wal','-shm')))
    extra=Path.home()/'.vesper/chat-history.sqlite3.bak-before-thread-map-restore-20260902-1955'
    if extra.exists():result.append(extra)
    return sorted(set(result))

def scrub_history_copy(path, conversations):
    try:con=sqlite3.connect(path,timeout=20)
    except sqlite3.Error:return 0
    removed=0
    try:
        tables={r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'conversations' not in tables:return 0
        columns={r[1] for r in con.execute('PRAGMA table_info(conversations)')}
        key='vesper_conversation_id' if 'vesper_conversation_id' in columns else ('id' if 'id' in columns else None)
        if not key:return 0
        con.execute('BEGIN IMMEDIATE')
        for ident in conversations:
            if 'message_tombstones' in tables:con.execute(f'DELETE FROM message_tombstones WHERE {key}=?',(ident,))
            if 'messages' in tables:removed+=con.execute(f'DELETE FROM messages WHERE {key}=?',(ident,)).rowcount
            con.execute(f'DELETE FROM conversations WHERE {key}=?',(ident,))
        con.commit();con.execute('VACUUM');con.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        return removed
    finally:con.close()

def main():
    backups=sqlite_files()
    before=size([history.DB_PATH,Path(str(history.DB_PATH)+'-wal'),*backups])
    with history.db() as con:
        rows=con.execute("SELECT vesper_conversation_id,codex_thread_id FROM conversations WHERE archived_at IS NOT NULL").fetchall()
    conversations=[r['vesper_conversation_id'] for r in rows]
    threads=[r['codex_thread_id'] for r in rows if r['codex_thread_id']]
    shared=sum(deletion.thread_is_shared(v) for v in threads)
    if shared:
        raise RuntimeError(f'Refusing historical purge: {shared} archived source threads are shared')
    failures=0;messages=0;wake=0;sources=0
    for row in rows:
        try:
            with history.db() as con:
                con.execute('BEGIN IMMEDIATE');deletion.block(con,row['vesper_conversation_id'],row['codex_thread_id'])
            deletion.delete_codex_thread(row['codex_thread_id']);sources+=bool(row['codex_thread_id'])
            wake+=deletion.purge_wake(row['vesper_conversation_id'])
            with history.db() as con:
                con.execute('BEGIN IMMEDIATE')
                con.execute('DELETE FROM message_tombstones WHERE vesper_conversation_id=?',(row['vesper_conversation_id'],))
                messages+=con.execute('DELETE FROM messages WHERE vesper_conversation_id=?',(row['vesper_conversation_id'],)).rowcount
                con.execute('DELETE FROM conversations WHERE vesper_conversation_id=?',(row['vesper_conversation_id'],))
        except Exception:failures+=1
    backup_messages=sum(scrub_history_copy(path,conversations) for path in backups)
    with history.db() as con:
        con.execute('PRAGMA wal_checkpoint(TRUNCATE)');con.execute('VACUUM');con.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    if deletion.WAKE_DB.exists():
        with sqlite3.connect(deletion.WAKE_DB) as con:
            con.execute('PRAGMA wal_checkpoint(TRUNCATE)');con.execute('VACUUM')
    after=size([history.DB_PATH,Path(str(history.DB_PATH)+'-wal'),*backups])
    print(json.dumps({'archivedCandidates':len(rows),'sharedRefused':shared,'failures':failures,
      'liveMessagesDeleted':messages,'backupMessagesDeleted':backup_messages,'sourceDeletesAttempted':sources,
      'wakeJobsDeleted':wake,'backupDatabasesChecked':len(backups),'bytesBefore':before,'bytesAfter':after}))
    if failures:return 1
    return 0

if __name__=='__main__':sys.exit(main())
