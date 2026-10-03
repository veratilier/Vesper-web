import assert from 'node:assert/strict';
import { startTerminalFeed } from '../lib/chat-terminal-feed.ts';
class Visibility extends EventTarget { visibilityState = 'visible'; flip(value: string) { this.visibilityState = value; this.dispatchEvent(new Event('visibilitychange')); } }
const visibility = new Visibility();
let requests = 0, signals: AbortSignal[] = [], pending: ((r: Response) => void)[] = [], screens: string[] = [], errors: string[] = [];
const stop = startTerminalFeed({ conversationId: 'chat-a', interval: 5, visibility: visibility as unknown as Document,
  request: signal => { requests++; signals.push(signal); return new Promise(resolve => pending.push(resolve)); },
  onFrame: frame => screens.push(frame.screen || ''), onError: error => errors.push(error), onHidden: () => {},
});
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
visibility.flip('visible'); visibility.flip('visible');
assert.equal(requests, 1, 'Visibility wake-ups must not overlap requests');
pending.shift()!(Response.json({ conversationId: 'chat-a', screen: 'live output 1', running: true }));
await tick();
assert.deepEqual(screens, ['live output 1']);
assert.equal(requests, 2, 'New live output is fetched automatically');
visibility.flip('hidden');
pending.shift()!(Response.json({ conversationId: 'chat-a', screen: 'hidden response' }));
await tick();
assert.equal(requests, 2, 'No polling in background');
assert.deepEqual(screens, ['live output 1']);
visibility.flip('visible');
assert.equal(requests, 3);
pending.shift()!(Response.json({ conversationId: 'chat-other', screen: 'wrong session', records: [{ output: 'saved log' }] }));
await tick();
assert.equal(errors.length, 1);
assert.deepEqual(screens, ['live output 1'], 'Reject another chat and never substitute its historical records');
visibility.flip('visible');
assert.equal(requests, 4, 'Foreground wake retries after errors');
stop();
assert.equal(signals.at(-1)?.aborted, true);
pending.shift()!(Response.json({ conversationId: 'chat-a', screen: 'late response' }));
await tick();
assert.deepEqual(screens, ['live output 1'], 'Unmount cancels writes to the UI');
visibility.flip('visible');
assert.equal(requests, 4);
console.log('Live terminal feed: serial polling, foreground resume, session isolation and teardown passed');
