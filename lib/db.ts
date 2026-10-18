import { env } from 'cloudflare:workers';
import { schemaStatements } from '@/db/schema';

export function getDb(): D1Database {
  return (env as unknown as { DB: D1Database }).DB;
}

let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getDb();
      await db.batch(schemaStatements.map((sql) => db.prepare(sql)));
    })().catch(error => { schemaReady = null; throw error; });
  }
  return schemaReady;
}
