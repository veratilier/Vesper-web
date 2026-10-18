import { env } from 'cloudflare:workers';
import { authorizeApp } from '@/lib/bridge-auth';
import { executeDesire, DesireUnavailable, type NativeDesireEnv } from '@/lib/desire/native';
import { corsHeaders, optionsResponse } from '@/lib/cors';
import { emotionContext, emotionEvents, commitEmotion, settlementReceipt } from '@/lib/desire/emotion-store';
import { z } from 'zod';
export const OPTIONS = optionsResponse;
export async function GET(request: Request) {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...Object.fromEntries(corsHeaders(request)), 'cache-control': 'no-store' } });
  if (!(await authorizeApp(request))) return respond({ error: 'Device not paired' }, 401);
  const query = new URL(request.url).searchParams;
  const view = query.get('view') || 'status';
  if (!['status', 'history', 'context'].includes(view)) return respond({ error: 'Unsupported view' }, 400);
  try {
    const input = view === 'history' ? { ...(query.has('limit') ? { limit: Number(query.get('limit')) } : {}), ...(query.has('cursor') ? { cursor: query.get('cursor') } : {}), ...(query.get('legacy') === 'true' ? {legacy:true} : {}) } : {};
    // Recovery is read-only: never seed defaults into a missing/wrong database.
    const db = (env as NativeDesireEnv).DB;
    if (!db) throw new DesireUnavailable('Vesper Desire storage is unavailable.');
    if (view === 'context') return respond({data:await emotionContext(db),source:'Vesper'});
    return respond({ data: await executeDesire(env as NativeDesireEnv, `desire_${view}`, input), source: 'Vesper' });
  } catch (reason) {
    if (reason instanceof DesireUnavailable) return respond({ error: reason.message }, 503);
    if (reason instanceof Error && reason.name === 'ZodError') return respond({ error: 'Invalid history parameters' }, 400);
    console.error('Native Desire read failed', reason);
    return respond({ error: "Could not read Desire. Please refresh later." }, 502);
  }
}
export async function POST(request: Request) {
  const respond = (body: unknown, status=200) => Response.json(body,{status,headers:{...Object.fromEntries(corsHeaders(request)),'cache-control':'no-store'}});
  if (!(await authorizeApp(request))) return respond({error:'Device not paired'},401);
  try {
    const db = (env as NativeDesireEnv).DB;
    if (!db) throw new DesireUnavailable('Vesper Desire storage is unavailable.');
    const text=await request.text(); if(text.length>500_000)return respond({error:'Request too large'},413);
    const input=z.object({action:z.enum(['events','commit','settlement']),events:z.unknown().optional(),candidate:z.unknown().optional(),model:z.string().max(120).optional(),error:z.string().max(240).optional()}).strict().parse(JSON.parse(text));
    if(input.action==='events')return respond(await emotionEvents(db,input.events));
    if(input.action==='commit') { const result=await commitEmotion(db,input.candidate); return respond(result,result.committed?200:409); }
    await settlementReceipt(db,input.model || 'unavailable',input.error);
    return respond({saved:true});
  } catch(e) {
    if(e instanceof DesireUnavailable)return respond({error:e.message},503);
    if(e instanceof z.ZodError || e instanceof SyntaxError)return respond({error:'Invalid emotion request'},400);
    console.error('Emotion write failed',e);
    return respond({error:'Could not save Desire; current values were preserved.'},502);
  }
}
