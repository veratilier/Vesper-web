# Restore the iOS Desire read API

The iOS client calls GET /api/desire and GET /api/desire?view=history&limit=20.
Main lacked these routes even though sites-release-ca9c513 contains the independent
Vesper implementation. This patch restores that implementation from commit
938f65b90b03f0329caf594088e354c1dc3075e9, without replacing the web UI or deployment configuration.

Storage remains the existing DB binding (vesper-db), owner `vesper`, tables
vesper_desire_state, vesper_desire_history, and vesper_desire_kv. The API requires
the existing owner row before invoking the engine; missing storage never triggers
fresh default values. No external Desire connector or original Rowan database is used.
Existing numeric values, timestamps, and history are preserved. The HTTP response
retains the iOS data envelope and device-token authentication.

Validation: npm run test:desire and npm run build. The API fixture exercises
401, unsupported views, status/history envelopes, no-store, and missing-state
protection. Engine fixtures check isolation, replay safety, and preserved state.

Deployment requires existing Cloudflare access. Check the active production
release against this scoped patch before deploying; do not replace a newer
production release with an older branch. Verify the DB binding and existing
vesper row using read-only queries. Build and deploy the existing vesper-api
Worker with wrangler.production.jsonc and --keep-vars. Do not deploy fixture SQL,
reset any database, or change DNS. Verify unauthenticated 401 and authenticated
status/history against existing D1 values and the iOS screen. GitHub Pages
publishing does not deploy this API. This patch restores the read API only;
it does not register new AI tools or change their write permissions.
