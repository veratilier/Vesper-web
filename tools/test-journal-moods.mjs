import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { journalForRead, journalEntryForRead, journalMoodLabels } from '../lib/journal-moods.ts';
const original = {user:'Vera text',agent:'Rowan text',moods:{user:['attached','missing','future-mood'],agent:['tired']},moodUsedAt:{user:{attached:'now'}},extra:{keep:true}};
const diary = {'2026-10-07':original,'2026-10-06':{agent:'Old entry'},metadata:{version:2}};
const read = journalForRead(diary);
assert.deepEqual(read['2026-10-07'].moodLabels,{user:['依恋','想念','future-mood'],agent:['疲惫']});
assert.deepEqual(read['2026-10-07'].moods,original.moods);
assert.deepEqual(read['2026-10-07'].moodUsedAt,original.moodUsedAt);
assert.deepEqual(read.metadata,diary.metadata);
assert.equal(original.moodLabels,undefined);
assert.deepEqual(read['2026-10-06'].moodLabels,{user:[],agent:[]});
assert.equal(journalEntryForRead(null),null);
assert.equal(Object.keys(journalMoodLabels).length,24);
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/codex-tools.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {exports,console,crypto,require(name) {
  if(name==='./journal-moods') return {journalForRead};
  if(name==='@/db/schema') return {allowedDocumentKeys:new Set(['diary','todos','notes','anniversaries','settings','music'])};
  if(name==='@/lib/db') return {ensureSchema:async()=>{},getDb:()=>({prepare:()=>({bind:key=>({first:async()=>({value:JSON.stringify(key==='diary'?diary:[])})})})})};
  if(name==='./desire/tools') return {desireTools:[]};
  return {};
}});
for(const section of ['journal','diary']) {
  const result = await exports.executeCodexTool('read_vesper_state',{section});
  assert.deepEqual(JSON.parse(JSON.stringify(result.value)),read);
}
const search = await exports.executeCodexTool('search_vesper_state',{query:'依恋'});
assert.ok(search.matches.some(match=>match.section==='journal' && match.value['2026-10-07'].moodLabels.user.includes('依恋')));
console.log('Journal tools return date/author-specific Chinese moods, retain unknown data, and search Chinese labels; no storage mutations');
