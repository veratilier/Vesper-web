import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync('tools/fixtures/shared-memory-schema.sql', 'utf8'));
const db = {
  prepare(sql) { const statement = (args = []) => ({ bind: (...values) => statement(values), first: async () => sqlite.prepare(sql).get(...args) ?? null, all: async () => ({ results: sqlite.prepare(sql).all(...args) }), run: async () => sqlite.prepare(sql).run(...args) }); return statement(); },
  async batch(statements) { sqlite.exec('BEGIN'); try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec('COMMIT'); return result; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } },
};
globalThis.__sharedFixture = { SHARED_MEMORY_DB: db, VESPER_MEMORY_CONTEXT_TRANSPORT:'additional-context-v1', VESPER_APP_TOKEN: 'fixture-token', DB: { prepare() { throw new Error('Legacy DB must not be accessed by shared tools'); } } };
const directory = await mkdtemp(join(tmpdir(), 'vesper-shared-integration-'));
try {
  const routes = {};
  for (const [name, entry] of Object.entries({ tools: 'app/api/codex/tools/route.ts', memory: 'app/api/shared-memory/route.ts', context: 'app/api/memory/context/route.ts' })) {
    const outfile = join(directory, name + '.mjs');
    await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'fixture', setup(b) {
      b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'env', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const env = globalThis.__sharedFixture;', loader: 'js' }));
    } }] });
    routes[name] = await import(pathToFileURL(outfile));
  }
  const request = (path, body, auth = true) => new Request('https://vesper.test' + path, { method: body ? 'POST' : 'GET', headers: { ...(auth ? { 'x-vesper-device-token': 'fixture-token' } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await routes.tools.POST(request('/api/codex/tools', { name: 'remember_vesper_memory' }, false))).status, 401);
  const response = await routes.tools.POST(request('/api/codex/tools', { name: 'remember_vesper_memory', arguments: { body: 'Fictitious integration record nebula', source: 'isolated fixture', kind: 'preference' } }));
  assert.equal(response.status, 200, await response.clone().text());
  const saved = (await response.json()).result;
  const record = await routes.memory.GET(request('/api/shared-memory?path=' + encodeURIComponent('/api/memories/' + saved.memory.id)));
  assert.equal(record.status, 200); assert.equal((await record.json()).id, saved.memory.id);
  const page = await routes.memory.GET(request('/api/shared-memory?path=' + encodeURIComponent('/api/memories')));
  assert.equal((await page.json()).items[0].id, saved.memory.id);
  const recalled = await routes.context.POST(request('/api/memory/context', { query: 'nebula' }));
  assert.equal((await recalled.json()).memories[0].id, saved.memory.id);
  const toolRecall = await routes.tools.POST(request('/api/codex/tools', { name: 'recall_vesper_memory', arguments: { query: 'nebula' } }));
  assert.equal((await toolRecall.json()).result.memories[0].id, saved.memory.id);
  const dream = { body: '【模拟梦境】Fictitious sleeping nebula', source: 'Vesper · simulated dream · sleep:fixture', kind: 'dream', occurred_at: '2026-10-02T07:00:00+08:00' };
  const saveDream = () => routes.tools.POST(request('/api/codex/tools', { name: 'remember_vesper_memory', arguments: dream }));
  const dreamSaved = (await (await saveDream()).json()).result;
  assert.equal(dreamSaved.stored, true); assert.equal(dreamSaved.memory.kind, 'dream');
  assert.equal((await (await saveDream()).json()).result.memory.id, dreamSaved.memory.id);
  const dreamRead = await routes.memory.GET(request('/api/shared-memory?path=' + encodeURIComponent('/api/memories/' + dreamSaved.memory.id)));
  assert.equal((await dreamRead.json()).body, dream.body);
  assert.equal((await (await routes.context.POST(request('/api/memory/context', { query: 'sleeping' }))).json()).memories.length, 0);
  const ledgerSqlite=new DatabaseSync(':memory:');
  globalThis.__sharedFixture.DB={prepare(sql){const statement=(args=[])=>({bind:(...v)=>statement(v),first:async()=>ledgerSqlite.prepare(sql).get(...args)??null,all:async()=>({results:ledgerSqlite.prepare(sql).all(...args)}),run:async()=>ledgerSqlite.prepare(sql).run(...args)});return statement();},async batch(statements){ledgerSqlite.exec('BEGIN');try{for(const s of statements)await s.run();ledgerSqlite.exec('COMMIT');}catch(e){ledgerSqlite.exec('ROLLBACK');throw e;}}};
  const batch=await (await routes.context.POST(request('/api/memory/context',{query:'unrelated',conversationId:'fixture',messageId:'user-1'}))).json();
  assert.equal(Object.keys(batch.additionalContext).sort().map(key=>batch.additionalContext[key].value).join(''),batch.context);
  assert.equal(batch.memories[0].id,saved.memory.id,'standing preference appears without a lexical hit');
  assert.deepEqual(JSON.parse(batch.context.slice(batch.context.indexOf('\n')+1)),batch.memories);
  assert.ok(batch.context.length<=4000 && Buffer.byteLength(batch.context,'utf8')<=6000);
  assert.equal((await (await routes.context.GET(request('/api/memory/context'))).json()).items.length,0);
  assert.equal((await routes.context.POST(request('/api/memory/context',{action:'acknowledge',deliveryId:batch.deliveryId,conversationId:'fixture',messageId:'user-1',turnId:'turn-1'}))).status,200);
  const delivered=await (await routes.context.GET(request('/api/memory/context?conversationId=fixture'))).json();
  assert.equal(delivered.items[0].context,batch.context);
  assert.equal((await routes.context.POST(request('/api/memory/context',{action:'feedback',deliveryId:batch.deliveryId,memoryId:saved.memory.id,kind:'changed'}))).status,200);
  const afterReview=await (await routes.tools.POST(request('/api/codex/tools',{name:'recall_vesper_memory',arguments:{query:'nebula'}}))).json();
  assert.equal(afterReview.result.memories.length,0,'pending corrections also disappear from active tool retrieval');
  delete globalThis.__sharedFixture.VESPER_MEMORY_CONTEXT_TRANSPORT;
  const beforeGate=ledgerSqlite.prepare('SELECT COUNT(*) AS n FROM memory_recall_deliveries').get().n;
  const gated=await (await routes.context.POST(request('/api/memory/context',{query:'tea',conversationId:'fixture',messageId:'unverified'}))).json();
  assert.equal(gated.status,'host_not_verified');assert.equal(gated.deliveryId,null);
  assert.equal(gated.context,'');assert.deepEqual(gated.memories,[]);assert.equal(gated.additionalContext,undefined);
  assert.equal(ledgerSqlite.prepare('SELECT COUNT(*) AS n FROM memory_recall_deliveries').get().n,beforeGate,'disabled transport must not prepare an injection');
  ledgerSqlite.close();
  delete globalThis.__sharedFixture.SHARED_MEMORY_DB;
  assert.equal((await routes.tools.POST(request('/api/codex/tools', { name: 'remember_vesper_memory', arguments: { body: 'must not fall back' } }))).status, 400);
  const failed=await routes.context.POST(request('/api/memory/context',{query:'test',conversationId:'fixture',messageId:'failure'}));
  assert.equal(failed.status,200);assert.equal((await failed.json()).context,'');
  console.log('PASS actual authenticated tool → shared DB → Memory page API → context/recall, no legacy DB fallback');
} finally { sqlite.close(); delete globalThis.__sharedFixture; await rm(directory, { recursive: true, force: true }); }
