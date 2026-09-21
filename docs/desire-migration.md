# Independent Desire storage — supersedes the shared-database plan

Vera clarified on 2026-09-09 that the official Rowan connection and the Vesper frontend must have separate Desire data.

## Routing

- Official Rowan and its existing hourly automation continue using the original `desire.r-vera.com` MCP and its `rowan-desire` D1 database. Keep that service, its state/history and subscriptions intact.
- The Vesper page, built-in frontend AI tools and Vesper MCP Desire tools use only Vesper's existing `DB` binding: `vesper-db`, database ID `00f8c1ca-f8a3-47d8-9f08-1fec87ec9f4a`.
- The API and MCP production configs remove the original `DESIRE_DB` and `DESIRE_LEGACY_KV` bindings. The code never falls back to them, even if stale dashboard bindings remain.
- There is no synchronization, dual write, historical import, or copying official Rowan's current values. Community activity notes still belong in Atlas.

## Independent data

`lib/desire/storage.ts` maps the unchanged engine's SQL to dedicated `vesper_desire_state` and `vesper_desire_history` tables. Push metadata is kept in `vesper_desire_kv` in the same Vesper D1; no original KV is used. Existing unrelated Vesper tables are preserved.

On first access, idempotent schema creation and INSERT OR IGNORE initialize the Vesper owner `vesper` with the engine defaults: longing 18, tenderness 64, playfulness 28, intensity 22, attachment 41, possessiveness 20, style quiet. Its history is empty and real-interaction/expression timestamps are null. Initialization never creates a user interaction and never overwrites existing Vesper Desire state.

Each frontend AI encounter updates only these independent tables. Provenance, stable request IDs, absence cursors, original scoring and replay protections are preserved. Notification delivery uses Vesper subscriptions and VAPID settings.

## Deploy using computer-side Cloudflare access

This cloud workspace cannot deploy without Cloudflare credentials. Until deployment the currently deployed shared-database version remains active.

1. Pull latest `sites-release-ca9c513`; preserve dashboard variables and existing secrets. Back up Vesper D1 using existing operational procedures. No original Desire data migration is needed.
2. Run:
   ```sh
   npm ci
   npm run test:desire
   npm run build
   npx wrangler deploy --config mcp-server/wrangler.jsonc --keep-vars
   npx wrangler deploy --config wrangler.production.jsonc --keep-vars
   ```
3. Verify both deployed Workers use only the `vesper-db` DB binding for Desire. No migration SQL needs to be applied manually: the isolated tables initialize on first authorized access.
4. Read authenticated Vesper status/history: the new independent database begins with defaults and empty history. Separately read the original domain's status/history and verify its existing data is unchanged. An unauthorized request must still return 401.
5. During a genuine frontend interaction, verify Vesper changes independently and the original domain does not. Do not submit a fabricated interaction to test scoring. Keep the official hourly task on the original connection; do not follow the old instruction to switch it to Vesper.

## Verification and rollback

Local verification: 34/34 tests pass, web production build succeeds, MCP Worker dry-run succeeds with only the Vesper DB binding, and TypeScript reports only the five existing diagnostics.

The relevant original regressions plus separation tests run with `npm run test:desire`. Tests verify new defaults, no original-binding fallback, untouched original-named sentinel tables, idempotent requests, provenance, repeat initialization, D1 push metadata and notification navigation. The full project TypeScript check has five known pre-existing music/test-import diagnostics; no new Desire errors are acceptable.

Avoid rolling back to the previous shared-database release: it would reconnect Vesper to official Rowan's data. Preserve the independent DB-only routing in any corrective rollback. No production state, history or database has been deleted by this change.

## Vesper AI routing audit (2026-09-09)

The split database release alone did not remove alternate AI tools. Production
execution records showed `asdk_app_6a92be9d9e1c819197f58017d0e2b985.desire_status`
returning the official state, while Vesper D1 held quiet/18/64 and empty history.
Vesper Settings also retained an enabled external `desire.r-vera.com` connection.

Vesper now disables that official app in **thread-scoped** start/resume config
(with both connector ID forms); it does not change the official app globally.
New frontend instructions distinguish old official results from native state.
The generic MCP catalog excludes reserved Desire tools, and the outbound gateway
rejects them before reading credentials or making network requests. For old
threads, generic `desire_status`/`desire_history` requests route through the same
owner-checked native executor. Legacy writes fail explicitly instead of silently
moving an intended official write to Vesper. Saved connections and histories stay
intact. Reload Vesper to apply the session settings; old threads lacking native
write tools can create a new conversation without deleting the original.

Native route: browser dynamic tool → POST `/api/codex/tools` →
`executeCodexTool` → `executeDesire` → the three `vesper_desire_*` tables in
`vesper-db`. Vesper MCP and `/api/desire` use the same executor/storage.
Regression checks: `node tools/test-desire-routing.mjs`,
`node tools/test-codex-thread-lifecycle.mjs`, `npm run test:desire`.
