import { authorizeApp } from '@/lib/bridge-auth';
import { getDb } from '@/lib/db';
import { corsHeaders, optionsResponse } from '@/lib/cors';
export const OPTIONS = optionsResponse;

// Recovery uses the independent device pairing credential, never the lost MCP token.
export async function POST(request: Request) {
  const headers = corsHeaders(request);
  headers.set('cache-control', 'no-store');
  if (!await authorizeApp(request)) return Response.json({ error: "Device pairing expired. Pair Vesper again before recovering the MCP token." }, { status: 401, headers });
  try {
    if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: "A JSON request is required." }, { status: 415, headers });
    const raw = await request.text();
    if (raw.length > 2048) return Response.json({ error: "Request too large" }, { status: 413, headers });
    const body = JSON.parse(raw) as { token?: unknown };
    if (typeof body?.token !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(body.token)) return Response.json({ error: "Enter a 16–256 character token using only letters, numbers, underscores or hyphens, without “Bearer”." }, { status: 400, headers });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.token));
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    const db = getDb();
    await db.prepare('CREATE TABLE IF NOT EXISTS vesper_mcp_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)').run();
    await db.prepare("INSERT INTO vesper_mcp_config(key,value,updated_at) VALUES('access_token_hash',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind(hash, new Date().toISOString()).run();
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ error: "Could not save the token. Please try again." }, { status: 400, headers });
  }
}
