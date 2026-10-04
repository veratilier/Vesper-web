import { authorizeApp } from '@/lib/bridge-auth';
import { memoryScopeFromRequest } from '@/lib/memory';
import { corsHeaders, optionsResponse } from '@/lib/cors';
import { createJotting, listJottings, deleteJotting, getJotting } from '@/lib/jottings';
export const OPTIONS = optionsResponse;
async function handle(request: Request) {
  const headers = corsHeaders(request); headers.set('cache-control','no-store');
  if (!(await authorizeApp(request))) return Response.json({ error: 'Device not paired' }, { status:401, headers });
  try {
    const { userId } = await memoryScopeFromRequest(request), url = new URL(request.url);
    const result = request.method === 'GET'
      ? url.searchParams.has('id') ? await getJotting(userId, url.searchParams.get('id') || '') : await listJottings(userId, Number(url.searchParams.get('limit') || 30), url.searchParams.get('before') || '')
      : request.method === 'DELETE' ? await deleteJotting(userId, url.searchParams.get('id') || '')
      : await createJotting(userId, await request.json(), 'Vera');
    return Response.json(result, { headers });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Jotting request failed' }, { status:400, headers }); }
}
export const GET = handle, POST = handle, DELETE = handle;
