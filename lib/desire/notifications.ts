import { sendPushBatch, type PushSubscriptionData } from '@mmmike/web-push/send';
import type { NativeDesireEnv } from './native';
/** Vesper devices only. Never send to or remove the old PWA subscriptions. */
export async function notifyVesperDesire(env: NativeDesireEnv, notification: { title: string; body: string; tag: string }) {
  if (!env.DB || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  const rows = await env.DB.prepare('SELECT subscription FROM vesper_push_subscriptions').all<{ subscription: string }>();
  const subscriptions = rows.results.map(row => JSON.parse(row.subscription) as PushSubscriptionData);
  if (!subscriptions.length) return false;
  const result = await sendPushBatch(subscriptions, { ...notification, url: '/?section=desire' }, {
    publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || 'mailto:admin@r-vera.com',
  });
  for (const endpoint of result.gone) await env.DB.prepare('DELETE FROM vesper_push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
  return result.delivered > 0;
}
