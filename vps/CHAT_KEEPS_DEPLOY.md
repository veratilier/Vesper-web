# Vesper chat screenshots and keeps

This change uses the existing private history service, Worker media bucket and saved photo album. On the VPS, Playwright launches Google Chrome and opens the real Vesper webpage in read-only capture mode. Existing chat components, CSS, saved Web appearance and avatars render selected original messages in Rowan's perspective. It works without an open iPhone. No chat/image deletion or automatic 30-photo expiry is introduced.

## Existing VPS

Update `codex_history_server.py`, `vesper_chat_screenshot.py`, `vesper_wake_runner.py`, `vesper_wake_store.py`, `vesper_wake_tools.py` together from the checked main commit into the existing `/home/ubuntu/vesper-codex-history` checkout. Preserve its database, token and service configuration.

Deploy the matching Web commit before restarting the VPS renderer. The browser loads `https://vesper.r-vera.com/?capture=agent&conversation=…&message=…` and the authenticated original-history read endpoint. Appearance and avatars come from the existing Web state API. Native device-local palettes are not synchronized to Web automatically.

As the existing service user, install the renderer:

```sh
python3 -m pip install --user playwright==1.58.0
python3 -m playwright install chrome
```

Install Chrome system dependencies with the administrator's existing deployment procedure (`python3 -m playwright install-deps chrome`), and `fonts-noto-cjk` if absent. Restart the existing `vesper-codex-history` service. It continues to use the same bearer token. No new port or public renderer is introduced. The renderer uses an isolated subprocess with a 40-second deadline and uses an ephemeral Chrome context with only the fixed Vesper origins allowed. Credentials are attached only to the precise state/history reads, never browser storage or URLs. Non-GET requests, WebSockets, service workers and redirects are blocked. A failed or outdated Web capture view produces no image; there is no HTML-rendering fallback.

## Worker and app

Build and deploy the checked Web main commit to the existing `vesper-api` Worker with `wrangler.production.jsonc --keep-vars`. The existing `VESPER_APP_TOKEN` must match the history token. Photo provenance initializes additively on first album access. Photos remain in R2, not database base64 fields. Rebuild the native App from the matching iOS change. Existing album search/send remain available during the upgrade; screenshot requests report unavailable until the VPS renderer is installed.

## Acceptance

Search a distinctive phrase with `chat_search_messages`. Pass its original conversation ID and exact chronological message IDs to `chat_capture_messages`, with `save:true`, a category and evaluation. Verify: a JPEG arrives in the current chat, Rowan is right/Vera left, Chinese text and original images load, original text is not replaced, and the same image appears in the saved album. Tap Original conversation in both clients and verify the source message. Search the album and use `album_send_photos` to send the kept image again. Wrong, private, deleted, cross-conversation and reordered IDs must fail before rendering. Renderer failure must not be reported as delivery.

The autonomous wake tool ceiling now supports search/capture/save. Existing owner-controlled tool and photo-message permissions still apply; this release does not silently enable new unattended permissions or change Desire values/schedules.
