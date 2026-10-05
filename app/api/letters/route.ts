import { authorizeApp } from '@/lib/bridge-auth';
import { memoryScopeFromRequest } from '@/lib/memory';
import { corsHeaders, optionsResponse } from '@/lib/cors';
import { createLetter, getLetter, listLetters, markLetter } from '@/lib/letters';
export const OPTIONS = optionsResponse;
async function handle(request: Request) {
  const headers = corsHeaders(request); headers.set('cache-control','no-store');
  if (!(await authorizeApp(request))) return Response.json({error:'Device not paired'},{status:401,headers});
  try {
    const {userId} = await memoryScopeFromRequest(request), query = new URL(request.url).searchParams;
    const result = request.method === 'GET' ? query.has('id') ? await getLetter(userId,query.get('id')!) : await listLetters(userId,Number(query.get('limit') || 30),query.get('before') || '')
      : request.method === 'PATCH' ? await markLetter(userId,await request.json()) : await createLetter(userId,await request.json());
    return Response.json(result,{headers});
  } catch (error) { return Response.json({error:error instanceof Error ? error.message : 'Letter request failed'},{status:400,headers}); }
}
export const GET = handle, POST = handle, PATCH = handle;
