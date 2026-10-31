import assert from 'node:assert/strict';
import {advertiseEvents} from '../bridge-worker/src/discovery.ts';
for(const result of [{protocolVersion:'2025-03-26',capabilities:{tools:{}}},{resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{}}}]) {
  const payload=JSON.stringify({jsonrpc:'2.0',id:1,result});
  const plain=JSON.parse(advertiseEvents(payload,'application/json'));
  assert.deepEqual(plain.result.capabilities.events,{});assert.deepEqual(plain.result.capabilities.tools,{});
  const event=advertiseEvents('event: message\ndata: '+payload+'\n\n','text/event-stream');
  assert.deepEqual(JSON.parse(event.match(/^data: (.+)$/m)[1]).result.capabilities.events,{});
}
const error=JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32601,message:'Not found'}});
assert.equal(advertiseEvents(error,'application/json'),error);
console.log('bridge event capability advertised in both MCP handshakes');
