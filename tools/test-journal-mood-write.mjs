import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import * as moods from '../lib/journal-moods.ts';

const original = {'2026-10-07': {user:'Vera text',agent:'Rowan text',moods:{user:['attached','future-tag'],agent:['tired'],extra:['keep']},moodUsedAt:{user:{attached:'before'},agent:{tired:'before'}},extra:{keep:true}},'2026-10-06':{agent:'Old day'},metadata:{version:2}};
let stored, conflict, dropped, blocked, writes;
function reset() { stored = JSON.stringify(original); conflict = dropped = blocked = false; writes = 0; }
reset();
const db = {prepare(sql) { let args = []; return {
  bind(...values) { args = values; return this; },
  async first() { return stored === null ? null : {value:stored}; },
  async run() {
    writes++;
    assert.match(sql, /WHERE vesper_documents.value = \?/);
    if (conflict) {
      conflict = false;
      const newer = JSON.parse(stored); newer['2026-10-07'].user = 'Concurrently edited Vera text'; newer['2026-10-08'] = {user:'New day'};
      stored = JSON.stringify(newer);
    }
    if (blocked || stored !== args[2]) return {meta:{changes:0}};
    stored = args[0];
    if (dropped) { const value = JSON.parse(stored); delete value['2026-10-07'].moods.agent; stored = JSON.stringify(value); }
    return {meta:{changes:1}};
  },
}; }};
function evaluate(path, mocks, suffix = '') {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8') + suffix,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,console,crypto,require:name => mocks[name] || {}});
  return exports;
}
const native = evaluate('lib/codex-tools.ts', {
  './journal-moods':moods,
  '@/db/schema':{allowedDocumentKeys:new Set(['diary'])},
  '@/lib/db':{ensureSchema:async()=>{},getDb:()=>db},
  './desire/tools':{desireTools:[]},
});
const catalog = evaluate('lib/codex-tool-definitions.ts', {'./journal-moods':moods,'./desire/tools':{desireToolDefinitions:[]}}).codexToolDefinitions;
const schema = catalog.find(tool => tool.name === 'journal_set_moods').inputSchema;
assert.deepEqual(Array.from(schema.required), ['date','moodIds']);
assert.equal(schema.properties.moodIds.items.enum.length, 24);
assert.equal(schema.properties.author, undefined);
const registrations = new Map();
const mcp = evaluate('mcp-server/src/index.ts', {
  '../../lib/journal-moods':moods,
  './diary':{isCalendarDate:value=>/^\d{4}-\d{2}-\d{2}$/.test(value)},
  '../../lib/desire/tools':{desireTools:[]},
  '@modelcontextprotocol/server':{McpServer:class {registerTool(name, definition, handler) { registrations.set(name,{definition,handler}); }}},
  './oauth':{createOAuth:()=>({})},
  zod:{z},
}, '\nexports.createTestServer = createServer;');
mcp.createTestServer({DB:db});
const tool = registrations.get('set_agent_diary_moods');
assert.ok(tool);
assert.equal(z.object(tool.definition.inputSchema).safeParse({date:'2026-10-07',moodIds:['invented']}).success,false);
for (const send of [args=>native.executeCodexTool('journal_set_moods',args), async args=>JSON.parse((await tool.handler(args)).content[0].text)]) {
  reset(); conflict = true;
  const saved = await send({date:'2026-10-07',moodIds:['calm','attached','calm']});
  assert.equal(saved.saved,true); assert.equal(saved.verified,true);
  assert.equal(saved.author,'Rowan'); assert.deepEqual(saved.entry.moodLabels.agent,['平静','依恋']);
  const value = JSON.parse(stored), entry = value['2026-10-07'];
  assert.equal(entry.user,'Concurrently edited Vera text'); assert.equal(entry.agent,original['2026-10-07'].agent);
  assert.deepEqual(entry.moods.user,original['2026-10-07'].moods.user);
  assert.deepEqual(entry.moods.extra,['keep']); assert.deepEqual(entry.extra,{keep:true});
  assert.deepEqual(entry.moodUsedAt.user,{attached:'before'}); assert.equal(entry.moodUsedAt.agent.tired,'before');
  assert.ok(entry.moodUsedAt.agent.calm); assert.ok(entry.moodUsedAt.agent.attached);
  assert.deepEqual(value['2026-10-06'],original['2026-10-06']); assert.deepEqual(value['2026-10-08'],{user:'New day'});
  assert.deepEqual(value.metadata,{version:2}); assert.equal(writes,2);
  const reread = await native.executeCodexTool('read_vesper_state',{section:'journal'});
  assert.deepEqual(Array.from(reread.value['2026-10-07'].moodLabels.agent),['平静','依恋']);
  const cleared = await send({date:'2026-10-07',moodIds:[]});
  assert.deepEqual(cleared.entry.moodLabels.agent,[]); assert.deepEqual(cleared.entry.moods.user,original['2026-10-07'].moods.user);
  for (const args of [{date:'2026-02-30',moodIds:['happy']},{date:'2026-10-07',moodIds:['invented']},{date:'2026-10-07',moodIds:'happy'},{date:'2026-10-07'}]) {
    const before = stored;
    await assert.rejects(send(args)); assert.equal(stored,before);
  }
  reset(); dropped = true;
  await assert.rejects(send({date:'2026-10-07',moodIds:['happy']}), /回读确认/);
  reset(); blocked = true;
  await assert.rejects(send({date:'2026-10-07',moodIds:['happy']}), /其他会话/);
  assert.equal(writes,3); assert.equal(stored,JSON.stringify(original));
  reset(); stored = null;
  const first = await send({date:'2026-10-07',moodIds:['curious']});
  assert.equal(first.verified,true); assert.deepEqual(first.entry.moodLabels.agent,['好奇']);
}
console.log('PASS native/MCP mood writes: readback, deduplication, clearing, calendar/ID validation, concurrent-edit preservation, new documents and failed saves');
