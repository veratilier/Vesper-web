import { ensureSchema, getDb } from './db';
import { visibleLetter } from './letter-policy';
import { letterKindSql } from './writing-kind';

type Row = { id: string; value: string; created_at: string };
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
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
export async function getJotting(owner: string, id: string, actor = 'Vera') {
  await ensureSchema();
  if (!idPattern.test(id)) throw new Error('Invalid jotting id');
  const row = await getDb().prepare('SELECT value FROM vesper_jottings WHERE user_id=? AND id=? AND ' + letterKindSql() + '=0').bind(owner,id).first<Row>();
  if (!row) throw new Error('This jotting is unavailable');
  return { jotting: visibleLetter(JSON.parse(row.value),actor) };
}
