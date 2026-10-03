import assert from 'node:assert/strict';
import { NATIVE_WAKE_HEADER as header, visibleUserContext, visibleUserItem } from '../lib/web-chat-context.ts';
import { mergeCodexMessages } from '../app/codex-message-merge.ts';
const records = [{ messageId: 'wake:auto-1790982000:final', createdAt: '2026-10-02T23:01:59Z', content: '旧消息 [括号] "引号" \\转义\n第二行', excerptTruncated: false }];
const envelope = header + '\n' + JSON.stringify(records, null, 2);
const user = '有一点，还好，至少早起了，目标达成';
assert.equal(visibleUserContext(envelope + '\n' + user), user);
assert.equal(visibleUserContext(envelope), '');
assert.equal(visibleUserContext(envelope + '\n' + envelope + '\n' + user), user);
assert.equal(visibleUserItem({ content: [{ type: 'inputText', text: envelope }, { type: 'image', url: 'photo' }, { type: 'inputText', text: user }] }), user);
assert.equal(visibleUserItem({ text: envelope + '\n' + user }), user);
for (const genuine of [JSON.stringify(records), '请解释这句话：' + envelope, header, header + '\n[{broken]', header + '\n[{"content":"my JSON"}]', user]) {
  assert.equal(visibleUserContext(genuine), genuine, 'Unrecognized input and genuine prose must survive');
}
const original = { id: 'local', role: 'user', conversationId: 'chat-a', content: user, createdAt: '2026-10-03T08:15:00Z', metadata: { turnId: 'turn-a' } };
const snapshot = { ...original, id: 'snapshot', content: envelope + '\n' + user, metadata: { turnId: 'turn-a', itemId: 'input-a' } };
for (const groups of [[[original], [snapshot]], [[snapshot], [original]]]) {
  const result = mergeCodexMessages(...groups);
  assert.equal(result.length, 1, 'Restoring a model input must not duplicate the actual user message');
  assert.equal(result[0].content, user);
  assert.equal(result[0].createdAt, original.createdAt);
}
assert.equal(snapshot.content, envelope + '\n' + user, 'Never mutate stored or transport inputs');
const assistant = { ...snapshot, role: 'agent' };
assert.equal(mergeCodexMessages([assistant])[0].content, assistant.content);
console.log('Web chat context: mixed inputs, multipart snapshots, replay and genuine JSON preservation passed');
