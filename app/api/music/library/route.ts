import { authorizeApp } from "@/lib/bridge-auth";
import { corsHeaders, optionsResponse } from "@/lib/cors";
import type { MusicSyncTrack } from "@/lib/music-service";

type MusicLibraryAction =
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

type SourceSong = {
  id?: number | string;
  name?: string;
  dt?: number;
  ar?: Array<{ name?: string }>;
  artists?: Array<{ name?: string }>;
  al?: { name?: string; picUrl?: string };
  album?: { name?: string; picUrl?: string };
};

function json(request: Request, value: unknown, status = 200) {
  const headers = corsHeaders(request);
  headers.set("cache-control", "no-store");
  return Response.json(value, { status, headers });
}

export const OPTIONS = optionsResponse;

function loginCookie(value: unknown) {
  const cookie = String(value || "").trim();
  if (!cookie || cookie.includes("=")) return cookie;
  return `MUSIC_U=${cookie}`;
}

function duration(milliseconds?: number) {
  if (!milliseconds) return "";
  return `${Math.floor(milliseconds / 60_000)}:${String(Math.floor(milliseconds / 1_000) % 60).padStart(2, "0")}`;
}

function toTrack(song: SourceSong) {
  const id = String(song.id || "");
  const album = song.al || song.album;
  return {
    id: `netease-${id}`,
    neteaseId: id,
    title: song.name || "Untitled song",
    artist: (song.ar || song.artists || []).map((artist) => artist.name).filter(Boolean).join(" / ") || "Unknown artist",
    album: album?.name || "",
    duration: duration(song.dt),
    cover: album?.picUrl?.replace(/^http:\/\//i, "https://") || "",
    url: "",
    playable: false,
  };
}

async function requestNetease(path: string, params: Record<string, string>, cookie = "") {
  const base = "https://music-api.r-vera.com";
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ ...params, ...(cookie ? { cookie } : {}) }),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || Number(result.code || 200) >= 400) throw new Error(`NetEase API returned ${result.code || response.status}`);
  return result;
}

function sourceSongs(value: unknown) {
  return Array.isArray(value) ? value as SourceSong[] : [];
}

export async function POST(request: Request) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try {
    const body = await request.json() as {
      action?: MusicLibraryAction;
      uid?: string;
      cookie?: string;
      query?: string;
      playlistId?: string;
      songIds?: string[];
      tracks?: MusicSyncTrack[];
      limit?: number;
    };
    const action = body.action;
    const uid = String(body.uid || "").trim();
    const cookie = loginCookie(body.cookie);
    const requireAccount = () => {
      if (!cookie) throw new Error("Connect your NetEase account first.");
      if (!uid) throw new Error("Enter your NetEase UID.");
    };
    const limit = String(Math.max(1, Math.min(Number(body.limit) || 30, 100)));

    if (action === "search") {
      const query = String(body.query || "").trim();
      if (!query) throw new Error("Enter a song, artist or album");
      const result = await requestNetease("/cloudsearch", { keywords: query, limit, type: "1" }, cookie);
      const songs = (result.result as { songs?: SourceSong[] } | undefined)?.songs || [];
      return json(request, { title: `“${query}”`, subtitle: "Search results", tracks: songs.map(toTrack) });
    }

    if (action === "playlists") {
      requireAccount();
      const result = await requestNetease("/user/playlist", { uid, limit: "100" }, cookie);
      const playlists = ((result.playlist as Array<{ id?: number | string; name?: string; trackCount?: number; coverImgUrl?: string; description?: string; creator?: { nickname?: string } }> | undefined) || [])
        .map((playlist) => ({
          id: String(playlist.id || ""),
          name: playlist.name || "Untitled playlist",
          trackCount: playlist.trackCount,
          cover: playlist.coverImgUrl?.replace(/^http:\/\//i, "https://") || "",
          description: playlist.description || "",
          creator: playlist.creator?.nickname || "",
        }))
        .filter((playlist) => playlist.id);
      return json(request, { playlists, summary: `Loaded ${playlists.length} playlists` });
    }

    if (action === "playlist") {
      const playlistId = String(body.playlistId || "").trim();
      if (!playlistId) throw new Error("Select a playlist first.");
      const result = await requestNetease("/playlist/track/all", { id: playlistId, limit: "500", offset: "0" }, cookie);
      const songs = sourceSongs(result.songs);
      return json(request, { title: "Playlist tracks", tracks: songs.map(toTrack) });
    }

    if (action === "recommendations") {
      requireAccount();
      const result = await requestNetease("/recommend/songs", {}, cookie);
      const songs = sourceSongs((result.data as { dailySongs?: SourceSong[] } | undefined)?.dailySongs);
      return json(request, { title: "Daily mix", subtitle: "30 songs picked for you", tracks: songs.map(toTrack) });
    }

    if (action === "personal-fm") {
      requireAccount();
      const result = await requestNetease("/personal_fm", {}, cookie);
      return json(request, { title: "Personal FM", subtitle: "A continuous mix for you", tracks: sourceSongs(result.data).map(toTrack) });
    }

    if (action === "recent-plays") {
      requireAccount();
      const result = await requestNetease("/record/recent/song", { limit }, cookie);
      const entries = (result.data as { list?: Array<{ data?: SourceSong }> } | undefined)?.list || [];
      return json(request, { title: "Recently played", tracks: entries.map((entry) => entry.data).filter((song): song is SourceSong => Boolean(song)).map(toTrack) });
    }

    if (action === "play-history") {
      requireAccount();
      const result = await requestNetease("/user/record", { uid, type: "1" }, cookie);
      const entries = (result.weekData as Array<{ song?: SourceSong }> | undefined) || [];
      return json(request, { title: "Weekly favorites", tracks: entries.map((entry) => entry.song).filter((song): song is SourceSong => Boolean(song)).map(toTrack) });
    }

    if (action === "liked-songs") {
      requireAccount();
      const result = await requestNetease("/likelist", { uid }, cookie);
      const ids = Array.isArray(result.ids) ? result.ids.slice(0, 100).map(String) : [];
      if (!ids.length) return json(request, { title: "Liked songs", tracks: [] });
      // Some public mirrors omit /song/detail even when their playlist and URL
      // endpoints are available. Keep the library usable: entries can still be
      // resolved to audio, and normal playlist/history entries retain full data.
      return json(request, { title: "Liked songs", tracks: ids.map((id) => toTrack({ id, name: "NetEase songs" })) });
    }

    if (action === "lyrics") {
      const songId = String(body.songIds?.[0] || "").trim();
      if (!songId) throw new Error("Missing song ID");
      const result = await requestNetease("/lyric", { id: songId }, cookie);
      return json(request, {
        lyrics: ((result.lrc as { lyric?: string } | undefined)?.lyric || "").trim(),
        translation: ((result.tlyric as { lyric?: string } | undefined)?.lyric || "").trim(),
      });
    }

    if (action === "playlist-add" || action === "playlist-remove") {
      requireAccount();
      const playlistId = String(body.playlistId || "").trim();
      const ids = Array.isArray(body.songIds) ? body.songIds.map(String).filter(Boolean).slice(0, 100) : [];
      if (!playlistId) throw new Error("Select a NetEase playlist first.");
      if (!ids.length) throw new Error("No songs to update");
      // This is deliberately only reached by an explicit in-app confirmation.
      // MUSIC_U is forwarded for this request but never persisted by the Worker.
      await requestNetease("/playlist/tracks", {
        op: action === "playlist-add" ? "add" : "del",
        pid: playlistId,
        tracks: ids.join(","),
      }, cookie);
      return json(request, { ok: true, summary: action === "playlist-add" ? "Added to NetEase playlist" : "Removed from NetEase playlist" });
    }

    if (action === "resolve") {
      const ids = Array.isArray(body.songIds) ? body.songIds.map(String).filter(Boolean).slice(0, 100) : [];
      if (!ids.length) throw new Error("No playable songs");
      const supplied = new Map(
        (Array.isArray(body.tracks) ? body.tracks : [])
          .map((track) => [String(track.neteaseId || track.id.replace(/^netease-/, "")), track] as const)
          .filter(([id]) => ids.includes(id)),
      );
      const result = await requestNetease("/song/url/v1", { id: ids.join(","), level: "standard" }, cookie);
      const urls = new Map<string, string>();
      for (const item of ((result.data as Array<{ id?: string | number; url?: string }> | undefined) || [])) {
        if (item.id && item.url) urls.set(String(item.id), item.url.replace(/^http:\/\//i, "https://"));
      }
      const tracks = ids.map((id) => {
        const current = supplied.get(id) || toTrack({ id, name: "NetEase songs" });
        const url = urls.get(id);
        return { ...current, id: `netease-${id}`, neteaseId: id, url: url || "", playable: Boolean(url) };
      });
      return json(request, { tracks, summary: `${tracks.filter((track) => track.playable).length} songs ready to play` });
    }

    throw new Error("Unsupported music action");
  } catch (reason) {
    return json(request, { error: reason instanceof Error ? reason.message : "NetEase Music is unavailable." }, 400);
  }
}
