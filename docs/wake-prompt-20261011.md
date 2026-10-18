# Autonomous wake prompt, 2026-10-11

The owner approved the condensed shared prompt in `vps/vesper_wake_policy.py`.
Each wake chooses its activities afresh from the tools that are both available
and authorized. Previous plans and Rowan's saved wording remain references;
they do not require completing an old activity or rotating through tools.

The shared prompt is supplied once as Codex `developerInstructions`. The turn
input carries only saved references and owner addenda when the composed prompt
starts with that shared base. Older custom owner prompts are retained verbatim.
Time, permissions, recent chat, Desire state and output schema remain separate
runtime inputs. Scheduling, sleep, recent-message quieting, authorization and
budgets remain enforced by the existing host code.

## Live VPS update

The live VPS has newer `nextWake` / `selfPrompt` support than this repository's
baseline runner. Replace only the `WAKE_PROMPT` string and the matching prompt
supplement assembly block in the existing live modules; back them up first.
Do not replace the whole runner/store, database, plan module or service settings.
Restart the history API to reload the shared prompt; the existing wake executor
loads it on its next scheduled invocation. Do not trigger an extra model run.

Remove only the owner addendum added on 2026-10-11 to clarify free activity choice,
whose content is now in the shared prompt. Preserve any other owner additions,
Rowan's self prompt, permissions, sleep settings and saved next-wake plan. Verify
the API's `defaultPrompt`, composed `prompt` and retained state after reload.
