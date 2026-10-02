import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import * as z from 'zod/v4';
import { authorizeApp } from '@/lib/bridge-auth';
import { recallSharedMemory } from '@/lib/shared-memory-tools';
import { prepareRecall, acknowledgeRecall, recentRecall, recallFeedback } from '@/lib/shared-memory-recall';
import { memoryAdditionalContext } from '@/lib/memory-transport';
import { MemoryError } from '@/lib/shared-memory-engine';
import { corsHeaders, optionsResponse } from '@/lib/cors';
function json(request:Request,value:unknown,status=200){const headers=corsHeaders(request);headers.set('cache-control','no-store');return Response.json(value,{status,headers});}
function databases(){const bindings=env as unknown as {DB:D1Database;SHARED_MEMORY_DB?:D1Database};if(!bindings.SHARED_MEMORY_DB)throw new Error('shared_memory_unavailable');return {memory:bindings.SHARED_MEMORY_DB,ledger:bindings.DB};}
export const OPTIONS=optionsResponse;
export async function GET(request:Request){
 if(!await authorizeApp(request))return json(request,{error:'Device not paired'},401);
 try{return json(request,await recentRecall(databases().ledger,new URL(request.url).searchParams.get('conversationId')||undefined));}
 catch{return json(request,{items:[],unavailable:true});}
}
export async function POST(request:Request){
 if(!await authorizeApp(request))return json(request,{error:'Device not paired'},401);
 let action='prepare';
 try{
  const raw=await request.text();if(raw.length>32000)return json(request,{error:'request_too_large'},413);
  const body=z.record(z.string(),z.unknown()).parse(JSON.parse(raw));action=String(body.action||'prepare');
  const {memory,ledger}=databases();
  if(action==='acknowledge')return json(request,await acknowledgeRecall(ledger,body));
  if(action==='feedback')return json(request,await recallFeedback(ledger,body,memory));
  if(action!=='prepare')return json(request,{error:'invalid_action'},400);
  // Existing clients continue to work until their non-visual transport update is installed.
  if(!body.messageId||!body.conversationId)return json(request,await recallSharedMemory(String(body.query||'').slice(0,1000)));
  if((env as unknown as {VESPER_MEMORY_CONTEXT_TRANSPORT?:string}).VESPER_MEMORY_CONTEXT_TRANSPORT!=='additional-context-v1')return json(request,{context:'',memories:[],deliveryId:null,status:'host_not_verified'});
  const prepared=await prepareRecall(memory,ledger,body as Parameters<typeof prepareRecall>[2]);
  return json(request,{...prepared,additionalContext:memoryAdditionalContext(prepared.context),transport:'additional-context-v1',retention:'host_history_possible'});
 }catch(error){
  if(error instanceof z.ZodError||error instanceof SyntaxError)return json(request,{error:'invalid_arguments'},400);
  if(error instanceof MemoryError)return json(request,{error:error.code},error.status);
  // Fail open only for read/preparation, never pretend a write succeeded.
  return action==='prepare'?json(request,{context:'',memories:[],deliveryId:null,status:'unavailable'}):json(request,{error:'memory_operation_unavailable'},503);
 }
}
