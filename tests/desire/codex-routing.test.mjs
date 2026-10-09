import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { executeDesire } from '/tmp/vesper-desire-native-test.mjs';

test('actual Codex catalog and dispatcher route authenticated Desire reads and writes to Vesper', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const adapter = {
    prepare(sql) {
      const statement = (values = []) => ({sql, values, bind: (...v) => statement(v),
        first: async () => db.prepare(sql).get(...values) ?? null,
        all: async () => ({results:db.prepare(sql).all(...values)}),
        run: async () => db.prepare(sql).run(...values)});
      return statement();
    },
    async batch(statements) { return statements.map(s => db.prepare(s.sql).run(...s.values)); }
  };
  globalThis.__codexDesireEnv = {DB:adapter, VESPER_APP_TOKEN:'fixture-token'};
  t.after(() => delete globalThis.__codexDesireEnv);
  await executeDesire(globalThis.__codexDesireEnv,'desire_status');

  const dir = await mkdtemp(join(tmpdir(),'desire-routing-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const file = join(dir,'route.mjs');
  await build({entryPoints:['app/api/codex/tools/route.ts'],outfile:file,bundle:true,platform:'node',format:'esm',plugins:[{
    name:'worker-env', setup(b) {
      b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export function waitUntil(p){return p;} export const env = globalThis.__codexDesireEnv;',loader:'js'}));
    }
  }]});
  const {GET,POST}=await import(pathToFileURL(file));
  const request=(body,auth=true)=>new Request('https://api.example/api/codex/tools',{
    method:body?'POST':'GET',headers:auth?{'x-vesper-device-token':'fixture-token','content-type':'application/json'}:{},
    ...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await POST(request({name:'desire_status'},false))).status,401);
  const catalog=(await (await GET(request())).json()).tools;
  for(const name of ['desire_status','desire_history','desire_encounter','desire_set_style','desire_express']) assert.ok(catalog.some(t=>t.name===name));
  const call=async(name,args={})=>{const response=await POST(request({name,arguments:args}));assert.equal(response.status,200);return (await response.json()).result;};
  assert.equal((await call('desire_status')).schemaVersion,3);
  assert.equal((await call('desire_status')).initialized,false);
  assert.equal((await call('desire_set_style',{style:'playful'})).deprecated,true);
  const args={kind:'warmth',interaction_source:'user',request_id:'fixture-event',note:'Fixture observation'};
  assert.equal((await call('desire_encounter',args)).pendingAssessment,true);
  await call('desire_encounter',args);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM vesper_emotion_events').get().n,1);
  assert.equal((await call('desire_history')).records.length,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='vesper_desire_state'").get().n,0);
});
