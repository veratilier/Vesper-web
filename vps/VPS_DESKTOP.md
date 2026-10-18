# Full VPS desktop in native Vesper

The VPS previously ran no desktop session: Chromium used the private Xvfb `:94`
display for owner login. Openbox now manages that same real display, with a tint2
taskbar, PCManFM desktop and an xterm running the system's actual `top`. Chromium
continues to use its existing display, profile and network restrictions. Backend
processes still run independently of GUI windows; their activity is visible in
the process terminal and the native **终端** tab.

Native **桌面** reads `GET /desktop/display` from the paired history origin. The
existing Vesper device bearer protects this exact read-only path; the browsing
MCP credential is unchanged. No VNC, CDP or desktop control port is exposed.
`vesper_desktop_capture.py` captures the X11 root pixels with Pillow/XCB: window
decorations, desktop, taskbar and other visible windows are included. It does not
render HTML or construct a simulated desktop. Closing a browser page does not
clear the desktop. The old `/browser/display` route remains compatible.

Captures are bounded to 512 KiB JPEG and shared for one second; the native client
polls only while its screen tab is active. A subprocess timeout kills failed
captures. Owner browser login hides the entire display; known visible browser
session credentials also suppress capture. Full desktop images include the
visible contents of other applications. Frames remain in memory, with no-store
headers and no access logging. Pinch zoom is retained on refresh.

The desktop runs as the owner `ubuntu`, with its own XDG state directory and a
restricted copy of the existing X11 authority. It does not give the browser
user access to the owner's files, create a Codex conversation, or copy thread IDs.
It is capped at 192 MiB and 30% CPU. The existing X server is not restarted.

Install the Ubuntu dependencies from the official configured repositories:

```sh
sudo apt-get install --no-install-recommends openbox tint2 xterm pcmanfm
sudo python3 install_vps_desktop.py --expected-server-sha <reviewed-browser-source-sha>
```

Stage the entire `desktop/` directory, both installers, the display adapter and
capture helper together from checked main. Installation backs up its own files,
validates the service, starts the desktop and updates the authenticated capture
route. Failure restores the previous service/configuration. The separate browser
installer preserves existing Codex and history services and rolls back its files.

Verification: display auth/login/failure/cache regressions; native route/frame and
zoom tests; actual public full-screen JPEG, taskbar/terminal windows, desktop
remaining visible with no browser page, and browser MCP/chat history continuity.
