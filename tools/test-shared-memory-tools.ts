import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { env } from 'cloudflare:workers';
import { sharedMemoryTool, recallSharedMemory } from '../lib/shared-memory-tools';
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync('tools/fixtures/shared-memory-schema.sql', 'utf8'));
const db = {
 prepare(sql: string) {
  const statement = sqlite.prepare(sql); let args: any[] = [];
  return { bind(...values: any[]) { args = values; return this; },
   async first() { return statement.get(...args) ?? null; },
   async all() { return { results: statement.all(...args) }; },
   async run() { return statement.run(...args); } };
 },
 async batch(statements: any[]) {
  sqlite.exec('BEGIN');
  try { for (const s of statements) await s.run(); sqlite.exec('COMMIT'); }
  catch(e) { sqlite.exec('ROLLBACK'); throw e; }
 }
};
const bindings = env as unknown as { SHARED_MEMORY_DB?: any };
await assert.rejects(sharedMemoryTool('remember_vesper_memory', { body: 'test' }, {}), /SHARED_MEMORY_DB/);
bindings.SHARED_MEMORY_DB = db;
const input = { body: '虚构测试：喜欢星河图标', type: 'long_term', kind: 'preference', source: 'fixture' };
const first: any = await sharedMemoryTool('remember_vesper_memory', input, { conversationId: 'test' });
assert.equal(first.storage, 'shared_memory'); assert.equal(first.stored, true);
assert.equal((await recallSharedMemory('星河')).memories[0].id, first.memory.id);
const repeated: any = await sharedMemoryTool('remember_vesper_memory', input, {});
assert.equal(repeated.duplicate, true);
const edited: any = await sharedMemoryTool('manage_vesper_memory', { action: 'edit', id: first.memory.id, body: '虚构测试：喜欢海浪图标', reason: '更正' }, {});
assert.equal(edited.memory.version, 2); assert.equal(edited.memory.versions.length, 2);
await assert.rejects(sharedMemoryTool('manage_vesper_memory', { action: 'delete', id: first.memory.id }, {}), /未修改/);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM memories').get()?.n, 2);
console.log('Shared tool save, readback, recall, deduplication, correction and fail-closed checks passed');
