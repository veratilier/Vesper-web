# Vesper external MCP

This Worker exposes Vesper data to an external MCP client such as ChatGPT.
It is independent of Vesper's Settings → MCP Servers, which connects external
servers to the app-server. Do not replace that UI, its OAuth flow or `/api/mcp`.

Endpoint after deployment: `https://mcp.vesper.r-vera.com/mcp`.
Keep the existing Bearer access token and shared `vesper-db` D1 binding.

## Tools

- Retired Notes: `list_notes` and `save_note` are no longer exposed. Existing
  `notes` documents are preserved for backups and compatibility.
- Reminders: `list_todos`, `save_todo`, `complete_todo`.
- Diary: `list_diaries`, `get_diary`, `write_agent_diary`.
  Writing now appends by default. `mode: replace` is only for an explicitly
  requested replacement. The user's diary field is preserved. Dates use
  YYYY-MM-DD; callers should choose the date in Vera's Asia/Shanghai timezone.
- Memory library: `list_memories`, `save_memory`, using the app's existing memory
  service, scope, deduplication and core-candidate workflow. Source is
  `vesper-mcp:chatgpt` or `vesper-mcp:automation`; choose automation for wake-ups.
  `search_memory` searches diaries, reminders and dates, excluding retired Notes.
- Notifications: `send_notification` sends immediately to subscribed devices.
  Saving a reminder does not itself schedule a push. Existing VAPID keys must
  match those used to subscribe the devices; don't generate replacement keys.
- Existing anniversary and music tools remain available.

## Release

Deploy only `mcp-server/wrangler.jsonc` for the MCP update, preserving secrets.
Memory tools accept either deployment-only `VESPER_MEMORY_USER_ID` (an audited
existing `usr_` + 32 hexadecimal owner ID) or, as a fallback, `VESPER_APP_TOKEN`
with exactly the same secret value as the API. An explicitly configured but
invalid owner fails closed. Tool callers cannot choose another owner.

When the original app secret cannot be recovered, inspect existing memory owner
IDs administratively. Configure a verified owner on the MCP Worker to keep the
API credential, paired devices, memory rows, revisions and jobs unchanged. Never
select an arbitrary first row when multiple owners exist. Re-audit this mapping
if the API credential/account is later migrated. Missing configuration fails
only memory-library tools; other tools retain their existing behavior.

Do not paste credentials in chat, commit or log them, or use the MCP Bearer token
as the app credential. Preserve the existing MCP Bearer by default. If its
replacement is explicitly authorized, back up D1 first, store the new credential
in a protected local configuration file, replace only `access_token_hash`, and
update external clients. Do not reset app pairing or overwrite VAPID secrets.
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are needed for Web Push.

Checks:

```
node --experimental-strip-types tools/test-mcp-diary.mjs
npx wrangler deploy --dry-run --config mcp-server/wrangler.jsonc
```

After authorized deployment, verify `/health`, authenticated initialize and
`tools/list`, confirm `list_notes` and `save_note` are absent, then read existing
diary/memory through the client. Refresh its tool catalog. Do not send test
notifications or create sample private entries without an explicit test request.

Current storage limitation: legacy document tools use read-modify-write JSON;
concurrent app/MCP writes can conflict. MCP diary writes check for changes since
read and reject a stale write; other writers still need their own concurrency
controls. Diary append is not a retry-idempotency
mechanism. The memory library retains its existing deduplication behavior.
