import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { authorizeApp } from '@/lib/bridge-auth';
import { corsHeaders, optionsResponse } from '@/lib/cors';
import { sharedMemoryRequest } from '@/lib/shared-memory-handler';

export const OPTIONS = optionsResponse;
function handle(request: Request) {
  return sharedMemoryRequest(request, {
    authorize: authorizeApp,
    database: () => (env as unknown as { SHARED_MEMORY_DB?: D1Database }).SHARED_MEMORY_DB,
    headers: corsHeaders,
  });
}
export const GET = handle;
export const POST = handle;
