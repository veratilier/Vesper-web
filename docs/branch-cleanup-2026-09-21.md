# Remote branch semantic audit — 2026-09-21

Baseline: `8752f52e83b28fde55a1c357e950494f0a6c4133` (`main`). This audit does not merge old branches, deploy code, or access D1.

The remotely readable annotated tag `release-backup-2026-09-21` resolves to `938f65b90b03f0329caf594088e354c1dc3075e9`, the complete release tip. Before deletion, every ancestry-contained branch was checked with `git merge-base --is-ancestor` against this baseline. The initial 43 branch names and exact tips are retained in the local cleanup inventory. 37 contained branches plus `fix/restore-native-desire-api` were deleted in the first batch. The latter's sole unique commit `606f37f` is marked `-` by `git cherry main`, confirming patch equivalence.

## claude/bug-check-o367gu — extract two missing guards; retire old branch

Unique commits: `81ecc22`, `93c8a62`, `cca4a11`, `ac95e1c`, `44b9fb3`, `a1f9701`, `4c14ac4`, `bc2213d`.

- **Still useful, minimal extraction from `81ecc22`:** reject unauthenticated Push POST before schema setup/body parsing and send existing device credentials from the settings push test. No change to VAPID public configuration GET, permissions, or database schema.
- **Still useful, minimal adaptation from `81ecc22`:** settle active chat state on explicit failed/aborted events, active socket closure and acknowledged cancellation; restore the socket error handler after handshake. Keep current main's normal completion processing for tool execution details, stickers, Wake and memory. Ignore stale turn IDs, handle duplicate termination idempotently, and do not resurrect a failed turn when its start RPC returns late.
- **Already fixed:** `/api/codex/tools` and `/api/music/sync` use an actual `Headers` object and `.set`, rather than spreading `Headers`. Main already rejects pending RPCs on socket close and handles failed/interrupted statuses in `turn/completed`; retain those existing implementations.
- **Superseded music backend (`cca4a11`, `ac95e1c`, `a1f9701`, `4c14ac4`, `bc2213d`):** main has authenticated `music/library` resolve plus cookie forwarding and the current playback/track library. Do not bring back the unauthenticated audio proxy which reads a shared stored MUSIC_U cookie or the obsolete `musicAuth` server storage path. This is a semantic decision, not a claim of patch identity or live music playback verification.
- **Superseded layout (`93c8a62`, `44b9fb3` and music layout parts of subsequent commits):** current `app/music.css` and `ListeningRoom` already implement avatars, queue bottom sheet, scrolling and safe-area handling. Current `app/chat.css` owns composer layout. Old global CSS overrides and removal of lyrics would overwrite the accepted release UI and are not retained.

Retained work is isolated on `fix/audited-push-chat-guards` from the baseline; the historical branch is unnecessary once that PR is published. It is not merged wholesale.

## codex-approval-fix-20260905 — fully superseded; delete

Unique commit `4429074` has exactly the same complete Git tree as main ancestor `d7f18b9` (`git diff --quiet d7f18b9 4429074` succeeds). This covers the unusually broad commit's MCP, memory, music, CSS and History changes, not just its title. Current approval helpers retain command/file/permission choices, duplicate request handling and disconnect cleanup; later changes translate UI labels to English. Approval regression tests are already present. No extraction is warranted.

## fix/date-input-width — preserved and refined; delete

Unique commit `c346146` introduced bounded `.profile-field` and native date/time input widths, minimum inline size, Safari internal value and editing rules. Those bounds remain in `app/globals.css`; main ancestor `b0e5194` / PR #28 additionally centers native values with inline-flex/flex. Reapplying the original block would undo that alignment. No extraction is warranted.

## sites-deploy — superseded; delete

Unique commit `c0a0121`'s viewport/root-launch change is represented by main ancestor `eb7506d`, followed by `ca9c513`, `86de07a` and subsequent native layout refinements. Both current manifests use root `start_url` and root scope. The current layout and service worker use newer manifest/icon/cache versions. Do not restore old v9 caches or the old global viewport overrides. No extraction is warranted; no Sites deployment is performed.

## Verification and boundary

The new guard regression executes the actual component teardown and terminal dispatch code with isolated state: failure, abort, disconnect, cancellation, stale IDs and duplicate events. The actual Push route is bundled with isolated dependencies: unpaired malformed requests return 401 before database/schema/body work; paired requests reach existing validation. No test calls production APIs or D1.

The extracted PR remains unmerged for review; formal main and production remain at the baseline. Final remaining remote branches and tag are recorded in `outputs/branch-cleanup-result-2026-09-21.md` locally.
