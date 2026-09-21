import assert from 'node:assert/strict';
import { executionEvent, workspaceOptions } from '../app/codex-execution.ts';
import { mergeCodexMessages } from '../app/codex-message-merge.ts';
let state = executionEvent('item/started', { item: { id: 'exec-1', type: 'commandExecution', command: 'npm test', cwd: '/project', status: 'inProgress' } });
assert.equal(state.status, 'inProgress');
state = executionEvent('item/commandExecution/outputDelta', { itemId: 'exec-1', delta: 'one\n' }, state);
state = executionEvent('item/commandExecution/outputDelta', { itemId: 'exec-1', delta: 'two\n' }, state);
assert.equal(state.output, 'one\ntwo\n');
state = executionEvent('item/completed', { item: { id: 'exec-1', type: 'commandExecution', status: 'completed', aggregatedOutput: 'authoritative', exitCode: 1 } }, state);
assert.equal(state.output, 'authoritative'); assert.equal(state.status, 'failed');
assert.equal(executionEvent('item/started', { item: { id: 'exec-1', type: 'commandExecution', status: 'inProgress' } }, state).status, 'failed');
assert.equal(executionEvent('item/agentMessage/delta', { itemId: 'x', delta: 'hello' }), null);
assert.equal(executionEvent('item/completed', { item: { id: 'reason', type: 'reasoning', content: 'private' } }), null);
const large = executionEvent('item/commandExecution/outputDelta', { itemId: 'exec-2', delta: 'x'.repeat(30000) });
assert.equal(large.output.length, 24000); assert.equal(large.truncated, true);
assert.equal(executionEvent('item/completed', { item: { id: 'call', type: 'dynamicToolCall', success: false, contentItems: [{ text: 'denied' }] } }).status, 'failed');
const messages = ['a', 'b'].map(id => ({ id, role: 'system', content: 'npm test', createdAt: '2026-09-08T00:00:00Z', metadata: { itemId: id, turnId: 'turn' } }));
assert.equal(mergeCodexMessages(messages).length, 2, 'distinct executions must never deduplicate by command');
assert.equal(mergeCodexMessages(messages, messages).length, 2, 'snapshot replay remains idempotent');
assert.deepEqual(workspaceOptions('/home/ubuntu/Vesper'), { cwd: '/home/ubuntu/Vesper' });
assert.deepEqual(workspaceOptions(''), {});
assert.throws(() => workspaceOptions('relative/path'));
assert.throws(() => workspaceOptions('/project\nother'));
console.log('Execution event, replay, output limits, failed status and workspace checks passed');

assert.equal(executionEvent('item/commandExecution/outputDelta', { itemId: 'exec-1', delta: 'duplicate output' }, state).output, 'authoritative');
const done = { id: 'exec', role: 'system', content: 'terminal', createdAt: '2026-09-08T00:00:00Z', status: 'completed', metadata: { itemId: 'exec', execution: { ...state, status: 'completed', updatedAt: '2026-09-08T00:00:02Z' } } };
const stale = { ...done, status: 'inProgress', metadata: { ...done.metadata, execution: { ...done.metadata.execution, status: 'inProgress', output: 'partial', updatedAt: '2026-09-08T00:00:03Z' } } };
for (const sources of [[done, stale], [stale, done]]) {
  const merged = mergeCodexMessages(sources);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].metadata.execution.status, 'completed');
  assert.equal(merged[0].metadata.execution.output, 'authoritative');
}
console.log('Late output and stale running snapshots cannot replay or regress completed execution');

const { formatExecutionOutput, executionFiles } = await import('../app/codex-execution.ts');
const wrapped = JSON.stringify([{ type: 'inputText', text: JSON.stringify({ section: 'today', value: [{ title: '整理宿舍', done: false }] }) }]);
assert.equal(formatExecutionOutput(wrapped), JSON.stringify({ section: 'today', value: [{ title: '整理宿舍', done: false }] }, null, 2));
assert.equal(formatExecutionOutput('{broken'), '{broken');
assert.equal(formatExecutionOutput([{ type: 'text', text: '<script>example</script>' }]), '<script>example</script>');
const patch = '@@ -1 +1 @@\n-old\n+' + 'new code '.repeat(3500);
const fileEvent = executionEvent('item/completed', { item: { id: 'files', type: 'fileChange', changes: [{ path: 'a.ts', kind: { type: 'update' }, diff: patch }, { path: 'b.ts', kind: 'add', diff: '+hello' }] } });
assert.equal(fileEvent.files[0].diff, patch, 'patches larger than the old log limit must retain their beginning and end');
assert.equal(fileEvent.files[1].diff, '+hello');
assert.equal(fileEvent.output, '', 'avoid duplicating patches as unreadable JSON');
assert.ok(!fileEvent.filesTruncated);
const huge = executionEvent('item/completed', { item: { id: 'huge', type: 'fileChange', aggregatedOutput: '\u0000'.repeat(30000), changes: [{ path: 'big.ts', diff: '+'.repeat(200000) }] } });
assert.ok(huge.filesTruncated && huge.files[0].truncated && huge.truncated);
assert.ok(JSON.stringify(huge).length < 128000, 'escaped output and patches must fit the persistence limit together');
assert.equal(executionFiles([{ path: 'only-path.ts' }]).files[0].diff, '', 'never invent missing code');
assert.deepEqual(executionFiles(null).files, []);
assert.equal(executionEvent('item/fileChange/outputDelta', { itemId: 'files', delta: 'late' }, fileEvent), fileEvent);
console.log('Nested tool results, complete patches, missing-code and serialized storage limits passed');

const escapedMetadata = executionEvent('item/completed', { item: { id: 'escaped-meta', type: 'fileChange', command: '\u0000'.repeat(3000), cwd: '\u0000'.repeat(1000), aggregatedOutput: '\u0000'.repeat(24000), changes: [{ path: 'a.ts', kind: 'update'.repeat(100000), diff: '+'.repeat(60000) }] } });
assert.ok(JSON.stringify(escapedMetadata).length < 128000, 'full execution including escaped metadata stays within persistence budget');

// Production legacy records may have an execution object without an execution ID.
const { savedExecution } = await import('../app/codex-execution.ts');
const legacy = { title: 'old tool', result: { ok: true }, files: [{ path: 'a.ts', diff: null }] };
const before = JSON.stringify(legacy);
const restored = savedExecution(legacy, 'history-message-1', '2026-09-21T00:00:00Z');
assert.equal(restored.id, 'history-message-1');
assert.equal(restored.id.startsWith('turn:'), false);
assert.equal(restored.status, 'unknown');
assert.equal(restored.output, JSON.stringify({ ok: true }, null, 2));
assert.equal(restored.files[0].diff, '');
assert.equal(JSON.stringify(legacy), before, 'display normalization must not mutate stored evidence');
for (const value of [null, [], true, { id: 7, title: {}, output: null }]) {
  const row = savedExecution(value, 'fallback', '');
  assert.equal(row.id, 'fallback');
  assert.equal(typeof row.title, 'string');
  assert.equal(typeof row.output, 'string');
}
assert.equal(savedExecution({ id: 'turn:summary', output: 'saved text' }, 'message', '').id, 'turn:summary');
assert.equal(savedExecution({ id: 'tool', output: 'exact\n output' }, 'message', '').output, 'exact\n output');
console.log('Partial legacy execution metadata renders safely without changing stored history');
