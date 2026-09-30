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

The terminal screen now returns up to 1,000 lines of real tmux scrollback, bounded
at 200,000 characters. It cannot recover lines already discarded by tmux. The
native Chat history tab pages the existing saved conversation for earlier messages;
it does not replay them into the CLI or create a different Codex thread.
