import { initializeWebMusicQueue, WEB_MUSIC } from '@/lib/web-music';
import { allowedDocumentKeys } from '@/db/schema';
import { getDb } from '@/lib/db';
import { optionsResponse } from '@/lib/cors';
import { appRoute, APIError } from '@/lib/backend/http';
import { documents } from '@/lib/backend/services';
export const OPTIONS = optionsResponse;
const handle = appRoute({ service: 'documents', methods: ['GET', 'PUT'], errorMessage: 'Document storage unavailable', errorStatus: 500 }, async context => {
  const repository = await documents();
  if (context.request.method === 'GET') {
    const key = context.url.searchParams.get('key');
    if (!key) return context.json({ documents: await repository.list() });
    if (!allowedDocumentKeys.has(key)) throw new APIError('Unknown document');
    if (key === WEB_MUSIC.queue || key === WEB_MUSIC.library) await initializeWebMusicQueue(getDb(), key);
    return context.json(await repository.read(key));
  }
  const body = await context.request.json() as { key?: string; value?: unknown };
  if (!body?.key || !allowedDocumentKeys.has(body.key) || body.value === undefined) throw new APIError('Invalid document');
  const saved = await repository.write(body.key, body.value);
  return context.json({ ok: true, updatedAt: saved.updatedAt });
});
export const GET = handle, PUT = handle;
