import { env } from 'cloudflare:workers';
import { authorizeApp } from '@/lib/bridge-auth';
import { getDb, ensureSchema } from '@/lib/db';
import { corsHeaders, optionsResponse } from '@/lib/cors';
import { sendPushBatch, type PushSubscriptionData } from '@mmmike/web-push/send';

export const OPTIONS = optionsResponse;
const json = (r: Request, value: unknown, status = 200) => Response.json(value, {status, headers: corsHeaders(r)});
// Idempotent notification outbox, separate from all existing user data.
export async function POST(request: Request) {
  if (!await authorizeApp(request)) return json(request,{error:'Device not paired'},401);
  const body = await request.json() as {requestId?: string; message?: string; conversationId?: string};
  if (!body.requestId || !/^[a-zA-Z0-9:_-]{1,128}$/.test(body.requestId) || !body.message?.trim()) return json(request,{error:'Invalid wake notification'},400);
  if (!body.conversationId || !/^[a-zA-Z0-9:_-]{1,128}$/.test(body.conversationId)) return json(request,{error:'Invalid conversation'},400);
  const config = env as {VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string};
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) return json(request,{error:'Push not configured'},503);
  await ensureSchema();
  const db = getDb();
  await db.prepare('CREATE TABLE IF NOT EXISTS vesper_wake_push (id TEXT PRIMARY KEY, status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL)').run();
  const subscriptions = await db.prepare('SELECT subscription FROM vesper_push_subscriptions').all<{subscription:string}>();
  if (!subscriptions.results.length) return json(request,{error:'No subscribed devices',delivered:0},409);
  const claim = await db.prepare("INSERT OR IGNORE INTO vesper_wake_push(id,status,created_at) VALUES(?,'sending',?)").bind(body.requestId,new Date().toISOString()).run();
  if (!claim.meta.changes) {
    const old=await db.prepare('SELECT status,result FROM vesper_wake_push WHERE id=?').bind(body.requestId).first<{status:string;result:string|null}>();
    return json(request,{duplicate:true,status:old?.status,...(old?.result?JSON.parse(old.result):{})});
  }
  try {
    const result=await sendPushBatch(subscriptions.results.map(row=>JSON.parse(row.subscription) as PushSubscriptionData),{
      title:'Vesper',body:body.message.slice(0,240),tag:`vesper-wake-${body.requestId}`,
      url:`/?section=chat&conversation=${encodeURIComponent(body.conversationId)}`,
    },{publicKey:config.VAPID_PUBLIC_KEY,privateKey:config.VAPID_PRIVATE_KEY,subject:config.VAPID_SUBJECT || 'mailto:admin@r-vera.com'});
    const receipt={delivered:result.delivered,total:subscriptions.results.length,gone:result.gone.length};
    await db.prepare('UPDATE vesper_wake_push SET status=?,result=? WHERE id=?').bind(result.delivered>0?'sent':'failed',JSON.stringify(receipt),body.requestId).run();
    return json(request,{status:result.delivered>0?'sent':'failed',...receipt});
  } catch {
    // Delivery may already have happened. Do not blindly resend an uncertain push.
    await db.prepare("UPDATE vesper_wake_push SET status='uncertain' WHERE id=?").bind(body.requestId).run();
    return json(request,{error:'Push delivery unconfirmed',status:'uncertain'},502);
  }
}
