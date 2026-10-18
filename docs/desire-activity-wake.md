# Native Desire activity context

Autonomous turns read the existing `desire_status` when that read permission is
available. The model uses the actual state, recent chat, memory tools, a pending
activity and recent tool receipts to choose what to do. There is no second drive
calculator, threshold-to-tool mapping, activity cooldown or action reward.
The existing Desire values, encounter calculations and wake schedule remain in
place. A personal observation can still be saved through the optional final
Desire assessment; routine tool completion does not generate an assessment.

The model can use authorized tools and finish with `share=false`. It does not
have to contact Vera, use a tool, or generate a numerical change every turn.
This supplies context for activity selection; it cannot guarantee model behavior.
Reading Desire does not require permission to write an encounter. If the read
fails, the failure is logged and the model receives null, rather than guessed state.

Ordinary structured responses also include nullable `nextActivity` with `activity`
(1–240 characters) and a brief `reason` (1–120). This is a pending task, not a
claim of completed work, a schedule, a grant of authority or private reasoning.
It is stored separately per conversation in the existing wake SQLite runtime
under `wake_activity:<conversation_id>` after a valid, still-permitted round.
Silent rounds retain their plans too. Explicit null clears the plan; an absent
field in legacy output retains it. Failed or interrupted turns do not replace it.
Verification turns are excluded. Up to three recent rounds supply bounded
Workflow facts; failed or uncertain calls are never labeled successful.

## Activate on the existing VPS

Use the existing wake account, normally `ubuntu`, with Python 3 and passwordless
sudo for its systemd units. From a checkout of the tested main commit:

```bash
bash vps/install_desire_activity.sh /home/ubuntu/vesper-codex-history/vesper_wake_runner.py
```

The installer supports the original runner and the previous Xinchao integration.
It checks known anchors, pauses the wake timer, refuses to interrupt a running
turn, makes a private backup, installs the module and patches small hooks.
Unknown or partial layouts fail before editing the runner. Live prompts,
`nextWake`, `selfPrompt`, other schema fields, preferences and databases are
preserved. The latest shared prompt change in Git is not forced over a custom
live prompt; the activity context is supplied within each ordinary turn.

If installed, only the `xinchao` service in the old `vesper-xinchao` Docker project
is stopped, and its known systemd environment drop-in is backed up and removed.
No volume, token, source checkout or state is deleted. No Docker dependency is
needed if the previous sidecar was never installed. A previously active timer
resumes on exit; a stopped timer stays stopped. No immediate model turn is created.
Cloudflare Worker publication alone cannot activate this VPS change.

Inspect the next normal turn in Workflow and the service journal. Read
`wake_activity:<conversation_id>` in the runtime table for its pending task.
A successful silent tool activity should have real Workflow receipts and no
newly saved chat message or push. Changes in native Desire come from its existing
mechanism, not this activity context. Do not infer successful activation from
a Git commit or local tests; check the target VPS.

Local checks:

```bash
PYTHONPATH=vps python3 -m unittest discover -s vps -p 'test_wake*.py'
bash -n vps/install_desire_activity.sh
```
