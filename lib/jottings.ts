import { ensureSchema, getDb } from './db';
import { visibleLetter } from './letter-policy';
import { isLetter, letterKindSql } from './writing-kind';

type Input = Record<string, unknown>;
type Row = { id: string; value: string; created_at: string };
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
function text(input: Input, key: string, max: number, required = false) {
  const value = input[key] === undefined ? '' : input[key];
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`Invalid jotting ${key}`);
  return value.trim();
}
export async function createJotting(owner: string, input: Input, author = 'Rowan') {
  await ensureSchema();
  const id = text(input, 'id', 128, true);
  if (!idPattern.test(id)) throw new Error('Use a stable jotting id; reuse it on retry');
  const body = text(input, 'text', 12000, true);
  const title = text(input, 'title', 120);
  const createdAt = new Date().toISOString();
  const value = { id, kind: 'sketch', text: body, title, author, createdAt };
  // A retry cannot overwrite an existing card or duplicate it. Different writers
  // append separate rows rather than racing on a whole JSON document.
  await getDb().prepare('INSERT INTO vesper_jottings(id,user_id,value,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO NOTHING')
    .bind(id, owner, JSON.stringify(value), createdAt).run();
  const saved = await getDb().prepare('SELECT id,value,created_at FROM vesper_jottings WHERE user_id=? AND id=?').bind(owner,id).first<Row>();
  if (!saved) throw new Error('Jotting save was not confirmed');
  const card = JSON.parse(saved.value);
  if (isLetter(card)) throw new Error('This id belongs to a letter; use letter_create');
  if (['text','title'].some(key => card[key] !== value[key as keyof typeof value])) throw new Error('Jotting id already belongs to different content');
  return { jotting: visibleLetter(card,author) };
}
export async function listJottings(owner: string, limit = 30, before = '', actor = 'Vera') {
  await ensureSchema();
  limit = Math.max(1, Math.min(50, Math.floor(limit) || 30));
  let cursor: string[] = [];
  if (before) {
    try { cursor = JSON.parse(atob(before)); } catch { throw new Error('Invalid jotting cursor'); }
    if (cursor.length !== 2 || cursor.some(v => typeof v !== 'string') || !idPattern.test(cursor[1])) throw new Error('Invalid jotting cursor');
  }
  const sql = 'SELECT id,value,created_at FROM vesper_jottings WHERE user_id=? AND ' + letterKindSql() + '=0' +
    (before ? ' AND (created_at < ? OR (created_at = ? AND id < ?))' : '') + ' ORDER BY created_at DESC,id DESC LIMIT ?';
  const args = before ? [owner,cursor[0],cursor[0],cursor[1],limit+1] : [owner,limit+1];
  const result = await getDb().prepare(sql).bind(...args).all<Row>();
  const rows = result.results.slice(0,limit), last = rows.at(-1);
  return { jottings: rows.map(row => visibleLetter(JSON.parse(row.value),actor)), before: result.results.length > limit && last ? btoa(JSON.stringify([last.created_at,last.id])) : null };
}
export async function deleteJotting(owner: string, id: string) {
  await ensureSchema();
  if (!idPattern.test(id)) throw new Error('Invalid jotting id');
  await getJotting(owner,id);
  await getDb().prepare('DELETE FROM vesper_jottings WHERE user_id=? AND id=? AND ' + letterKindSql() + '=0').bind(owner,id).run();
  return { ok: true };
}
export async function getJotting(owner: string, id: string, actor = 'Vera') {
  await ensureSchema();
  if (!idPattern.test(id)) throw new Error('Invalid jotting id');
  const row = await getDb().prepare('SELECT value FROM vesper_jottings WHERE user_id=? AND id=? AND ' + letterKindSql() + '=0').bind(owner,id).first<Row>();
  if (!row) throw new Error('This jotting is unavailable');
  return { jotting: visibleLetter(JSON.parse(row.value),actor) };
}
