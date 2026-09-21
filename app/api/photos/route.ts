import { authorizeApp } from '@/lib/bridge-auth';
import { memoryScopeFromRequest } from '@/lib/memory';
import { listAlbumPhotos, saveAlbumPhoto } from '@/lib/photo-album';
import { corsHeaders, optionsResponse } from '@/lib/cors';
export const OPTIONS = optionsResponse;
export async function GET(request: Request) {
  const headers = corsHeaders(request); headers.set('cache-control', 'no-store');
  if (!await authorizeApp(request)) return Response.json({ error: 'Device not paired' }, { status: 401, headers });
  const u = new URL(request.url), scope = await memoryScopeFromRequest(request);
  return Response.json(await listAlbumPhotos(scope.userId, Object.fromEntries(u.searchParams), u.origin), { headers });
}
export async function POST(request: Request) {
  const headers = corsHeaders(request); headers.set('cache-control', 'no-store');
  if (!await authorizeApp(request)) return Response.json({ error: 'Device not paired' }, { status: 401, headers });
  try {
    const raw = await request.text(); if (raw.length > 4000) throw new Error('Request too large');
    const data = JSON.parse(raw), scope = await memoryScopeFromRequest(request);
    return Response.json({ photo: await saveAlbumPhoto(scope.userId, String(data.key || ''), data.category, data.caption, new URL(request.url).origin) }, { headers });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Save failed" }, { status: 400, headers }); }
}
