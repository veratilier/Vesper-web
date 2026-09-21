# Bilibili watch import deployment

Release branch: `sites-release-ca9c513`. This feature reuses the history service on 4510; it does not change Codex, wake scheduling, Desire, or existing history data.

## Install on the existing VPS

1. Pull this branch and copy `vps/vesper_watch.py` and the updated `vps/codex_history_server.py` into the **existing history service working directory** alongside the wake modules. Preserve its environment, token file, SQLite DB and other files.
2. Install current `yt-dlp` and `ffmpeg` (including ffprobe). Use a dedicated Python virtualenv or pipx for yt-dlp; point `VESPER_YTDLP` to its absolute executable path so systemd can find it. ffmpeg must be on the service PATH.
3. If login is needed, supply the owner's **Bilibili-only Netscape-format cookie file** locally on the VPS, outside the repository, readable only by the service user (0600). Configure `VESPER_BILIBILI_COOKIES=/absolute/private/path/bilibili-cookies.txt` via a systemd override for the history service. Never paste cookies into chat, source, logs, or the frontend. An absent cookie path permits public-video attempts. Do not export other sites' cookies.
4. Optional `VESPER_WATCH_CACHE` defaults to `/home/ubuntu/.vesper/watch-cache`. Provide at least 6 GB headroom. Imports are serialized, limited to 30 minutes and about 2 GB of temporary files per job (checked each second), with yt-dlp's 1 GB per-stream limit. Reject new imports once retained files exceed 4 GB. Six-hour expired job directories are removed on the **next import**; these are temporary copies, not a permanent media library. Service restart interrupts an import; reimport explicitly.
5. Restart only `vesper-codex-history.service`; build/deploy the frontend with the existing production procedure. The existing `/history/` nginx route must forward `/watch/*` to 4510. If a separate `/history/watch/` nginx prefix is added for stream logging, also add an exact `location = /history/watch` forwarding to `http://127.0.0.1:4510/watch`. Otherwise nginx redirects POST/OPTIONS to the trailing-slash URL, breaking browser preflight with `Load failed`. Verify OPTIONS returns 204 without redirect and POST returns 202. Do not expose that port or relax global authentication. Import/status require the existing bearer token; video GET uses a separate HMAC capability scoped to the video and expiry. Configure nginx access logs for this route to omit query strings (use `$uri`, not `$request_uri` / `$request`) to avoid recording playback capabilities. The Python service already omits them.

## Acceptance

- Confirm ordinary history and wake routes still work.
- In Pandora's movie room paste a full `https://www.bilibili.com/video/BV…` or `/bangumi/play/ep…` URL. Short URLs are intentionally rejected; open them first to obtain a full link. Import selects one entry; `?p=N` is retained.
- First try a short public video, then a video the owner can access with their own account. Login does **not** guarantee VIP/region/DRM playback. No access bypass is implemented. Failures show a generic message without upstream URLs or cookies.
- Wait for preparation, verify audible MP4 playback on iPhone, seeking (`206` and Content-Range), and “看看这一幕” screenshot capture across the CORS boundary. Sources lacking compatible H.264/AAC up to 720p fail instead of serving an unplayable file. First version prepares a server-side file before playback, not immediate upstream streaming.
- Platform subtitles are loaded if available; otherwise import SRT/VTT manually. AI receives the existing screenshot plus subtitle context; no new model provider is required. It still does not receive movie audio.
- Verify unsigned/expired/tampered stream URLs fail and no device token appears in media URL. Refreshing while preparation is pending recovers the session's job ID; returning from another room resumes polling. A failed status request has an explicit retry action.
- `python3 -m unittest discover -s vps -p 'test_watch.py'` checks URL restrictions, range handling, scoped signatures and expiry. Real platform/iPhone acceptance requires this deployment and has not been performed by the code-editing session.

References: https://github.com/yt-dlp/yt-dlp and https://github.com/yt-dlp/yt-dlp/wiki/FAQ .
