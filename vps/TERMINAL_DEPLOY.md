# Live VPS Codex terminal

The Chat terminal now reads the current screen of a persistent **real tmux
Codex CLI pane**, not command records or rollout files. It refreshes every
500 ms while visible. Text and Esc/Tab/Ctrl+C/arrows/Enter go to that pane.
This is a dedicated VPS CLI session; it does not mirror the headless Chat
app-server process or inject commands into an active Chat turn.

Install `tmux` and ensure `codex` is available on the history service's PATH.
Copy `vesper_terminal.py` and the updated `codex_history_server.py` together
to the existing `/home/ubuntu/vesper-codex-history` directory. Add a systemd
drop-in for `vesper-codex-history.service`:

```ini
[Service]
Environment=VESPER_TERMINAL_ENABLED=1
Environment=VESPER_TERMINAL_CWD=/home/ubuntu/Vesper-ios
Environment=PATH=/home/ubuntu/.local/bin:/usr/local/bin:/usr/bin:/bin
```

Set CWD to the actual repository you want Codex to work in and PATH to the
installed CLI's location. Reload systemd and restart **only** the history
service. No Cloudflare Worker or nginx change is needed: the existing
authenticated `/history/` proxy already covers these routes.

The app's Start button creates one session using the existing CLI login and
approval configuration. Merely opening the sheet does not start Codex or
submit a model turn. Closing it stops polling but keeps the tmux process alive.
No unattended approvals or bypass flags are introduced.

The tmux server uses socket name `vesper-terminal`, session `vesper-codex`.
To inspect the same pane from SSH as ubuntu:

```sh
tmux -L vesper-terminal attach -t vesper-codex
```

If a session exits, the Start button starts a new CLI session. This does not
automatically resume an old CLI thread. A dropped input acknowledgment is
never retried automatically; inspect the pane before resending.

Verification: open Chat's terminal, start Codex, type a harmless question,
confirm live redraws, send arrow/Tab/Esc, interrupt with Ctrl+C, close/reopen,
and confirm the same pane survives. Wrong/missing bearer tokens must return
401 on all three routes. The native app currently renders the terminal screen
in monochrome; it supports text/key interaction, not mouse or ANSI colors.

Run `python3 -m unittest discover -s vps -p test_terminal.py` before deploying.
