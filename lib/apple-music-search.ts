export type AppleTrack = { id: string; source: 'appleMusic'; appleMusicId: string; appleMusicURL: string; title: string; artist: string; album: string; cover: string; duration: number; playable: boolean };
export function appleTrack(value: Record<string, unknown>): AppleTrack | null {
  if (value.kind !== 'song' || typeof value.trackId !== 'number' || typeof value.trackName !== 'string' || typeof value.artistName !== 'string') return null;
  const id = String(value.trackId);
  const url = typeof value.trackViewUrl === 'string' ? new URL(value.trackViewUrl) : null;
  if (!url || !['music.apple.com', 'itunes.apple.com'].includes(url.hostname)) return null;
  url.hostname = 'music.apple.com'; url.protocol = 'https:';
  return { id: 'apple-' + id, source: 'appleMusic', appleMusicId: id, appleMusicURL: url.toString(), title: value.trackName, artist: value.artistName,
    album: String(value.collectionName || ''), cover: String(value.artworkUrl100 || '').replace(/^http:/, 'https:'),
    duration: Number(value.trackTimeMillis || 0) / 1000, playable: true };
}
export async function searchAppleMusic(query: string, limit: number, request: typeof fetch = fetch) {
  // Mainland China has Apple Music but no iTunes music storefront. Public
  // metadata can be absent there; query Taiwan next without claiming that a
  // catalog song is available in the device's storefront. MusicKit checks that.
  for (const country of ['cn', 'tw']) {
    const url = new URL('https://itunes.apple.com/search');
    url.search = new URLSearchParams({ term: query, entity: 'song', country, limit: String(limit) }).toString();
    const response = await request(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Apple Music metadata lookup failed: HTTP ' + response.status);
    const body = await response.json() as { results?: Record<string, unknown>[] };
    if (!Array.isArray(body.results)) throw new Error('Apple Music returned invalid metadata');
    const tracks = body.results.map(appleTrack).filter((v): v is AppleTrack => v !== null);
    if (tracks.length) return tracks;
  }
  return [];
}
export async function lookupAppleMusic(id: string, request: typeof fetch = fetch) {
  if (!/^\d+$/.test(id)) return null;
  for (const country of ['cn', 'tw']) {
    const url = new URL('https://itunes.apple.com/lookup');
    url.search = new URLSearchParams({ id, entity: 'song', country }).toString();
    const response = await request(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Apple Music metadata lookup failed: HTTP ' + response.status);
    const body = await response.json() as { results?: Record<string, unknown>[] };
    const song = body.results?.map(appleTrack).find(track => track?.appleMusicId === id);
    if (song) return song;
  }
  return null;
}

export function isAppleMusicTrack(track: { id: string; appleMusicId?: string; neteaseId?: string; source?: string }) {
  return Boolean(track.appleMusicId?.trim()) && !track.neteaseId && track.source !== 'netease' && !track.id.startsWith('netease-');
}
