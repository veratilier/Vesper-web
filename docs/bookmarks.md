# Shared picture-and-text bookmarks

The native Bookmarks page and Rowan use the same authenticated D1 records in
`vesper_bookmarks`. This is separate from chat Favorites. Existing chats,
documents, credentials, and wake scheduling remain in place.

- `GET /api/bookmarks?limit=30&before=…` reads newest-first pages.
- `POST /api/bookmarks` creates one card; stable `id` makes retries idempotent.
- `DELETE /api/bookmarks?id=…` removes only that account's card.
- `bookmark_list` and `bookmark_create` are registered in the shared Codex catalog.
  Wake's tool ceiling also includes them; the owner's saved permissions still apply.
- Reading Room cards provide `bookId` and an exact `quote`. The server verifies
  the quote and book title; displayed `text` may be a separate summary.
- `imageUrl` accepts public HTTPS URLs. `imageSource` retains attribution or the
  generated-image origin. Generation is not fabricated: use an available image
  tool, upload its output through the existing attachment tool, then use the real
  returned URL. With no image, the native page uses the bundled coast background.

Release the checked main commit using `wrangler.production.jsonc --keep-vars`.
On the existing VPS replace the scoped history/terminal/wake modules and restart
the history service that imports them. Preserve the existing wake database and
timer. Grant only the two new bookmark tools once for this owner-authorized
feature; do not reset other permissions or re-grant them on every startup.

Tests: `node tools/test-bookmarks.mjs`, `python3 -m unittest test_terminal
test_wake_tools test_wake_permissions test_history_paging` from `vps`, then the
production build. Production acceptance separately checks authenticated
tool → API readback → scoped test-card deletion and the actual VPS module hashes.

The terminal screen returns real tmux scrollback bounded at 200,000 characters.
Earlier recorded instructions, command outputs, file changes and tool statuses
are separately paged from this same Codex thread's original rollout inside the
Live terminal view. This does not execute old commands or create another runtime.
Lines that tmux discarded and that Codex never recorded cannot be reconstructed.

The history API now restores missing completed assistant items from that rollout
before returning a conversation. It uses stable item IDs, respects message and
conversation deletion markers, and preserves already-delivered saved content and
its timestamps. Only completed public items are read; hidden reasoning, developer
context and raw tool arguments are excluded. Source records are cached in bounded
memory and never copied into another permanent transcript file. Returning to the
foreground uses the existing same-thread reconnect and history read, so suspended
phones do not need to receive every completion event. No background keepalive or
new wake timer is required. Run `python3 -m unittest test_codex_records
test_terminal test_history_reconcile test_history_paging` from `vps`.
