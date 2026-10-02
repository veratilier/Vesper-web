import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sharedMemoryRequest } from '../lib/shared-memory-handler';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync('tools/fixtures/shared-memory-schema.sql', 'utf8'));
const db = {
 prepare(sql: string) {
  const statement = sqlite.prepare(sql); let args: any[] = [];
  return {
   bind(...values: any[]) { args = values; return this; },
   async first() { return statement.get(...args) ?? null; },
   async all() { return {results: statement.all(...args)}; },
   async run() { return statement.run(...args); },
  };
 },
 async batch(statements: any[]) {
  sqlite.exec('BEGIN');
  try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; }
  catch(e) { sqlite.exec('ROLLBACK'); throw e; }
 }
};
async function call(path: string, body?: unknown, authorized = true) {
 const url = new URL('https://vesper.example/api/shared-memory'); url.searchParams.set('path',path);
 return sharedMemoryRequest(new Request(url,{method:body === undefined?'GET':'POST',...(body === undefined?{}:{body:JSON.stringify(body)})}),{
  authorize:async()=>authorized, database:()=>{assert.ok(authorized,'authorization must precede database access'); return db as any;},headers:()=>new Headers()
 });
}
async function json(path: string, body?: unknown) { const response=await call(path,body); assert.ok(response.ok,await response.clone().text()); return response.json() as Promise<any>; }
assert.equal((await call('/api/memories',undefined,false)).status,401);
assert.equal((await call('/api/memories',{body:'blocked'},false)).status,401);
assert.equal((await call('//external.example/')).status,400);
assert.equal((await call('/api/password',{password:'blocked'})).status,404);
const original={body:'测试记忆：图标选择星河。',source:'虚构验收',kind:'preference'};
const saved=await json('/api/memories',original);
assert.equal((await json('/api/memories',original)).id,saved.id);
assert.equal((await json('/api/search',{query:'星河'})).hits[0].id,saved.id);
const corrected=await json('/api/memories/'+saved.id+'/correct',{...original,body:'测试记忆：图标选择海浪。',correction_reason:'虚构的偏好更新'});
assert.equal((await json('/api/memories/'+saved.id)).body,original.body);
assert.equal((await json('/api/memories/'+saved.id)).active,0);
assert.equal((await json('/api/memories/'+corrected.id)).versions.length,2);
assert.equal((await call('/api/memories/'+saved.id+'/correct',{...original,body:'迟到的修改',correction_reason:'冲突测试'})).status,409);
assert.equal((await json('/api/search',{query:'星河'})).hits.length,0);
assert.equal((await json('/api/memories')).total,1);
assert.equal((await json('/api/memories?include_superseded=true')).total,2);
await json('/api/memories',{...original,body:'星河梦境',kind:'dream'});
assert.equal((await json('/api/search',{query:'星河'})).hits.length,0);
assert.equal((await json('/api/search',{query:'星河',include_nonfacts:true})).hits[0].kind,'dream');
assert.equal((await call('/api/memories',{...original,body:'x'.repeat(70000)})).status,413);
console.log('PASS: paired access, blocked routes, save/deduplicate, search, version corrections, conflict, nonfacts, body bound');
