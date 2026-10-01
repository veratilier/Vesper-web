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
globalThis.__sharedFixture = { SHARED_MEMORY_DB: db, VESPER_APP_TOKEN: 'fixture-token', DB: { prepare() { throw new Error('Legacy DB must not be accessed by shared tools'); } } };
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
  delete globalThis.__sharedFixture.SHARED_MEMORY_DB;
  assert.equal((await routes.tools.POST(request('/api/codex/tools', { name: 'remember_vesper_memory', arguments: { body: 'must not fall back' } }))).status, 400);
  console.log('PASS actual authenticated tool → shared DB → Memory page API → context/recall, no legacy DB fallback');
} finally { sqlite.close(); delete globalThis.__sharedFixture; await rm(directory, { recursive: true, force: true }); }
