// Run against the isolated local Worker after seeding its D1 with the disposable fixture code.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
if(!process.env.BRIDGE_TEST_URL) { console.log('OAuth Worker integration skipped: no local test server configured'); process.exit(0); }
const root=process.env.BRIDGE_TEST_URL;
const callback=process.env.BRIDGE_TEST_CLIENT==='muse'?'https://agent.meta.ai/api/hatch/oauth/callback':'https://chatgpt.com/connector_platform_oauth_redirect', code='vb_'+'A'.repeat(43);
let r=await fetch(root+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Local fixture',redirect_uris:[callback],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})});
let client=await r.json();assert.equal(r.status,201);assert(client.client_id);
const verifier=crypto.randomBytes(32).toString('base64url'), challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
const query=new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:callback,scope:'conversation:access',state:'test',code_challenge:challenge,code_challenge_method:'S256',resource:'https://bridge.vesper.r-vera.com/mcp'});
r=await fetch(root+'/authorize?'+query,{redirect:'manual'});const html=await r.text(),nonce=html.match(/name="csrf" value="([^"]+)"/)?.[1],cookie=r.headers.get('set-cookie')?.split(';')[0];assert.equal(r.status,200);assert(nonce&&cookie);assert.equal(r.headers.get('referrer-policy'),'same-origin');
const submit=async(origin,fetchSite,csrf=nonce)=>fetch(root+'/authorize',{method:'POST',redirect:'manual',headers:{origin,'sec-fetch-site':fetchSite,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,code,decision:'allow'})});
assert.equal((await submit('https://attacker.example','cross-site')).status,403);
assert.equal((await submit('null','cross-site')).status,403);
assert.equal((await submit('null','same-origin','invalid')).status,403);
r=await submit('null','same-origin');assert.equal(r.status,303);
const authCode=new URL(r.headers.get('location')).searchParams.get('code');assert(authCode);
r=await fetch(root+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,code:authCode,redirect_uri:callback,code_verifier:verifier,resource:'https://bridge.vesper.r-vera.com/mcp'})});const token=await r.json();assert.equal(r.status,200);assert(token.access_token);
r=await fetch(root+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token.access_token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});const body=await r.text();assert.equal(r.status,200);assert(body.includes('read_messages'));assert(body.includes('send_reply'));assert(!body.includes('list_memories'));assert(!body.includes('list_diaries'));
r=await fetch(root+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token.access_token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:3,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'fixture',version:'1'}}})});assert((await r.text()).includes('"events":{}'));
r=await fetch(root+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token.access_token,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':'server/discover'},body:JSON.stringify({jsonrpc:'2.0',id:5,method:'server/discover',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}})});assert((await r.text()).includes('"events":{}'));
r=await fetch(root+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token.access_token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:4,method:'events/list',params:{}})});assert((await r.text()).includes('message.created'));
r=await fetch(root+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token.access_token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'send_reply',arguments:{id:'wrong-target',replyTo:'unknown-message',text:'fixture'}}})});
assert((await r.text()).includes('isError'));
console.log('OAuth registration, authorization, token exchange and scoped MCP tools passed');
