# VPS wake policy (2026-09-09)

The existing `vesper-wake.timer` polls once per minute. The executor uses the installed Codex app-server over stdio and the existing ChatGPT login; no model API fallback is permitted.

## Scheduling and eligibility

After each terminal round (including silent/skipped/failed/interrupted), the runner reads the **native Vesper** `desire_status` endpoint. It samples seconds uniformly around `120 - 0.9 * longing` minutes, ±15 minutes clipped to 30–120 minutes. Explicit requests for fewer interruptions raise the center to at least 105 minutes. `wake.sqlite3` stores the draw, longing, next timestamp and originating job. Minute polls/restarts do not redraw. Failed status reads postpone scheduling until a successful read; they never fabricate a Desire value.

Automatic wake runs around the clock, with no night-time restriction. Quiet preferences and active chats postpone execution without changing the draw, so actual waiting can exceed 120 minutes. Turning automatic wake off still works. Manual/verification requests also respect quiet preferences and chat avoidance.

Only direct, unquoted recent user statements are considered. Supported explicit quiet/allow/fewer-interruptions statements and first-person emotions expire after six hours unless a duration is given. Numeric and common Chinese hour/minute/day durations are supported, capped at 24 hours; today/tonight expire at local midnight. No inference from silence or Desire. Unsupported/ambiguous wording does not invent a preference. Preference evidence includes the source message and expiry, with no permanent emotional profile.

## Target and output

At claim time, select the latest genuine user message with a completed normal AI reply in the same turn and unarchived conversation. Ignore wake/test/synthetic metadata, explicitly prefixed test messages, execution cards and the legacy autonomous window. Persist conversation/user/turn IDs. Later conversation activity never switches this round's target. Deleted/archived targets, quiet or foreground activity suppress publication. No eligible target means no model run, no message, no new window.

Model output is structured `{share, message}`. Silent rounds only retain their actual tool ledger. Shared rounds save a system activity card, execution records and the final answer (and any actual attachments), then call the idempotent notification outbox with the locked conversation ID. Intermediate commentary is never published. Activity descriptions derive from actual tool names and recorded outcomes. Notification clicks open that conversation; frontend merges persisted messages without replacing existing history.

## Bounds and recovery

One model turn per job, 600-second execution deadline, eight distinct tool calls, a 32,000 non-cached-token / 128,000 total-token stop threshold, and at most 24 started rounds / 160,000 non-cached tokens in a rolling 24 hours. All input/output tokens are still recorded; previously cached input is not counted twice against the new-token budget. Token notifications are retrospective, so token thresholds are circuit breakers rather than exact billing caps. Subscription limits still apply. No extra paid API is configured. Context is bounded to 12 normal messages / 9,000 characters; final publication is bounded to 1,600 characters.

SQLite job IDs, process flock and per-item tool records prevent replay. An interrupted model/tool is never rerun automatically. Once saved, only the same idempotent push is retried. Unknown push delivery is not blindly resent. Note/journal writes remain allowed; deleting data, altering settings, official Desire tools and Desire encounter writes are unavailable. Database migrations are additive. Existing history and the legacy wake conversation remain untouched.

Tests: `python3 -m unittest discover -s vps -p 'test_wake*.py'`, `node tools/test-wake-push.mjs`, `npm run test:codex`, `npm run build`.

## Live acceptance

On 2026-09-09 the user confirmed the PWA was completely closed. Systemd timer job `403c552a-f5ad-4ce3-8f51-0a28dc0f0257` then completed native `desire_status` and `read_vesper_state` calls, saved one final agent message plus three system activity records in the locked existing conversation, and sent the saved text through the push outbox (6/6 subscriptions accepted). The user confirmed receipt with normal Chinese text while the PWA was closed.

The selected target still matched the last completed normal user/AI pair after publication. No new conversation was created. All 800 messages in the pre-deploy backup retained their IDs, roles and contents. Desire longing was 18; the post-round draw was 5,466 seconds. `nextAt=1788953645.9913094` remained identical after timer restart and a new process reading the schedule. The 16 automated wake tests also passed, including silence, no target, expiry, persistence and archive/delete protection.

The preceding verification was stopped by the original cumulative-token guard before publishing anything. Inspection showed repeated cached input was included (34,247 total; 16,640 cached). The revised guard records both total and non-cached usage with separate limits; the failed job remains preserved and was not replayed. The successful verification used a new job ID and reported 17,643 non-cached tokens.

## Unattended tool permissions (2026-09-10)

Background reads include Vesper state, memory, reading room, task records, photos, music and native Desire. Writes may add notes, journal, memory candidates, reading annotations and attachments in the locked chat. No memory deletion or editing is granted. Desire encounters are restricted to real new observations; the runner forces `interaction_source=automation` and one stable event ID per job, never the official Desire service.

Configured MCPs must first be listed. Current Galaxy and Botling connections expose only explicitly reviewed read actions; posting, replying, deleting, voting, registrations and account changes are denied. Notification/announcement reads force `mark_read=false` and `mark_seen=false`. Unrecognized MCP tools need a reviewed action policy rather than inheriting permissions from external descriptions. Pandora's reading tools work in the background; video frames still require a foreground player.
