import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let calls = [], uploads = [], failure;
const bytes = Buffer.from([137,80,78,71,13,10,26,10,255]);
let reply = { base64: bytes.toString('base64'), mimeType: 'image/png', digest: 'a'.repeat(64) };
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/generated-chat-files.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, encodeURIComponent, require(name) {
  if (name === './chat-keeps') return { historyRead: async (path, body) => { calls.push({path, body}); if (failure) throw failure; return reply; } };
  if (name === './codex-artifacts') return { createChatFile: async (input, owner, origin) => { uploads.push({input, owner, origin}); return {key:'actual.png',type:input.mimeType,size:Buffer.from(input.base64 || '', 'base64').length}; } };
  throw new Error(name);
} });
const context = { conversationId:'chat',threadId:'thread',origin:'https://vesper.test' };
const generated = {files:[{name:'night.png',path:'/home/ubuntu/.codex/generated_images/thread/generated.png',mimeType:'text/plain'}]};
const result = await exports.deliverChatFiles(generated, 'owner', context);
assert.equal(result.attachments[0].type,'image/png');
assert.equal(result.attachments[0].size,bytes.length);
assert.equal(calls[0].path,'/conversations/chat/generated-image');
assert.equal(calls[0].body.threadId,'thread');
assert.deepEqual(Buffer.from(uploads[0].input.base64,'base64'),bytes);
assert.equal(uploads[0].owner,'owner');
await assert.rejects(exports.deliverChatFiles(generated,'owner',{...context,threadId:undefined}));
await assert.rejects(exports.deliverChatFiles({files:[{...generated.files[0],base64:'AA=='}]},'owner',context));
const count=uploads.length;
failure=new Error('Generated image belongs to a different conversation');
await assert.rejects(exports.deliverChatFiles(generated,'owner',context),/different conversation/);
assert.equal(uploads.length,count);
failure=undefined; reply={base64:'AA==',mimeType:'text/plain',digest:'a'.repeat(64)};
await assert.rejects(exports.deliverChatFiles(generated,'owner',context),/not confirmed/);
await exports.deliverChatFiles({files:[{name:'text.txt',text:'complete text'}]},'owner',context);
assert.equal(uploads.at(-1).input.text,'complete text');
console.log('Generated image path → private history bytes → image attachment; context, provenance, failures and text compatibility passed');
