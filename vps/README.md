# Vesper Codex history service

The static PWA reads and writes Codex conversation history through
`https://codex.r-vera.com/history`. The service runs beside `codex app-server`
on the Vesper VPS and authenticates the same bearer capability token.

Persistent data lives at `/home/ubuntu/.vesper/chat-history.sqlite3`. The
`conversations` table owns the Vesper-to-Codex mapping, title, timestamps, and
archive state. The `messages` table stores user and final agent messages with
their original timestamps and explicit `item_id` / `turn_id` columns for
idempotent snapshot merging.

Runtime files:

- `codex_history_server.py`: loopback-only HTTP/SQLite service on port 4510.
- `vesper-codex-history.service`: systemd unit.
- `nginx-codex-history.conf`: `/history/` reverse-proxy location for the
  existing authenticated `codex.r-vera.com` tunnel.

## Background wake executor

`vesper-wake.timer` invokes `vesper_wake_runner.py` every minute. It uses the
existing Ubuntu Codex ChatGPT login through a runner-owned stdio App Server.
No model API key is added; API-key accounts are rejected. The existing
`~/.codex/app-server-token` authenticates Vesper and the local history API.

- `~/.vesper/wake.sqlite3` stores jobs, tool outcomes, schedule, and foreground
  activity. `flock`, unique request IDs, and a transactional claim prevent duplicate
  execution. Interrupted model turns are marked interrupted, never replayed.
- Settings `careFrequency` remain authoritative: off/daily/twice-weekly. Scheduled
  jobs run around the clock at persisted Desire-based 30–120 minute intervals; active foreground turns
  defer pending jobs. Manual wakes join an existing queued/running job.
- Background turns are separate from browser-owned Codex threads. Final messages,
  wake cards, attachments, and tool summaries use the existing history API, in
  the latest eligible conversation with a completed normal user/AI turn. Existing conversations stay intact.
- Only explicitly listed native tools are available unattended. Extra approvals
  are declined. Native Desire reads remain isolated; background wakes do not
  create synthetic Desire encounters. Verification runs expose read-only tools.
- Replies are saved before POST `/api/wake` sends Web Push to stored Vesper
  subscriptions. D1 `vesper_wake_push` deduplicates delivery by job ID. Transport
  uncertainty never causes a model rerun or blind repeated push. `saved`,
  `push_failed`, and `completed` are distinct states; provider acceptance is not
  proof that the phone displayed the notification.
- The frontend no longer has an automatic wake timer. Manual buttons enqueue on
  VPS; status/polling and notification links open the existing chat presentation.

Install the runner/store beside the history service, back up the SQLite history
using its backup API, install the two systemd units, restart only history, and
`systemctl enable --now vesper-wake.timer`. Existing model/tunnel services and
login are left in place. Runtime files should be private to Ubuntu.

For the user-authorized closed-PWA acceptance test, schedule one real read-only
wake with `python3 vesper_wake_runner.py --schedule-verification 120`, then confirm
PWA closure before its due time. Check job completion, saved messages, native
read calls, and push receipt independently. Do not claim end-to-end acceptance
from timer activation alone. Test with `python3 -m unittest discover -s vps -p test_wake.py`.

### Closed-PWA acceptance — 2026-09-09

Implementation `bc66168`, API Worker version
`1c76a0ad-998e-4979-a63b-de240177ae3c`.
The user confirmed all Vesper PWA windows closed before the queued verification.
The existing systemd timer (not a browser or a direct model invocation) claimed
job `75f5652f-c4d5-4370-a2f7-c0da883ee2af` at 17:20:01 Asia/Singapore.
The VPS used ChatGPT managed login, completed native `desire_status` and
`read_vesper_state`, saved the wake card, two agent message items and two tool
observations, and finished around 17:20:13. Web Push returned delivered=6/6;
the user separately confirmed receiving the phone notification while PWA closed.
Repeated submission of the same request ID left one job and two executed calls.
All 776 pre-existing history message IDs, roles, and contents matched the SQLite
backup (zero missing, zero content changes). The normal timer remains enabled
with the existing daily setting. No API key or synthetic Desire encounter was used.

Regression coverage also includes `node tools/test-wake-push.mjs` (authorization
and concurrent push deduplication). The full build and existing chat/Desire tests
passed; TypeScript retains only the five previously recorded unrelated diagnostics.

### UTF-8 follow-up

The first acceptance notification arrived but was not readable Chinese: the
runner embedded JSON in curl's config syntax, which discarded the backslashes
in Unicode escapes. Transport acceptance alone had missed this encoding bug.
The runner now supplies a private UTF-8 JSON body file via `--data-binary`, keeping
payloads out of curl's config parser. A real curl-to-HTTP regression test covers
Chinese, emoji, quotes, newlines, and literal backslashes.

The two affected assistant messages were restored by exact comparison against
Codex's original thread snapshot, keeping their IDs and timestamps. The known
wake label, tool-result labels and conversation title were also repaired after
a SQLite backup. The corrected replies matched the history HTTP response. One
corrective push (`<original-job-id>-utf8-fix`) was sent from the saved original
reply, with 6/6 provider acceptances. No model/tool rerun or extra wake job occurred.
