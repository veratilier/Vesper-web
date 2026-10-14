import { createLetter, getLetter, listLetters, markLetter } from '@/lib/letters';
import { optionsResponse } from '@/lib/cors';
import { appRoute } from '@/lib/backend/http';
export const OPTIONS = optionsResponse;
const handle = appRoute({ service: 'letters', methods: ['GET', 'POST', 'PATCH'], errorMessage: 'Letter request failed' }, async context => {
  const { userId } = await context.scope(), request = context.request, query = context.url.searchParams;
  return context.json(request.method === 'GET' ? query.has('id') ? await getLetter(userId,query.get('id')!) : await listLetters(userId,Number(query.get('limit') || 30),query.get('before') || '') : request.method === 'PATCH' ? await markLetter(userId,await request.json()) : await createLetter(userId,await request.json()));
});
export const GET = handle, POST = handle, PATCH = handle;
