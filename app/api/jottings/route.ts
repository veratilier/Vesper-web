import { listJottings, getJotting } from '@/lib/jottings';
import { optionsResponse } from '@/lib/cors';
import { appRoute } from '@/lib/backend/http';
export const OPTIONS = optionsResponse;
const handle = appRoute({ service: 'writing', methods: ['GET', 'POST', 'DELETE'], errorMessage: 'Jotting request failed' }, async context => {
  if (context.request.method !== 'GET') return context.json({ error: 'Sketch has been retired' }, 410);
  const { userId } = await context.scope(), query = context.url.searchParams;
  return context.json(query.has('id') ? await getJotting(userId, query.get('id') || '') : await listJottings(userId, Number(query.get('limit') || 30), query.get('before') || ''));
});
export const GET = handle, POST = handle, DELETE = handle;
