# Shared Memory access through Vesper

The native Memory screen calls `/api/shared-memory` using the existing Vesper device token. The endpoint verifies `authorizeApp` before accessing `SHARED_MEMORY_DB`. There is no second login, client-side service secret, public memory endpoint, or bundled data snapshot.

`SHARED_MEMORY_DB` binds the existing `memory-db` database (94e8bf24-53d1-4199-8483-e908c10c571b). Preserve the existing Vesper `DB` binding. Do not initialize, migrate, clear, or import data in the shared database. Independent Memory web/MCP and Vesper access the same records and correction chains. Legacy Vesper records remain in the old UI and database.

The vendored shared-memory-engine is copied from veratilier/memory src/memory.ts with only local SHA-256 and environment/type adapters. Track future Memory schema/engine changes together. This endpoint currently uses keyword search; optional external embedding configuration on the independent service is not automatically inherited.

Supported authenticated routes: list, search, get, save, correct. It does not proxy connections/password/token administration. The existing chat-side memory tools remain unchanged.

## Deployment

Deploy the existing `vesper-api` Worker from the current Vesper-web main branch using its established Cloudflare account. After installing dependencies and a successful `npm run build`, use the existing `wrangler.production.jsonc`, preserving dashboard variables (e.g. `npx wrangler deploy --config wrangler.production.jsonc --keep-vars`). This does not require issuing a new Memory password or token. The GitHub Pages workflow does not deploy this API Worker.

The server update must be live before installing the updated native app. An unbound server returns 503 with a setup message, not an empty successful library. Verify with a paired device: list an existing record, save a disposable test record, check it in the independent library, correct it there and read both versions in Vesper. This authenticated production/device verification has not been performed here.

## Local validation

The integration test uses an in-memory SQLite database and fictitious text only. Run `npx --yes --package tsx tsx tools/test-shared-memory.ts` (Node 24). It covers authorization before database access, allowed routes, save deduplication, search, shared correction chains, stale conflicts, nonfact exclusion, and payload bounds.
