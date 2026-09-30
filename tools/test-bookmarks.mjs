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
globalThis.__bookmarkFixture={ DB:db,VESPER_APP_TOKEN:'fixture-token' };
const directory=await mkdtemp(join(tmpdir(),'vesper-bookmark-tests-'));
try {
  const modules={};
  for(const [name,entry] of Object.entries({route:'app/api/bookmarks/route.ts',tools:'app/api/codex/tools/route.ts',store:'lib/bookmarks.ts'})) {
    const outfile=join(directory,name+'.mjs');
    await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'esm',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env=globalThis.__bookmarkFixture;',loader:'js'}));}}]});
    modules[name]=await import(pathToFileURL(outfile));
  }
  const request=(method,path,body,auth=true)=>new Request('https://vesper.test'+path,{method,headers:{'content-type':'application/json',...(auth?{'x-vesper-device-token':'fixture-token'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await modules.route.GET(request('GET','/api/bookmarks',null,false))).status,401);
  assert.equal((await modules.tools.POST(request('POST','/api/codex/tools',{name:'bookmark_create'},false))).status,401);
  const card={id:'synthetic-1',text:'A fictional bookmark used only by this test.',imageUrl:'https://example.com/cover.jpg',imageSource:'test fixture'};
  const result=await modules.tools.POST(request('POST','/api/codex/tools',{name:'bookmark_create',arguments:card}));
  assert.equal(result.status,200,await result.clone().text());
  assert.equal((await result.json()).result.bookmark.author,'Rowan');
  assert.equal((await modules.route.POST(request('POST','/api/bookmarks',card))).status,200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM vesper_bookmarks').get().n,1);
  assert.equal((await modules.route.POST(request('POST','/api/bookmarks',{...card,text:'conflicting content'}))).status,400);
  assert.equal((await modules.route.GET(request('GET','/api/bookmarks'))).status,200);
  assert.equal((await (await modules.route.GET(request('GET','/api/bookmarks'))).json()).bookmarks[0].text,card.text);
  assert.deepEqual((await modules.store.listBookmarks('different-account')).bookmarks,[]);
  for(const imageUrl of ['http://example.com/a','https://user:secret@example.com/a','https://127.0.0.1/a','https://10.0.0.1/a','https://[::1]/a','file:///tmp/a'])
    assert.equal((await modules.route.POST(request('POST','/api/bookmarks',{id:'invalid-image',text:'test',imageUrl}))).status,400,imageUrl);
  sqlite.prepare('INSERT INTO vesper_documents VALUES(?,?,?)').run('readingRoom',JSON.stringify([{id:'book',title:'Fixture book',text:'The exact passage from a fictional book.'}]),'fixture');
  assert.equal((await modules.tools.POST(request('POST','/api/codex/tools',{name:'bookmark_create',arguments:{id:'quote',text:'A summary',bookId:'book',quote:'invented passage'}}))).status,400);
  const exact={id:'quote',text:'A summary',bookId:'book',quote:'The exact passage'};
  assert.equal((await modules.tools.POST(request('POST','/api/codex/tools',{name:'bookmark_create',arguments:exact}))).status,200);
  const first=await (await modules.route.GET(request('GET','/api/bookmarks?limit=1'))).json();
  const second=await (await modules.route.GET(request('GET','/api/bookmarks?limit=1&before='+encodeURIComponent(first.before)))).json();
  assert.equal(first.bookmarks.length,1);assert.equal(second.bookmarks.length,1);assert.notEqual(first.bookmarks[0].id,second.bookmarks[0].id);
  assert.equal((await modules.route.DELETE(request('DELETE','/api/bookmarks?id=synthetic-1'))).status,200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM vesper_bookmarks WHERE id=?').get('synthetic-1').n,0);
  console.log('PASS authenticated API/tool persistence, readback, retry deduplication, account isolation, image URL validation, exact Reading Room quote, pagination and scoped deletion');
} finally {sqlite.close();await rm(directory,{recursive:true,force:true});}
