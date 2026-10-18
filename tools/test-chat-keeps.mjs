import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let reply = Response.json({ messages: [] });
let calls = [];
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/chat-keeps.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports, AbortSignal, URLSearchParams,
  require(name) {
    if (name === 'cloudflare:workers') return { env: { VESPER_APP_TOKEN: 'fixture-only-token' } };
    if (['./codex-artifacts', './photo-album'].includes(name)) return {};
    throw new Error('Unexpected dependency');
  },
  async fetch(url, options) {
    assert.equal(options.redirect, 'manual', 'Cloudflare supports manual/follow only');
    assert.equal(new URL(url).origin, 'https://codex.r-vera.com');
    calls.push({ url, options });
    return reply;
  },
});
assert.deepEqual(JSON.parse(JSON.stringify(await exports.historyRead('/conversations/fixture'))), { messages: [] });
assert.equal(calls[0].options.method, 'GET');
reply = Response.json({ mimeType: 'image/jpeg' });
await exports.historyRead('/conversations/fixture/screenshot', { messageIds: ['original'], perspective: 'agent' });
assert.equal(calls[1].options.method, 'POST');
assert.deepEqual(JSON.parse(calls[1].options.body), { messageIds: ['original'], perspective: 'agent' });
calls = [];
reply = new Response(null, { status: 302, headers: { location: 'https://untrusted.example/' } });
await assert.rejects(exports.historyRead('/conversations/fixture/screenshot', {}), /History redirect blocked/);
assert.equal(calls.length, 1, 'Never follow redirects with history credentials');
reply = Response.json({ error: 'Original conversation is unavailable' }, { status: 404 });
await assert.rejects(exports.historyRead('/conversations/fixture'), /Original conversation is unavailable/);
console.log('Chat capture history: Worker-compatible redirect mode, real POST body, redirects blocked and failures propagated passed');

reply = new Response('error code: 502', { status: 502 });
await assert.rejects(exports.historyRead('/conversations/fixture/screenshot', {}), /HTTP 502; no image was delivered/);
