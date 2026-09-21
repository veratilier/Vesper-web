import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { isDesireTool, legacyDesireRead, VESPER_DESIRE_SESSION_CONFIG } from '../lib/desire/routing.js';
assert.equal(legacyDesireRead('desire_status'), 'desire_status');
assert.equal(legacyDesireRead('desire_history'), 'desire_history');
for (const name of ['desire_encounter', 'desire_express', 'desire_set_style']) assert.throws(() => legacyDesireRead(name), /外部 Desire 写入已停用/);
assert.equal(isDesireTool('search'), false);
assert.equal(legacyDesireRead('search'), null);
assert.equal(VESPER_DESIRE_SESSION_CONFIG['apps.asdk_app_6a92be9d9e1c819197f58017d0e2b985.enabled'], false);
// Exercise the actual outbound gateway: blocked calls must not even read a
// connection/credential, let alone initialize an external MCP session.
await build({entryPoints:['lib/mcp-connections.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/vesper-routing-gateway.mjs',plugins:[{name:'isolated-storage',setup(b){
 b.onResolve({filter:/^(cloudflare:workers|@\/lib\/db)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='cloudflare:workers'?'export const env = {};':'export const ensureSchema=()=>{throw Error("unexpected database access")}; export const getDb=()=>{throw Error("unexpected database access")};',loader:'js'}));
}}]});
const {callConfiguredMcpTool}=await import('/tmp/vesper-routing-gateway.mjs');
for (const toolName of ['desire_status','desire_history','desire_encounter','desire_express','desire_set_style']) {
 await assert.rejects(callConfiguredMcpTool({userId:'fixture'}, {connectionId:'old-connection',toolName,arguments:{}}),/External Desire tools are disabled/);
}
console.log('Desire routing: native read compatibility, blocked legacy writes and no external gateway access passed');
