# Memory retrieval and reviewed experiences

## Current release boundary

External embedding is **disabled by default**, and the owner explicitly chose to keep it disabled. No embedding model or paid dependency is selected. Production continues to use keyword retrieval plus standing preferences. Mock-vector tests verify transport and filtering, **not semantic quality**. Do not enable it merely because tests pass.

Audit on 2026-10-03 found that the host already called the episode keyword search before the first model request, but only passed a DB binding. The shared database had no embedding rows or source-evidence detail records; the two requested gift/song cases were not saved episodes. Standing preferences alone are not evidence of episode recall.

## Request path

1. Native Chat submits current text and up to six completed user/assistant messages, excluding wake, activity, failed and streaming records.
2. `/api/memory/context` searches the current query (750 characters). For explicit references/follow-ups, it also searches the query with the last two user messages (180 characters each). A new unrelated question does not inherit the prior topic.
3. Standing preferences/agreements are selected independently. Episode candidates use keyword matches and, only when enabled, cosine similarity against a versioned index. Semantic minimum is 0.65; final score is the stronger lexical/semantic score, contextual query weighted 0.9; automatic episode selection requires at least 0.35.
4. Select at most two episodes, enforce review/withdrawal/current-version filters, deduplicate roots, respect feedback and a 30-minute cooldown (explicit follow-up bypasses it).
5. Revalidate selected records. The exact same compact objects form the request and delivery ledger. Total <= 4,000 UTF-16 units and 6,000 UTF-8 bytes, standing portion <= 3,200 / 4,500. Episode summaries <=240 characters; preferences <=180 and are never silently cut mid-condition. Oversized preferences require a stored concise summary and otherwise generate an omission warning.
6. Supply untrusted `additionalContext` only to this request. The previously verified VPS runtime keeps it out of normal history. Empty/failing recall sends an empty context object, clearing previous volatile context. A receipt is acknowledged only after a turn ID is accepted.

Diagnostics store queries, selected/rejected candidates, scores, current IDs/versions/kinds, elapsed time, mode and warnings. `tokenCountKind=utf8_byte_upper_bound` is deliberately a conservative byte-based token ceiling, **not an exact model tokenizer count**. Production model tokenizer accounting remains a limitation. Candidate diagnostics cover retrieved top candidates, not every nonmatching database row. A DB-wide outage may also prevent storing its own failure record; chat still continues.

## Sources and candidates

`remember_vesper_memory` now requires literal verified message evidence for episodes and proposes a pending candidate. Existing distillation remains optional and uses its existing configuration; this release adds no model calls or credentials. Routine exchanges are excluded by its existing prompt. The user can also propose from Chat's remember button.

Candidates are owner-scoped, deduplicated by source-message identities, editable before acceptance, and excluded from search. Acceptance rechecks literal quotes and atomically writes the memory/version metadata and accepted status. Concurrent edits/rejection abort the write. Evidence references are immutable when editing an interpretation. Occurred dates remain null unless explicitly supplied, separate from message/recorded timestamps. Details support participants and a separately labeled interpretation. Human review is necessary: literal quotation matching does not prove an interpretation is true.

iOS Chat and Memory expose actual delivered records, source navigation, original/version/correction views, irrelevant feedback and candidate review. The standalone Memory website retains its existing versioned-record UI; pending Vesper candidates are reviewed in Vesper, not a new public website endpoint.

## Optional vector interface (do not enable without approval)

Set these only after approval of data flow/cost and real evaluation:
- `EMBEDDING_ENABLED=true`
- `EMBEDDING_URL`: fixed HTTPS OpenAI-compatible embeddings endpoint
- `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_INDEX_VERSION`
- `EMBEDDING_API_KEY`: secret, if required

No defaults imply permission. Both existing Workers must use the same tuple. Text sent would be memory type/date/title/summary/body (bounded to 16,000 UTF-8 bytes), plus retrieval queries including limited recent context. Original texts and sources stay in D1; vectors are only indexes.

Background jobs reconcile all active rows after writes/recalls and on the memory Worker's existing scheduled maintenance. No duplicate timer is created. Up to eight leased jobs run per invocation; failures retry after five minutes. Retrieval embeds only queries, with a 1.5-second network timeout, and falls back to keywords. Model/endpoint/dimension/index-version form the index identity; change the tuple to rebuild asynchronously. Withdrawn/reviewed/changed details invalidate vectors. Concurrent metadata edits cannot insert a stale vector. Old indexes are retained for deliberate maintenance rather than deleting user records.

For the current small library D1 stores vectors and the Worker computes cosine similarity. This scans the current index and is not intended for a large multi-tenant corpus. Pending rebuilds may require multiple invocations. No local model was installed on the nearly full, memory-constrained VPS.

## Validation

- `npm run test:memory`: isolated SQLite fixtures, disabled => zero fetches, index build/rebuild, unrelated rejection, nonfacts, cooldown, current versions, source review, rejection race, transport and exact receipts.
- Memory `npm run check` and local browser acceptance: existing site/MCP behavior and persistence.
- Native Xcode test/build: related memory entry, existing app regression suite; device interaction still needs validation.
- Real gift/song cases: original source IDs can be located, but require review/acceptance before using them as authoritative test fixtures. With embeddings disabled, paraphrase semantic retrieval and a real model's independent answers remain **not validated**. Never label those mock tests as real case acceptance.
