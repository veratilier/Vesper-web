# Journal message activity

Deploy the frontend together with `codex_history_server.py` and the new sibling
`vesper_activity.py` to the existing VPS history service directory; restart that
history service using its existing service configuration. No new credentials or
migration are required. The authenticated endpoint is `GET /activity?month=YYYY-MM`.

Counts use retained SQLite messages across conversations (including archived
conversations), grouped in Asia/Shanghai. A text, image group, sticker or music
card counts as one saved message. System/tool/reasoning records, failed/streaming
messages, synthetic wake prompts and marked verification records are excluded.
Wake replies are separately counted as autonomous. Deleted messages disappear
from counts. Older messages without wake metadata cannot reliably be identified
as autonomous. No records are rewritten or copied.

Verify after deployment: view a month containing messages, open a date, compare
counts and existing journals, edit a user journal, return to the calendar. Check
an empty day and phone-width layout. A failed request shows unavailable, not zero.
The calendar refreshes every 30 seconds while visible and upon returning to it.
