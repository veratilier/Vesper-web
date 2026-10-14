import { createBookmark, listBookmarks, deleteBookmark } from '@/lib/bookmarks';
import { optionsResponse } from '@/lib/cors';
import { appRoute } from '@/lib/backend/http';
export const OPTIONS = optionsResponse;
const handle = appRoute({ service: 'writing', methods: ['GET', 'POST', 'DELETE'], errorMessage: 'Bookmark request failed' }, async context => {
  const { userId } = await context.scope(), request = context.request, query = context.url.searchParams;
  return context.json(request.method === 'GET' ? await listBookmarks(userId, Number(query.get('limit') || 30), query.get('before') || '') : request.method === 'DELETE' ? await deleteBookmark(userId, query.get('id') || '') : await createBookmark(userId, await request.json(), 'Vera'));
});
export const GET = handle, POST = handle, DELETE = handle;
