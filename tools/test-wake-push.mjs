import assert from 'node:assert/strict';
import {build} from 'esbuild';
const rows=new Map();let sent=0;
globalThis.wakeDb={prepare(sql){let values=[];return {bind(...v){values=v;return this},async run(){if(sql.startsWith('INSERT OR IGNORE')) {const exists=rows.has(values[0]);if(!exists)rows.set(values[0],{status:'sending',result:null});return {meta:{changes:exists?0:1}}}if(sql.startsWith('UPDATE'))rows.set(values.at(-1),{status:values.length===3?values[0]:'uncertain',result:values.length===3?values[1]:null});return {meta:{changes:1}}},async first(){return rows.get(values[0])},async all(){return {results:[{subscription:'{}'}]}}}}};
globalThis.wakeSend=async(subscriptions,payload)=>{assert.equal(payload.url,'/?section=chat&conversation=chat-existing');sent++;return {delivered:1,gone:[]}};
await build({entryPoints:['app/api/wake/route.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/vesper-wake-push-test.mjs',plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^(cloudflare:workers|@\/lib\/|@mmmike\/)/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({loader:'js',contents:
 a.path==='cloudflare:workers'?'export const env={VAPID_PUBLIC_KEY:"fixture",VAPID_PRIVATE_KEY:"fixture"};':
 a.path.endsWith('bridge-auth')?'export const authorizeApp=async r=>r.headers.get("test-auth")==="yes";':
 a.path.endsWith('/db')?'export const getDb=()=>globalThis.wakeDb;export const ensureSchema=async()=>{};':
 a.path.endsWith('/cors')?'export const corsHeaders=()=>({});export const optionsResponse=()=>new Response();':
 'export const sendPushBatch=(...args)=>globalThis.wakeSend(...args);'}));}}]});
const {POST}=await import('/tmp/vesper-wake-push-test.mjs');
const req=(auth=true)=>new Request('https://test/api/wake',{method:'POST',headers:auth?{'test-auth':'yes'}:{},body:JSON.stringify({requestId:'one',message:'Saved reply',conversationId:'chat-existing'})});
assert.equal((await POST(req(false))).status,401);assert.equal(sent,0);
const results=await Promise.all([POST(req()),POST(req())]);
assert.equal(sent,1,'concurrent/repeated notification requests must send once');
assert.equal((await (await POST(req())).json()).delivered,1);assert.equal(sent,1);
console.log('Wake push authorization and concurrent delivery deduplication passed');
