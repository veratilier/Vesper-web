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

- POST `{query, conversationId, messageId, recent:[{role,content}]}` prepares an immutable delivery with `context`, exact `memories`, `deliveryId`, and warnings. Both clients call it before turn/start, and pass additionalContext on that same turn. No recalled content is passed through thread/resume instructions. Voice chat transport receives standing preferences too.
- Standing active preferences/agreements are selected without a semantic query. Related episodes use current text plus up to four recent turns, weighted toward the current message. At most two episodes; root dedupe; 30-minute per-conversation episode cooldown. Current implementation uses the existing lexical engine, not an unconfigured embedding API.
- The entire serialized batch, including header and metadata, fits **4,000 JavaScript string characters and 6,000 UTF-8 bytes** (previously 18,000 characters). These are hard payload limits, not tokenizer estimates. Standing preferences reserve at most 2,200 characters / 3,300 bytes, leaving space for up to two related episodes. No extra summarization model call is made.
- Preferences/agreements use whitespace-compacted original text up to 180 characters; a longer original uses its existing `details.summary` only if that complete summary fits 180 characters. Otherwise it is omitted with `standing_preferences_omitted_for_compact_budget`. Never cut off a preference's condition, negation or exception. Short preferences still repeat per turn, unaffected by episode cooldown.
- Episodes use the existing summary up to 240 characters, or an explicitly labelled extractive excerpt when no summary exists or the summary is too long. `body_format` distinguishes `compact_original`, `summary`, and `excerpt`; none of these is a new memory version. A summary/excerpt is not a verbatim quote or complete agreement.
- Each injected item keeps its ID, root/version, type, event date (including null), recorded date, source and exact source URL. At most two evidence references retain conversation/message IDs and original timestamps; quote bodies, extra references, titles and version chains are omitted from automatic context. Oversized metadata causes the whole item to be skipped, never a broken URL/ID or truncated JSON object. Retrieve exact originals/full references with the existing Memory MCP `memory_get({id})`, or the existing shared-memory item API; source chat references can be looked up separately.
- `context`, response `memories`, and persisted delivery `memories` are built from the same compact objects. The ledger describes precisely the injected summaries, not unsent full originals. The existing 768-byte fragments reconstruct that context losslessly. Already acknowledged snapshots remain immutable on retry (including older-format batches); the new limits apply to newly prepared batches. Original memory records and details are not modified.
- POST `{action:'acknowledge', deliveryId, conversationId, messageId, turnId}` only after app-server accepts turn/start. An acknowledgment means the client supplied the context; it cannot prove that the model used it. An ambiguous/failed send or lost acknowledgment is not displayed as delivered. Prepared snapshots are invisible to recentRecall and expire after one day; accepted snapshots remain an audit record.
- GET with optional conversationId returns latest 40 acknowledged snapshots for the future UI.
- POST `{action:'feedback',deliveryId,memoryId,kind:'irrelevant'|'changed'}` validates membership in an acknowledged snapshot. Irrelevant suppresses the root in that conversation for 30 minutes; changed suspends the version pending correction globally.
- Retrieval failure returns an empty unavailable batch and does not block chat. Client request deadline is four seconds. Mutation failure does not claim success. Legacy clients without IDs use the old response for compatibility, with no invented delivery receipt.

## Request-scoped host transport

The stock Codex 0.159.3 host appends changed `turn/start.additionalContext` fragments to conversation history. An empty/replacement map does not remove past fragments. `thread/resume` instructions are also unsuitable: loaded threads may ignore overrides.

Vesper therefore pins its app-server to upstream tag `rust-v0.159.3`, commit `01fc69f4026735edfdf6789820549727a4867b11`, with the small patch in `vps/codex-recall/request-scoped.patch`. Only the reserved `vesper_memory_000`–`vesper_memory_999` namespace changes lifetime. These entries remain in the in-memory current-input store, are rendered as untrusted context into each generation request, and are never appended to rollout history. The next accepted input replaces/clears the map. History compaction does not read this request-only store; a fresh resume/fork reconstructs history without those snippets. Other additional-context namespaces, chat history, credentials, tools and wake scheduling retain their existing behavior. Actual assistant replies may naturally refer to recalled information; those replies remain normal conversation history. This is not a promise to erase information from assistant prose.

`lib/memory-transport.ts` retains the existing API: keyed untrusted fragments of at most 768 UTF-8 bytes reconstruct the compact prepared batch losslessly. No client interface change beyond already merged iOS PR #44 is required. A receipt still proves accepted input, not that the model relied on a memory.

**Gate:** only `VESPER_MEMORY_CONTEXT_TRANSPORT=request-scoped-v2` enables new-client recall. The earlier `additional-context-v1` flag is deliberately rejected. Set the new flag only after the deployed patched binary passes `vps/codex-recall/acceptance.py`. Disable the Worker gate before rolling back the app-server to stock Codex. Upgrading the global terminal/wake Codex executable does not upgrade this pinned app-server: rebuild/revalidate its patch separately.

The runtime is built on GitHub Actions, not the low-memory VPS. The workflow pins source, verifies upstream V8 checksums, refuses external dependency drift, and publishes the runtime/source/patch hashes. Deploy by changing only the existing app-server launcher executable, retaining all its arguments, user, working directory, token file and service. Keep the previous executable for rollback; do not replace the global Codex binary used by terminal/wake.

## Verification and release

- `npm run test:memory`: isolated fictitious SQLite fixtures cover exact original verification, owner isolation, shared writes, corrections, withdrawal, fixed preferences, episodes, recent context, cooldown, snapshot receipts, feedback/correction, nonfacts, no match and null dates.
- `npx tsc --noEmit`, `npm run build`, worker dry-run.
- Independent Memory: `npm run typecheck`, `node --import tsx --test test/*.test.ts`, `npm run build`.
- Native changes contain no UI code. Build/test the existing Mac workspace while preserving its local changes/signing; physical-device delivery must be reported separately.
- After host acceptance, release the Vesper Worker from its checked main commit; preserve existing variables/bindings. Rebuild/install the iOS app to use the new request/receipt flow. Existing deployment credentials are required; code/PR completion is not production deployment.

Reference: Latent-memory's host-hook design was consulted; no reference-project implementation was copied.

### Host acceptance

The baseline `tools/check-memory-host.py` captured A, then A+B, then A+B on stock 0.159.3. The expanded `vps/codex-recall/acceptance.py` runs isolated fictitious persistent threads against a loopback mock provider, with temporary CODEX_HOME and no production credentials. It checks replacement, empty batches, lossless Unicode/multiple fragments, repeated identical batches, tool continuation, thread isolation, history compaction, fork, process restart/resume, and absence of snippet bodies in rollout files. It prints only fixture counts and booleans. Deployment requires all checks to pass against the exact release binary; passing compilation alone is insufficient.
