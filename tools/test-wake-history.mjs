import assert from 'node:assert/strict';
import { readWakeHistory } from '../lib/wake-history.ts';
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://codex.r-vera.com/history/conversations/chat%2Fa/wake-history');
  assert.equal(options.headers.authorization, 'Bearer fixture');
  assert.equal(options.redirect, 'manual');
  return Response.json({messages:[{id:'silent',role:'system',content:'activity',createdAt:'2026-09-10',metadata:{wake:{messageOmitted:true},wakeRunId:'run'}}]});
};
let result = await readWakeHistory('chat/a','fixture');
assert.equal(result.available,true);
assert.equal(result.records[0].metadata.wake.messageOmitted,true);
globalThis.fetch = async () => new Response('',{status:404});
result = await readWakeHistory('chat/a','fixture');
assert.equal(result.available,false);
assert.match(result.note,/does not mean no wake/);
console.log('Silent wake history and unavailable-service checks passed');

let calls = 0;
globalThis.fetch = async (url, options) => {
  calls++;
  assert.equal(options.redirect, 'manual');
  return calls === 1 ? new Response(null, {status: 302, headers: {location: '/history/conversations/chat/wake-history/'}}) : Response.json({messages:[]});
};
assert.equal((await readWakeHistory('chat','fixture')).available,true);
assert.equal(calls,2);
for (const location of ['https://untrusted.example/capture', '/history/conversations/another/wake-history']) {
  calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location}});};
  const denied=await readWakeHistory('chat','fixture');
  assert.equal(denied.available,false);assert.equal(denied.failureReason,'redirect_blocked');assert.equal(calls,1);
}
calls=0;
globalThis.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:'/history/conversations/chat/wake-history'}});};
assert.equal((await readWakeHistory('chat','fixture')).available,false);
assert.equal(calls,3);
console.log('History redirect origin/path isolation and loop bound passed');
