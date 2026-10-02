// Native MusicKit keeps the original keys. The browser owns a separate queue,
// command inbox and playback status; neither client consumes the other's state.
export const WEB_MUSIC = { queue: 'webMusicQueue', control: 'webMusicControl', playback: 'webMusicPlayback' } as const;
export type MusicIdentity = { id: string; neteaseId?: string; appleMusicId?: string; source?: string };
export function neteaseTrackId(track: MusicIdentity): string | null {
  if (track.appleMusicId || track.source === 'appleMusic' || track.id.startsWith('apple-')) return null;
  const id = track.neteaseId || (track.id.startsWith('netease-') ? track.id.slice(8) : '');
  return /^\d+$/.test(id) ? id : null;
}
export function webQueue<T extends MusicIdentity>(tracks: T[]): T[] {
  return tracks.filter(track => Boolean(neteaseTrackId(track)));
}

export async function initializeWebMusicQueue(db: D1Database) {
  const existing = await db.prepare('SELECT value FROM vesper_documents WHERE key = ?').bind(WEB_MUSIC.queue).first<{ value: string }>();
  if (existing) return;
  const legacy = await db.prepare('SELECT value FROM vesper_documents WHERE key = ?').bind('musicQueue').first<{ value: string }>();
  let tracks: MusicIdentity[] = [];
  try {
    const value = JSON.parse(legacy?.value || '[]');
    if (Array.isArray(value)) tracks = value.filter(item => item && typeof item.id === 'string');
  } catch { /* Leave the original document untouched, even if malformed. */ }
  // Atomic insert protects a queue another browser saved during initialization.
  await db.prepare('INSERT OR IGNORE INTO vesper_documents (key, value, updated_at) VALUES (?, ?, ?)')
    .bind(WEB_MUSIC.queue, JSON.stringify(webQueue(tracks)), new Date().toISOString()).run();
}
