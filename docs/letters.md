# Letters

Letters replaces the fourth mobile navigation item; Journal remains available in Collection. The Web and native clients share `/api/letters` and the existing Sketch rows in `vesper_jottings`. No old writing is copied or removed. Read and keep marks live in `vesper_letter_marks`, independently for Vera and Rowan.

The archive has All, Unread and Kept filters, a compact horizontal Upcoming strip and an upright letter box. Each box page shows five letters; further pages and server pagination expose older letters. Sweeping over an exposed edge raises that letter. Holding still for 500 ms selects it and reveals Open. Raising a letter never changes its fixed front-to-back depth. Keyboard and VoiceOver users can select each letter directly. Reduced motion removes the delivery/lift transitions.

Compose saves a device/account-scoped draft. On the first delivery attempt the draft becomes immutable, retaining the same ID, body, date and reply parent on retry. A received server receipt confirms delivery; animation alone does not. Reading and keeping call the server, and reply never overwrites an unfinished or pending draft.

`unlockAt` is an ISO timestamp with a timezone. The server withholds a future incoming letter's body from the recipient, including through legacy Sketch reads; the author can read their own copy. Clients refresh the archive on return and once per minute while active. Opening a letter always rechecks the server. No scheduled push or automatic AI reply is implied.

Rowan has `letter_list`, `letter_create`, `letter_read` and `letter_keep` tools in the app tool catalog and MCP server. VPS wake rounds can use them only within their explicit tool permissions. Existing saved permission selections remain unchanged. Old `jotting_*` tools remain compatible.

## Validation

Run `node tools/test-letters.mjs` for persistence, exact retries, owner isolation, both writer roles, clock boundaries, old Sketch body redaction, independent read/keep marks, reply validation and pagination. Run `node tools/test-jottings.mjs` and `python3 -m unittest discover -s vps -p 'test_*wake*.py'` for compatibility. The mainline workflow also runs the Letters tests.

`npx tsc --noEmit`, `npm run build`, `npm run build:pages`, and both production/MCP Wrangler dry runs validate the two Web builds and Worker bundles. Native XCTest covers draft restoration, scoped cache isolation, sealed covers, pending reply protection and navigation; the macOS iOS workflow must build and run it before merging the native PR.

## Release

Merge checked PRs into the respective main branches. Deploy the Web repo's exact main commit to the existing `vesper-api` Worker using `wrangler.production.jsonc` with `--keep-vars`, and deploy the same repo's `mcp-server/wrangler.jsonc` for the connected MCP tool catalog. Update the existing VPS wake files through its normal deployment process. Do not use the separate Letters prototype site as production. Install a native build containing the new views after the API is available.

Device verification should cover all three palettes, a box with more than five letters, rear-letter occlusion during lifting, a timed incoming letter, an offline first delivery followed by retry, and leaving/reopening an unfinished draft.
