import { ensureSchema, getDb } from './db';

type Input = Record<string, unknown>;
type Row = { id: string; value: string; created_at: string };
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
function text(input: Input, key: string, max: number, required = false) {
  const value = input[key] === undefined ? '' : input[key];
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`Invalid bookmark ${key}`);
  return value.trim();
}
export function publicImageURL(value: string) {
  if (!value) return '';
  const url = new URL(value), host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || host.includes(':') ||
      !host.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
      /\.(local|internal|localhost)$/.test(host)) throw new Error('Use a public HTTPS image URL without credentials');
  return url.href;
}
export async function createBookmark(owner: string, input: Input, author = 'Rowan') {
  await ensureSchema();
  const id = text(input, 'id', 128, true);
  if (!idPattern.test(id)) throw new Error('Use a stable bookmark id; reuse it on retry');
  const body = text(input, 'text', 2000, true);
  const source = text(input, 'source', 240);
  const bookId = text(input, 'bookId', 128), quote = text(input, 'quote', 2000);
  if (bookId) {
    const row = await getDb().prepare("SELECT value FROM vesper_documents WHERE key='readingRoom'").first<{ value: string }>();
    const book = (row ? JSON.parse(row.value) : []).find((b: Input) => b.id === bookId);
    if (!book || !quote || typeof book.text !== 'string' || !book.text.includes(quote)) throw new Error('Read the book first and supply an exact quote from it');
    if (source && source !== book.title) throw new Error('Bookmark source must match the book title');
    input = { ...input, source: book.title };
  }
  const imageUrl = publicImageURL(text(input, 'imageUrl', 2048));
  const imageSource = text(input, 'imageSource', 2048);
  const createdAt = new Date().toISOString();
  const value = { id, text: body, source: text(input, 'source', 240), bookId, quote, imageUrl, imageSource, author, createdAt };
  // A retry cannot overwrite an existing card or duplicate it. Different writers
  // append separate rows rather than racing on a whole JSON document.
  await getDb().prepare('INSERT INTO vesper_bookmarks(id,user_id,value,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO NOTHING')
    .bind(id, owner, JSON.stringify(value), createdAt).run();
  const saved = await getDb().prepare('SELECT id,value,created_at FROM vesper_bookmarks WHERE user_id=? AND id=?').bind(owner,id).first<Row>();
  if (!saved) throw new Error('Bookmark save was not confirmed');
  const card = JSON.parse(saved.value);
  if (['text','source','bookId','quote','imageUrl','imageSource'].some(key => card[key] !== value[key as keyof typeof value])) throw new Error('Bookmark id already belongs to different content');
  return { bookmark: card };
}
export async function listBookmarks(owner: string, limit = 30, before = '') {
  await ensureSchema();
  limit = Math.max(1, Math.min(50, Math.floor(limit) || 30));
  let cursor: string[] = [];
  if (before) {
    try { cursor = JSON.parse(atob(before)); } catch { throw new Error('Invalid bookmark cursor'); }
    if (cursor.length !== 2 || cursor.some(v => typeof v !== 'string') || !idPattern.test(cursor[1])) throw new Error('Invalid bookmark cursor');
  }
  const sql = 'SELECT id,value,created_at FROM vesper_bookmarks WHERE user_id=?' +
    (before ? ' AND (created_at < ? OR (created_at = ? AND id < ?))' : '') + ' ORDER BY created_at DESC,id DESC LIMIT ?';
  const args = before ? [owner,cursor[0],cursor[0],cursor[1],limit+1] : [owner,limit+1];
  const result = await getDb().prepare(sql).bind(...args).all<Row>();
  const rows = result.results.slice(0,limit), last = rows.at(-1);
  return { bookmarks: rows.map(row => JSON.parse(row.value)), before: result.results.length > limit && last ? btoa(JSON.stringify([last.created_at,last.id])) : null };
}
export async function deleteBookmark(owner: string, id: string) {
  await ensureSchema();
  if (!idPattern.test(id)) throw new Error('Invalid bookmark id');
  await getDb().prepare('DELETE FROM vesper_bookmarks WHERE user_id=? AND id=?').bind(owner,id).run();
  return { ok: true };
}
