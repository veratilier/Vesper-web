# Wake permissions and private run history

Native Settings > Autonomous Wake now configures tools and outgoing message types without a user-editable prompt. The executor still uses a built-in instruction; permission checks are enforced in Python, not by trusting that instruction.

Deploy the updated `vps/vesper_wake_store.py`, `vps/vesper_wake_tools.py`, and `vps/vesper_wake_runner.py` together to the existing VPS wake service directory using the existing deployment procedure. Keep the current token, database, service environment, and systemd timer. Do not create another timer or delete history. Restart the existing wake service after deployment. Cloudflare Worker deployment alone does not install this VPS change.

The authenticated history GET /wake must return `permissionVersion: 1` and `configVersion: 3`. Until then, native permission controls stay disabled. POST /wake with action configure accepts `permissions: {tools: [...], messages: [...]}` alongside enabled and intervalMinutes; all IDs are validated. Existing authorization is preserved until the user saves switches. Saving switches selects the built-in task instruction; older custom prompt text is retained in storage but is not executed in this mode.

Both tool and output-type permission are required for sending photos, files, or stickers. Tool permissions are checked again before dispatch, and message permissions before publication/delivery. Revoking permission does not undo an already-started request. External MCP access remains restricted to the existing read-only action policy, even with its switch on. Disabling Desire reading makes adaptive scheduling use 120 minutes without reading Desire.

Tool steps remain in the wake SQLite ledger, with status and timestamps, and are returned in the existing authenticated /wake jobs list. Raw arguments, tool payloads and credentials are not returned. New wake markers and execution cards are no longer written into chat history. The native presentation hides old wake activity records without deleting them, preserving final messages and attachments. Historical steps created before timestamp support may have no timestamps.

Validation: `PYTHONPATH=vps python3 -m unittest discover -s vps -p 'test_wake*.py'`. Confirm on a device that saving permissions round-trips, disabled tools are unavailable, a silent run creates no chat activity cards, and a shared final message remains visible.


## Required Desire assessment

Normal/manual wake executions now require the existing `desire_status` and `desire_encounter` permissions. The executor reads status before the model turn, requires a grounded `kind`/nonempty `note` in the structured decision, then performs exactly one ledger-backed encounter before marking the run successful (including silent runs). The source is always automation and the event ID is stable for the job. Verification runs remain read-only. Revoked permissions, uncertain writes, and failed writes block successful completion; no permission is silently re-enabled. The existing Desire scoring rules determine numeric changes, including zero change when warranted. Deploy `vesper_wake_runner.py` and `vesper_wake_tools.py` to the existing VPS service; this change does not require a Cloudflare release.
