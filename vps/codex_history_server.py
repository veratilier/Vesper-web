#!/usr/bin/env python3
"""Authenticated SQLite history API colocated with the Vesper Codex app-server."""

from __future__ import annotations

import hmac
import json
import os
import sqlite3
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qs
import vesper_activity as activity
import vesper_wake_store as wake_store
import vesper_conversation_delete as conversation_delete
import vesper_watch as watch


DB_PATH = Path(os.environ.get("VESPER_HISTORY_DB", "/home/ubuntu/.vesper/chat-history.sqlite3"))
TOKEN_PATH = Path(os.environ.get("CODEX_TOKEN_FILE", "/home/ubuntu/.codex/app-server-token"))
ALLOWED_ORIGINS = {"https://vesper.r-vera.com", "http://localhost:3000", "http://localhost:5173"}

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


INTERNAL_CONTEXT_PREFIXES = (
    "[vesper response preference — not user content:",
    "旧记忆背景（只作为长期背景",
)


def is_internal_context(content: str) -> bool:
    """Reject legacy client-side prompt/context items from durable chat history."""
    return content.strip().lower().startswith(INTERNAL_CONTEXT_PREFIXES)


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.executescript(SCHEMA)
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
    return connection


def conversation(row: sqlite3.Row, message_count: int | None = None) -> dict:
    value = {
        "vesperConversationId": row["vesper_conversation_id"],
        "id": row["vesper_conversation_id"],
        "codexThreadId": row["codex_thread_id"],
        "title": row["title"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "archived": row["archived_at"] is not None,
        "archivedAt": row["archived_at"],
        "source": row["source"],
    }
    if message_count is not None:
        value["messageCount"] = message_count
    return value


def message(row: sqlite3.Row) -> dict:
    try:
        metadata = json.loads(row["metadata_json"] or "{}")
    except json.JSONDecodeError:
        metadata = {}
    return {
        "id": row["id"],
        "conversationId": row["vesper_conversation_id"],
        "role": row["role"],
        "type": row["message_type"] if "message_type" in row.keys() else "text",
        "content": row["content"],
        "status": row["status"],
        "metadata": metadata,
        "createdAt": row["created_at"],
        "source": row["source"],
        "timeSource": row["time_source"],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "VesperHistory/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        # Never log query strings because the WebSocket capability token is passed there.
        print(f'{self.address_string()} {self.command} {urlparse(self.path).path}')

    def origin(self) -> str | None:
        value = self.headers.get("Origin")
        return value if value in ALLOWED_ORIGINS else None

    def authenticated(self) -> bool:
        supplied = self.headers.get("Authorization", "")
        supplied = supplied[7:].strip() if supplied.startswith("Bearer ") else ""
        try:
            expected = TOKEN_PATH.read_text(encoding="utf-8").strip()
        except OSError:
            return False
        return bool(supplied and expected and hmac.compare_digest(supplied, expected))

    def send_json(self, status: int, value: object) -> None:
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        origin = self.origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        if not self.origin():
            self.send_json(403, {"error": "Origin not allowed"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.origin() or "")
        self.send_header("Access-Control-Allow-Headers", "authorization, content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def watch_secret(self):
        return TOKEN_PATH.read_text(encoding="utf-8").strip()

    def dispatch(self) -> None:
        parts = urlparse(self.path).path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "watch" and parts[2] == "stream" and self.command == "GET":
            watch.serve(self, parts[1])
            return
        if not self.authenticated():
            self.send_json(401, {"error": "Unauthorized"})
            return
        path = [unquote(part) for part in urlparse(self.path).path.strip("/").split("/") if part]
        if path and path[0] == "watch":
            try:
                if path == ["watch"] and self.command == "POST":
                    self.send_json(202, watch.start(self.body().get("url")))
                elif len(path) == 2 and self.command == "GET":
                    data = watch.read(path[1])
                    if data["status"] == "ready":
                        expiry = int(data["created"] + watch.TTL)
                        data["streamPath"] = f'/watch/{path[1]}/stream?expires={expiry}&ticket={watch.ticket(path[1], expiry, self.watch_secret())}'
                    self.send_json(200, data)
                else: self.send_json(405, {"error": "Method not allowed"})
            except (ValueError, OSError):
                self.send_json(400, {"error": "导入不可用：请确认完整 B 站链接，且没有其他视频正在准备或缓存已满。"})
        elif path == ["wake"] and self.command == "GET":
            self.send_json(200, wake_store.status())
        elif path == ["wake"] and self.command == "POST":
            body = self.body()
            if body.get("action") == "presence":
                wake_store.presence(body.get("deviceId", "web"), body.get("busy", False))
                self.send_json(200, {"ok": True})
            elif body.get("action") == "configure":
                try:
                    self.send_json(200, wake_store.configure(body))
                except ValueError as error:
                    self.send_json(400, {"error": str(error)})
            elif body.get("action") == "request":
                ident = wake_store.request(body.get("requestId"))
                self.send_json(202, {"ok": True, "requestId": ident, "conversationId": None})
            else:
                self.send_json(400, {"error": "Unknown wake action"})
        elif path == ["activity"] and self.command == "GET":
            try:
                month = parse_qs(urlparse(self.path).query).get("month", [""])[0]
                with db() as connection:
                    result = activity.month_activity(connection, month)
                self.send_json(200, result)
            except ValueError:
                self.send_json(400, {"error": "Expected month YYYY-MM"})
        elif path == ["health"] and self.command == "GET":
            self.send_json(200, {"ok": True})
        elif path == ["conversations"] and self.command == "GET":
            self.list_conversations()
        elif len(path) == 2 and path[0] == "conversations":
            if self.command == "GET": self.get_conversation(path[1])
            elif self.command in {"POST", "PATCH"}: self.upsert_conversation(path[1])
            elif self.command == "DELETE": self.delete_conversation(path[1])
            else: self.send_json(405, {"error": "Method not allowed"})
        elif len(path) == 3 and path[0] == "conversations" and path[2] == "wake-history" and self.command == "GET":
            with db() as connection:
                rows = connection.execute("""SELECT * FROM messages
                  WHERE vesper_conversation_id = ?
                    AND (json_extract(metadata_json, '$.wakeRunId') IS NOT NULL
                         OR json_extract(metadata_json, '$.wake') IS NOT NULL)
                  ORDER BY created_at DESC, rowid DESC LIMIT 100""", (path[1],)).fetchall()
            self.send_json(200, {"messages": [message(row) for row in rows], "limit": 100})
        elif len(path) == 3 and path[0] == "conversations" and path[2] == "messages" and self.command == "POST":
            self.upsert_message(path[1])
        elif len(path) == 4 and path[0] == "conversations" and path[2] == "messages" and self.command == "DELETE":
            self.delete_message(path[1], path[3])
        else:
            self.send_json(404, {"error": "Not found"})

    def body(self) -> dict:
        length = min(int(self.headers.get("Content-Length", "0") or 0), 1_000_000)
        value = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(value, dict):
            raise ValueError("JSON object required")
        return value

    def list_conversations(self) -> None:
        with db() as connection:
            rows = connection.execute("""SELECT c.*, COUNT(m.id) AS message_count
              FROM conversations c LEFT JOIN messages m ON m.vesper_conversation_id = c.vesper_conversation_id
              WHERE c.archived_at IS NULL GROUP BY c.vesper_conversation_id
              ORDER BY c.updated_at DESC LIMIT 100""").fetchall()
        self.send_json(200, {"conversations": [conversation(row, row["message_count"]) for row in rows]})

    def get_conversation(self, conversation_id: str) -> None:
        with db() as connection:
            if conversation_delete.is_deleted(connection, conversation_id):
                self.send_json(404, {"error": "Conversation not found"}); return
            row = connection.execute("SELECT * FROM conversations WHERE vesper_conversation_id = ?", (conversation_id,)).fetchone()
            messages = connection.execute("""SELECT * FROM messages WHERE vesper_conversation_id = ?
              ORDER BY created_at ASC, rowid ASC LIMIT 1000""", (conversation_id,)).fetchall()
            tombstones = connection.execute("""SELECT codex_thread_id, stable_id, deleted_at
              FROM message_tombstones WHERE vesper_conversation_id = ?""", (conversation_id,)).fetchall()
        self.send_json(200, {
            "conversation": conversation(row) if row else None,
            "messages": [message(item) for item in messages],
            "tombstones": [{"threadId": item["codex_thread_id"], "stableId": item["stable_id"],
                            "messageId": item["stable_id"], "deletedAt": item["deleted_at"]}
                           for item in tombstones],
        })

    def upsert_conversation(self, conversation_id: str) -> None:
        body = self.body()
        timestamp = now()
        title = str(body.get("title") or "新对话").strip()[:120] or "新对话"
        thread_present = "codexThreadId" in body
        thread_id = str(body.get("codexThreadId") or "").strip() or None
        source = str(body.get("source") or "codex")
        source = source if source in {"legacy-vesper", "codex"} else "codex"
        created_at = str(body.get("createdAt") or timestamp)
        updated_at = str(body.get("updatedAt") or timestamp)
        with db() as connection:
            if conversation_delete.is_deleted(connection, conversation_id, thread_id):
                self.send_json(410, {"error": "Conversation was permanently deleted"}); return
            connection.execute("""INSERT INTO conversations
              (vesper_conversation_id, codex_thread_id, title, created_at, updated_at, archived_at, source)
              VALUES (?, ?, ?, ?, ?, NULL, ?)
              ON CONFLICT(vesper_conversation_id) DO UPDATE SET
                codex_thread_id = CASE WHEN ? THEN excluded.codex_thread_id ELSE conversations.codex_thread_id END,
                title = CASE WHEN excluded.title <> '新对话' THEN excluded.title ELSE conversations.title END,
                created_at = CASE WHEN conversations.created_at = '' THEN excluded.created_at ELSE conversations.created_at END,
                updated_at = CASE WHEN excluded.updated_at > conversations.updated_at THEN excluded.updated_at ELSE conversations.updated_at END,
                source = CASE WHEN conversations.source = 'codex' THEN conversations.source ELSE excluded.source END,
                archived_at = NULL""",
              (conversation_id, thread_id, title, created_at, updated_at, source, thread_present))
            row = connection.execute("SELECT * FROM conversations WHERE vesper_conversation_id = ?", (conversation_id,)).fetchone()
        self.send_json(200, {"conversation": conversation(row)})

    def upsert_message(self, conversation_id: str) -> None:
        body = self.body()
        message_id = str(body.get("id") or "").strip()
        role = str(body.get("role") or "")
        content = str(body.get("content") or "").strip()
        message_type = str(body.get("type") or "text").strip().lower()
        metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
        sticker = metadata.get("sticker") if isinstance(metadata.get("sticker"), dict) else {}
        valid_sticker = bool(sticker.get("assetId") and sticker.get("url") and sticker.get("mimeType"))
        if (not message_id or role not in {"user", "agent", "system"} or message_type not in {"text", "sticker"}
                or (message_type == "text" and not content) or (message_type == "sticker" and not valid_sticker)
                or len(content) > 120_000):
            self.send_json(400, {"error": "Invalid message"})
            return
        if is_internal_context(content):
            # Older clients temporarily represented developer instructions and
            # recalled memory as turn input. It is private context, not a user
            # message, and must never be persisted or returned as chat history.
            self.send_json(200, {"ok": True, "skipped": "internal_context"})
            return
        item_id = str(metadata.get("itemId") or "").strip() or None
        turn_id = str(metadata.get("turnId") or "").strip() or None
        created_at = str(body.get("createdAt") or "")
        timestamp = now()
        conversation_updated_at = created_at if created_at else timestamp
        status = str(body.get("status") or "delivered")[:32]
        title = str(body.get("title") or content[:42]).strip()[:120] or ("表情包" if message_type == "sticker" else "新对话")
        source = str(body.get("source") or "codex")
        source = source if source in {"legacy-vesper", "codex"} else "codex"
        time_source = str(body.get("timeSource") or metadata.get("timeSource") or ("message" if created_at else "unknown"))[:32]
        with db() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing_conversation = connection.execute("SELECT codex_thread_id FROM conversations WHERE vesper_conversation_id=?", (conversation_id,)).fetchone()
            if conversation_delete.is_deleted(connection, conversation_id, existing_conversation["codex_thread_id"] if existing_conversation else None):
                self.send_json(410, {"error": "Conversation was permanently deleted"}); return
            if body.get("wakeTargetUserId"):
                # Serialize with archive/delete: background output must never recreate a window.
                target = connection.execute("""SELECT 1 FROM conversations c JOIN messages m
                  ON m.vesper_conversation_id=c.vesper_conversation_id
                  WHERE c.vesper_conversation_id=? AND c.archived_at IS NULL AND m.id=? AND m.role='user'""",
                  (conversation_id, body["wakeTargetUserId"])).fetchone()
                if not target:
                    self.send_json(409, {"error": "Wake target no longer available"})
                    return

            connection.execute("""INSERT INTO conversations
              (vesper_conversation_id, title, created_at, updated_at, archived_at, source)
              VALUES (?, ?, ?, ?, NULL, ?)
              ON CONFLICT(vesper_conversation_id) DO UPDATE SET
                title = CASE WHEN conversations.title = '新对话' THEN excluded.title ELSE conversations.title END,
                updated_at = CASE WHEN excluded.updated_at > conversations.updated_at THEN excluded.updated_at ELSE conversations.updated_at END,
                archived_at = NULL""",
              (conversation_id, title, created_at, conversation_updated_at, source))
            deleted = connection.execute("""SELECT 1 FROM message_tombstones
              WHERE vesper_conversation_id = ? AND (stable_id = ? OR (? IS NOT NULL AND stable_id = ?)) LIMIT 1""",
              (conversation_id, message_id, item_id, item_id)).fetchone()
            if deleted:
                self.send_json(200, {"ok": True, "deleted": True})
                return
            existing = connection.execute("""SELECT id FROM messages WHERE vesper_conversation_id = ?
              AND ((? IS NOT NULL AND item_id = ?) OR id = ?) LIMIT 1""",
              (conversation_id, item_id, item_id, message_id)).fetchone()
            target_id = existing["id"] if existing else message_id
            connection.execute("""INSERT INTO messages
              (id, vesper_conversation_id, role, content, status, item_id, turn_id, metadata_json, created_at, updated_at, source, time_source, message_type)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET content = excluded.content, status = excluded.status,
                item_id = COALESCE(excluded.item_id, messages.item_id),
                turn_id = COALESCE(excluded.turn_id, messages.turn_id),
                metadata_json = excluded.metadata_json,
                created_at = CASE WHEN messages.created_at = '' THEN excluded.created_at ELSE messages.created_at END,
                source = excluded.source, time_source = excluded.time_source, message_type = excluded.message_type, updated_at = excluded.updated_at""",
              (target_id, conversation_id, role, content, status, item_id, turn_id,
               json.dumps(metadata, ensure_ascii=False), created_at, timestamp, source, time_source, message_type))
            row = connection.execute("SELECT * FROM messages WHERE id = ?", (target_id,)).fetchone()
        self.send_json(200, {"message": message(row)})

    def delete_conversation(self, conversation_id: str) -> None:
        with db() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT codex_thread_id FROM conversations WHERE vesper_conversation_id=?", (conversation_id,)).fetchone()
            if not row:
                if conversation_delete.is_deleted(connection, conversation_id):
                    self.send_json(200, {"ok": True, "permanentlyDeleted": True, "deleted": 0}); return
                self.send_json(404, {"error": "Conversation not found"}); return
            thread_id=row["codex_thread_id"]
            if conversation_delete.thread_is_shared(thread_id):
                self.send_json(409, {"error": "Conversation belongs to a shared Codex thread and was retained"}); return
            conversation_delete.block(connection, conversation_id, thread_id)
        try:source=conversation_delete.delete_codex_thread(thread_id)
        except Exception:
            self.send_json(502, {"error": "Codex source deletion failed; conversation is blocked pending retry"}); return
        wake_jobs=conversation_delete.purge_wake(conversation_id)
        with db() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM message_tombstones WHERE vesper_conversation_id=?",(conversation_id,))
            messages=connection.execute("DELETE FROM messages WHERE vesper_conversation_id=?",(conversation_id,)).rowcount
            deleted=connection.execute("DELETE FROM conversations WHERE vesper_conversation_id=?",(conversation_id,)).rowcount
        self.send_json(200,{"ok":True,"permanentlyDeleted":True,"deleted":deleted,"messagesDeleted":messages,
                            "wakeJobsDeleted":wake_jobs,"source":source})

    def delete_message(self, conversation_id: str, message_id: str) -> None:
        body = self.body()
        with db() as connection:
            row = connection.execute(
                "SELECT item_id, metadata_json FROM messages WHERE vesper_conversation_id = ? AND id = ?",
                (conversation_id, message_id),
            ).fetchone()
            metadata = {}
            if row:
                try:
                    metadata = json.loads(row["metadata_json"] or "{}")
                except json.JSONDecodeError:
                    metadata = {}
            conversation_row = connection.execute(
                "SELECT codex_thread_id FROM conversations WHERE vesper_conversation_id = ?", (conversation_id,)
            ).fetchone()
            item_id = str(body.get("itemId") or (row["item_id"] if row else "") or "").strip() or None
            thread_id = str(body.get("threadId") or metadata.get("threadId") or
                            (conversation_row["codex_thread_id"] if conversation_row else "") or "").strip() or None
            for stable_id in {message_id, item_id} - {None, ""}:
                connection.execute("""INSERT INTO message_tombstones
                  (vesper_conversation_id, codex_thread_id, stable_id, deleted_at)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT(vesper_conversation_id, codex_thread_id, stable_id)
                  DO UPDATE SET deleted_at = excluded.deleted_at""",
                  (conversation_id, thread_id or "", stable_id, now()))
            cursor = connection.execute(
                "DELETE FROM messages WHERE vesper_conversation_id = ? AND id = ?",
                (conversation_id, message_id),
            )
            if cursor.rowcount:
                latest = connection.execute(
                    "SELECT MAX(created_at) AS latest FROM messages WHERE vesper_conversation_id = ?",
                    (conversation_id,),
                ).fetchone()["latest"]
                connection.execute(
                    "UPDATE conversations SET updated_at = ? WHERE vesper_conversation_id = ?",
                    (latest or now(), conversation_id),
                )
        self.send_json(200, {"ok": True, "deleted": cursor.rowcount, "tombstoned": 1})

    do_GET = dispatch
    do_POST = dispatch
    do_PATCH = dispatch
    do_DELETE = dispatch


if __name__ == "__main__":
    with db():
        pass
    server = ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("VESPER_HISTORY_PORT", "4510"))), Handler)
    server.serve_forever()
