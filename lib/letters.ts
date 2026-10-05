import { ensureSchema, getDb } from './db';
import { visibleLetter, letterDate, type Letter } from './letter-policy';
type Row = { id: string; value: string; created_at: string; read_at?: string; kept?: number };
const validID = /^[A-Za-z0-9_-]{1,128}$/;
function id(value: unknown) { if (typeof value !== 'string' || !validID.test(value)) throw new Error('Invalid letter id'); return value; }
function field(value: unknown, max: number, required = false) { if (value === undefined && !required) return ''; if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('Invalid letter content'); return value.trim(); }
const select = `SELECT j.*,m.read_at,m.kept FROM vesper_jottings j LEFT JOIN vesper_letter_marks m ON m.user_id=j.user_id AND m.letter_id=j.id AND m.actor=? WHERE j.user_id=?`;
function view(row: Row, actor: string) { return visibleLetter({ ...JSON.parse(row.value), read: Boolean(row.read_at), kept: Boolean(row.kept) }, actor); }
export async function getLetter(owner: string, letterID: string, actor = 'Vera') {
  await ensureSchema();
  const row = await getDb().prepare(select + ' AND j.id=?').bind(actor, owner, id(letterID)).first<Row>();
  if (!row) throw new Error('Letter unavailable');
  return { letter: view(row, actor) };
}
export async function listLetters(owner: string, limit = 30, before = '', actor = 'Vera') {
  await ensureSchema();
  let cursor: string[] = [];
  if (before) { try { cursor = JSON.parse(atob(before)); } catch { throw new Error('Invalid cursor'); } if (!Array.isArray(cursor) || cursor.length !== 2 || typeof cursor[0] !== 'string' || typeof cursor[1] !== 'string' || !validID.test(cursor[1])) throw new Error('Invalid cursor'); }
  limit = Math.min(50, Math.max(1, Math.floor(limit) || 30));
  const rows = await getDb().prepare(select + (before ? ' AND (j.created_at < ? OR (j.created_at = ? AND j.id < ?))' : '') + ' ORDER BY j.created_at DESC,j.id DESC LIMIT ?')
    .bind(actor, owner, ...(before ? [cursor[0],cursor[0],cursor[1]] : []), limit+1).all<Row>();
  const page = rows.results.slice(0, limit), last = page.at(-1);
  return { letters: page.map(row => view(row,actor)), before: rows.results.length > limit && last ? btoa(JSON.stringify([last.created_at,last.id])) : null, serverTime: new Date().toISOString() };
}
export async function createLetter(owner: string, input: Record<string, unknown>, actor = 'Vera') {
  await ensureSchema();
  const letterID = id(input.id), title = field(input.title,120), body = field(input.text,12000,true);
  const recipient = actor === 'Vera' ? 'Rowan' : 'Vera';
  const unlockAt = letterDate(input.unlockAt), replyTo = input.replyTo ? id(input.replyTo) : undefined;
  if (replyTo) { const parent = (await getLetter(owner,replyTo,actor)).letter; if (parent.locked) throw new Error('Open the original letter before replying'); }
  const value: Letter = { id:letterID, title, text:body, author:actor, recipient, createdAt:new Date().toISOString(), ...(unlockAt ? { unlockAt } : {}), ...(replyTo ? { replyTo } : {}) };
  await getDb().prepare('INSERT INTO vesper_jottings(id,user_id,value,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO NOTHING').bind(letterID,owner,JSON.stringify(value),value.createdAt).run();
  const row = await getDb().prepare('SELECT value FROM vesper_jottings WHERE user_id=? AND id=?').bind(owner,letterID).first<Row>();
  if (!row) throw new Error('Letter delivery was not confirmed');
  const saved = JSON.parse(row.value) as Letter;
  if (saved.author !== actor || saved.text !== body || saved.title !== title || saved.unlockAt !== unlockAt || saved.replyTo !== replyTo) throw new Error('This id belongs to a different letter');
  return { letter: visibleLetter(saved,actor) };
}
export async function markLetter(owner: string, input: Record<string, unknown>, actor = 'Vera') {
  const letterID = id(input.id), letter = (await getLetter(owner,letterID,actor)).letter;
  if (input.action !== 'read' && input.action !== 'keep') throw new Error('Invalid letter action');
  if (input.action === 'read' && letter.locked) throw new Error('This letter is still sealed');
  if (input.action === 'keep' && typeof input.kept !== 'boolean') throw new Error('Invalid bookmark');
  const sql = input.action === 'read'
    ? `INSERT INTO vesper_letter_marks(user_id,letter_id,actor,read_at) VALUES(?,?,?,?) ON CONFLICT(user_id,letter_id,actor) DO UPDATE SET read_at=COALESCE(vesper_letter_marks.read_at,excluded.read_at)`
    : `INSERT INTO vesper_letter_marks(user_id,letter_id,actor,kept) VALUES(?,?,?,?) ON CONFLICT(user_id,letter_id,actor) DO UPDATE SET kept=excluded.kept`;
  await getDb().prepare(sql).bind(owner,letterID,actor,input.action === 'read' ? new Date().toISOString() : input.kept ? 1 : 0).run();
  return getLetter(owner,letterID,actor);
}

// Covers only: this feed can schedule reminders without fetching sealed bodies.
// Query the existing letters as well, so previously sent timed letters participate.
export async function letterReminders(owner: string, actor = 'Vera') {
  await ensureSchema();
  const now = new Date().toISOString();
  const rows = await getDb().prepare(`SELECT j.id,j.value,r.delivered_at FROM vesper_jottings j
    LEFT JOIN vesper_letter_marks m ON m.user_id=j.user_id AND m.letter_id=j.id AND m.actor=?
    LEFT JOIN vesper_letter_reminders r ON r.user_id=j.user_id AND r.letter_id=j.id AND r.recipient=?
    WHERE j.user_id=? AND json_extract(j.value,'$.unlockAt') IS NOT NULL
      AND json_extract(j.value,'$.author')!=? AND m.read_at IS NULL
    ORDER BY json_extract(j.value,'$.unlockAt'),j.id`).bind(actor,actor,owner,actor)
    .all<Row & {delivered_at?: string}>();
  const covers = rows.results.flatMap(row => {
    const letter = JSON.parse(row.value) as Letter;
    const opening = Date.parse(letter.unlockAt || '');
    if (!Number.isFinite(opening)) return [];
    return [{id:letter.id,title:letter.title,author:letter.author,recipient:actor,
      createdAt:letter.createdAt,unlockAt:letter.unlockAt!,due:opening<=Date.parse(now),
      deliveredAt:row.delivered_at || null}];
  });
  const unread = await getDb().prepare(`SELECT j.id,j.value FROM vesper_jottings j
    LEFT JOIN vesper_letter_marks m ON m.user_id=j.user_id AND m.letter_id=j.id AND m.actor=?
    WHERE j.user_id=? AND json_extract(j.value,'$.author')!=? AND m.read_at IS NULL
    ORDER BY j.created_at DESC,j.id DESC`).bind(actor,owner,actor).all<Row>();
  const inbox = unread.results.map(row => {
    const letter = JSON.parse(row.value) as Letter;
    return {id:letter.id,title:letter.title,author:letter.author,createdAt:letter.createdAt,
      ...(letter.unlockAt ? {unlockAt:letter.unlockAt} : {})};
  });
  return {reminders:covers,inbox,serverTime:now};
}
export async function acknowledgeLetterReminder(owner: string, letterID: string, actor = 'Vera') {
  const letter = (await getLetter(owner,letterID,actor)).letter;
  if (letter.author === actor || !letter.unlockAt || Date.parse(letter.unlockAt)>Date.now()) throw new Error('This letter is not ready for a reminder');
  await getDb().prepare(`INSERT INTO vesper_letter_reminders(user_id,letter_id,recipient,delivered_at)
    VALUES(?,?,?,?) ON CONFLICT(user_id,letter_id,recipient) DO NOTHING`)
    .bind(owner,id(letterID),actor,new Date().toISOString()).run();
  return {ok:true};
}
