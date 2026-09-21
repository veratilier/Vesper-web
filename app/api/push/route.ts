import { env } from "cloudflare:workers";
import { sendPushNotification, type PushSubscriptionData } from "@mmmike/web-push/send";
import { corsHeaders, optionsResponse } from "@/lib/cors";
import { ensureSchema, getDb } from "@/lib/db";

type PushEnv = {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

function json(request: Request, value: unknown, status = 200) {
  return Response.json(value, { status, headers: corsHeaders(request) });
}

function pushEnv() {
  return env as unknown as PushEnv;
}

function validSubscription(value: unknown): value is PushSubscriptionData {
  if (!value || typeof value !== "object") return false;
  const entry = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof entry.endpoint !== "string" || !entry.endpoint.startsWith("https://")) return false;
  return typeof entry.keys?.p256dh === "string" && typeof entry.keys?.auth === "string";
}

export const OPTIONS = optionsResponse;

export async function GET(request: Request) {
  const settings = pushEnv();
  return json(request, {
    configured: Boolean(settings.VAPID_PUBLIC_KEY && settings.VAPID_PRIVATE_KEY),
    publicKey: settings.VAPID_PUBLIC_KEY || "",
  });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = (await request.json()) as {
    action?: "subscribe" | "test" | "notify";
    subscription?: unknown;
    notification?: {
      title?: string;
      body?: string;
      url?: string;
      tag?: string;
      kind?: "message" | "call" | "note";
    };
  };
  if (!validSubscription(body.subscription))
    return json(request, { error: "Invalid push subscription" }, 400);

  const now = new Date().toISOString();
  await getDb()
    .prepare(`INSERT INTO vesper_push_subscriptions(endpoint, subscription, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription, updated_at = excluded.updated_at`)
    .bind(body.subscription.endpoint, JSON.stringify(body.subscription), now, now)
    .run();

  if (body.action !== "test" && body.action !== "notify") return json(request, { ok: true });
  const settings = pushEnv();
  if (!settings.VAPID_PUBLIC_KEY || !settings.VAPID_PRIVATE_KEY)
    return json(request, { error: "Push server is not configured" }, 503);

  const payload = body.action === "notify"
    ? {
        title: (body.notification?.title || "Vesper").slice(0, 80),
        body: (body.notification?.body || "New activity in Vesper").slice(0, 260),
        url: body.notification?.url?.startsWith("/") ? body.notification.url : "/",
        tag: (body.notification?.tag || "vesper-agent-action").slice(0, 120),
        kind: body.notification?.kind || "message",
      }
    : {
        title: "Vesper",
        body: "Web Push is connected. Vesper can notify you even when the page is closed.",
        url: "/",
        tag: "vesper-test",
      };
  const delivered = await sendPushNotification(
    body.subscription,
    payload,
    {
      publicKey: settings.VAPID_PUBLIC_KEY,
      privateKey: settings.VAPID_PRIVATE_KEY,
      subject: settings.VAPID_SUBJECT || "mailto:admin@r-vera.com",
    },
  );
  if (!delivered) {
    await getDb().prepare("DELETE FROM vesper_push_subscriptions WHERE endpoint = ?").bind(body.subscription.endpoint).run();
  }
  return json(request, { ok: delivered, delivered });
}
