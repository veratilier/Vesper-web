# Vesper Web mainline reconciliation — 2026-09-21

## Fixed inputs and preservation

- Base: `sites-release-ca9c513` at `938f65b90b03f0329caf594088e354c1dc3075e9` (includes `09c4643`).
- Audited main: `afe840ef38b922f29c5b9a51339ce5beb29819f2`.
- Common ancestor: `58c7c9c3f6fccb5221736db036e865452804a92d`; main has 9 unique commits, release has 100.
- Working branch was created directly from release: `reconcile/web-mainline`.
- The release card homepage, Desire flower, Usage, Notes, Reminders, Music, Chat, Journal, Watch, native shell and Wake features are retained. No main homepage replacement.
- No D1 migrations/imports/exports/deletions. `DB` remains vesper-db (`00f8c1ca-f8a3-47d8-9f08-1fec87ec9f4a`); `SHARED_MEMORY_DB` is the existing memory-db (`94e8bf24-53d1-4199-8483-e908c10c571b`). IDs checked against Cloudflare's read-only database listing.

## Every main-only commit

| Commit | Decision | Evidence / integration |
| --- | --- | --- |
| `dce0ced` photo stack gestures | Skip duplicate | Release `6d3be94` has the gestures and settling animation, plus album detail support. Preserve release gallery. |
| `9ef96c9` history deletion | Adapt missing safeguards | Release `d137ee0`, `df6f839`, `938f65b` already implement permanent deletion, hashed tombstones, source cleanup and Wake cancellation. Preserve them; port HTTP error handling and transactional/idempotent missing-parent message deletion. Do not introduce competing conversation_tombstones storage or run any purge. |
| `13dd8d0` shared Memory API | Cherry-pick (`ddd61db`) | Existing shared database binding, engine, authenticated handler, fixtures and API tests. |
| `ff85994` native OAuth | Skip overlapping/older implementation | Release `c656df8` and followups already implement fixed `com.rvera.vesper://mcp/oauth/callback`, validated native-state prefix, no-referrer and PKCE/state checks. Main's `native=1` / `vesper://` callback would regress the released native shell. |
| `e6063fb` history search/context | Adapt missing capability | Release `7a87bee` already has literal scoped search and rowid-stable paging with tool-noise filtering. Add `around` context and invalid-cursor rejection while retaining rowid ordering, existing response and limits. |
| `fbf740a` PR #37 Desire API | Selective port | Release Desire engine files are identical to main. Preserve engine/dependencies/UI. Add GET guard against missing binding/state, API regression tests and recovery notes. |
| `960bdb4` Desire tools | Selective port | Release already registers and dispatches all native tools with owner checks and legacy routing. Add missing-state guard and actual dispatcher integration test. |
| `5d21239` PR #38 shared tools | Cherry-pick (`2f46f05`) | remember/recall/manage, read/search state memory and context use shared binding. Move shared-tool dispatch before legacy schema initialization to avoid touching the old database. |
| `afe840e` PR #38 merge commit | No duplicate patch | Contains the already audited `5d21239` changes; preserve main ancestry in the reviewed PR integration. |

The two cherry-picks applied without textual conflicts. Semantic overlaps were resolved by the file/function decisions above, not whole-branch content merging.

## Additional integration fixes

- Web/PWA Memory now defaults to shared records with search, categories, pagination, exact record ID and version readback. Legacy Vesper memories remains accessible, with all old data and functions retained.
- Bump the tool catalog version so stale chats refresh their tool definitions; bump shell cache version for the release.
- Add an isolated full HTTP/tool integration check: authorized tool save → shared Memory list/detail → context/recall returns the same ID, with legacy DB access forbidden and missing binding failing closed.
- Add temporary-database History tests for message context, search authorization, rollback, retry, tombstones and storage errors. No test uses live D1 or real Codex deletion.
- Repair stale Wake test expectations against release commits `6a87b1d` (English UI) and `10b0f68` (owner-visible notification ledger); continue asserting raw errors/results are excluded.
- Resolve pre-existing type-check failures in music response typing, playlist-intent track ID, Watch response typing, Capacitor KeyboardResize enum, and TS test import configuration. The playlist fix prevents an existing runtime access to missing `track.id` on an intent.
- Add a PR workflow covering type-checks, existing tests, isolated integration tests, both production builds and Worker dry-run.

## Validation scope

Local: Desire 36 tests; existing Codex tests; all `tools/test-*` checks via `node tools/test-reconcile.mjs`; service worker 5 tests; VPS isolated tests; `npx tsc --noEmit`; Worker production build; static Pages production build; Wrangler production dry-run with both D1 bindings.

Browser local checks: opening scene → release card homepage; shared and legacy Memory entry; Chat composer and History panel. Local preview is not paired, so its unavailable-data messages are expected and not a successful live API test.

Production verification must be recorded separately after merge/deploy. A build passing does not establish Desire, AI memory writes or browser readback on production. VPS code is included and tested, but deploying the Cloudflare Worker does not deploy the separate VPS History service.

## Ancestry integration conflict resolution

After the audited content commit `4a1e21a`, a normal no-commit merge of main was inspected to retain both histories. Nine conflict paths were resolved to that reviewed integration tree: `app/attachment-gallery.tsx`, `app/mcp/oauth/callback/route.ts`, `docs/shared-memory.md`, `lib/codex-tool-definitions.ts`, `lib/codex-tools.ts`, `package-lock.json`, `package.json`, `tests/desire/native.test.mjs`, and `vps/codex_history_server.py`.

This preserves the release's Capacitor dependencies, native notification tests and OAuth/gallery behavior, while keeping all selected backend fixes. Main's two old History test files were not added: they assert the superseded plaintext-tombstone design and are covered by `test_history_reconcile.py` plus release paging/deletion tests. The ancestry merge changes no product code relative to the audited integration commit.

Lint was also run: the repository reports 48 errors / 1544 warnings across existing and vendored code. This is not claimed as passing and is not used as a substitute for the successful type-check, regression tests and builds.
