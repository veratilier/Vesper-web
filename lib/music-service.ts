export type MusicSyncTrack = {
  id: string;
  title: string;
  artist: string;
  duration?: string;
  url: string;
  cover?: string;
  neteaseId?: string;
  album?: string;
  playable?: boolean;
};

// This is the UI-facing subset of the MIT-licensed netease-music-mcp tool set.
// It stays transport-neutral so the same Vesper screen can later point at the
// MCP server directly without changing its presentation or playback state.
export type MusicLibraryAction =
  | "search"
  | "playlists"
  | "playlist"
  | "recommendations"
  | "personal-fm"
  | "recent-plays"
  | "play-history"
  | "liked-songs"
  | "lyrics"
  | "resolve"
  | "playlist-add"
  | "playlist-remove";

export type MusicLibraryPlaylist = {
  id: string;
  name: string;
  trackCount?: number;
  cover?: string;
  description?: string;
  creator?: string;
};

export type MusicLibraryResult = {
  error?: string;
  tracks?: MusicSyncTrack[];
  playlists?: MusicLibraryPlaylist[];
  title?: string;
  subtitle?: string;
  lyrics?: string;
  translation?: string;
  summary?: string;
};

export async function requestNeteaseLibrary(
  endpoint: string,
  headers: HeadersInit,
  payload: {
    action: MusicLibraryAction;
    uid?: string;
    cookie?: string;
    query?: string;
    playlistId?: string;
    songIds?: string[];
    tracks?: MusicSyncTrack[];
    limit?: number;
  },
): Promise<MusicLibraryResult> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({})) as MusicLibraryResult;
  if (!response.ok) throw new Error(result.error || "NetEase Music is unavailable.");
  return result;
}
