import { getDb } from './db';
export type AlbumPhoto = { id: string; key: string; name: string; type: string; size: number; category: string; caption: string; source: string; createdAt: string; savedAt: string | null; url: string; sourceConversationId?: string; sourceMessageId?: string };
type Row = { id: string; media_key: string; name: string; mime: string; size: number; category: string; caption: string; source: string; created_at: string; saved_at: string | null; source_conversation_id?: string; source_message_id?: string };
const clean = (v: unknown, n: number) => typeof v === 'string' ? v.trim().slice(0, n) : '';
export async function ensurePhotoAlbum() {
  await getDb().prepare(`CREATE TABLE IF NOT EXISTS vesper_album_photos (id TEXT PRIMARY KEY, owner TEXT NOT NULL, media_key TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, category TEXT NOT NULL DEFAULT '未分类', caption TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, created_at TEXT NOT NULL, saved_at TEXT, UNIQUE(owner, media_key))`).run();
  await getDb().prepare(`CREATE TABLE IF NOT EXISTS vesper_photo_sources (owner TEXT NOT NULL, media_key TEXT NOT NULL, source_conversation_id TEXT NOT NULL, source_message_id TEXT NOT NULL, message_ids TEXT NOT NULL, PRIMARY KEY(owner,media_key))`).run();
}
export async function linkPhotoSource(owner: string, key: string, source: { conversationId: string; messageId: string; messageIds: string[] }) {
  await ensurePhotoAlbum();
  await getDb().prepare('INSERT INTO vesper_photo_sources VALUES(?,?,?,?,?) ON CONFLICT(owner,media_key) DO UPDATE SET source_conversation_id=excluded.source_conversation_id,source_message_id=excluded.source_message_id,message_ids=excluded.message_ids').bind(owner,key,source.conversationId,source.messageId,JSON.stringify(source.messageIds)).run();
}
export async function registerPhotoSource(owner: string, attachment: { key: string; name: string; type: string; size: number }, source: 'user' | 'agent') {
  if (!/^image\/(png|jpeg|gif|webp|avif|heic|heif)$/i.test(attachment.type)) return;
  if (!/^[a-z0-9-]+\.[a-z0-9]+$/i.test(attachment.key)) throw new Error('Invalid media key');
  await ensurePhotoAlbum();
  await getDb().prepare(`INSERT INTO vesper_album_photos(id,owner,media_key,name,mime,size,source,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,media_key) DO NOTHING`).bind(crypto.randomUUID(), owner, attachment.key, clean(attachment.name, 160), attachment.type, attachment.size, source, new Date().toISOString()).run();
}
function photo(row: Row, origin: string): AlbumPhoto { return { id: row.id, key: row.media_key, name: row.name, type: row.mime, size: row.size, category: row.category, caption: row.caption, source: row.source, createdAt: row.created_at, savedAt: row.saved_at, sourceConversationId: row.source_conversation_id, sourceMessageId: row.source_message_id, url: `${origin}/api/media/${row.media_key}` }; }
export async function saveAlbumPhoto(owner: string, key: string, category: unknown, caption: unknown, origin: string) {
  await ensurePhotoAlbum();
  const row = await getDb().prepare('SELECT * FROM vesper_album_photos WHERE owner=? AND media_key=?').bind(owner, key).first<Row>();
  if (!row) throw new Error("Photo not found for this account. Upload it again or import it into the album.");
  await getDb().prepare('UPDATE vesper_album_photos SET category=?,caption=?,saved_at=COALESCE(saved_at,?) WHERE owner=? AND media_key=?').bind(clean(category, 60) || row.category, caption === undefined ? row.caption : clean(caption, 500), new Date().toISOString(), owner, key).run();
  return getAlbumPhoto(owner, row.id, origin);
}
export async function getAlbumPhoto(owner: string, id: string, origin: string) {
  await ensurePhotoAlbum();
  const row = await getDb().prepare('SELECT p.*,s.source_conversation_id,s.source_message_id FROM vesper_album_photos p LEFT JOIN vesper_photo_sources s ON s.owner=p.owner AND s.media_key=p.media_key WHERE p.owner=? AND p.id=? AND p.saved_at IS NOT NULL').bind(owner, id).first<Row>();
  if (!row) throw new Error("Photo not found in album");
  return photo(row, origin);
}
export async function listAlbumPhotos(owner: string, input: { query?: unknown; category?: unknown; limit?: unknown; offset?: unknown }, origin: string) {
  await ensurePhotoAlbum();
  const query = `%${clean(input.query, 100).replace(/[\\%_]/g, '\\$&')}%`;
  const category = clean(input.category, 60);
  const limit = Math.max(1, Math.min(60, Math.floor(Number(input.limit)) || 30));
  const offset = Math.max(0, Math.min(100000, Math.floor(Number(input.offset)) || 0));
  const rows = await getDb().prepare(`SELECT p.*,s.source_conversation_id,s.source_message_id FROM vesper_album_photos p LEFT JOIN vesper_photo_sources s ON s.owner=p.owner AND s.media_key=p.media_key WHERE p.owner=? AND p.saved_at IS NOT NULL AND (?='' OR category=?) AND (name LIKE ? ESCAPE '\\' OR caption LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\') ORDER BY p.saved_at DESC,p.id LIMIT ? OFFSET ?`).bind(owner, category, category, query, query, query, limit + 1, offset).all<Row>();
  const categories = await getDb().prepare('SELECT DISTINCT category FROM vesper_album_photos WHERE owner=? AND saved_at IS NOT NULL ORDER BY category').bind(owner).all<{ category: string }>();
  return { photos: rows.results.slice(0, limit).map(row => photo(row, origin)), categories: categories.results.map(row => row.category), nextOffset: rows.results.length > limit ? offset + limit : null };
}
