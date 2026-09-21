"""Read-only message counts, grouped by Asia/Shanghai calendar date."""
import json
import re
from datetime import datetime, timedelta, timezone

ZONE = timezone(timedelta(hours=8))

def month_activity(connection, month):
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}", month):
        raise ValueError("Invalid month")
    start = datetime.strptime(month, "%Y-%m").replace(tzinfo=ZONE)
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    days = {}
    # julianday accepts both legacy ISO offsets and UTC timestamps.
    rows = connection.execute("""SELECT m.*, c.title FROM messages m
        JOIN conversations c ON c.vesper_conversation_id=m.vesper_conversation_id
        WHERE julianday(m.created_at)>=julianday(?) AND julianday(m.created_at)<julianday(?)
        AND m.role IN ('user','agent')""", (start.isoformat(), end.isoformat()))
    for row in rows:
        try:
            meta = json.loads(row["metadata_json"] or "{}")
        except (ValueError, TypeError):
            meta = {}
        if not isinstance(meta, dict):
            meta = {}
        source = meta.get("source") or row["source"]
        if source in ("verification", "test") or meta.get("blockType") in ("execution", "reasoning", "analysis", "dynamicToolCall"):
            continue
        content = row["content"].strip()
        if content.lower().startswith(("[vesper response preference — not user content:", "旧记忆背景（只作为长期背景")):
            continue
        if row["status"] in ("error", "failed", "streaming"):
            continue
        if not content and not any(meta.get(k) for k in ("attachments", "sticker", "musicCard")):
            continue
        wake = meta.get("wakeRunId") or meta.get("wake") or source in ("automation", "automatic")
        if wake and row["role"] == "user":
            continue  # Legacy synthetic wake request, not a user message.
        key = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")).astimezone(ZONE).date().isoformat()
        day = days.setdefault(key, {"user": 0, "agent": 0, "autonomous": 0, "total": 0})
        category = "autonomous" if wake else row["role"]
        day[category] += 1
        if not wake:
            day["total"] += 1
    return {"month": month, "timezone": "Asia/Shanghai", "days": days}
