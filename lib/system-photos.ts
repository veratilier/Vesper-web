import { env } from 'cloudflare:workers';
import { getDb } from './db';

type Row = {
  id: string; asset_id: string; preview_key: string; captured_at: string;
  width: number; height: number; synced_at: string; scan_id: string;
};
const bucket = () => (env as unknown as { MEDIA: R2Bucket }).MEDIA;
const validAssetID = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value);

export async function ensureSystemPhotos() {
  await getDb().prepare(`CREATE TABLE IF NOT EXISTS vesper_system_photos (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, asset_id TEXT NOT NULL,
    preview_key TEXT NOT NULL, captured_at TEXT NOT NULL, width INTEGER NOT NULL,
    height INTEGER NOT NULL, synced_at TEXT NOT NULL, scan_id TEXT NOT NULL DEFAULT '', UNIQUE(owner, asset_id)
  )`).run();
  await getDb().prepare('CREATE INDEX IF NOT EXISTS vesper_system_photos_order ON vesper_system_photos(owner, captured_at DESC, id)').run();
}

const validScan = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
export async function knownSystemPhotoIDs(owner: string, ids: unknown, scan: unknown) {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !validAssetID(id))) throw new Error('Supply up to 100 photo IDs');
  if (!validScan(scan)) throw new Error('Invalid photo scan');
  await ensureSystemPhotos();
  if (!ids.length) return { known: [] };
  const marks = ids.map(() => '?').join(',');
  const rows = await getDb().prepare(`SELECT asset_id FROM vesper_system_photos WHERE owner=? AND asset_id IN (${marks})`)
    .bind(owner,...ids).all<{asset_id:string}>();
  await getDb().prepare(`UPDATE vesper_system_photos SET scan_id=? WHERE owner=? AND scan_id<>? AND asset_id IN (${marks})`)
    .bind(scan,owner,scan,...ids).run();
  return { known: rows.results.map(row => row.asset_id) };
}

export async function uploadSystemPhoto(owner: string, input: Record<string, unknown>) {
  const assetID = input.assetId;
  const encoded = input.base64;
  if (!validScan(input.scanId)) throw new Error('Invalid photo scan');
  if (!validAssetID(assetID) || typeof encoded !== 'string' || encoded.length < 100 || encoded.length > 450_000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error('Invalid photo preview');
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  if (bytes.length > 320_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Only a small JPEG preview is accepted');
  const capturedAt = typeof input.capturedAt === 'string' && Number.isFinite(Date.parse(input.capturedAt)) ? new Date(input.capturedAt).toISOString() : new Date().toISOString();
  const width = Math.max(1, Math.min(100_000, Math.floor(Number(input.width) || 1)));
  const height = Math.max(1, Math.min(100_000, Math.floor(Number(input.height) || 1)));
  await ensureSystemPhotos();
  const previous = await getDb().prepare('SELECT id,preview_key FROM vesper_system_photos WHERE owner=? AND asset_id=?').bind(owner, assetID).first<Pick<Row,'id'|'preview_key'>>();
  const id = previous?.id || crypto.randomUUID();
  // Slash-containing private keys cannot be served by the public /api/media/[key] route.
  const key = previous?.preview_key || `private-system-photos/${crypto.randomUUID()}.jpg`;
  await bucket().put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  await getDb().prepare(`INSERT INTO vesper_system_photos(id,owner,asset_id,preview_key,captured_at,width,height,synced_at,scan_id)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,asset_id) DO UPDATE SET preview_key=excluded.preview_key,
    captured_at=excluded.captured_at,width=excluded.width,height=excluded.height,synced_at=excluded.synced_at,scan_id=excluded.scan_id`)
    .bind(id,owner,assetID,key,capturedAt,width,height,new Date().toISOString(),input.scanId).run();
  return { id, saved: true };
}

export async function removeSystemPhotos(owner: string, ids: unknown) {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !validAssetID(id))) throw new Error('Supply up to 100 photo IDs');
  await ensureSystemPhotos();
  let removed = 0;
  for (const assetID of ids) {
    const row = await getDb().prepare('SELECT preview_key FROM vesper_system_photos WHERE owner=? AND asset_id=?').bind(owner,assetID).first<Pick<Row,'preview_key'>>();
    if (!row) continue;
    await bucket().delete(row.preview_key);
    await getDb().prepare('DELETE FROM vesper_system_photos WHERE owner=? AND asset_id=?').bind(owner,assetID).run();
    removed += 1;
  }
  return { removed };
}

export async function clearSystemPhotos(owner: string) {
  await ensureSystemPhotos();
  const rows = await getDb().prepare('SELECT asset_id FROM vesper_system_photos WHERE owner=? LIMIT 100').bind(owner).all<{asset_id:string}>();
  const { removed } = await removeSystemPhotos(owner, rows.results.map(row => row.asset_id));
  const more = await getDb().prepare('SELECT id FROM vesper_system_photos WHERE owner=? LIMIT 1').bind(owner).first<{id:string}>();
  return { removed, more: Boolean(more) };
}
export async function finishSystemPhotoScan(owner: string, scan: unknown) {
  if (!validScan(scan)) throw new Error('Invalid photo scan');
  await ensureSystemPhotos();
  const rows = await getDb().prepare('SELECT asset_id FROM vesper_system_photos WHERE owner=? AND scan_id<>? LIMIT 100')
    .bind(owner,scan).all<{asset_id:string}>();
  const { removed } = await removeSystemPhotos(owner, rows.results.map(row => row.asset_id));
  const more = await getDb().prepare('SELECT id FROM vesper_system_photos WHERE owner=? AND scan_id<>? LIMIT 1')
    .bind(owner,scan).first<{id:string}>();
  return { removed, more: Boolean(more) };
}

export async function systemPhotoCount(owner: string) {
  await ensureSystemPhotos();
  const row = await getDb().prepare('SELECT COUNT(*) AS count FROM vesper_system_photos WHERE owner=?').bind(owner).first<{count:number}>();
  return { count: row?.count || 0 };
}

async function serialize(row: Row, includePreview: boolean) {
  const photo: Record<string, unknown> = { id: row.id, capturedAt: row.captured_at, width: row.width, height: row.height, syncedAt: row.synced_at };
  if (includePreview) {
    const object = await bucket().get(row.preview_key);
    if (object) {
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (bytes.length <= 320_000) {
        let binary = '';
        for (let index = 0; index < bytes.length; index += 8192) {
          binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
        }
        photo.imageDataUrl = `data:image/jpeg;base64,${btoa(binary)}`;
      }
    }
  }
  return photo;
}

export async function browseSystemPhotos(owner: string, input: Record<string, unknown>) {
  await ensureSystemPhotos();
  const offset = Math.max(0, Math.min(100_000, Math.floor(Number(input.offset) || 0)));
  const limit = Math.max(1, Math.min(8, Math.floor(Number(input.limit) || 6)));
  const rows = await getDb().prepare(`SELECT * FROM vesper_system_photos WHERE owner=? ORDER BY captured_at DESC,id LIMIT ? OFFSET ?`)
    .bind(owner, limit+1, offset).all<Row>();
  const photos = await Promise.all(rows.results.slice(0,limit).map(row => serialize(row, true)));
  return { photos, nextOffset: rows.results.length > limit ? offset + limit : null, ...(await systemPhotoCount(owner)) };
}

export async function viewSystemPhoto(owner: string, id: unknown) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Use an exact photo ID returned by browse');
  await ensureSystemPhotos();
  const row = await getDb().prepare('SELECT * FROM vesper_system_photos WHERE owner=? AND id=?').bind(owner,id).first<Row>();
  if (!row) throw new Error('Photo preview not found');
  return { photo: await serialize(row, true) };
}
