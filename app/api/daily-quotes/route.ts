import { authorizeApp } from '@/lib/bridge-auth';
import { memoryScopeFromRequest } from '@/lib/memory';
import { corsHeaders, optionsResponse } from '@/lib/cors';
import { commentDailyQuote, keepDailyQuote, listDailyQuotes, setQuotePreferences } from '@/lib/daily-quotes';

export const OPTIONS = optionsResponse;
function respond(request: Request, value: unknown, status = 200) {
  const headers = corsHeaders(request); headers.set('cache-control', 'no-store');
  return Response.json(value, { status, headers });
}
async function handle(request: Request) {
  if (!await authorizeApp(request)) return respond(request, { error: 'Device not paired' }, 401);
  try {
    const { userId } = await memoryScopeFromRequest(request);
    if (request.method === 'GET') return respond(request, await listDailyQuotes(userId));
    const input = await request.json() as Record<string, unknown>;
    if (input.action === 'preferences') return respond(request, { preferences: await setQuotePreferences(userId, input) });
    if (input.action === 'keep') return respond(request, await keepDailyQuote(userId, String(input.cardId || ''), input.kept));
    if (input.action === 'comment') return respond(request, await commentDailyQuote(userId, input, 'Vera'));
    return respond(request, { error: 'Unknown daily quote action' }, 400);
  } catch (error) { return respond(request, { error: error instanceof Error ? error.message : 'Daily quote request failed' }, 400); }
}
export const GET = handle, POST = handle;
