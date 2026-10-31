import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createBridge,listBridges,revokeBridge,userSend,userMessages,assistantMessages,assistantReply } from '../lib/conversation-bridge.ts';
const sqlite=new DatabaseSync(':memory:');
class Statement {
  constructor(sql,values=[]) { this.sql=sql; this.values=values; }
  bind(...values) { return new Statement(this.sql,values); }
  async run() { return sqlite.prepare(this.sql).run(...this.values); }
  async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return {results:sqlite.prepare(this.sql).all(...this.values)}; }
}
const db={prepare:sql=>new Statement(sql),batch:async statements=>Promise.all(statements.map(s=>s.run()))};
const a=await createBridge(db,'owner-a',{name:'Work A',provider:'work'});
const b=await createBridge(db,'owner-a',{name:'Muse',provider:'muse'});
const c=await createBridge(db,'owner-b',{name:'Work B',provider:'work'});
assert.equal((await listBridges(db,'owner-a')).bindings.length,2);
assert(!JSON.stringify(await listBridges(db,'owner-a')).includes(a.token));
await userSend(db,'owner-a',{bindingId:a.binding.id,id:'one',text:'private A'});
await userSend(db,'owner-a',{bindingId:b.binding.id,id:'two',text:'private B'});
assert.deepEqual((await assistantMessages(db,a.token)).messages.map(m=>m.text),['private A']);
assert.deepEqual((await assistantMessages(db,a.token)).pending.map(m=>m.id),['one']);
assert.deepEqual((await assistantMessages(db,b.token)).messages.map(m=>m.text),['private B']);
await assert.rejects(()=>userMessages(db,'owner-b',a.binding.id));
await assert.rejects(()=>assistantReply(db,a.token,{id:'reply',replyTo:'two',text:'wrong window'}));
await assistantReply(db,a.token,{id:'reply',replyTo:'one',text:'hello'});
assert.deepEqual((await assistantMessages(db,a.token)).pending,[]);
await assistantReply(db,a.token,{id:'reply',replyTo:'one',text:'hello'});
assert.equal((await userMessages(db,'owner-a',a.binding.id)).messages.length,2);
await assert.rejects(()=>assistantReply(db,a.token,{id:'reply',replyTo:'one',text:'different retry'}));
await revokeBridge(db,'owner-a',a.binding.id);
await assert.rejects(()=>assistantMessages(db,a.token));
assert.equal((await assistantMessages(db,b.token)).messages.length,1);
assert.equal((await assistantMessages(db,c.token)).messages.length,0);
console.log('conversation bridge: isolation, idempotency and revocation passed');
