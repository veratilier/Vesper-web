# Vesper

Vesper is a mobile-first personal companion PWA. `main` is the source of truth:
Cloudflare serves the built app and API directly on `vesper.r-vera.com`; there is
no Sites intermediary.

## Entry points

- `static-index.html` / `static-entry.tsx` — GitHub Pages entry point
- `app/page.tsx` — the shared React UI
- `app/api/state/route.ts` — D1-backed application state API
- `app/api/media/route.ts` — media upload API
- `public/manifest.webmanifest` — PWA manifest
- `app/api/codex/route.ts` — authenticated WebSocket proxy for the VPS Codex app-server
- `wrangler.production.jsonc` — API Worker deployment

`npm run build` produces the Cloudflare Worker and client assets in `dist/`.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
npm run build:pages
```

## Deployment

Push `main` (or run the commands below) to update the live domain directly:

```bash
npm run build
npx wrangler d1 execute vesper-db --remote --file migrations/0001_vesper_documents.sql
npx wrangler deploy --config wrangler.production.jsonc --keep-vars
```

PWA: <https://vesper.r-vera.com>

API: <https://api.vesper.r-vera.com>

## One Codex app-server connection

The chat client uses the official bidirectional JSON-RPC app-server protocol.
It does not ask for an API key, MCP URL, CyberBoss endpoint, or provider
selector. Run Codex on the VPS and keep its ChatGPT login there:

```bash
codex login --device-auth
codex app-server --listen ws://127.0.0.1:4500
```

Put the public `wss://…` URL in Vesper → Settings → Codex Server. If the VPS
is behind the Vesper Worker, set these Worker secrets instead and leave the URL
blank in the app:

```bash
npx wrangler secret put CODEX_APP_SERVER_URL --config wrangler.production.jsonc
npx wrangler secret put CODEX_APP_SERVER_TOKEN --config wrangler.production.jsonc
```

The browser obtains the dynamic-tool catalog from `/api/codex/tools`, but the
handlers run on the authenticated Vesper Worker and persist through D1. Codex
calls them with `item/tool/call`; the client forwards the call to the server
bridge and returns an `inputText` result to the same app-server turn. The
current bridge exposes `read_vesper_state`, `search_vesper_state`, and
`write_vesper_state`.

The chat renderer uses a strict item whitelist: only assistant message items
with text content become bubbles. Reasoning summaries, tool calls, shell
commands, tool output, system/developer events, and unknown item types are
kept out of the transcript; unknown events are recorded only as redacted
diagnostic metadata. History is normalized with the same filter when a thread
is resumed.
Images and audio are sent as inline data URLs, videos contribute a representative
frame, and text/JSON/HTML files are included as text. Other files are uploaded
to the existing media bucket and shown in the transcript.

## Retired Notes feature

The standalone Notes and Sketch UI and agent tools have been removed. Existing documents and Sketch records are retained for backups and read-only compatibility; they are not migrated or deleted. Journals and book annotations remain available. Cached `write_vesper_state(kind=note)` and old Sketch write requests fail without writing data.
