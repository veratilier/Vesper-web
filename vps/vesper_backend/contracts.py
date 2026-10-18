from __future__ import annotations
import json
import sqlite3
from datetime import datetime, timezone
from urllib.parse import urlparse

INTERNAL_CONTEXT_PREFIXES = (
    "[vesper response preference — not user content:",
    "旧记忆背景（只作为长期背景",
)

def is_internal_context(content: str) -> bool:
    """Reject legacy client-side prompt/context items from durable chat history."""
    return content.strip().lower().startswith(INTERNAL_CONTEXT_PREFIXES)

def valid_history_attachment(item: object) -> bool:
    if not isinstance(item, dict) or not isinstance(item.get("url"), str):
        return False
    try:
        url = urlparse(item["url"])
        return url.scheme in {"http", "https"} and bool(url.hostname) and isinstance(item.get("type"), str) and bool(item["type"].strip())
    except ValueError:
        return False

def valid_history_batch(batch: object, conversation_id: str) -> bool:
    """Native collected messages keep their visible payloads in child records."""
    if not isinstance(batch, list) or not batch:
        return False
    seen = set()
    for child in batch:
        if not isinstance(child, dict):
            return False
        child_id = child.get("id")
        content = child.get("content")
        metadata = child.get("metadata")
        if (not isinstance(child_id, str) or not child_id.strip() or child_id in seen
                or child.get("role") != "user" or child.get("conversationId") != conversation_id
                or not isinstance(content, str) or len(content) > 120_000
                or not isinstance(metadata, dict) or metadata.get("batchMessages")
                or child.get("type", "text") not in ("text", "sticker")
                or is_internal_context(content)):
            return False
        seen.add(child_id)
        attachments = metadata.get("attachments")
        has_attachments = isinstance(attachments, list) and bool(attachments) and all(valid_history_attachment(item) for item in attachments)
        sticker = metadata.get("sticker")
        has_sticker = isinstance(sticker, dict) and all(sticker.get(key) for key in ("assetId", "url", "mimeType"))
        music = metadata.get("musicCard")
        has_music = isinstance(music, dict) and isinstance(music.get("title"), str) and bool(music["title"].strip())
        location = metadata.get("locationCard")
        has_location = isinstance(location, dict) and all(isinstance(location.get(key), (int, float)) for key in ("latitude", "longitude"))
        if not (content.strip() or has_attachments or has_sticker or has_music or has_location):
            return False
    return True

def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

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
