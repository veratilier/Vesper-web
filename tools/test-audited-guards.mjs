import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { build } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const page = await readFile('app/page.tsx', 'utf8');
const helper = page.slice(page.indexOf('  const finishFailedTurn ='), page.indexOf('  const handleSocketMessage ='));
const code = ts.transpileModule(helper + '\nglobalThis.finish = finishFailedTurn;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  let result = { busy: true, settled: 0, flushes: 0, updates: [], approvals: [], questions: [{ params: { turnId: 't1' } }, { params: { turnId: 't2' } }] };
  const ref = current => ({ current });
  const context = { Date, Set, Map, activeTurnId: ref('t1'), activeTurnUserId: ref('u1'), threadId: ref('thread'), completedQuestionTurns: ref(new Set()),
    sending: ref(true), streamBuffers: ref(new Map([['x','partial']])), streamStartedAt: ref(new Map([['x',1]])), reasoningBuffers: ref(new Map()), reasoningSummaries: ref(['thought']), pendingAgentStickers: ref([{}]), turnDone: ref(() => result.settled++),
    clearApprovalQueue: value => result.approvals.push(value), setToolQuestions: fn => { result.questions = fn(result.questions); }, flushExecutions: () => result.flushes++,
    updateMessage: (id, fn) => result.updates.push({ id, value: fn({ metadata: { wake: { startedAt: 'before' } } }) }),
    setBusy: value => { result.busy = value; }, setError: value => { result.error = value; }, setStreamingItems: value => { result.streaming = value; },
  };
  vm.runInNewContext(code, context);
  return { context, result };
}
for (const reason of ['failed', 'aborted', 'disconnected', 'cancelled']) {
  const { context: c, result: r } = fixture();
  c.finish(reason, 't1');
  assert.equal(r.busy, false); assert.equal(c.sending.current, false); assert.equal(r.settled, 1);
  assert.equal(r.updates[0].value.status, 'error'); assert.ok(r.updates[0].value.metadata.wake.endedAt);
  assert.equal(r.questions.length, 1); assert.equal(r.questions[0].params.turnId, 't2');
  assert.equal(c.streamBuffers.current.size, 0); assert.equal(c.activeTurnId.current, '');
  c.finish(reason, 't1'); assert.equal(r.settled, 1, 'duplicate terminal events must be harmless');
}
{
  const { context: c, result: r } = fixture();
  c.finish('stale cancellation', 'old');
  assert.equal(r.busy, true); assert.equal(r.settled, 0); assert.equal(c.activeTurnId.current, 't1');
}
// Exercise the actual notification-dispatch block, including both compatibility methods.
const terminalDispatch = page.slice(page.indexOf('    if (message.method === "turn/failed"'), page.indexOf('    // App-server versions have used'));
for (const method of ['turn/failed', 'turn/aborted']) {
  const calls = [];
  const dispatch = ts.transpileModule('(function () {' + terminalDispatch + '})()', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(dispatch, { message: { method }, params: { turn: { id: 't1' }, error: { message: 'failure detail' } }, finishFailedTurn: (...args) => calls.push(args) });
  assert.deepEqual(calls, [['failure detail', 't1']]);
}

const directory = await mkdtemp(join(tmpdir(), 'vesper-push-guard-'));
try {
  const output = join(directory, 'push.mjs');
  await build({ entryPoints: ['app/api/push/route.ts'], outfile: output, bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'isolated', setup(b) {
    b.onResolve({ filter: /^(cloudflare:workers|@\/lib\/(db|bridge-auth)|@mmmike\/web-push\/send)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.includes('bridge-auth')
      ? 'export async function authorizeApp(request) { return request.headers.get("x-vesper-device-token") === "fixture-valid"; }'
      : args.path.endsWith('/db') ? 'export async function ensureSchema() { globalThis.schemaCalls++; } export function getDb() { throw new Error("Unexpected database access"); }'
      : args.path.includes('web-push') ? 'export function sendPushNotification() { throw new Error("Unexpected push delivery"); }'
      : 'export const env = {};', loader: 'js' }));
  } }] });
  const { POST } = await import(pathToFileURL(output));
  globalThis.schemaCalls = 0;
  const rejected = await POST(new Request('https://fixture/api/push', { method: 'POST', body: 'not-json' }));
  assert.equal(rejected.status, 401); assert.equal(globalThis.schemaCalls, 0, 'auth must precede schema and body processing');
  const paired = await POST(new Request('https://fixture/api/push', { method: 'POST', headers: { 'x-vesper-device-token': 'fixture-valid' }, body: '{}' }));
  assert.equal(paired.status, 400); assert.equal(globalThis.schemaCalls, 1, 'paired requests reach existing validation');
} finally { await rm(directory, { recursive: true, force: true }); }
console.log('Audited guards: terminal lifecycle, stale/duplicate notifications and push authorization passed');
