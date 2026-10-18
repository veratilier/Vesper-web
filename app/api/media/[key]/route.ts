import { media } from '@/lib/backend/services';
import { corsHeaders, optionsResponse } from '@/lib/cors';

export const OPTIONS = optionsResponse;

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  if (!/^[a-z0-9-]+\.[a-z0-9]+$/i.test(key)) return new Response('Not found', { status: 404 });
  const object = await media().get(key);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = corsHeaders(_request);
  object.writeHttpMetadata(headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}
