import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserStorage } from '../lib/browser-storage.ts';

function fixture() {
  const original = new Map([
    ['vesper-device-token', 'test-only-credential'],
    ['vesper-local-profile', '{"userName":"Existing"}'],
    ['vesper-codex-chat-one', '[{"content":"existing history"}]'],
  ]);
  const disk = new Map();
  let full = true;
  let writes = 0;
  let broken = false;
  const local = {
    getItem: key => original.get(key) ?? null,
    setItem: (key, value) => {
      writes++;
      if (full) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      original.set(key, value);
    },
    removeItem: key => { original.delete(key); },
    key: index => [...original.keys()][index] ?? null,
    get length() { return original.size; },
  };
  const overflow = {
    load: async () => [...disk],
    put: async (key, value) => {
      if (broken) throw new Error('Unavailable');
      disk.set(key, value);
    },
  };
  return { original, disk, local, overflow, create: () => createBrowserStorage(() => local, overflow),
    unfill: () => { full = false; }, break: () => { broken = true; }, repair: () => { broken = false; }, writes: () => writes };
}

test('full localStorage does not crash; profile and history survive a reload without clearing old data', async () => {
  const f = fixture();
  const before = [...f.original];
  const s = f.create();
  await s.initialize();
  const profile = JSON.stringify({ userName: 'Updated', avatar: 'data:image/png;base64,TEST' });
  assert.doesNotThrow(() => s.setItem('vesper-local-profile', profile));
  s.setItem('vesper-codex-chat-one', '[{"content":"existing history"},{"content":"new"}]');
  s.setItem('vesper-codex-chat-backup-one', '[{"content":"existing history"},{"content":"new"}]');
  assert.equal(s.getItem('vesper-local-profile'), profile);
  assert.equal(s.status(), 'saving');
  await s.flush();
  assert.equal(s.status(), 'ready');
  assert.deepEqual([...f.original], before);
  const reload = f.create();
  await reload.initialize();
  assert.equal(reload.getItem('vesper-local-profile'), profile);
  assert.match(reload.getItem('vesper-codex-chat-one'), /existing history.*new/);
  assert.equal(reload.getItem('vesper-device-token'), 'test-only-credential');
  assert.ok(reload.keys().includes('vesper-codex-chat-backup-one'));
});

test('identical values avoid unnecessary writes and overflow stays authoritative when quota becomes available', async () => {
  const f = fixture();
  const s = f.create();
  await s.initialize();
  s.setItem('vesper-local-profile', f.original.get('vesper-local-profile'));
  assert.equal(f.writes(), 0);
  s.setItem('vesper-local-profile', 'first');
  await s.flush();
  f.unfill();
  s.setItem('vesper-local-profile', 'last');
  await s.flush();
  const reload = f.create();
  await reload.initialize();
  assert.equal(reload.getItem('vesper-local-profile'), 'last');
});

test('rapid streaming writes preserve final snapshot; explicit deletion cannot revive stale original values', async () => {
  const f = fixture();
  const s = f.create();
  await s.initialize();
  for (let i = 0; i < 25; i++) s.setItem('vesper-codex-chat-one', `snapshot ${i}`);
  await s.flush();
  assert.equal(f.disk.get('vesper-codex-chat-one'), 'snapshot 24');
  s.removeItem('vesper-codex-chat-one');
  await s.flush();
  const reload = f.create();
  await reload.initialize();
  assert.equal(reload.getItem('vesper-codex-chat-one'), null);
  assert.ok(!reload.keys().includes('vesper-codex-chat-one'));
  assert.ok(f.original.has('vesper-codex-chat-one'));
});

test('both stores unavailable: retains in-memory edits and reports failure, then retries without data eviction', async () => {
  const f = fixture();
  f.break();
  const s = f.create();
  await s.initialize();
  let notifications = 0;
  const unsubscribe = s.subscribe(() => notifications++);
  s.setItem('vesper-document-notes', 'new note');
  await s.flush();
  assert.equal(s.status(), 'unavailable');
  assert.equal(s.getItem('vesper-document-notes'), 'new note');
  assert.equal(f.original.size, 3);
  f.repair();
  s.setItem('vesper-document-notes', 'new note');
  await s.flush();
  assert.equal(s.status(), 'ready');
  assert.equal(f.disk.get('vesper-document-notes'), 'new note');
  assert.ok(notifications >= 4);
  unsubscribe();
});

test('failed overflow hydration and restricted localStorage do not reject initialization or expose data', async () => {
  const s = createBrowserStorage(() => { throw new Error('SecurityError'); }, {
    load: async () => { throw new Error('blocked'); },
    put: async () => { throw new Error('blocked'); },
  });
  await s.initialize();
  assert.equal(s.status(), 'unavailable');
  assert.equal(s.getItem('vesper-local-profile'), null);
  assert.deepEqual(s.keys(), []);
  s.setItem('vesper-local-profile', 'pending');
  await s.flush();
  assert.equal(s.getItem('vesper-local-profile'), 'pending');
});
