# Xinchao state service for Vesper wakes

This optional integration lets real Xinchao state inform Vesper's existing Codex
wake turns. A turn can read or save something and finish with `share=false`.
Successful native tool receipts generate bounded own-action feedback; a planned
action, failed call, or false storage receipt does not count as completion.

Upstream: <https://github.com/tianyupaipai-cmd/xinchao-nian>, component
`xinchao/` 4.0.0, pinned to
`a38a0a3241b0d3928d4a452ea1a38cf7efa14cd3`. Only that component is built; its
MIT license is in `xinchao/LICENSE`. The bundled OB service is not installed.
Review new upstream versions before changing the pin.

## Scope

- Existing Vesper scheduling, sleep, foreground activity, user preferences,
  revoked permissions and message permissions remain authoritative. There is no
  additional wake timer or direct push channel.
- Rising curiosity, reflection, boredom, duty, sharing, longing and concern can
  suggest one activity using tools already authorized for this wake. A drive has
  a three-hour suggestion cooldown after a completed turn; its active satisfaction
  plateau suppresses suggestions. A two-hour steady drive can also qualify.
  These are integration defaults, not measurements of psychological feelings.
- Tool results, not prose claims, feed `discovery` or `reflection` through the
  upstream MCP self-report gate. At most one event of each kind per completed
  wake is sent. Uncertain writes are recorded and never blindly retried.
- Only a fresh normal user message within two minutes signals user presence.
  Timer ticks and the AI's own actions never signal that Vera arrived. No chat
  text, relationship classifications, API model or new memory service is added.
- State remains separate from the existing Desire graph; this does not migrate
  or replace that graph's stored values. Actual tool selection remains the
  model's decision. Installation does not guarantee a tool call every wake.
- The upstream service defaults to sleeping after idle time. This deployment
  uses its maximum idle threshold (one week) so a 90-minute absence does not
  suppress Vesper activities. After a week without real user presence the
  sidecar sleeps; Vesper's ordinary wake flow still works without an activity
  suggestion. Fake presence heartbeats are deliberately not used.
- The optional service can fail without blocking ordinary Vesper wakes.

## Install on the existing VPS

Requires the existing `ubuntu` wake account, writable live runner directory,
passwordless sudo for systemd management, Git, Python 3, Docker and Compose v2.
This script does not install Docker or change machine access. Run from the
checked-out Vesper commit containing these files, as the existing wake account:

```bash
bash vps/install_xinchao.sh /home/ubuntu/vesper-codex-history/vesper_wake_runner.py
```

The script checks the live runner layout before installing, fetches the pinned
upstream commit, builds only `xinchao/`, starts it and verifies authenticated state
access. It creates a persistent Docker volume and private token/environment files
under `~/.vesper/xinchao/`. The service binds only `127.0.0.1:18110` on the host.
No public URL, OAuth, dashboard, Bark, attention monitoring, dreams or OB is enabled.

It then pauses the existing wake timer, refuses to interrupt an active wake,
copies the adapter, and inserts four small hooks into the live runner. An unknown
or partial layout aborts for review. The original runner is backed up privately;
its prompt, `nextWake`, `selfPrompt`, databases and other live additions are kept.
The timer resumes even if activation fails. No immediate model turn is triggered.
If an active wake prevented activation, rerun once that wake finishes; the token
and persistent state are reused.

The standalone install is a **VPS deployment**. Publishing the Cloudflare Worker
alone cannot activate it. Do not report a GitHub commit or local test as a VPS
installation.

## Verify after activation

```bash
docker compose -p vesper-xinchao -f "$HOME/.vesper/xinchao/compose.yaml" ps
sudo systemctl cat vesper-wake.service
sudo journalctl -u vesper-wake.service --since '30 minutes ago'
```

Inspect `xinchao_health`, `xinchao_actions`, `xinchao_feedback` and
`xinchao_presence_event` in the existing wake SQLite `runtime` table. Feedback
status distinguishes `applied`, `received_without_effect` (quota/duplicate/no
effect), and `uncertain`; a received event alone does not prove a drive changed.
The existing Workflow ledger remains the record of actual tools. A silent wake
with successful tools should have no newly saved chat message or push.

Local checks:

```bash
PYTHONPATH=vps python3 -m unittest discover -s vps -p 'test_wake*.py'
XINCHAO_TEST_SOURCE=/path/to/xinchao-nian/xinchao PYTHONPATH=vps python3 -m unittest vps/test_wake_xinchao.py
bash -n vps/install_xinchao.sh
```

The optional HTTP test launches the real pinned Node service with temporary
state/token files, verifies an own action changes a drive without refreshing user
presence, and verifies deduplication. Container build/health and systemd activation
must additionally be checked on the target VPS.

## Disable without deleting state

Set `VESPER_XINCHAO_ENABLED=false` in `~/.vesper/xinchao/wake.env`. The next existing
wake process will skip the adapter. To also stop the sidecar:

```bash
docker compose -p vesper-xinchao -f "$HOME/.vesper/xinchao/compose.yaml" stop
```

Do not use `down -v`: the volume contains persistent state. Keep the adapter file
while the runner imports it. Restoring the runner backup should only be done after
reviewing any live edits made since installation.
