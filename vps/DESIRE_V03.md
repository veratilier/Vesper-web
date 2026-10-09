# Vesper Desire v0.3

Vesper uses separate `vesper_emotion_*` D1 tables. The original Desire connector
and the previous six-dimensional Vesper tables are never rewritten. New values
start absent and are initialized by a semantic assessment of actual recent data.

`vesper-emotion.timer` runs one tool-free, ephemeral `gpt-6-luna` turn every
quarter hour, including during sleep and with no new chat. It uses at most 10
pending events and 3 already-counted background events, with the whole input
bounded to 4,800 characters, and enforces 16,000 fresh / 24,000 total tokens and a 3-minute model
deadline. Model/quota/network failures preserve the committed state and record a
brief error. One catch-up run occurs after downtime, without replaying missed runs.

Native VPS chat can optionally append one private structured candidate to the
normal reply. The client hides streamed tags, durably queues evidence/candidate,
and commits only after a completed turn. It does not call a second model or wait
for emotion persistence before displaying a reply. A stale candidate is discarded;
evidence remains pending for the next periodic settlement. Changing credentials
isolates caches/outboxes. MAC conversations remain separate; no VPS thread IDs or
Mac connection credentials are reused.

Every commit uses one D1 transaction for version compare-and-swap, history and
specific consumed event IDs. Unique update/version constraints prevent duplicate
retries and competing candidates. There is no maximum-event-ID watermark. Events
arriving late inside the collector's rolling 24-hour updated-at window are
re-examined by stable IDs. The collector reads a bounded latest 240-message page;
native completed turns additionally submit their own durable evidence.

Emotion advice controls the **next plan after an activity**, avoiding constant
rescheduling. User fixed intervals take priority. Calm advice is 30–60 minutes;
the provisional operational range for other semantic advice is 15–240 minutes.
There are no emotion-score thresholds or weighted numeric interval formulas.
Recent user activity suppresses extra messages and attachments for 30 minutes,
while allowing authorized quiet activities; foreground replies, sleep, explicit
DND, revocation, budgets and one executor lock still gate activities.

The wake executor reads emotions and maintains one durable pending activity plan;
it never writes the retired six-dimensional assessment. Confirmed saved results,
failed results and unconfirmed receipts remain distinguishable and feed later
settlements. Music/Studyroom are not offered as autonomous activities.

After deploying the checked Worker main commit, copy this directory's installer,
three Python files and two units to a private VPS staging folder, then run
`python3 install_emotions.py`. The installer backs up existing runner/policy files,
does not restart the foreground chat/history/browser services, and enables only
the new emotion timer. The installed runner imports the policy on its next wake.

The existing production VPS also has its own nextWake/selfPrompt plan extension.
The installer checks its reviewed source digests and applies narrow, compiled
compatibility patches while retaining those plans, prompts and atomic saves.
Unrecognized host changes abort before replacing files. The existing host
30-minute/24-hour bounds remain in force; calm choices are restricted to30–60
minutes before the existing sleep and owner-setting validator runs.
