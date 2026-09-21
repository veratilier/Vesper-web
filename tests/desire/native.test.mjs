import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { executeDesire } from '/tmp/vesper-desire-native-test.mjs';
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const adapter = {
    prepare(sql) {
      const statement = (values = []) => ({ sql, values, bind: (...next) => statement(next),
        first: async () => db.prepare(sql).get(...values) ?? null,
        all: async () => ({ results: db.prepare(sql).all(...values) }),
        run: async () => db.prepare(sql).run(...values) });
      return statement();
    },
    async batch(statements) {
      db.exec('BEGIN');
      try { const results = statements.map(({sql,values}) => db.prepare(sql).run(...values)); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  const forbidden = new Proxy({}, { get() { throw Error('Original Desire storage must never be accessed'); } });
  return { db, env: { DB: adapter, DESIRE_DB: forbidden, DESIRE_LEGACY_KV: forbidden }, snapshot: () => db.prepare('SELECT * FROM vesper_desire_state').get() };
}
test('independent initial state and empty history; repeated reads preserve clocks', async t => {
  const f = fixture(t);
  const state = await executeDesire(f.env, 'desire_status');
  assert.equal(state.longing, 18); assert.equal(state.tenderness, 64);
  assert.equal(state.lastRealInteractionAt, null);
  const before = f.snapshot();
  await executeDesire(f.env, 'desire_status');
  assert.deepEqual(f.snapshot(), before);
  assert.deepEqual((await executeDesire(f.env, 'desire_history')).records, []);
});
test('missing Vesper DB cannot fall back to the original Desire bindings', async () => {
  await assert.rejects(executeDesire({ DESIRE_DB: {}, DESIRE_LEGACY_KV: {} }, 'desire_status'));
});
test('unrelated original-named tables are never read or changed', async t => {
  const f = fixture(t);
  f.db.exec("CREATE TABLE desire_state (user_id TEXT, longing INTEGER); INSERT INTO desire_state VALUES ('veratilier',57); CREATE TABLE encounter_history (note TEXT); INSERT INTO encounter_history VALUES ('original note');");
  await executeDesire(f.env, 'desire_encounter', { kind:'warmth', interaction_source:'user', request_id:'independent-user', note:'Vesper note' });
  assert.equal(f.db.prepare('SELECT longing FROM desire_state').get().longing,57);
  assert.equal(f.db.prepare('SELECT note FROM encounter_history').get().note,'original note');
  const records = (await executeDesire(f.env, 'desire_history')).records;
  assert.equal(records.length,1); assert.equal(records[0].note,'Vesper note');
});
test('Vesper requests remain idempotent and preserve notes verbatim', async t => {
  const f = fixture(t), input = { kind:'repair', interaction_source:'user', request_id:'same-event', note:'  原样\n保留  ' };
  const first = await executeDesire(f.env,'desire_encounter',input), before = f.snapshot();
  const again = await executeDesire(f.env,'desire_encounter',input);
  assert.equal(again.replayed,true); assert.equal(again.encounterId,first.encounterId);
  assert.deepEqual(f.snapshot(),before);
  assert.equal((await executeDesire(f.env,'desire_history')).records[0].note,input.note);
  await assert.rejects(executeDesire(f.env,'desire_encounter',{...input,note:'different'}));
});
test('invalid provenance never initializes or writes; automation never creates real contact', async t => {
  const f = fixture(t);
  await assert.rejects(executeDesire(f.env,'desire_encounter',{kind:'repair',request_id:'bad'}));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sqlite_master').get().n,0);
  await executeDesire(f.env,'desire_encounter',{kind:'absence',interaction_source:'automation',request_id:'wake'});
  assert.equal(f.snapshot().last_real_interaction_at,null);
});
test('style/expression and push deduplication metadata stay in Vesper D1', async t => {
  const f = fixture(t);
  f.db.exec('CREATE TABLE vesper_push_subscriptions (subscription TEXT)');
  f.env.VAPID_PUBLIC_KEY='unused'; f.env.VAPID_PRIVATE_KEY='unused';
  await executeDesire(f.env,'desire_set_style',{style:'clingy'});
  const expression = await executeDesire(f.env,'desire_express',{mode:'record'});
  assert.equal(expression.recorded,true); assert.equal(expression.message,undefined);
  assert.equal(f.snapshot().style,'clingy');
  assert.equal((await executeDesire(f.env,'desire_history')).records.length,0);
  assert.ok(f.db.prepare('SELECT count(*) AS n FROM vesper_desire_kv').get().n > 0);
});
test('concurrent first reads initialize one state without overwriting an encounter', async t => {
  const f = fixture(t);
  await Promise.all([executeDesire(f.env,'desire_status'),executeDesire(f.env,'desire_history')]);
  await executeDesire(f.env,'desire_encounter',{kind:'warmth',interaction_source:'user',request_id:'first'});
  const before=f.snapshot();
  await executeDesire({...f.env,DB:{...f.env.DB}},'desire_status');
  assert.deepEqual(f.snapshot(),before);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM vesper_desire_state').get().n,1);
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
