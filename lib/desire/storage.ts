import { desireSchema } from './schema';
const ready = new WeakMap<D1Database, Promise<void>>();
/** Adapt the unchanged engine's table names to isolated tables in Vesper's DB. */
export async function independentDesireStorage(db: D1Database) {
  let initialization = ready.get(db);
  if (!initialization) {
    initialization = db.batch(desireSchema.map(sql => db.prepare(sql))).then(() => undefined).catch(error => { ready.delete(db); throw error; });
    ready.set(db, initialization);
  }
  await initialization;
  const engineDb = {
    prepare: (sql: string) => db.prepare(sql.replace(/\bdesire_state\b/g, 'vesper_desire_state').replace(/\bencounter_history\b/g, 'vesper_desire_history')),
    batch: (statements: D1PreparedStatement[]) => db.batch(statements),
  } as D1Database;
  // The engine's legacy-state lookup is disabled; small push metadata also stays in D1.
  const localMetadata = {
    async get(key: string, type?: string | { type?: string }) {
      if (key.startsWith('rowan-desire:')) return null;
      const row = await db.prepare('SELECT value FROM vesper_desire_kv WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)').bind(key, Date.now()).first<{ value: string }>();
      if (!row) return null;
      return (typeof type === 'string' ? type : type?.type) === 'json' ? JSON.parse(row.value) : row.value;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      const expiry = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null;
      await db.prepare('INSERT INTO vesper_desire_kv(key,value,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at').bind(key, value, expiry).run();
    },
  } as unknown as KVNamespace;
  return { DESIRE_DB: engineDb, OAUTH_KV: localMetadata };
}
