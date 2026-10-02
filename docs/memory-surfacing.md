# Memory foundations and automatic surfacing

Scope: backend + non-visual web/native chat transport. Memory page and chat disclosure UI are intentionally deferred at Vera's request (2026-10-02). Existing page layout, styles and tabs are unchanged.

## Storage and compatibility

- Original `memories` records and their version chains stay in SHARED_MEMORY_DB, the existing owner memory-db. No export/import/reset or category rewrite runs automatically.
- Additive, idempotent `memory_details`, `memory_withdrawals`, `memory_reviews` tables attach titles/summaries/original quotes, withdrawal audit, and pending correction review. Shared engine copies in Vesper and independent Memory must be released together. Vesper DB keeps the delivery/feedback ledger; it is not another copy of the memory library.
- `episode`: a concrete shared event. `preference` and `agreement`: durable stated preferences/requirements. `reflection`: subjective. `dream`: fiction. Automatic factual recall excludes both latter kinds.
- Missing event dates remain null. A quote's chat timestamp and the memory's recorded_at must never be substituted for an unknown event date.
- `/api/memories/:id/correct` supports category corrections with full original/version preservation. `/withdraw` requires a reason, keeps the original accessible, and deactivates current use. Correcting a superseded/withdrawn ID is rejected.
- `already changed` feedback creates a review flag on the specific version, excluding it from default list/search/automatic recall. A later corrected version can be used again. It never guesses a replacement fact.

## Writing and backfill

`remember_vesper_memory` requires original message references/quotes for new episodes. Every supplied quote is checked against the owner-scoped append-only evidence vault; invented quotes or unmirrored source messages fail without writing. Details include conversation/message IDs and original timestamps. Exact same source-message set and category deduplicates even if a retry paraphrases the memory body. One record per category and source-message set avoids overlapping-window diaries.

The optional existing distillation worker now writes shared memory, not the legacy database. It emits at most two meaningful records, allows an empty list, classifies all five kinds, and verifies quotes. It still requires the owner's configured MEMORY_MODEL_* service; this change adds no model provider, credentials or subscription. The same chat agent can write through the tools without a separate distillation model.

Historical remediation must inspect actual source chats and create corrections through the version API. No fabricated Oct 1 event is seeded. Production records have **not** been audited or reclassified as part of the code change: database access was unavailable. Missing original chat evidence must be synced/read before backfill. Independent Memory's owner-authorized `memory_save` accepts user-supplied source records; it does not claim those quotes were verified against Vesper's evidence vault.

## Prepare → accepted receipt

Authenticated `/api/memory/context`:

- POST `{query, conversationId, messageId, recent:[{role,content}]}` prepares an immutable delivery with `context`, exact `memories`, `deliveryId`, and warnings. Both clients call it before thread/start or thread/resume and turn/start. Voice chat transport receives standing preferences too.
- Standing active preferences/agreements are selected without a semantic query. Related episodes use current text plus up to four recent turns, weighted toward the current message. At most three episodes; root dedupe; 30-minute per-conversation episode cooldown. Current implementation uses the existing lexical engine, not an unconfigured embedding API.
- Entire JSON objects fit an **18,000-character** budget. This is not a token count. Oversized standing preference sets return `standing_preferences_exceed_character_budget`; no guarantee is made that an unlimited number of preferences fits. Normal short preferences repeat each turn, unaffected by episode cooldown.
- POST `{action:'acknowledge', deliveryId, conversationId, messageId, turnId}` only after app-server accepts turn/start. An acknowledgment means the client supplied the context; it cannot prove that the model used it. An ambiguous/failed send or lost acknowledgment is not displayed as delivered. Prepared snapshots are invisible to recentRecall and expire after one day; accepted snapshots remain an audit record.
- GET with optional conversationId returns latest 40 acknowledged snapshots for the future UI.
- POST `{action:'feedback',deliveryId,memoryId,kind:'irrelevant'|'changed'}` validates membership in an acknowledged snapshot. Irrelevant suppresses the root in that conversation for 30 minutes; changed suspends the version pending correction globally.
- Retrieval failure returns an empty unavailable batch and does not block chat. Client request deadline is four seconds. Mutation failure does not claim success. Legacy clients without IDs use the old response for compatibility, with no invented delivery receipt.

## Transport limit: not fully ephemeral

The current published app-server `TurnStartParams` has no per-turn developer-instruction override. Clients therefore retain the existing thread/start or thread/resume developerInstructions channel and **replace** the bounded current batch before each turn. No memory is appended to Vesper user/assistant message content or `turn/start.input`.

This is not proof that Codex's internal rollout, compaction or fork history contains no previous developer context. True request-only injection needs a provider/request hook on the VPS and testing on its exact deployed app-server build. The batch warns that previous batches/versions are historical. Until that host hook is implemented, don't advertise strict zero-retention or claim old hidden context has been purged. The ledger records supplied context only, not inaccessible model reasoning.

## Verification and release

- `npm run test:memory`: isolated fictitious SQLite fixtures cover exact original verification, owner isolation, shared writes, corrections, withdrawal, fixed preferences, episodes, recent context, cooldown, snapshot receipts, feedback/correction, nonfacts, no match and null dates.
- `npx tsc --noEmit`, `npm run build`, worker dry-run.
- Independent Memory: `npm run typecheck`, `node --import tsx --test test/*.test.ts`, `npm run build`.
- Native changes contain no UI code. iOS CI must build/test on macOS; this Linux workspace cannot run Xcode or prove on-device delivery.
- Release independent Memory and Vesper Workers together from checked main commits; preserve existing variables/bindings. Rebuild/install the iOS app to use the new request/receipt flow. Existing deployment credentials are required; code/PR completion is not production deployment.

Reference: Latent-memory's host-hook design was consulted; no reference-project implementation was copied.
