# Autonomous Wake controls

Settings → Autonomous Wake exposes the existing VPS scheduler. It does not control ChatGPT scheduled tasks or create another timer.

Deploy both components from `sites-release-ca9c513`:

1. Update `codex_history_server.py`, `vesper_wake_store.py` and `vesper_wake_runner.py` in the existing VPS service directory. Preserve credentials, environment, databases and companion modules. Restart the existing `vesper-codex-history` service. Keep the existing `vesper-wake.timer`; do not create another timer or interrupt a running wake.
2. Run `npm run build` and deploy the existing Worker with `npx wrangler deploy --config wrangler.production.jsonc --keep-vars`.

Authenticated GET `/history/wake` now returns `configVersion: 2`, durable `config`, editable `prompt` and `defaultPrompt`, and up to 50 job summaries with tool names and status. Raw tool results, generated text, errors and credentials are omitted from job summaries. Existing chat records remain available in chat.

Authenticated POST `/history/wake` accepts `{ "action": "configure", "enabled": true, "intervalMinutes": 60 }`. A null interval retains the existing adaptive policy. Fixed intervals accept integer minutes from 30 to 1440. Changing the switch or interval starts the selected interval from save time. Prompt-only edits preserve the next scheduled time. Quiet requests, active conversations and daily limits can defer execution. Configuration overrides legacy careFrequency after the first explicit save. Disabling cancels queued automatic jobs but preserves manual and running jobs.

Older servers leave controls disabled and show an update message. Failed saves never report success. No settings are changed just by opening the screen. Beijing time is used for displayed dates.

Checks: `python3 -m unittest discover -s vps -p 'test_wake*.py'`; `npm run build:pages`; `npm run build`.

After deployment verify save/read across devices, switch off with a queued automatic task, expand real job records, and verify the next fixed interval. No live settings were changed during development.

The same configure request accepts an optional `prompt` string (1–8000 characters, nonblank). Omitting it preserves the saved text for older clients. The executor loads it at the next turn start, alongside existing permissions and output requirements. Restore default edits the form; Save settings persists it. Only authenticated settings reads expose the prompt, not job history. No prompts were changed in production during development.
