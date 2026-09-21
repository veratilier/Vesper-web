import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Exercise the actual HTTP handler, including authentication and its iOS envelope.
test('native API preserves existing storage and distinguishes missing state from 404', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vesper-desire-api-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'route.mjs');
  await build({ entryPoints: ['app/api/desire/route.ts'], outfile: file, bundle: true, platform: 'node', format: 'esm', plugins: [{
    name: 'worker-fixture', setup(b) {
      b.onResolve({filter: /^cloudflare:workers$/}, () => ({path:'env',namespace:'fixture'}));
      b.onResolve({filter: /lib\/desire\/native$/}, () => ({path:'native',namespace:'fixture'}));
      b.onLoad({filter: /.*/,namespace:'fixture'}, ({path}) => ({contents: path === 'env'
        ? 'export const env = globalThis.__desireFixture.env;'
        : `export class DesireUnavailable extends Error {};
           export async function executeDesire(env,name,input) { globalThis.__desireFixture.calls.push({name,input}); return name === 'desire_history' ? {records:[{note:'existing note'}]} : {longing:57,tenderness:71}; }`, loader:'js'}));
    }
  }] });
  let exists = true, probes = 0;
  const fixture = { calls: [], env: { VESPER_APP_TOKEN:'test-token', DB:{ prepare(sql) {
    probes++; assert.match(sql,/SELECT user_id FROM vesper_desire_state/);
    return {bind(owner) {assert.equal(owner,'vesper');return {async first(){return exists ? {user_id:owner} : null;}};}};
  }}}};
  globalThis.__desireFixture=fixture;
  t.after(()=>delete globalThis.__desireFixture);
  const {GET}=await import(pathToFileURL(file));
  const request=(query='',auth=true)=>new Request('https://api.example/api/desire'+query,{headers:auth?{'x-vesper-device-token':'test-token'}:{}});
  assert.equal((await GET(request('',false))).status,401);assert.equal(probes,0);
  assert.equal((await GET(request('?view=unknown'))).status,400);assert.equal(probes,0);
  const status=await GET(request());assert.equal(status.status,200);
  assert.deepEqual(await status.json(),{data:{longing:57,tenderness:71},source:'Vesper'});
  assert.equal(status.headers.get('cache-control'),'no-store');
  const history=await GET(request('?view=history&limit=20'));
  assert.equal((await history.json()).data.records[0].note,'existing note');
  assert.deepEqual(fixture.calls[1],{name:'desire_history',input:{limit:20}});
  exists=false;assert.equal((await GET(request())).status,503);assert.equal(fixture.calls.length,2);
  delete fixture.env.DB;assert.equal((await GET(request())).status,503);
});
