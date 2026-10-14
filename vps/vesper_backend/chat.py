from __future__ import annotations
import json
import sqlite3
from urllib.parse import urlparse, parse_qs

from dataclasses import dataclass

@dataclass
class ServiceResult:
    status: int
    value: object

class ChatService:
    """Conversation business rules; no HTTP socket, credential or response headers."""
    def __init__(self, services, query=None, body=None, method='GET'):
        self.services = services
        self.command = method
        self.query = query or {}
        self._body = body or (lambda: {})
        self.result = None

    def body(self): return self._body()
    def respond(self, status, value): self.result = ServiceResult(status, value)

    def conversation_terminal(self, path):
        services = self.services
        codex_records = services.codex_records
        conversation_delete = services.conversation_delete
        db = services.db
        terminal = services.terminal
        action = path[3:] if len(path) > 3 else []
        if not ((not action and self.command == "GET") or (action in (["start"], ["input"], ["resize"]) and self.command == "POST")):
            self.respond(405, {"error": "Method not allowed"}); return
        with db() as connection:
            row = connection.execute("SELECT codex_thread_id FROM conversations WHERE vesper_conversation_id=? AND archived_at IS NULL", (path[1],)).fetchone()
            if not row or conversation_delete.is_deleted(connection, path[1], row["codex_thread_id"]):
                self.respond(404, {"error": "Conversation not found"}); return
            thread_id = row["codex_thread_id"]
        if not thread_id:
            self.respond(409, {"error": "Send a message in this chat before opening its terminal"}); return
        try:
            if not action:
                result = terminal.screen(thread_id)
                with db() as connection:
                    if conversation_delete.is_deleted(connection, path[1], thread_id):
                        self.respond(404, {"error": "Conversation not found"}); return
                    before = self.query.get('before', [''])[0]
                    try:
                        result['history'] = codex_records.terminal_page(connection, path[1], thread_id, before)
                    except (OSError, ValueError, sqlite3.Error):
                        result['historyError'] = 'Recorded Codex activity could not be read; the live terminal remains available'
            elif action == ["start"]:
                result = terminal.start(thread_id)
            elif action == ["resize"]:
                result = terminal.resize(self.body(), thread_id)
            else:
                result = terminal.input_event(self.body(), thread_id)
            self.respond(200, dict(result, conversationId=path[1], codexThreadId=thread_id))
        except terminal.TerminalUnavailable as error:
            self.respond(503, {"error": str(error)})

    def inbox(self) -> None:
        services = self.services
        db = services.db
        is_internal_context = services.is_internal_context
        # Read-only message identities; user sends, tool activity and draft/title
        # updates cannot light an incoming-message badge. No transcript body.
        with db() as connection:
            rows = connection.execute("""SELECT m.* FROM messages m JOIN conversations c
              ON c.vesper_conversation_id=m.vesper_conversation_id
              WHERE c.archived_at IS NULL AND m.role IN ('agent','system')
                AND m.status IN ('completed','delivered')
              ORDER BY m.created_at DESC,m.rowid DESC""").fetchall()
        incoming = {}
        for row in rows:
            chat = row['vesper_conversation_id']
            if chat in incoming:continue
            try: meta = json.loads(row['metadata_json'] or '{}')
            except (ValueError,TypeError):continue
            if not isinstance(meta,dict):continue
            block = meta.get('blockType','')
            if row['role']=='system' and block!='letterReminder':continue
            if row['role']=='agent' and (meta.get('phase')=='commentary' or meta.get('execution') or
                block not in ('','agentMessage','assistantMessage','outputMessage','text','message','sticker','musicCard')):continue
            if is_internal_context(row['content']):continue
            if not row['content'].strip() and not any(meta.get(k) for k in ('attachments','sticker','musicCard','call')):continue
            incoming[chat]={'conversationId':chat,'messageId':row['id'],'itemId':row['item_id'], 'createdAt':row['created_at']}
        self.respond(200, {'incoming':list(incoming.values())})

    def list_conversations(self) -> None:
        services = self.services
        conversation = services.conversation
        conversation_delete = services.conversation_delete
        db = services.db
        with db() as connection:
            rows = connection.execute("""SELECT c.*, COUNT(m.id) AS message_count,
              (SELECT content FROM messages p WHERE p.vesper_conversation_id=c.vesper_conversation_id AND p.role IN ('user','agent') ORDER BY p.created_at DESC,p.rowid DESC LIMIT 1) AS preview
              FROM conversations c LEFT JOIN messages m ON m.vesper_conversation_id = c.vesper_conversation_id
              WHERE c.archived_at IS NULL GROUP BY c.vesper_conversation_id
              ORDER BY c.updated_at DESC LIMIT 100""").fetchall()
            rows = [row for row in rows if not conversation_delete.is_deleted(connection, row["vesper_conversation_id"], row["codex_thread_id"])]
        self.respond(200, {"conversations": [dict(conversation(row, row["message_count"]), preview=row["preview"] or "") for row in rows]})

    def search_messages(self) -> None:
        services = self.services
        db = services.db
        message = services.message
        query = self.query
        text = query.get("q", [""])[0].strip()[:300]
        conversation_id = query.get("conversationId", [""])[0]
        try: offset = min(100000, max(0, int(query.get("offset", ["0"])[0])))
        except ValueError: offset = 0
        if not text:
            self.respond(200, {"results": [], "hasMore": False}); return
        with db() as connection:
            rows = connection.execute("""SELECT m.*, c.title FROM messages m JOIN conversations c
              ON c.vesper_conversation_id=m.vesper_conversation_id
              WHERE c.archived_at IS NULL AND m.role IN ('user','agent')
              AND (?='' OR m.vesper_conversation_id=?) AND instr(lower(m.content),lower(?))>0
              AND coalesce(json_extract(m.metadata_json,'$.blockType'),'') IN ('','agentMessage','assistantMessage','userMessage','text')
              ORDER BY m.created_at DESC,m.rowid DESC LIMIT 61 OFFSET ?""", (conversation_id,conversation_id,text,offset)).fetchall()
        self.respond(200, {"results": [dict(message(row), title=row["title"]) for row in rows[:60]], "hasMore": len(rows)>60})

    def get_conversation(self, conversation_id: str) -> None:
        services = self.services
        chat_screenshot = services.chat_screenshot
        codex_records = services.codex_records
        conversation = services.conversation
        conversation_delete = services.conversation_delete
        db = services.db
        message = services.message
        query = self.query
        capture_ids = query.get('captureMessageId')
        if capture_ids:
            # Read-only capture does not sync Codex records or write presence.
            with db() as connection:
                data = chat_screenshot.select_messages(connection, conversation_id, capture_ids)
                rows = connection.execute('SELECT * FROM messages WHERE vesper_conversation_id=? AND id IN (' + ','.join('?' for _ in capture_ids) + ') ORDER BY created_at,rowid', (conversation_id, *capture_ids)).fetchall()
            self.respond(200, {'conversation': {'id': conversation_id, 'title': data['title']}, 'messages': [message(row) for row in rows], 'tombstones': [], 'hasMore': False})
            return
        with db() as connection:
            if conversation_delete.is_deleted(connection, conversation_id):
                self.respond(410, {"error": "Conversation was deleted", "code": "conversation_deleted"}); return
            recovery = codex_records.sync(connection, conversation_id)
            row = connection.execute("SELECT * FROM conversations WHERE vesper_conversation_id = ?", (conversation_id,)).fetchone()
            query = self.query
            paginated = query.get("latest", [""])[0] == "1"
            try: limit = min(500, max(1, int(query.get("limit", ["200"])[0])))
            except ValueError: limit = 200
            before = query.get("before", [""])[0]
            cursor = connection.execute("SELECT created_at,rowid FROM messages WHERE id=? AND vesper_conversation_id=?", (before, conversation_id)).fetchone() if before else None
            around = query.get("around", [""])[0]
            if before and not cursor:
                self.respond(400, {"error": "Invalid history cursor"}); return
            if around:
                target = connection.execute("SELECT created_at,rowid FROM messages WHERE id=? AND vesper_conversation_id=?", (around, conversation_id)).fetchone()
                if not target:
                    self.respond(404, {"error": "Message not found"}); return
                args = (conversation_id, target["created_at"], target["rowid"])
                older = connection.execute("SELECT * FROM messages WHERE vesper_conversation_id=? AND (created_at,rowid) <= (?,?) ORDER BY created_at DESC,rowid DESC LIMIT ?", (*args, (limit+1)//2)).fetchall()
                newer = connection.execute("SELECT * FROM messages WHERE vesper_conversation_id=? AND (created_at,rowid) > (?,?) ORDER BY created_at,rowid LIMIT ?", (*args, limit//2)).fetchall()
                messages = list(reversed(older)) + list(newer)
                first = connection.execute("SELECT created_at,rowid FROM messages WHERE id=?", (messages[0]["id"],)).fetchone()
                has_more = bool(connection.execute("SELECT 1 FROM messages WHERE vesper_conversation_id=? AND (created_at,rowid) < (?,?) LIMIT 1", (conversation_id, first["created_at"], first["rowid"])).fetchone())
            elif paginated:
                clause = " AND (created_at,rowid) < (?,?)" if cursor else ""
                args = (conversation_id,) + ((cursor["created_at"], cursor["rowid"]) if cursor else ()) + (limit+1,)
                batch = connection.execute("SELECT * FROM messages WHERE vesper_conversation_id=?" + clause + " ORDER BY created_at DESC,rowid DESC LIMIT ?", args).fetchall()
                has_more = len(batch) > limit
                messages = list(reversed(batch[:limit]))
            else:
                messages = connection.execute("SELECT * FROM messages WHERE vesper_conversation_id=? ORDER BY created_at ASC,rowid ASC LIMIT 1000", (conversation_id,)).fetchall()
                has_more = False
            tombstones = connection.execute("""SELECT codex_thread_id, stable_id, deleted_at
              FROM message_tombstones WHERE vesper_conversation_id = ?""", (conversation_id,)).fetchall()
        self.respond(200, {
            "conversation": conversation(row) if row else None,
            "messages": [message(item) for item in messages],
            "hasMore": has_more,
            "before": messages[0]["id"] if messages else None,
            "recovery": recovery,
            "tombstones": [{"threadId": item["codex_thread_id"], "stableId": item["stable_id"],
                            "messageId": item["stable_id"], "deletedAt": item["deleted_at"]}
                           for item in tombstones],
        })

    def upsert_conversation(self, conversation_id: str) -> None:
        services = self.services
        conversation = services.conversation
        conversation_delete = services.conversation_delete
        db = services.db
        now = services.now
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
                self.respond(410, {"error": "Conversation was deleted", "code": "conversation_deleted"}); return
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
        self.respond(200, {"conversation": conversation(row)})

    def upsert_message(self, conversation_id: str) -> None:
        services = self.services
        conversation_delete = services.conversation_delete
        db = services.db
        is_internal_context = services.is_internal_context
        message = services.message
        now = services.now
        valid_history_attachment = services.valid_history_attachment
        valid_history_batch = services.valid_history_batch
        body = self.body()
        message_id = str(body.get("id") or "").strip()
        role = str(body.get("role") or "")
        content = str(body.get("content") or "").strip()
        message_type = str(body.get("type") or "text").strip().lower()
        metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
        sticker = metadata.get("sticker") if isinstance(metadata.get("sticker"), dict) else {}
        valid_sticker = bool(sticker.get("assetId") and sticker.get("url") and sticker.get("mimeType"))
        # Native photo/file messages keep the caption empty and store uploaded
        # media in metadata. Do not reject them before the model turn can start.
        attachments = metadata.get("attachments")
        has_attachments = isinstance(attachments, list) and bool(attachments) and all(valid_history_attachment(item) for item in attachments)
        has_batch = role == "user" and valid_history_batch(metadata.get("batchMessages"), conversation_id)
        if (not message_id or role not in {"user", "agent", "system"} or message_type not in {"text", "sticker"}
                or (message_type == "text" and not content and not has_attachments and not has_batch) or (message_type == "sticker" and not valid_sticker)
                or len(content) > 120_000):
            self.respond(400, {"error": "Invalid message"})
            return
        if is_internal_context(content):
            # Older clients temporarily represented developer instructions and
            # recalled memory as turn input. It is private context, not a user
            # message, and must never be persisted or returned as chat history.
            self.respond(200, {"ok": True, "skipped": "internal_context"})
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
                self.respond(410, {"error": "Conversation was deleted", "code": "conversation_deleted"}); return
            if body.get("wakeTargetUserId"):
                # Serialize with archive/delete: background output must never recreate a window.
                target = connection.execute("""SELECT 1 FROM conversations c JOIN messages m
                  ON m.vesper_conversation_id=c.vesper_conversation_id
                  WHERE c.vesper_conversation_id=? AND c.archived_at IS NULL AND m.id=? AND m.role='user'""",
                  (conversation_id, body["wakeTargetUserId"])).fetchone()
                if not target:
                    self.respond(409, {"error": "Wake target no longer available"})
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
                self.respond(200, {"ok": True, "deleted": True})
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
        self.respond(200, {"message": message(row)})

    def delete_conversation(self, conversation_id: str) -> None:
        services = self.services
        codex_records = services.codex_records
        conversation_delete = services.conversation_delete
        db = services.db
        with db() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT codex_thread_id FROM conversations WHERE vesper_conversation_id=?", (conversation_id,)).fetchone()
            if not row:
                if conversation_delete.is_deleted(connection, conversation_id):
                    self.respond(200, {"ok": True, "permanent": True, "permanentlyDeleted": True, "deleted": 0}); return
                self.respond(404, {"error": "Conversation not found"}); return
            thread_id=row["codex_thread_id"]
            if conversation_delete.thread_is_shared(thread_id):
                self.respond(409, {"error": "Conversation belongs to a shared Codex thread and was retained"}); return
            conversation_delete.block(connection, conversation_id, thread_id)
        try:source=conversation_delete.delete_codex_thread(thread_id)
        except Exception:
            self.respond(502, {"error": "Codex source deletion failed; conversation is blocked pending retry"}); return
        codex_records.forget(thread_id)
        wake_jobs=conversation_delete.purge_wake(conversation_id)
        with db() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM message_tombstones WHERE vesper_conversation_id=?",(conversation_id,))
            messages=connection.execute("DELETE FROM messages WHERE vesper_conversation_id=?",(conversation_id,)).rowcount
            deleted=connection.execute("DELETE FROM conversations WHERE vesper_conversation_id=?",(conversation_id,)).rowcount
        self.respond(200,{"ok":True,"permanent":True,"permanentlyDeleted":True,"deleted":deleted,"messagesDeleted":messages,
                            "wakeJobsDeleted":wake_jobs,"source":source})

    def delete_message(self, conversation_id: str, message_id: str) -> None:
        services = self.services
        db = services.db
        now = services.now
        body = self.body()
        with db() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if not connection.execute("SELECT 1 FROM conversations WHERE vesper_conversation_id=?", (conversation_id,)).fetchone():
                self.respond(200, {"ok": True, "deleted": 0}); return
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
        self.respond(200, {"ok": True, "deleted": cursor.rowcount, "tombstoned": 1})

