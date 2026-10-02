import { initializeWebMusicQueue, WEB_MUSIC } from "@/lib/web-music";
import { cleanMusicDocument } from '@/lib/music-data';
import { allowedDocumentKeys } from "@/db/schema";
import { ensureSchema, getDb } from "@/lib/db";
import { corsHeaders, optionsResponse } from "@/lib/cors";
import { authorizeApp } from "@/lib/bridge-auth";

function json(request: Request, value: unknown, status = 200) {
  return Response.json(value, { status, headers: corsHeaders(request) });
}

export const OPTIONS = optionsResponse;

export async function GET(request: Request) {
  if (!(await authorizeApp(request)))
    return json(request, { error: "Device not paired" }, 401);
  await ensureSchema();
  const key = new URL(request.url).searchParams.get("key");
  if (key) {
    if (!allowedDocumentKeys.has(key))
      return json(request, { error: "Unknown document" }, 400);
    if (key === WEB_MUSIC.queue || key === WEB_MUSIC.library) await initializeWebMusicQueue(getDb(), key);
    const row = await getDb()
      .prepare("SELECT value, updated_at FROM vesper_documents WHERE key = ?")
      .bind(key)
      .first<{ value: string; updated_at: string }>();
    return json(
      request,
      row
        ? { key, value: JSON.parse(row.value), updatedAt: row.updated_at }
        : { key, value: null },
    );
  }
  const result = await getDb()
    .prepare("SELECT key, value, updated_at FROM vesper_documents")
    .all<{ key: string; value: string; updated_at: string }>();
  const documents = Object.fromEntries(
    result.results.map((row) => [
      row.key,
      { value: JSON.parse(row.value), updatedAt: row.updated_at },
    ]),
  );
  return json(request, { documents });
}

export async function PUT(request: Request) {
  if (!(await authorizeApp(request)))
    return json(request, { error: "Device not paired" }, 401);
  await ensureSchema();
  const body = (await request.json()) as { key?: string; value?: unknown };
  if (
    !body.key ||
    !allowedDocumentKeys.has(body.key) ||
    body.value === undefined
  ) {
    return json(request, { error: "Invalid document" }, 400);
  }
  const updatedAt = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO vesper_documents (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(body.key, JSON.stringify(cleanMusicDocument(body.key, body.value)), updatedAt)
    .run();
  return json(request, { ok: true, updatedAt });
}
