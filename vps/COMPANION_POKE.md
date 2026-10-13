# Lock-screen companion tap

POST `/history/companion/poke` uses the existing history Bearer credential. The
native LiveActivityIntent stays in the background, keeps one request UUID until
a receipt is confirmed, and targets the last opened conversation for the same
API identity. Credentials stay in the app's Keychain.

The server atomically saves a user tap and a durable queued job before returning
202. Repeated UUIDs and taps within 15 seconds reuse the same receipt. A single
background worker generates a brief response using the existing Codex ChatGPT
login, recent conversation text and the user's configured instructions. It uses
an ephemeral thread with no tools and never interrupts the interactive thread.
The resulting reply is stored in the original conversation. Native chat includes
this background reply as quoted context on the next normal turn.

Deleted conversations are rejected and checked again before reply delivery.
Failed or interrupted model work is not replayed. Payload instructions are
cleared after execution. A restart recovers queued work, not running work.
This is an explicit user interaction, independent of autonomous-wake sleep and
presence gates. It does not implement APNs or claim a model response before it
has actually arrived. The banner receipt means the tap was durably accepted.

## Checks and deployment

`python3 -m unittest test_companion_poke.PokeTests -v` inside `vps/` tests auth,
idempotency, rapid taps, failed generations, and deletion before/during a reply.
Use isolated fixtures for model verification; do not inject test taps into a real
conversation. Deploy `vesper_companion_poke.py` plus the small import/route/start
hook in `codex_history_server.py` to the existing VPS history service. Preserve
newer live server changes when applying this scoped patch. Restart only
`vesper-codex-history.service`. No Cloudflare Worker code or DNS changes are
needed: the existing history reverse proxy forwards the route.
