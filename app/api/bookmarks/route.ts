import { authorizeApp } from '@/lib/bridge-auth';
import { memoryScopeFromRequest } from '@/lib/memory';
import { corsHeaders, optionsResponse } from '@/lib/cors';
import { createBookmark, listBookmarks, deleteBookmark } from '@/lib/bookmarks';
export const OPTIONS = optionsResponse;
async function handle(request: Request) {
  const headers = corsHeaders(request); headers.set('cache-control','no-store');
  if (!(await authorizeApp(request))) return Response.json({ error: 'Device not paired' }, { status:401, headers });
  try {
    const { userId } = await memoryScopeFromRequest(request), url = new URL(request.url);
    const result = request.method === 'GET'
      ? await listBookmarks(userId, Number(url.searchParams.get('limit') || 30), url.searchParams.get('before') || '')
      : request.method === 'DELETE' ? await deleteBookmark(userId, url.searchParams.get('id') || '')
      : await createBookmark(userId, await request.json(), 'Vera');
    return Response.json(result, { headers });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Bookmark request failed' }, { status:400, headers }); }
}
export const GET = handle, POST = handle, DELETE = handle;
