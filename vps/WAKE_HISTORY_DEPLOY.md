# Wake history readable from chat

Release branch: `sites-release-ca9c513`.

Deploy both parts of this change:

1. Pull this branch and copy `vps/codex_history_server.py` to the existing history service directory. Preserve its environment, token, databases and companion modules. Restart that existing history service.
2. Build and deploy the existing Cloudflare Worker using `wrangler.production.jsonc` with dashboard variables preserved (`--keep-vars`).

The authenticated GET `/history/conversations/{conversationId}/wake-history` returns up to 100 recent saved wake messages from that conversation, including silent markers and tool activity. It reads existing history; it does not create or replay wakes.

The existing `read_codex_task_progress` tool now adds `wakeHistory` to its response. Older conversations already equipped with that tool can use the new implementation without creating a conversation. If a conversation lacks that tool entirely, a new tool catalog is still required.

Verify from an existing conversation containing a silent wake: ask the model to call `read_codex_task_progress`. Confirm `wakeHistory.available` is true, with the recorded timestamp, `messageOmitted` and tool activity. Test another conversation for isolation. Missing/old/unreachable history services return `available: false`, not an assertion that no wakes occurred. Stored tool output may be a summary rather than full tool results.

Checks: `node tools/test-wake-history.mjs`; `python3 -m unittest discover -s vps -p test_wake_history.py`; `npm run build`.
