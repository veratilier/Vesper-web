import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {runInNewContext} from 'node:vm';
import { fixture } from './fixture.mjs';
import {executeDesire} from '/tmp/vesper-desire-native-test.mjs';
test('Vesper reads uninitialized eight emotions, with no official service fallback',async t=>{
 const {env,db}=fixture(t);const state=await executeDesire(env,'desire_status');
 assert.equal(state.initialized,false);assert.equal(state.values,null);
 assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='desire_state'").get().n,0);
 assert.deepEqual((await executeDesire(env,'desire_history')).records,[]);
 await assert.rejects(executeDesire({DESIRE_DB:{}},'desire_status'));
});
test('legacy histories remain separate; an old tool records evidence without arithmetic updates',async t=>{
 const {env,db}=fixture(t);
 db.exec("CREATE TABLE vesper_desire_history(id TEXT,user_id TEXT,note TEXT,created_at TEXT,after_state TEXT)");
 db.prepare('INSERT INTO vesper_desire_history VALUES(?,?,?,?,?)').run('old','vesper','Original note','2026-10-01T00:00:00Z',JSON.stringify({longing:70}));
 const old=await executeDesire(env,'desire_history',{legacy:true});assert.equal(old.records[0].note,'Original note');assert.equal(old.legacy,true);
 const input={kind:'warmth',interaction_source:'user',request_id:'one',note:'Actual observed exchange'};
 await executeDesire(env,'desire_encounter',input);await executeDesire(env,'desire_encounter',input);
 assert.equal(db.prepare('SELECT count(*) n FROM vesper_emotion_events').get().n,1);
 assert.equal((await executeDesire(env,'desire_status')).version,0);
 assert.equal((await executeDesire(env,'desire_set_style',{style:'playful'})).deprecated,true);
 assert.equal((await executeDesire(env,'desire_express')).deprecated,true);
 assert.equal(db.prepare('SELECT count(*) n FROM vesper_desire_history').get().n,1);
});
test('notification click opens Desire without reloading an existing Vesper window', async () => {
  const { runInNewContext } = await import('node:vm');
  const handlers = {}; let message, focused = false, pending;
  const window = { url: 'https://vesper.r-vera.com/', postMessage(value) { message = value; }, async focus() { focused = true; } };
  const self = { registration: { scope: 'https://vesper.r-vera.com/' }, addEventListener(name, callback) { handlers[name] = callback; }, clients: { async matchAll() { return [window]; }, openWindow() { throw Error('must not open a second window'); } } };
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), { self, URL });
  handlers.notificationclick({ notification: { close() {}, data: { url: '/?section=desire' } }, waitUntil(value) { pending = value; } });
  await pending;
  assert.equal(message.section, 'desire'); assert.equal(focused, true);
});
test('notification click opens the native route in a new window and rejects external destinations', async () => {
  const { runInNewContext } = await import('node:vm');
  for (const [requested, expected] of [['/?section=desire', 'https://vesper.r-vera.com/?section=desire'], ['https://other.example/', 'https://vesper.r-vera.com/']]) {
    const handlers = {}; let opened, pending;
    const self = { registration: { scope: 'https://vesper.r-vera.com/' }, addEventListener(name, callback) { handlers[name] = callback; }, clients: { async matchAll() { return []; }, async openWindow(url) { opened = url; } } };
    runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), { self, URL });
    handlers.notificationclick({ notification: { close() {}, data: { url: requested } }, waitUntil(value) { pending = value; } });
    await pending; assert.equal(opened, expected);
  }
});
