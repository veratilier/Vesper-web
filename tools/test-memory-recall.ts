import { memoryAdditionalContext } from '../lib/memory-transport';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { saveMemory, getMemory, withdrawMemory } from '../lib/shared-memory-engine';
import { prepareRecall, acknowledgeRecall, recentRecall, recallFeedback, RECALL_CHAR_BUDGET } from '../lib/shared-memory-recall';
function database(){const sqlite=new DatabaseSync(':memory:');return {sqlite,db:{prepare(sql:string){let values:unknown[]=[];return {bind(...args:unknown[]){values=args;return this;},async first(){return sqlite.prepare(sql).get(...values as any[])??null;},async all(){return {results:sqlite.prepare(sql).all(...values as any[])};},run(){return sqlite.prepare(sql).run(...values as any[]);}};},async batch(statements:any[]){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}} as any};}
const memory=database(),ledger=database();memory.sqlite.exec(readFileSync('tools/fixtures/shared-memory-schema.sql','utf8'));
const save=(body:string,kind='episode',extra={})=>saveMemory(memory.db,{body,kind,source:'fictional test only',...extra});
const prefs=await save('不用 emoji；语音仅用英文。','agreement');
const tea=await save('更喜欢茶本身，不喜欢甜点。','preference');
const swing=await save('虚构验收：在楼下秋千上通话。','episode',{occurred_at:'2026-10-01T20:00:00+08:00',details:{title:'虚构秋千通话',evidence:[{conversation_id:'fiction',message_id:'fixture',quote:'楼下秋千'}]}});
await save('虚构秋千梦境','dream');await save('秋千让我感到平静','reflection');
const prepare=(query:string,messageId=crypto.randomUUID(),recent:any[]=[])=>prepareRecall(memory.db,ledger.db,{query,conversationId:'fixture-chat',messageId,recent});
const first=await prepare('秋千');assert.equal(first.status,'prepared');assert.equal((await recentRecall(ledger.db)).items.length,0);
assert.deepEqual(new Set(first.memories.map(m=>m.id)),new Set([prefs.id,tea.id,swing.id]));
assert.ok(first.context.includes('2026-10-01T12:00:00.000Z'));assert.ok(first.context.length<=RECALL_CHAR_BUDGET);assert.ok(!first.context.includes('梦境'));
await assert.rejects(acknowledgeRecall(ledger.db,{deliveryId:first.deliveryId,conversationId:'other',messageId:first.messageId,turnId:'t1'}),/delivery_not_found/);
await acknowledgeRecall(ledger.db,{deliveryId:first.deliveryId,conversationId:'fixture-chat',messageId:first.messageId,turnId:'t1'});
assert.equal((await recentRecall(ledger.db)).items[0].context,first.context);
await assert.rejects(acknowledgeRecall(ledger.db,{deliveryId:first.deliveryId,conversationId:'fixture-chat',messageId:first.messageId,turnId:'t2'}),/delivery_turn_conflict/);
assert.equal((await prepare('unrelated')).memories.length,2);assert.equal((await prepare('秋千')).memories.length,2,'episodes cool down but standing preferences repeat');
await recallFeedback(ledger.db,{deliveryId:first.deliveryId,memoryId:tea.id,kind:'changed'},memory.db);
assert.ok(!(await prepare('茶')).memories.some(m=>m.id===tea.id));
assert.ok((await getMemory(memory.db,tea.id)).review);
const corrected=await saveMemory(memory.db,{id:tea.id,body:'现在可以接受少量甜点。',kind:'preference',source:tea.source,correction_reason:'虚构偏好纠正'},true);
assert.ok((await prepare('茶')).memories.some(m=>m.id===corrected.id),'a new corrected version is usable');
assert.ok(!(await prepare('茶')).memories.some(m=>m.id===tea.id));
assert.ok((await getMemory(memory.db,tea.id)).review);
await withdrawMemory(memory.db,prefs.id,'虚构撤回');assert.ok(!(await prepare('emoji')).memories.some(m=>m.id===prefs.id));
assert.equal((await getMemory(memory.db,prefs.id)).body,prefs.body);assert.ok((await getMemory(memory.db,prefs.id)).withdrawal);
assert.equal((await getMemory(memory.db,swing.id)).details.title,'虚构秋千通话');
await assert.rejects(saveMemory(memory.db,{id:prefs.id,body:'stale',kind:'agreement',source:'fixture',correction_reason:'stale'},true),/stale_version/);
const other=await prepareRecall(memory.db,ledger.db,{query:'再聊聊吧',recent:[{role:'user',content:'楼下秋千'}],conversationId:'another-chat',messageId:'context'});
assert.ok(other.memories.some(m=>m.id===swing.id));
const race=await Promise.all([prepare('秋千','same-message'),prepare('茶','same-message')]);assert.notEqual(race[0].deliveryId,race[1].deliveryId,'preparations have immutable distinct snapshots');
await withdrawMemory(memory.db,corrected.id,'test');await withdrawMemory(memory.db,swing.id,'test');
assert.equal((await prepare('不存在的旧事')).context,'');
const unknown=await save('日期未知的虚构星河事件');assert.equal((await getMemory(memory.db,unknown.id)).occurred_at,null);
console.log('PASS recall: standing preferences, episodes, context, cooldown, immutable receipts, changed/corrected, withdrawal, nonfacts, empty/unknown dates');

const longContext='茶与星河 🌙'.repeat(3000);const fragments=memoryAdditionalContext(longContext);
assert.equal(Object.keys(fragments).sort().map(k=>fragments[k].value).join(''),longContext);
assert.ok(Object.values(fragments).every(part=>Buffer.byteLength(part.value,'utf8')<=768));
console.log('PASS lossless bounded host fragments; disabled until deployed schema is verified');

// Compact payload acceptance: only fictitious records in isolated databases.
const compactDb=database(),compactLedger=database();
compactDb.sqlite.exec(readFileSync('tools/fixtures/shared-memory-schema.sql','utf8'));
const addCompact=(body:string,kind='episode',extra={})=>saveMemory(compactDb.db,{body,kind,source:'fictional compact fixture',...extra});
const shortPreference=await addCompact('  不使用 emoji；\n除非我主动要求。  ','preference');
const longPreference=await addCompact('完整偏好及条件。'.repeat(80)+'例外：我主动要求时可以。','agreement',{details:{summary:'默认不使用表情；用户主动要求时可以。'}});
const unsafePreference=await addCompact('一段复杂约定。'.repeat(100)+'但只在用户同意时适用。','agreement');
for(let index=0;index<4;index++)await addCompact(`星港共同经历 ${index}。`+'原文不应自动注入。'.repeat(300),'episode',{
 occurred_at:index===0?null:'2026-10-01T20:00:00+08:00',source_url:`https://example.test/events/${index}`,
 details:{summary:`星港：虚构旧事 ${index} 的简短摘要。`,evidence:Array.from({length:3},(_,n)=>({
  conversation_id:'fictional-room',message_id:`fixture-${index}-${n}`,quote:'原话引用不应自动注入。'.repeat(100),created_at:null
 }))}
});
const compact=await prepareRecall(compactDb.db,compactLedger.db,{query:'星港',conversationId:'compact',messageId:'compact-1'});
const {RECALL_BYTE_BUDGET,RECALL_EPISODE_LIMIT}=await import('../lib/shared-memory-recall');
function exactCompact(batch:typeof compact){
 assert.ok(batch.context.length<=RECALL_CHAR_BUDGET);
 assert.ok(Buffer.byteLength(batch.context,'utf8')<=RECALL_BYTE_BUDGET);
 assert.deepEqual(JSON.parse(batch.context.slice(batch.context.indexOf('\n')+1)),batch.memories,'ledger has exactly injected objects, not full originals');
 const parts=memoryAdditionalContext(batch.context);
 assert.equal(Object.keys(parts).sort().map(key=>parts[key].value).join(''),batch.context);
}
exactCompact(compact);
assert.equal(compact.memories.filter(m=>m.reason==='related_history').length,RECALL_EPISODE_LIMIT);
assert.equal(compact.memories.find(m=>m.id===shortPreference.id)?.body,'不使用 emoji； 除非我主动要求。');
assert.equal(compact.memories.find(m=>m.id===longPreference.id)?.body_format,'summary');
assert.ok(!compact.memories.some(m=>m.id===unsafePreference.id),'do not cut off preference conditions');
assert.ok('warnings' in compact && compact.warnings.includes('standing_preferences_omitted_for_compact_budget'));
assert.ok(!compact.context.includes('原文不应自动注入'));
assert.ok(!compact.context.includes('原话引用不应自动注入'));
for(const item of compact.memories.filter(m=>m.reason==='related_history')){
 assert.ok(item.body.length<=240);assert.equal(item.body_format,'summary');
 assert.equal(item.details?.evidence.length,2);assert.ok(item.source_url);
 assert.ok(item.id&&item.root_id&&item.kind&&item.recorded_at);
 assert.equal(Object.hasOwn(item.details!.evidence[0],'quote'),false);
 const original=await getMemory(compactDb.db,item.id);
 assert.equal(item.occurred_at,original.occurred_at);
 assert.ok(original.body.includes('原文不应自动注入'));
 assert.equal(original.details.evidence.length,3,'full references remain retrievable by ID');
}
await acknowledgeRecall(compactLedger.db,{deliveryId:compact.deliveryId,conversationId:'compact',messageId:'compact-1',turnId:'compact-turn'});
const stored=(await recentRecall(compactLedger.db)).items[0];
assert.equal(stored.context,compact.context);assert.deepEqual(stored.memories,compact.memories);
const retry=await prepareRecall(compactDb.db,compactLedger.db,{query:'别的话题',conversationId:'compact',messageId:'compact-1'});
assert.equal(retry.deliveryId,compact.deliveryId);assert.equal(retry.context,compact.context);
// Metadata also consumes the budget; never truncate a source URL to squeeze it in.
const oversize=await addCompact('星港巨长来源','episode',{source_url:'https://example.test/'+ 'x'.repeat(7000)});
for(let i=0;i<15;i++)await addCompact(`有效偏好 ${i}：`+'请保留条件。'.repeat(15),'preference');
const crowded=await prepareRecall(compactDb.db,compactLedger.db,{query:'星港',conversationId:'crowded',messageId:'crowded-1'});
exactCompact(crowded);assert.ok('warnings' in crowded && crowded.warnings.length);
assert.ok(!crowded.memories.some(m=>m.id===oversize.id));
assert.ok(crowded.memories.filter(m=>m.reason==='related_history').length>=1,'standing budget still reserves room for a related episode');
assert.ok(crowded.memories.filter(m=>m.reason==='related_history').length<=2);
// Missing summaries fall back to explicitly labelled bounded excerpts, not invented summaries.
const excerptDb=database(),excerptLedger=database();excerptDb.sqlite.exec(readFileSync('tools/fixtures/shared-memory-schema.sql','utf8'));
const excerptOriginal='星港'+ '🌙'.repeat(200)+'末尾';
await saveMemory(excerptDb.db,{body:excerptOriginal,kind:'episode',source:'fictional excerpt'});
const clipped=await prepareRecall(excerptDb.db,excerptLedger.db,{query:'星港',conversationId:'excerpt',messageId:'excerpt-1'});
exactCompact(clipped);assert.equal(clipped.memories[0].body_format,'excerpt');
assert.equal(clipped.memories[0].occurred_at,null);assert.ok(clipped.memories[0].body.length<=240);
assert.ok(excerptOriginal.startsWith(clipped.memories[0].body.slice(0,-1)));assert.ok(clipped.memories[0].body.endsWith('…'));
assert.ok(!clipped.context.includes('\ufffd'));
console.log(`PASS compact recall: <=${RECALL_CHAR_BUDGET} chars / ${RECALL_BYTE_BUDGET} UTF-8 bytes, 2 episodes, exact ledger/transport, safe preferences, original retrieval, Unicode excerpts, crowded budgets`);
