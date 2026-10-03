# Vesper request-scoped recall runtime

Upstream: OpenAI Codex `rust-v0.159.3`, `01fc69f4026735edfdf6789820549727a4867b11`.
The patch changes two Rust files, not the provider/authentication implementation.

- `AdditionalContextStore`: reserve `vesper_memory_NNN` for volatile untrusted recall; never emit those entries to the conversation transcript.
- Generation request assembly: add the current volatile entries to the outgoing prompt. History compaction uses the original clean history; unchanged batches still appear in each request of the current turn.
- New input replaces the whole map, including empty maps. Other namespaces keep upstream behavior.
- Generated assistant text is still ordinary chat history. This does not erase facts mentioned in actual replies.

The GitHub workflow builds `codex-app-server` and its required sibling `codex-code-mode-host` from the same pinned source on Ubuntu 22.04. Deploy both executables together in the same directory; the app-server resolves the helper relative to its own executable. Its artifact contains the upstream commit, Vesper build commit, patch, lock diff and hashes for both binaries. `check-lock.py` permits only workspace version updates from the upstream release tag; it refuses registry/git dependency changes.

Before changing the existing service, run the acceptance script on the exact artifact:

```sh
python3 acceptance.py --command /absolute/path/codex-app-server
```

It must exit zero. It uses a temporary CODEX_HOME and localhost fake provider, with no production credentials. It captures outgoing fixture payloads, tests replacement/clear/Unicode/repeat/tool continuation/compaction/fork/restart, and checks rollout files. A separate Code Mode call must execute JavaScript through the real helper, invoke the no-op dynamic tool, and return its result; receiving a final text reply or checking `--help` is insufficient. The workflow runs this acceptance against the packaged binaries before uploading an artifact. It emits only fixture counts, not payload bodies. `--observe --command /usr/bin/codex app-server` records the stock binary baseline without failing on its known retention behavior.

Deploy only the existing `codex-app-server` service launcher to the versioned artifact. Preserve its arguments and token file. Keep the original launcher for rollback. Do not alter `/usr/bin/codex`, terminal/wake executables, chat databases, or schedules. Verify the process executable hash and authenticated live service before setting the existing Worker variable `VESPER_MEMORY_CONTEXT_TRANSPORT=request-scoped-v2`.

Rollback order: disable/unset the Worker gate first, then restore the original app-server launcher. Future Codex upgrades require rebuilding this patch and rerunning acceptance; a new upstream version number alone is not compatibility evidence.

The Vesper resume extension accepts `dynamicTools` using the same schema validation as thread/start. Omitted preserves the catalog; an empty array clears it. Loaded and cold-resumed threads publish the refreshed catalog before returning the resume response. Already accepted turns retain their own snapshots. The host sends the current catalog on each resume; no transcript or user message is rewritten. Acceptance checks actual outgoing requests for tool addition and removal, including a process restart.
