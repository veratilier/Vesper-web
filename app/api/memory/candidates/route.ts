import {saveSchema} from '@/lib/shared-memory-engine';
import {env,waitUntil} from 'cloudflare:workers';
import {authorizeApp} from '@/lib/bridge-auth';
import {memoryScopeFromRequest} from '@/lib/memory';
import {verifySharedEvidence} from '@/lib/memory-vault';
import {listCandidates,reviewCandidate,proposeMemory,editCandidate} from '@/lib/memory-candidates';
import {processVectorJobs,type VectorEnv} from '@/lib/memory-vector-index';
import type {D1Database} from '@cloudflare/workers-types';
import {corsHeaders,optionsResponse} from '@/lib/cors';
export const OPTIONS=optionsResponse;
async function handle(request:Request){
 const headers=corsHeaders(request);headers.set('cache-control','no-store');
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
 if(!await authorizeApp(request))return json({error:'Device not paired'},401);
 try{
  const db=(env as unknown as {SHARED_MEMORY_DB:D1Database}).SHARED_MEMORY_DB;if(!db)return json({error:'shared_memory_unavailable'},503);
  const scope=await memoryScopeFromRequest(request);const owner=scope.userId+':'+scope.characterId;
  if(request.method==='GET')return json(await listCandidates(db,owner));
  const text=await request.text();if(text.length>64000)return json({error:'request_too_large'},413);
  const input=JSON.parse(text);
  if(input.action==='propose'){const payload=saveSchema.parse(input.memory);if(payload.details?.evidence?.length)payload.details.evidence=await verifySharedEvidence(scope,payload.details.evidence);return json(await proposeMemory(db,owner,payload));}
  if(input.action==='edit')return json(await editCandidate(db,owner,String(input.id||''),input.memory));
  const result=await reviewCandidate(db,owner,input,refs=>verifySharedEvidence(scope,refs??[]));
  waitUntil(processVectorJobs({...env as unknown as VectorEnv,DB:db}).catch(()=>{}));return json(result);
 }catch{return json({error:'candidate_review_failed_check_original_source'},400);}
}
export const GET=handle;export const POST=handle;
