import * as z from 'zod/v4';
import type { D1Database } from '@cloudflare/workers-types';
import { getMemory, kinds, listMemories, MemoryError, saveMemory, searchMemory, withdrawMemory } from './shared-memory-engine';

type Dependencies = {
  authorize: (request: Request) => Promise<boolean>;
  database: () => D1Database | undefined;
  headers: (request: Request) => Headers;
};

// Only paired Vesper devices can reach this owner's shared library. No arbitrary proxy URL.
export async function sharedMemoryRequest(request: Request, dependencies: Dependencies): Promise<Response> {
  const headers = dependencies.headers(request);
  headers.set('cache-control', 'no-store');
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
  if (!await dependencies.authorize(request)) return json({ error: 'Device not paired' }, 401);
  const db = dependencies.database();
  if (!db) return json({ error: '共享记忆库尚未完成后端连接，请更新 Vesper 服务。' }, 503);
  try {
    const path = new URL(request.url).searchParams.get('path') ?? '';
    if (!path.startsWith('/api/') || path.startsWith('//') || path.includes('#') || path.includes('\\')) return json({ error: 'Invalid memory route' }, 400);
    const target = new URL(path, 'https://memory.r-vera.com');
    if (request.method === 'GET' && target.pathname === '/api/memories') {
      const q = Object.fromEntries(target.searchParams);
      const options = z.object({ offset: z.coerce.number().int().min(0).max(1000000).default(0), limit: z.coerce.number().int().min(1).max(100).default(40), include_superseded: z.enum(['true','false']).default('false'), kind: z.enum([...kinds,'preference_agreement']).optional() }).parse(q);
      return json(await listMemories(db, { ...options, include_superseded: options.include_superseded === 'true' }));
    }
    const record = target.pathname.match(/^\/api\/memories\/([a-f0-9-]+)$/i);
    if (request.method === 'GET' && record) return json(await getMemory(db, z.uuid().parse(record[1])));
    if (request.method !== 'POST') return json({ error: 'Unsupported memory route' }, 405);
    // Bound streamed bodies before parsing; never log original text or credentials.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 65536) { await reader.cancel(); return json({ error: 'Memory request too large' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (target.pathname === '/api/search') return json(await searchMemory({ DB: db }, body));
    if (target.pathname === '/api/memories') return json(await saveMemory(db, body), 201);
    const withdrawal = target.pathname.match(/^\/api\/memories\/([a-f0-9-]+)\/withdraw$/i);
    if (withdrawal) return json(await withdrawMemory(db,z.uuid().parse(withdrawal[1]),z.object({reason:z.string()}).parse(body).reason));
    const correction = target.pathname.match(/^\/api\/memories\/([a-f0-9-]+)\/correct$/i);
    if (correction) {
      const fields = z.record(z.string(), z.unknown()).parse(body);
      return json(await saveMemory(db, { ...fields, id: z.uuid().parse(correction[1]) }, true), 201);
    }
    return json({ error: 'Unsupported memory route' }, 404);
  } catch (error) {
    if (error instanceof MemoryError) return json({ error: error.code }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: '请检查原文、来源、链接和时间格式。' }, 400);
    return json({ error: '共享记忆库请求未完成，请稍后重试。' }, 503);
  }
}
