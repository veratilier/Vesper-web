# Browser viewport adapter (retained for compatibility)

The native monitor now shows the full desktop. See `VPS_DESKTOP.md`. The original
browser-only route below remains available without changing its MCP permissions.

The original browser-only adapter passively reads the current page in the
independent Rowan browser. The terminal retains the current-chat command/output.
This VPS has a private Xvfb browser display; the monitor shows its actual webpage
viewport. Commands and tool results are available in the terminal tab.

`GET https://codex.r-vera.com/browser/display` uses the existing Vesper device
bearer token, only on this exact read-only route. The browser MCP keeps its
independent credential and permissions. No VNC/CDP port or new public listener is
opened. Nginx forwards the existing tunnel's exact path to loopback 8784. Headers
disable response caching, and access logging remains off for the viewer route.

`vesper_browser_display.py` is imported beside the existing browser server.
Viewing does not start Chromium, navigate, scroll, replace element observations,
or extend its idle lifetime. Browser tools retain control of the page. Frames are
shared for at most one second to bound capture costs across devices. The native
app polls every 1.5 seconds only while the screen tab is visible and the app is
active. A frame keeps its original capture time; disconnected clients label it
as the last frame, while idle/login/private states clear it. Pinch zoom remains
stable as frames refresh. Browser fields are masked, and visible known credential
values suppress capture. Owner login mode suppresses the display altogether.

The deployed read-only browser clears its page after each read/screenshot tool
finishes. Its blank page is reported as idle. During a tool call, the monitor
shows the actual page being read; viewing retains the original clearing policy.

Install from the checked production commit on the existing VPS, using its browser
source hash inspected immediately before deployment:

```sh
sudo python3 install_browser_display.py --expected-server-sha <reviewed-sha256>
```

Stage this script and `vesper_browser_display.py` together. It makes private backups,
adds a narrow startup hook to the existing browser source, saves a SHA-256 verifier
of the existing device pairing token in a root/browser-group readable file,
validates Nginx configuration and authenticated startup, then reloads Nginx. A
failure restores the saved files. It restarts only the browser; active owner login
must finish first. If the device token is rotated, rerun the installer with the
current browser source hash. The browser keeps only the one-way verifier on disk;
the original device token stays in Codex's existing private file. Chat history,
Codex threads and login stay in place.

Offline regression: `python3 vps/test_browser_display.py` (requires aiohttp).
Test authentication, exact read-only route, unchanged browser observations and idle
time, shared frame capture, login/sensitive states and real capture failures. Live
acceptance additionally checks public HTTPS auth, same-page capture, unchanged
element state and no model turn, and original chat/terminal availability.
