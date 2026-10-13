# Screen companion → Chat and Bark

The user starts the system ReplayKit broadcast explicitly. The upload extension prepares a fixed selected VPS conversation, sampled image, contact instructions/name and model via authenticated `/companion/watch` requests.

- `POST` actions: `start`, `frame`, `stop`. Stable UUIDs deduplicate sessions and samples.
- `GET /companion/watch/<session>/<frame>` polls one receipt and renews a 120-second lease.
- JPEGs are bounded to 1000px / 700KB base64, retained in a bounded in-memory queue only, and consumed by a server-owned ephemeral Codex review using the existing ChatGPT login. They do not enter normal chat history.
- Review reads the latest 24 delivered messages of that exact chat and the previous scene summary. It produces structured `{scene, reply}`; null reply is quiet. The observer cannot execute tools or alter the interactive thread.
- Visually unchanged samples skip model work. Replies are limited to one per 45 seconds. Prompt discourages screenshot reports, replies to the app's own chat/notification UI, and unsupported audio claims.
- Only completed natural replies enter the selected chat as `screen:<frame>:reply`, with screen metadata for context on the next native chat turn. No synthetic user messages are inserted.
- Bark scans those completed replies with its existing name/avatar/deep-link delivery, receipt deduplication and corresponding foreground-chat suppression.
- Pause/end revokes the session and outstanding replies. Expired leases, conversation deletion and service restarts cancel work; uncertain model generations are never replayed.
- Native screen sharing currently requires the VPS backend. A fresh broadcast is required after updating the extension.

Verification: `python3 -m unittest test_screen_companion.ScreenTests test_bark.BarkTests -q` exercises authenticated routing, selected chat context, silent/identical frames, deduplication, throttling, foreground suppression, cancellation/deletion, expiry, invalid images and non-replayed failures.
