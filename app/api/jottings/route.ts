import { createJotting, listJottings, deleteJotting, getJotting } from '@/lib/jottings';
import { optionsResponse } from '@/lib/cors';
import { appRoute } from '@/lib/backend/http';
export const OPTIONS = optionsResponse;
const handle = appRoute({ service: 'writing', methods: ['GET', 'POST', 'DELETE'], errorMessage: 'Jotting request failed' }, async context => {
  const { userId } = await context.scope(), request = context.request, query = context.url.searchParams;
  return context.json(request.method === 'GET' ? query.has('id') ? await getJotting(userId, query.get('id') || '') : await listJottings(userId, Number(query.get('limit') || 30), query.get('before') || '') : request.method === 'DELETE' ? await deleteJotting(userId, query.get('id') || '') : await createJotting(userId, await request.json(), 'Vera'));
});
export const GET = handle, POST = handle, DELETE = handle;
