# Sleep time

VPS `/wake` exposes `sleepVersion: 1`, `configVersion: 5` and `config.sleep`:

```json
{"enabled":true,"start":"00:00","end":"07:00","timeZone":"Asia/Shanghai","dreamEnabled":true}
```

Save through the existing authenticated `configure` action, retaining the current main `enabled` and `intervalMinutes`. Older clients omitting `sleep` preserve it. iOS: Setting → Autonomous Wake → Sleep time. Times are Beijing time; start is inclusive, end exclusive. Overnight ranges are supported; equal start/end is rejected.

The existing minute timer enforces sleep locally before any network/model call. Running rounds check the gate before tools, messages, notification delivery and while waiting for the model. Queued automatic rounds become silent rather than replaying a night's backlog. Existing chat, databases, credentials and timer units remain in place.

Only an observed sleep period creates a durable cycle. After it ends, Vesper resumes the current eligible chat thread with the existing ChatGPT login. It writes one fictional dream to the shared-memory `dream` category and then saves a short morning greeting in that same chat. The full dream stays in Dreams; the chat message retains available public reasoning summaries and tool call details for its expandable process view. The main switch, sleep switch, dream switch, memory-write permission, and text-message permission still apply. Quiet or active chat delays the turn. Installing during the day does not fabricate a previous night's dream.

The generated body is persisted before writing memory. Stable body/source/time lets the shared-memory service deduplicate uncertain retries. Saved cycles are not repeated after restart. Errors are available under `sleep.lastDream`; retries wait 30 minutes. Disabling either switch skips pending dreams. The run and its memory-save step appear in Workflow. This does not create another timer or change ChatGPT's official scheduled tasks.

Deploy `vesper_morning_dream.py`, `vesper_wake_runner.py`, and `vesper_wake_workflow.py` together into the actual history/wake module directory. Preserve the live runner's other features when its source differs from this repository. Restart the history service to reload the Workflow description; the existing wake service reads the runner on its next timer invocation. Tests: `python3 -m unittest discover -s vps -p 'test_wake*.py'` and `python3 -m unittest discover -s vps -p 'test_morning_dream.py'`.
