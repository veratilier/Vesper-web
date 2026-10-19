import { authorizeApp } from '@/lib/bridge-auth';
import { corsHeaders, optionsResponse } from '@/lib/cors';
import { memoryScopeFromRequest } from '@/lib/memory';
import { clearSystemPhotos, finishSystemPhotoScan, knownSystemPhotoIDs, removeSystemPhotos, systemPhotoCount, uploadSystemPhoto } from '@/lib/system-photos';

export const OPTIONS = optionsResponse;
function json(request: Request, value: unknown, status = 200) {
  const headers = corsHeaders(request); headers.set('cache-control', 'no-store');
  return Response.json(value, { status, headers });
}
export async function GET(request: Request) {
  if (!await authorizeApp(request)) return json(request, { error: 'Device not paired' }, 401);
  return json(request, await systemPhotoCount((await memoryScopeFromRequest(request)).userId));
}
export async function POST(request: Request) {
  if (!await authorizeApp(request)) return json(request, { error: 'Device not paired' }, 401);
  try {
    const raw = await request.text();
    if (raw.length > 500_000) throw new Error('Request too large');
    const input = JSON.parse(raw) as Record<string,unknown>;
    const owner = (await memoryScopeFromRequest(request)).userId;
    switch (input.action) {
      case 'check': return json(request, await knownSystemPhotoIDs(owner,input.ids,input.scanId));
      case 'upload': return json(request, await uploadSystemPhoto(owner,input));
      case 'remove': return json(request, await removeSystemPhotos(owner,input.ids));
      case 'clear': return json(request, await clearSystemPhotos(owner));
      case 'finish': return json(request, await finishSystemPhotoScan(owner,input.scanId));
      default: throw new Error('Unknown photo sync action');
    }
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : 'Photo sync failed' }, 400);
  }
}
