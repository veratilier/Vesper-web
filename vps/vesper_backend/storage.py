from __future__ import annotations
import sqlite3
import threading
import hashlib
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
  vesper_conversation_id TEXT PRIMARY KEY,
  codex_thread_id TEXT UNIQUE,
  title TEXT NOT NULL DEFAULT '新对话',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  source TEXT NOT NULL DEFAULT 'codex'
);
CREATE INDEX IF NOT EXISTS conversations_updated
  ON conversations(archived_at, updated_at DESC);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  vesper_conversation_id TEXT NOT NULL REFERENCES conversations(vesper_conversation_id),
  role TEXT NOT NULL CHECK(role IN ('user', 'agent', 'system')),
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  item_id TEXT,
  turn_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'codex',
  time_source TEXT NOT NULL DEFAULT 'message'
  ,message_type TEXT NOT NULL DEFAULT 'text' CHECK(message_type IN ('text', 'sticker'))
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_item
  ON messages(vesper_conversation_id, item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_turn
  ON messages(vesper_conversation_id, turn_id);
CREATE INDEX IF NOT EXISTS messages_created
  ON messages(vesper_conversation_id, created_at, id);
CREATE TABLE IF NOT EXISTS message_tombstones (
  vesper_conversation_id TEXT NOT NULL REFERENCES conversations(vesper_conversation_id),
  codex_thread_id TEXT NOT NULL DEFAULT '',
  stable_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (vesper_conversation_id, codex_thread_id, stable_id)
);
CREATE INDEX IF NOT EXISTS message_tombstones_lookup
  ON message_tombstones(vesper_conversation_id, stable_id);
CREATE TABLE IF NOT EXISTS deleted_conversations (
  conversation_hash TEXT PRIMARY KEY, thread_hash TEXT, deleted_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS deleted_conversations_thread
  ON deleted_conversations(thread_hash) WHERE thread_hash IS NOT NULL;
"""

_initialization_lock = threading.Lock()
_initialized = {}

def open_history(path: Path, schema: str = SCHEMA) -> sqlite3.Connection:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        # Serialize first-open migrations; ordinary requests do not rerun DDL.
        with _initialization_lock:
            stamp = path.stat()
            identity = (stamp.st_dev, stamp.st_ino, hashlib.sha256(schema.encode()).digest())
            key = str(path.resolve())
            if _initialized.get(key) != identity or stamp.st_size == 0:
                connection.execute("PRAGMA journal_mode = WAL")
                connection.executescript(schema)
                conversation_columns = {row["name"] for row in connection.execute("PRAGMA table_info(conversations)")}
                message_columns = {row["name"] for row in connection.execute("PRAGMA table_info(messages)")}
                if "source" not in conversation_columns:
                    connection.execute("ALTER TABLE conversations ADD COLUMN source TEXT NOT NULL DEFAULT 'codex'")
                if "source" not in message_columns:
                    connection.execute("ALTER TABLE messages ADD COLUMN source TEXT NOT NULL DEFAULT 'codex'")
                if "time_source" not in message_columns:
                    connection.execute("ALTER TABLE messages ADD COLUMN time_source TEXT NOT NULL DEFAULT 'message'")
                if "message_type" not in message_columns:
                    connection.execute("ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'")
                connection.commit()
                _initialized[key] = identity
        return connection
    except Exception:
        connection.close()
        raise
