import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const sql = new DatabaseSync(':memory:');
let failSchema = true, schemaCalls = 0, conflict;
const db = {
  prepare(query) { const statement = (args=[]) => ({
    bind: (...values) => statement(values),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => {
      if (conflict && query.startsWith('UPDATE vesper_documents SET')) { const update=conflict; conflict=undefined; update(); }
      const result=sql.prepare(query).run(...args); return { meta: { changes: Number(result.changes) } };
    },
  }); return statement(); },
  async batch(statements) {
    schemaCalls++;
    if (failSchema) { failSchema=false; throw new Error('D1_ERROR: private storage diagnostic'); }
    for(const statement of statements) await statement.run();
  },
};
globalThis.__backendFixture={ DB:db,VESPER_APP_TOKEN:'fixture-token',MEDIA:{put:async()=>({}),get:async()=>null} };
const directory=await mkdtemp(join(tmpdir(),'vesper-backend-boundaries-'));
try {
  const modules={};
  for(const [name,entry] of Object.entries({route:'app/api/state/route.ts',documents:'lib/backend/documents.ts',http:'lib/backend/http.ts',tools:'app/api/codex/tools/route.ts'})) {
    const outfile=join(directory,name+'.mjs');
    await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'esm',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__backendFixture; export function waitUntil(p){return p;}',loader:'js'}));}}]});
    modules[name]=await import(pathToFileURL(outfile));
  }
  const request=(method,path,body,auth=true)=>new Request('https://vesper.test'+path,{method,headers:{'content-type':'application/json',...(auth?{'x-vesper-device-token':'fixture-token'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  assert.equal((await modules.route.GET(request('GET','/api/state',undefined,false))).status,401);
  assert.equal(schemaCalls,0,'Unauthorized requests cannot initialize/read storage');
  const failed=await modules.route.GET(request('GET','/api/state'));
  assert.equal(failed.status,503); assert.ok(failed.headers.get('x-vesper-request-id'));
  assert.ok(!(await failed.text()).includes('private storage'));
  assert.equal((await modules.route.GET(request('GET','/api/state'))).status,200);
  assert.equal(schemaCalls,2,'A failed schema initialization must not poison future requests');
  const diary={'2026-10-14':{user:'User-authored fixture'}};
  assert.equal((await modules.route.PUT(request('PUT','/api/state',{key:'diary',value:diary}))).status,200);
  const model=await modules.tools.POST(request('POST','/api/codex/tools',{name:'write_vesper_state',arguments:{kind:'journal',date:'2026-10-14',text:'Agent-authored fixture'}}));
  assert.equal(model.status,200,await model.clone().text());
  const read=await (await modules.route.GET(request('GET','/api/state?key=diary'))).json();
  assert.equal(read.value['2026-10-14'].user,'User-authored fixture');assert.equal(read.value['2026-10-14'].agent,'Agent-authored fixture');
  const repo=new modules.documents.DocumentRepository(db);
  conflict=()=>sql.prepare('UPDATE vesper_documents SET value=? WHERE key=?').run(JSON.stringify({'2026-10-14':{user:'Concurrent user edit',agent:'Agent-authored fixture'}}),'diary');
  await repo.update('diary',value=>({...value,'2026-10-14':{...value['2026-10-14'],agent:'New agent edit'}}));
  const concurrent=await repo.read('diary');assert.equal(concurrent.value['2026-10-14'].user,'Concurrent user edit');assert.equal(concurrent.value['2026-10-14'].agent,'New agent edit');
  let scopes=0, writes=0;const logs=[];
  const handler=modules.http.appRoute({service:'fixture',methods:['POST'],errorMessage:'Failed'},async context=>{await context.scope();await context.scope();writes++;return context.json({ok:true});},{authorize:async()=>true,scope:async()=>{scopes++;return {userId:'fixture',characterId:'fixture'};},log:entry=>logs.push(entry)});
  await handler(request('POST','/fixture?private-query=secret',{private:'message'}));assert.equal(scopes,1);assert.equal(writes,1);
  assert.equal((await handler(request('GET','/fixture'))).status,405);assert.equal(writes,1);
  assert.ok(!JSON.stringify(logs).includes('secret'));assert.ok(!JSON.stringify(logs).includes('private'));
  assert.equal((await modules.route.GET(request('GET','/api/state?key=not-allowed'))).status,400);
  console.log('PASS shared API authentication, identity, safe diagnostics, schema retry, shared HTTP/tool documents and concurrent diary preservation');
} finally { sql.close();await rm(directory,{recursive:true,force:true}); }
