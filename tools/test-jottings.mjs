import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const sqlite = new DatabaseSync(':memory:');
const db = {
  prepare(sql) { const stmt=(args=[])=>({bind:(...values)=>stmt(values),first:async()=>sqlite.prepare(sql).get(...args)??null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)});return stmt(); },
  async batch(statements) { for(const s of statements) await s.run(); },
};
globalThis.__jottingFixture={ DB:db,VESPER_APP_TOKEN:'fixture-token' };
const directory=await mkdtemp(join(tmpdir(),'vesper-jotting-tests-'));
try {
  const modules={};
  for(const [name,entry] of Object.entries({route:'app/api/jottings/route.ts',tools:'app/api/codex/tools/route.ts',store:'lib/jottings.ts'})) {
    const outfile=join(directory,name+'.mjs');
    await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'esm',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export function waitUntil(p){return p;} export const env=globalThis.__jottingFixture;',loader:'js'}));}}]});
    modules[name]=await import(pathToFileURL(outfile));
  }
  const request=(method,path,body,auth=true)=>new Request('https://vesper.test'+path,{method,headers:{'content-type':'application/json',...(auth?{'x-vesper-device-token':'fixture-token'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await modules.route.GET(request('GET','/api/jottings',null,false))).status,401);
  assert.equal((await modules.tools.POST(request('POST','/api/codex/tools',{name:'jotting_create'},false))).status,401);
  const card={id:'synthetic-1',text:'A fictional jotting used only by this test.',title:'A passing thought'};
  const result=await modules.tools.POST(request('POST','/api/codex/tools',{name:'jotting_create',arguments:card}));
  assert.equal(result.status,200,await result.clone().text());
  assert.equal((await result.json()).result.jotting.author,'Rowan');
  assert.equal((await modules.route.POST(request('POST','/api/jottings',card))).status,200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM vesper_jottings').get().n,1);
  assert.equal((await modules.route.POST(request('POST','/api/jottings',{...card,text:'conflicting content'}))).status,400);
  assert.equal((await modules.route.GET(request('GET','/api/jottings'))).status,200);
  assert.equal((await (await modules.route.GET(request('GET','/api/jottings'))).json()).jottings[0].text,card.text);
  assert.deepEqual((await modules.store.listJottings('different-account')).jottings,[]);
  for (const body of [{id:'bad',text:''},{id:'bad',text:'x'.repeat(12001)},{id:'../bad',text:'x'}])
    assert.equal((await modules.route.POST(request('POST','/api/jottings',body))).status,400);
  assert.deepEqual((await modules.store.listJottings('different-account')).jottings,[]);
  await assert.rejects(modules.store.getJotting('different-account',card.id));
  const byId=await (await modules.route.GET(request('GET','/api/jottings?id='+card.id))).json();
  assert.equal(byId.jotting.text,card.text);
  assert.equal((await modules.route.POST(request('POST','/api/jottings',{id:'synthetic-2',text:'A separate thought.'}))).status,200);
  const first=await (await modules.route.GET(request('GET','/api/jottings?limit=1'))).json();
  const second=await (await modules.route.GET(request('GET','/api/jottings?limit=1&before='+encodeURIComponent(first.before)))).json();
  assert.notEqual(first.jottings[0].id,second.jottings[0].id);
  assert.equal((await modules.route.DELETE(request('DELETE','/api/jottings?id=synthetic-1'))).status,200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM vesper_documents WHERE key IN (\'notes\',\'diary\')').get().n,0);
  console.log('PASS jotting API and tool: authentication, persistence, retries, conflict rejection, isolation, exact read, limits, pagination, scoped deletion, no journal/note writes');
} finally {sqlite.close();await rm(directory,{recursive:true,force:true});}
