import { z } from 'zod';
import { ensureBridge } from '../../lib/conversation-bridge.ts';
import { ensureGroups } from '../../lib/bridge-groups.ts';
type Env={DB:D1Database; OAUTH_KV:KVNamespace};
type Sub={id:string;binding_id:string;url:string;expires_at:string;start_rowid:number};
type Delivery=Sub & {message_id:string;message_text:string;message_created_at:string;attempts:number|null};
const NAME='message.created', KEY='vesper-chat-event:';
const schema=z.object({name:z.literal(NAME),arguments:z.object({}).strict(),delivery:z.object({mode:z.literal('webhook'),url:z.string().max(2048),secret:z.string().optional()}).passthrough(),ttlMs:z.number().positive().nullable().optional()}).passthrough();
const encoder=new TextEncoder();
export class EventCallbackError extends Error {
  readonly reason:'timeout'|'connection_failed'|'signing_failed'|'http_error'|'challenge_failed';
  readonly detail:string;
  constructor(reason:'timeout'|'connection_failed'|'signing_failed'|'http_error'|'challenge_failed',detail='') {super('callback_failed');this.reason=reason;this.detail=detail;}
}
/** Only coarse failure classes and trusted provider hostnames may be logged. */
export function eventFailureDiagnostic(error:unknown,input:unknown) {
  const value=input&&typeof input==='object'?input as {delivery?:{url?:unknown}}:{};
  let callbackHost='unknown';
  try { const host=new URL(String(value.delivery?.url||'')).hostname.toLowerCase();callbackHost=host==='openai.com'||host.endsWith('.openai.com')||host==='chatgpt.com'||host.endsWith('.chatgpt.com')?host:'other'; } catch { /* no raw URLs in logs */ }
  const reason=error instanceof EventCallbackError?error.reason:error instanceof z.ZodError?'invalid_schema':error instanceof Error&&['invalid_url','invalid_secret','connection_unavailable'].includes(error.message)?error.message:'internal_error';
  const fields=error instanceof z.ZodError?error.issues.map(issue=>issue.path.map(String).join('.')).slice(0,8):[];
  return {reason,callbackHost,fields,...(error instanceof EventCallbackError&&error.detail?{detail:error.detail}:{})};
}
async function digest(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s))),x=>x.toString(16).padStart(2,'0')).join('');}
function destination(value:string){
  const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port&&u.port!=='443') throw new Error('invalid_url');
  const host=u.hostname.toLowerCase();
  // Event subscriptions are currently enabled only for OpenAI's observed MCP callback host.
  // Do not accept arbitrary internet destinations or private-network targets.
  if(host!=='connectors.api.openai.com') throw new Error('invalid_url');
  return u.toString();
}
function decodeSecret(value:unknown):Uint8Array<ArrayBuffer> {
  if(typeof value!=='string'||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('invalid_secret');
  let decoded:string;try{decoded=atob(value.slice(6));}catch{throw new Error('invalid_secret');}
  const key=Uint8Array.from(decoded,c=>c.charCodeAt(0));if(key.length<24||key.length>64) throw new Error('invalid_secret');return key;
}
async function ensure(env:Env){await env.DB.batch([
  env.DB.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_subscriptions (id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, url TEXT NOT NULL, expires_at TEXT NOT NULL, start_rowid INTEGER NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_deliveries (subscription_id TEXT NOT NULL, message_id TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(subscription_id,message_id))'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_group_subscription_start (subscription_id TEXT PRIMARY KEY, start_rowid INTEGER NOT NULL)'),
]);}
async function signed(url:string,secret:string,id:string,subscriptionID:string,body:unknown,fetcher:typeof fetch=fetch) {
  const payload=JSON.stringify(body), timestamp=String(Math.floor(Date.now()/1000));
  let signature:Uint8Array;
  try {const key=await crypto.subtle.importKey('raw',decodeSecret(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(`${id}.${timestamp}.${payload}`)));}
  catch {throw new EventCallbackError('signing_failed');}
  const b64=btoa(String.fromCharCode(...signature));
  try {return await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':`v1,${b64}`,'X-MCP-Subscription-Id':subscriptionID},body:payload});}
  catch(error) {
    const message=error instanceof Error?error.message.toLowerCase():'';
    const tags=['dns','certificate','tls','redirect','timeout','public','private','network','fetch','socket','blocked','invocation','receiver'].filter(tag=>message.includes(tag));
    const errorCode=message.match(/\b10\d{2}\b/)?.[0];if(errorCode)tags.push('code_'+errorCode);
    const type=error instanceof Error&&['TypeError','AbortError','TimeoutError','Error'].includes(error.name)?error.name:'unknown';
    throw new EventCallbackError(type==='TimeoutError'?'timeout':'connection_failed',[type,...tags].join(','));
  }
}
const definition={name:NAME,description:'A new user message in this authorized Vesper conversation or a group this connection belongs to. When group_id is present, read and reply using the group tools.',delivery:['webhook'],inputSchema:{type:'object',properties:{},additionalProperties:false},payloadSchema:{type:'object',properties:{message_id:{type:'string'},text:{type:'string'},group_id:{type:'string'}},required:['message_id','text'],additionalProperties:false}};
export function listEvents(){return {events:[definition]};}
export async function subscribe(env:Env,bindingID:string,input:unknown,fetcher:typeof fetch=fetch){
  const p=schema.parse(input), url=destination(p.delivery.url),secret=p.delivery.secret;
  decodeSecret(secret);if(typeof secret!=='string') throw new Error('invalid_secret');
  const active=await env.DB.prepare('SELECT id FROM vesper_bridge_bindings WHERE id=? AND revoked=0').bind(bindingID).first();
  if(!active) throw new Error('connection_unavailable');
  await ensure(env);await ensureGroups(env.DB);
  const id='sub_'+(await digest(`${bindingID}\n${NAME}\n${url}`)).slice(0,48), challenge=crypto.randomUUID()+crypto.randomUUID();
  let verified:Response;
  try { verified=await signed(url,secret,'verify_'+crypto.randomUUID(),id,{type:'verification',challenge},fetcher); }
  catch(error) { if(error instanceof EventCallbackError)throw error;throw new EventCallbackError('connection_failed'); }
  if(!verified.ok) throw new EventCallbackError('http_error');
  const json=await verified.json().catch(()=>null) as {challenge?:unknown}|null;
  if(!json||typeof json.challenge!=='string'||await digest(json.challenge)!==await digest(challenge)) throw new EventCallbackError('challenge_failed');
  const existing=await env.DB.prepare('SELECT start_rowid FROM vesper_bridge_subscriptions WHERE id=? AND binding_id=?').bind(id,bindingID).first<{start_rowid:number}>();
  const latest=await env.DB.prepare('SELECT COALESCE(MAX(m.rowid),0) AS n FROM vesper_bridge_messages m WHERE m.binding_id=? AND NOT EXISTS (SELECT 1 FROM vesper_bridge_inflight f WHERE f.binding_id=m.binding_id AND f.message_id=m.id AND f.ready=0)').bind(bindingID).first<{n:number}>();
  const ttl=Math.max(60000,Math.min(p.ttlMs??86400000,86400000));
  const expiresAt=new Date(Date.now()+ttl).toISOString();
  await env.OAUTH_KV.put(KEY+id,secret,{expirationTtl:Math.ceil(ttl/1000)+300});
  await env.DB.prepare('INSERT INTO vesper_bridge_subscriptions(id,binding_id,url,expires_at,start_rowid) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,expires_at=excluded.expires_at')
    .bind(id,bindingID,url,expiresAt,existing?.start_rowid??latest?.n??0).run();
  const groupLatest=await env.DB.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM vesper_bridge_group_messages').first<{n:number}>();
  await env.DB.prepare('INSERT INTO vesper_bridge_group_subscription_start(subscription_id,start_rowid) VALUES(?,?) ON CONFLICT DO NOTHING').bind(id,groupLatest?.n??0).run();
  return {id,refreshBefore:expiresAt,cursor:null,truncated:false};
}
export async function unsubscribe(env:Env,bindingID:string,input:unknown){
  const p=schema.parse(input),url=destination(p.delivery.url),id='sub_'+(await digest(`${bindingID}\n${NAME}\n${url}`)).slice(0,48);
  await ensure(env); await env.DB.prepare('DELETE FROM vesper_bridge_subscriptions WHERE id=? AND binding_id=?').bind(id,bindingID).run();
  await env.DB.prepare('DELETE FROM vesper_bridge_group_subscription_start WHERE subscription_id=?').bind(id).run();
  await env.OAUTH_KV.delete(KEY+id); return {};
}
export async function deliver(env:Env,fetcher:typeof fetch=fetch){
  await ensureBridge(env.DB);await ensureGroups(env.DB);await ensure(env);const now=new Date().toISOString();
  await env.DB.prepare('INSERT OR IGNORE INTO vesper_bridge_group_subscription_start(subscription_id,start_rowid) SELECT id,0 FROM vesper_bridge_subscriptions').run();
  const {results}=await env.DB.prepare(`SELECT s.*,m.id AS message_id,m.text AS message_text,m.created_at AS message_created_at,d.attempts
    FROM vesper_bridge_subscriptions s JOIN vesper_bridge_bindings b ON b.id=s.binding_id AND b.revoked=0
    JOIN vesper_bridge_messages m ON m.binding_id=s.binding_id AND m.sender='user' AND m.rowid>s.start_rowid
    LEFT JOIN vesper_bridge_deliveries d ON d.subscription_id=s.id AND d.message_id=m.id
    WHERE s.expires_at>? AND NOT EXISTS (SELECT 1 FROM vesper_bridge_inflight f WHERE f.binding_id=m.binding_id AND f.message_id=m.id AND f.ready=0)
    AND (d.status IS NULL OR (d.status='retry' AND d.next_at<=?))
    ORDER BY m.rowid LIMIT 50`).bind(now,now).all<Delivery>();
  for(const item of results){
    const secret=await env.OAUTH_KV.get(KEY+item.id);if(!secret) continue;
    const eventId='evt_'+(await digest(`${item.id}\n${item.message_id}`)).slice(0,48);
    let status:'done'|'retry'|'terminal'='retry';const attempts=(item.attempts??0)+1;
    try {
      const r=await signed(item.url,secret,eventId,item.id,{eventId,name:NAME,timestamp:item.message_created_at,data:{message_id:item.message_id,text:item.message_text},cursor:null},fetcher);
      if(r.ok) status='done';else if(r.status===410||r.status===413||attempts>=5) status='terminal';
    } catch { if(attempts>=5) status='terminal'; }
    const next=new Date(Date.now()+Math.min(3600000,60000*2**(attempts-1))).toISOString();
    await env.DB.prepare('INSERT INTO vesper_bridge_deliveries(subscription_id,message_id,attempts,next_at,status) VALUES(?,?,?,?,?) ON CONFLICT(subscription_id,message_id) DO UPDATE SET attempts=excluded.attempts,next_at=excluded.next_at,status=excluded.status')
      .bind(item.id,item.message_id,attempts,next,status).run();
  }
  const groupResults=await env.DB.prepare(`SELECT s.*,g.id AS group_id,m.id AS message_id,m.text AS message_text,m.created_at AS message_created_at,d.attempts
    FROM vesper_bridge_subscriptions s JOIN vesper_bridge_bindings b ON b.id=s.binding_id AND b.revoked=0
    JOIN vesper_bridge_group_subscription_start gs ON gs.subscription_id=s.id
    JOIN vesper_bridge_group_inbox i ON i.binding_id=s.binding_id
    JOIN vesper_bridge_groups g ON g.id=i.group_id
    JOIN vesper_bridge_group_members member ON member.group_id=g.id AND member.binding_id=s.binding_id
    JOIN vesper_bridge_group_messages m ON m.group_id=i.group_id AND m.id=i.message_id AND m.rowid>gs.start_rowid
    LEFT JOIN vesper_bridge_deliveries d ON d.subscription_id=s.id AND d.message_id=('group_'||g.id||'_'||m.id)
    WHERE s.expires_at>? AND (d.status IS NULL OR (d.status='retry' AND d.next_at<=?)) ORDER BY m.rowid LIMIT 50`).bind(now,now).all<Delivery & {group_id:string}>();
  for(const item of groupResults.results) {
    const secret=await env.OAUTH_KV.get(KEY+item.id);if(!secret)continue;
    const deliveryID='group_'+item.group_id+'_'+item.message_id,eventId='evt_'+(await digest(`${item.id}\n${deliveryID}`)).slice(0,48);
    let status:'done'|'retry'|'terminal'='retry';const attempts=(item.attempts??0)+1;
    try {const r=await signed(item.url,secret,eventId,item.id,{eventId,name:NAME,timestamp:item.message_created_at,data:{message_id:item.message_id,text:item.message_text,group_id:item.group_id},cursor:null},fetcher);if(r.ok)status='done';else if(r.status===410||r.status===413||attempts>=5)status='terminal';}catch{if(attempts>=5)status='terminal';}
    const next=new Date(Date.now()+Math.min(3600000,60000*2**(attempts-1))).toISOString();
    await env.DB.prepare('INSERT INTO vesper_bridge_deliveries(subscription_id,message_id,attempts,next_at,status) VALUES(?,?,?,?,?) ON CONFLICT(subscription_id,message_id) DO UPDATE SET attempts=excluded.attempts,next_at=excluded.next_at,status=excluded.status').bind(item.id,deliveryID,attempts,next,status).run();
  }
}
