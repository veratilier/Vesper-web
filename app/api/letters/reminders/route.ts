import { authorizeApp } from '@/lib/bridge-auth';
import { memoryScopeFromRequest } from '@/lib/memory';
import { corsHeaders, optionsResponse } from '@/lib/cors';
import { letterReminders, acknowledgeLetterReminder } from '@/lib/letters';
export const OPTIONS = optionsResponse;
async function handle(request: Request) {
  const headers = corsHeaders(request); headers.set('cache-control','no-store');
  if (!await authorizeApp(request)) return Response.json({error:'Device not paired'},{status:401,headers});
  try {
    const {userId} = await memoryScopeFromRequest(request);
    const actor = new URL(request.url).searchParams.get('actor') || 'Vera';
    if (!['Vera','Rowan'].includes(actor)) throw new Error('Invalid recipient');
    const result = request.method === 'GET' ? await letterReminders(userId,actor)
      : await acknowledgeLetterReminder(userId,String(((await request.json()) as {id?:unknown}).id || ''),actor);
    return Response.json(result,{headers});
  } catch (error) { return Response.json({error:error instanceof Error ? error.message : 'Reminder request failed'},{status:400,headers}); }
}
export const GET = handle, POST = handle;
