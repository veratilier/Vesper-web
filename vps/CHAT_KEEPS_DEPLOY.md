# Vesper chat screenshots and keeps

This change uses the existing private history service, Worker media bucket and saved photo album. Screenshots are server-rendered original selected chat messages in Rowan's perspective. It works without an open iPhone. No chat/image deletion or automatic 30-photo expiry is introduced.

## Existing VPS

Update `codex_history_server.py`, `vesper_chat_screenshot.py`, `vesper_wake_runner.py`, `vesper_wake_store.py`, `vesper_wake_tools.py` together from the checked main commit into the existing `/home/ubuntu/vesper-codex-history` checkout. Preserve its database, token and service configuration.

Also copy `vps/screenshot-assets/` alongside `vesper_chat_screenshot.py`. It contains the existing Vesper default blue marble artwork used by the native App and Web. Screenshots use the native chat's transparent text layout, blue ink and CJK system-font fallback, with Rowan right and Vera left. The renderer uses this bundled default theme; it does not yet synchronize device-local black/white palette choices.

As the existing service user, install the renderer:

```sh
python3 -m pip install --user playwright==1.58.0
python3 -m playwright install chromium
```

Install Chromium system dependencies with the administrator's existing deployment procedure (`python3 -m playwright install-deps chromium`), and `fonts-noto-cjk` if absent. Restart the existing `vesper-codex-history` service. It continues to use the same bearer token. No new port or public renderer is introduced. The renderer uses an isolated subprocess with a 40-second deadline and permits only Vesper media image requests, with no redirects.

## Worker and app

Build and deploy the checked Web main commit to the existing `vesper-api` Worker with `wrangler.production.jsonc --keep-vars`. The existing `VESPER_APP_TOKEN` must match the history token. Photo provenance initializes additively on first album access. Photos remain in R2, not database base64 fields. Rebuild the native App from the matching iOS change. Existing album search/send remain available during the upgrade; screenshot requests report unavailable until the VPS renderer is installed.

## Acceptance

Search a distinctive phrase with `chat_search_messages`. Pass its original conversation ID and exact chronological message IDs to `chat_capture_messages`, with `save:true`, a category and evaluation. Verify: a JPEG arrives in the current chat, Rowan is right/Vera left, Chinese text and original images load, original text is not replaced, and the same image appears in the saved album. Tap Original conversation in both clients and verify the source message. Search the album and use `album_send_photos` to send the kept image again. Wrong, private, deleted, cross-conversation and reordered IDs must fail before rendering. Renderer failure must not be reported as delivery.

The autonomous wake tool ceiling now supports search/capture/save. Existing owner-controlled tool and photo-message permissions still apply; this release does not silently enable new unattended permissions or change Desire values/schedules.
