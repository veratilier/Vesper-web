import { listAlbumPhotos, removeAlbumPhoto, saveAlbumPhoto } from '@/lib/photo-album';
import { optionsResponse } from '@/lib/cors';
import { appRoute, APIError } from '@/lib/backend/http';
export const OPTIONS = optionsResponse;
const handle = appRoute({ service: 'media', methods: ['GET','POST','DELETE'], errorMessage: 'Photo request failed' }, async context => {
  const scope = await context.scope();
  if (context.request.method === 'GET') return context.json(await listAlbumPhotos(scope.userId, Object.fromEntries(context.url.searchParams), context.url.origin));
  const raw = await context.request.text();
  if (raw.length > 4000) throw new APIError('Request too large');
  const data = JSON.parse(raw);
  if (context.request.method === 'DELETE') {
    const id = String(data?.id || '');
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new APIError('Invalid photo ID');
    if (!await removeAlbumPhoto(scope.userId, id)) throw new APIError('Photo not found in album', 404);
    return context.json({ removed: true, photoId: id });
  }
  return context.json({ photo: await saveAlbumPhoto(scope.userId, String(data?.key || ''), data.category, data.caption, context.url.origin) });
});
export const GET = handle, POST = handle, DELETE = handle;
