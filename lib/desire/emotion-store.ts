import { candidateInput, eventInput } from './emotions';

const schema = [
  `CREATE TABLE IF NOT EXISTS vesper_emotion_state (owner TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0, values_json TEXT, reason TEXT, unresolved TEXT, updated_at TEXT, source TEXT, cadence_json TEXT)`,
  `CREATE TABLE IF NOT EXISTS vesper_emotion_events (id TEXT PRIMARY KEY, stream TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, outcome TEXT NOT NULL, processed_by TEXT, received_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS vesper_emotion_pending ON vesper_emotion_events(processed_by,at,id)`,
  `CREATE TABLE IF NOT EXISTS vesper_emotion_updates (id TEXT PRIMARY KEY, base_version INTEGER NOT NULL, version INTEGER NOT NULL UNIQUE, source TEXT NOT NULL, values_json TEXT NOT NULL, reason TEXT NOT NULL, unresolved TEXT NOT NULL, event_ids TEXT NOT NULL, cadence_json TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS vesper_emotion_runtime (owner TEXT PRIMARY KEY, last_attempt_at TEXT, last_success_at TEXT, model TEXT, error TEXT)`,
  `INSERT OR IGNORE INTO vesper_emotion_state(owner,version) VALUES('vesper',0)`,
];
const ready = new WeakMap<D1Database, Promise<unknown>>();
async function initialize(db: D1Database) {
  let promise = ready.get(db);
  if (!promise) { promise = db.batch(schema.map(sql => db.prepare(sql))).catch(e => { ready.delete(db); throw e; }); ready.set(db, promise); }
  await promise;
}
type StateRow = { version: number; values_json: string | null; reason: string | null; unresolved: string | null; updated_at: string | null; source: string | null; cadence_json: string | null };
const parse = (text: string | null) => text ? JSON.parse(text) : null;
export async function emotionState(db: D1Database) {
  await initialize(db);
  const row = await db.prepare(`SELECT * FROM vesper_emotion_state WHERE owner='vesper'`).first<StateRow>();
  const runtime = await db.prepare(`SELECT last_attempt_at,last_success_at,model,error FROM vesper_emotion_runtime WHERE owner='vesper'`).first();
  return { schemaVersion: 3, initialized: !!row?.values_json, version: row?.version ?? 0, values: parse(row?.values_json ?? null),
    reason: row?.reason ?? '', unresolved: row?.unresolved ?? '', updatedAt: row?.updated_at ?? null,
    source: row?.source ?? null, cadence: parse(row?.cadence_json ?? null), runtime, settlementMinutes: 15 };
}
export async function emotionEvents(db: D1Database, raw: unknown) {
  await initialize(db);
  const events = eventInput.array().max(100).parse(raw);
  if (events.length) await db.batch(events.map(e => db.prepare(`INSERT OR IGNORE INTO vesper_emotion_events(id,stream,at,kind,text,outcome,received_at) VALUES(?,?,?,?,?,?,?)`).bind(e.id,e.stream,e.at,e.kind,e.text,e.outcome,new Date().toISOString())));
  return { accepted: events.length };
}
export async function emotionContext(db: D1Database) {
  const state = await emotionState(db);
  const pending = await db.prepare(`SELECT id,stream,at,kind,text,outcome FROM vesper_emotion_events WHERE processed_by IS NULL ORDER BY at,id LIMIT 80`).all();
  const background = await db.prepare(`SELECT id,stream,at,kind,text,outcome,processed_by FROM vesper_emotion_events WHERE processed_by IS NOT NULL ORDER BY at DESC,id DESC LIMIT 12`).all();
  return { state, pending: pending.results, background: background.results.map(e => ({ ...e, alreadyCounted: true })) };
}
export async function commitEmotion(db: D1Database, raw: unknown) {
  await initialize(db);
  const c = candidateInput.parse(raw);
  if(c.baseVersion===0 && c.eventIds.length===0)throw new Error('Initial emotions require real evidence');
  const previous = await db.prepare(`SELECT * FROM vesper_emotion_updates WHERE id=?`).bind(c.updateId).first();
  if (previous) return { committed: true, duplicate: true, version: previous.version };
  if (c.cadence?.mode === 'calm' && (c.cadence.minutes < 30 || c.cadence.minutes > 60)) throw new Error('Calm cadence must be 30–60 minutes');
  const at = new Date().toISOString(), ids = JSON.stringify(c.eventIds), values = JSON.stringify(c.values), cadence = c.cadence ? JSON.stringify(c.cadence) : null;
  // D1 batch is one transaction. The insertion elects a winner; every subsequent
  // write is gated by that exact update ID and version. Events can arrive out of order.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO vesper_emotion_updates(id,base_version,version,source,values_json,reason,unresolved,event_ids,cadence_json,created_at)
      SELECT ?,version,version+1,?,?,?,?,?,?,? FROM vesper_emotion_state WHERE owner='vesper' AND version=?
      AND (SELECT count(*) FROM vesper_emotion_events WHERE id IN (SELECT value FROM json_each(?)) AND processed_by IS NULL)=json_array_length(?)`)
      .bind(c.updateId,c.source,values,c.reason,c.unresolved,ids,cadence,at,c.baseVersion,ids,ids),
    db.prepare(`UPDATE vesper_emotion_state SET version=version+1,values_json=?,reason=?,unresolved=?,updated_at=?,source=?,cadence_json=COALESCE(?,cadence_json)
      WHERE owner='vesper' AND version=? AND EXISTS(SELECT 1 FROM vesper_emotion_updates WHERE id=? AND base_version=vesper_emotion_state.version)`)
      .bind(values,c.reason,c.unresolved,at,c.source,cadence,c.baseVersion,c.updateId),
    db.prepare(`UPDATE vesper_emotion_events SET processed_by=? WHERE processed_by IS NULL AND id IN(SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM vesper_emotion_updates WHERE id=?)`).bind(c.updateId,ids,c.updateId),
  ]);
  const saved = await db.prepare(`SELECT version FROM vesper_emotion_updates WHERE id=?`).bind(c.updateId).first<{version:number}>();
  return saved ? { committed: true, duplicate: false, version: saved.version } : { committed: false, conflict: true, state: await emotionState(db) };
}
export async function emotionHistory(db: D1Database, limit = 20, cursor?: string) {
  await initialize(db);
  const before = cursor ? Number(cursor) : Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(before)) throw new Error('Invalid history cursor');
  const rows = await db.prepare(`SELECT * FROM vesper_emotion_updates WHERE version<? ORDER BY version DESC LIMIT ?`).bind(before,limit).all<Record<string, unknown>>();
  return { schemaVersion: 3, records: rows.results.map(row => ({ id: row.id, version: row.version, source: row.source, note: row.reason,
    values: parse(String(row.values_json)), eventIds: parse(String(row.event_ids)), createdAt: row.created_at })),
    cursor: rows.results.length === limit ? String(rows.results.at(-1)?.version) : null };
}
export async function settlementReceipt(db: D1Database, model: string, error?: string) {
  await initialize(db); const at = new Date().toISOString();
  await db.prepare(`INSERT INTO vesper_emotion_runtime(owner,last_attempt_at,last_success_at,model,error) VALUES('vesper',?,?,?,?) ON CONFLICT(owner) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_success_at=COALESCE(excluded.last_success_at,vesper_emotion_runtime.last_success_at),model=excluded.model,error=excluded.error`).bind(at,error ? null : at,model,error?.slice(0,240) ?? null).run();
}
