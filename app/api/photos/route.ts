import { listAlbumPhotos, saveAlbumPhoto } from '@/lib/photo-album';
import { optionsResponse } from '@/lib/cors';
import { appRoute, APIError } from '@/lib/backend/http';
export const OPTIONS = optionsResponse;
const handle = appRoute({ service: 'media', methods: ['GET','POST'], errorMessage: 'Photo request failed' }, async context => {
  const scope = await context.scope();
  if (context.request.method === 'GET') return context.json(await listAlbumPhotos(scope.userId, Object.fromEntries(context.url.searchParams), context.url.origin));
  const raw = await context.request.text();
  if (raw.length > 4000) throw new APIError('Request too large');
  const data = JSON.parse(raw);
  return context.json({ photo: await saveAlbumPhoto(scope.userId, String(data?.key || ''), data.category, data.caption, context.url.origin) });
});
export const GET = handle, POST = handle;
