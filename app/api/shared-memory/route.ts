import { processVectorJobs, type VectorEnv } from '@/lib/memory-vector-index';
import { env, waitUntil } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { authorizeApp } from '@/lib/bridge-auth';
import { corsHeaders, optionsResponse } from '@/lib/cors';
import { sharedMemoryRequest } from '@/lib/shared-memory-handler';

export const OPTIONS = optionsResponse;
async function handle(request: Request) {
  const response=await sharedMemoryRequest(request, {
    authorize: authorizeApp,
    database: () => (env as unknown as { SHARED_MEMORY_DB?: D1Database }).SHARED_MEMORY_DB,
    headers: corsHeaders,
    vector: env as unknown as VectorEnv,
  });
  if(response.ok&&request.method==='POST'){const db=(env as unknown as {SHARED_MEMORY_DB?:D1Database}).SHARED_MEMORY_DB;if(db)waitUntil(processVectorJobs({...env as unknown as VectorEnv,DB:db}).catch(()=>{}));}
  return response;
}
export const GET = handle;
export const POST = handle;
