import { OAuthProvider, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { bridgeIdentity, assistantMessagesBound, assistantReplyBound } from '../../lib/conversation-bridge';
import { listEvents, subscribe, unsubscribe, deliver } from './events';
import { createConsent, getConsent, deleteConsent, consentCookie, clearConsentCookie, cookieMatches } from './consent';
import { getBridgeImage, getBridgeMedia, uploadBridgeMedia } from '../../lib/bridge-media';

type Env = { DB:D1Database; MEDIA:R2Bucket; OAUTH_KV:KVNamespace; OAUTH_PROVIDER:OAuthHelpers };
const ORIGIN='https://bridge.vesper.r-vera.com', SCOPE='conversation:access';
const response=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
function server(env:Env,bindingID:string) {
  const mcp=new McpServer({name:'Vesper Chat',version:'1.0.0'});
  mcp.registerTool('read_messages',{
    description:'Read this connection’s recent and pending messages. Attachments have private IDs; use read_attachment to view images or retrieve file bytes. No other conversations are accessible.',
    inputSchema:{},annotations:{readOnlyHint:true},
  },async()=>{
    try { return response(await assistantMessagesBound(env.DB,bindingID)); }
    catch { return {...response({error:'Connection unavailable'}),isError:true}; }
  });
  mcp.registerTool('send_reply',{
    description:'Send a reply to a pending user message. Optional attachments must first be uploaded with upload_attachment. Generate a unique id and reuse it unchanged on retries.',
    inputSchema:{id:z.string(),replyTo:z.string(),text:z.string().optional(),attachments:z.array(z.string()).max(5).optional(),card:z.object({kind:z.enum(['location','music']),data:z.record(z.string(),z.unknown())}).optional()},annotations:{idempotentHint:true,readOnlyHint:false},
  },async input=>{
    try { return response(await assistantReplyBound(env.DB,bindingID,input)); }
    catch { return {...response({error:'Reply unavailable'}),isError:true}; }
  });
  mcp.registerTool('read_attachment',{
    description:'Read an attachment belonging to a sent message in this connection. Images up to 4 MB are returned as images; other files are returned in base64 chunks using nextOffset.',
    inputSchema:{id:z.string(),offset:z.number().int().min(0).default(0)},annotations:{readOnlyHint:true},
  },async ({id,offset})=>{
    try {
      if(offset===0) { const image=await getBridgeImage(env.DB,env.MEDIA,bindingID,id);if(image)return {content:[{type:'image' as const,data:image.data,mimeType:image.mimeType},{type:'text' as const,text:JSON.stringify(image.attachment)}]}; }
      return response(await getBridgeMedia(env.DB,env.MEDIA,bindingID,id,offset));
    } catch { return {...response({error:'Attachment unavailable'}),isError:true}; }
  });
  mcp.registerTool('upload_attachment',{
    description:'Stage an actual file or sticker for your next send_reply. Supply genuine base64 bytes, not a guessed URL. Attach the returned ID to send_reply. Maximum 8 MB.',
    inputSchema:{name:z.string().min(1).max(160),mimeType:z.string().max(128),base64:z.string().max(12*1024*1024),kind:z.enum(['file','sticker']).default('file')},annotations:{readOnlyHint:false},
  },async input=>{
    try {
      if(!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)||input.base64.length%4!==0)throw new Error('Invalid base64');
      const raw=atob(input.base64);if(raw.length>8*1024*1024)throw new Error('Too large');
      const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
      return response(await uploadBridgeMedia(env.DB,env.MEDIA,bindingID,'assistant',{name:input.name,type:input.mimeType,bytes,kind:input.kind}));
    } catch { return {...response({error:'Attachment upload unavailable'}),isError:true}; }
  });
  return mcp;
}
const allowedRedirect=(value:string)=>{
  try { const u=new URL(value); return !u.search&&!u.hash&&((u.origin==='https://chatgpt.com'&&(u.pathname==='/connector_platform_oauth_redirect'||/^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(u.pathname)))||(u.origin==='https://agent.meta.ai'&&u.pathname==='/api/hatch/oauth/callback')); } catch { return false; }
};
async function handleMcp(request:Request,env:Env,ctx:ExecutionContext,bindingID:string) {
  let packet: {id?:string|number;method?:string;params?:unknown}|undefined;
  if(request.method==='POST') { try { packet=await request.clone().json() as typeof packet; } catch { /* SDK handles invalid JSON. */ } }
  if(packet?.method?.startsWith('events/')) {
    try {
      let result:unknown;
      if(packet.method==='events/list') result=listEvents();
      else if(packet.method==='events/subscribe') result=await subscribe(env,bindingID,packet.params);
      else if(packet.method==='events/unsubscribe') result=await unsubscribe(env,bindingID,packet.params);
      else return Response.json({jsonrpc:'2.0',id:packet.id??null,error:{code:-32601,message:'Method not found'}});
      return Response.json({jsonrpc:'2.0',id:packet.id??null,result});
    } catch(error) {
      const callback=error instanceof Error&&error.message==='callback_failed';
      return Response.json({jsonrpc:'2.0',id:packet.id??null,error:{code:callback?-32015:-32602,message:callback?'Callback endpoint verification failed':'Invalid event request',...(callback?{data:{reason:'challenge_failed'}}:{})}});
    }
  }
  const result=await createMcpHandler(()=>server(env,bindingID),{route:'/mcp'})(request,env,ctx);
  if(packet?.method!=='initialize'||!result.ok) return result;
  const original=await result.text();
  const update=(value:string)=>{const p=JSON.parse(value);p.result.capabilities.events={};return JSON.stringify(p);};
  try {
    const body=(result.headers.get('content-type')||'').includes('text/event-stream')
      ? original.replace(/^(data:\s*)(.+)$/m,(_,prefix,value)=>prefix+update(value)) : update(original);
    const headers=new Headers(result.headers);headers.delete('content-length');return new Response(body,{status:result.status,headers});
  } catch { return new Response(original,{status:result.status,headers:result.headers}); }
}
const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function page(body:string,cookie?:string,status=200) {
  return new Response(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vesper Chat</title><style>body{font:16px system-ui;background:#101d30;color:#eef4ff;margin:0;display:grid;place-items:center;min-height:100dvh}main{max-width:420px;padding:28px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:14px;margin-top:12px;border-radius:12px}button{background:#45618a;color:white}small{color:#b8c6dc}</style><main>${body}</main></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",...(cookie?{'set-cookie':cookie}:{})}});
}
const api:ExportedHandler<Env>={async fetch(request,env,ctx) {
  const props=(ctx as ExecutionContext & {props?:{bindingID?:string; scope?:string[]}}).props;
  if(!props?.bindingID||!props.scope?.includes(SCOPE)) return new Response('Forbidden',{status:403});
  return handleMcp(request,env,ctx,props.bindingID);
}};
const fallback:ExportedHandler<Env>={async fetch(request) {
  if(new URL(request.url).pathname==='/health') return Response.json({ok:true});
  return new Response('Vesper Chat bridge',{status:404});
}};
const oauth=new OAuthProvider<Env>({
  apiRoute:'/mcp',apiHandler:api as ExportedHandler<Env> & Required<Pick<ExportedHandler<Env>,'fetch'>>,
  authorizeEndpoint:'/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',
  clientIdMetadataDocumentEnabled:true,allowImplicitFlow:false,allowPlainPKCE:false,
  accessTokenTTL:3600,refreshTokenTTL:30*86400,scopesSupported:[SCOPE],
  resourceMetadata:{resource:`${ORIGIN}/mcp`,authorization_servers:[ORIGIN],scopes_supported:[SCOPE],resource_name:'Vesper Chat - single connection'},
  defaultHandler:{async fetch(request,env,ctx) {
    const url=new URL(request.url);
    if(url.pathname!=='/authorize') return fallback.fetch!(request,env,ctx);
    try {
      if(request.method==='GET') {
        const auth=await env.OAUTH_PROVIDER.parseAuthRequest(request);
        if(!allowedRedirect(auth.redirectUri)||auth.scope.some(s=>s!==SCOPE)) return page('This authorization request is not supported.',undefined,400);
        const nonce=crypto.randomUUID()+crypto.randomUUID();
        await createConsent(env.DB,nonce,request.url);
        const client=await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
        return page(`<h1>Connect Vesper Chat</h1><p>Connect ${escape(client?.clientName||'your assistant')} to one conversation. This does not grant access to Vesper memory, diary, photos, or other chats.</p><form method="post" action="/authorize"><input type="hidden" name="csrf" value="${nonce}"><label>Connection code<input type="password" name="code" autocomplete="off" required></label><small>Use the code from Vesper; do not send it in a message.</small><button name="decision" value="allow">Connect</button><button name="decision" value="deny" formnovalidate>Cancel</button></form>`,consentCookie(nonce));
      }
      const origin=request.headers.get('origin'), fetchSite=request.headers.get('sec-fetch-site');
      // Some WebKit versions submit an opaque Origin under strict referrer policies.
      // Accept that only when the browser identifies the request as same-origin;
      // the one-time nonce and host-only SameSite cookie are still required below.
      const sameOrigin=origin===ORIGIN||((origin===null||origin==='null')&&fetchSite==='same-origin');
      if(request.method!=='POST'||!sameOrigin) return page('Invalid request. Please restart the connection in ChatGPT.',undefined,403);
      const raw=await request.text(); if(raw.length>12000) return page('Request too large.',undefined,400);
      const form=new URLSearchParams(raw), nonce=form.get('csrf')||'';
      if(!cookieMatches(request.headers.get('cookie'),nonce)) {
        console.warn('vesper_chat_oauth: cookie_mismatch');
        return page('The browser session could not be verified. Open the latest authorization link and complete it in the same browser.',undefined,403);
      }
      // Read through old KV entries for authorizations started before this update.
      const currentConsent=await getConsent(env.DB,nonce);
      const legacyConsent=currentConsent ? null : await env.OAUTH_KV.get(`chat-consent:${nonce}`);
      const original=currentConsent ?? legacyConsent;
      if(!original) {
        console.warn('vesper_chat_oauth: consent_expired');
        return page('This authorization link has expired. Ask the assistant to start a new connection.',undefined,403);
      }
      const auth=await env.OAUTH_PROVIDER.parseAuthRequest(new Request(original));
      if(!allowedRedirect(auth.redirectUri)||auth.scope.some(s=>s!==SCOPE)) return page('Unsupported authorization.',undefined,400);
      if(form.get('decision')==='deny') {
        await deleteConsent(env.DB,nonce).catch(()=>{});
        if(legacyConsent) await env.OAUTH_KV.delete(`chat-consent:${nonce}`).catch(()=>{});
        const denied=new URL(auth.redirectUri); denied.searchParams.set('error','access_denied'); denied.searchParams.set('state',auth.state||''); denied.searchParams.set('iss',ORIGIN); return Response.redirect(denied,303);
      }
      if(form.get('decision')!=='allow') return page('Authorization denied.',undefined,403);
      let bindingID:string;
      try { bindingID=await bridgeIdentity(env.DB,(form.get('code')||'').trim()); }
      catch(error) {
        if(error instanceof Error&&error.message==='Connection unavailable') {
          console.warn('vesper_chat_oauth: code_unavailable');
          return page('This connection code is invalid or has been disconnected. Create a new connection in Vesper.',undefined,400);
        }
        throw error;
      }
      const granted=await env.OAUTH_PROVIDER.completeAuthorization({request:auth,userId:`chat_${bindingID}`,metadata:{clientName:'Vesper Chat'},scope:[SCOPE],props:{bindingID,scope:[SCOPE]}});
      await deleteConsent(env.DB,nonce).catch(()=>{});
      if(legacyConsent) await env.OAUTH_KV.delete(`chat-consent:${nonce}`).catch(()=>{});
      return new Response(null,{status:303,headers:{location:granted.redirectTo,'cache-control':'no-store','set-cookie':clearConsentCookie(nonce)}});
    } catch { console.warn('vesper_chat_oauth: authorization_failed'); return page('Unable to complete authorization. Please restart the connection in your assistant.',undefined,400); }
  }},
});
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext) {
  if(new URL(request.url).pathname==='/mcp') {
    const auth=request.headers.get('authorization')||'';
    if(auth.startsWith('Bearer vb_')) {
      try { const id=await bridgeIdentity(env.DB,auth.slice(7)); return handleMcp(request,env,ctx,id); }
      catch { return Response.json({error:'Connection unavailable'},{status:401}); }
    }
  }
  return oauth.fetch(request,env,ctx);
}, async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext) { ctx.waitUntil(deliver(env)); }
} satisfies ExportedHandler<Env>;
