import { ensureSchema, getDb } from "@/lib/db";
import { authorizeApp } from "@/lib/bridge-auth";
import { corsHeaders, optionsResponse } from "@/lib/cors";

type MusicTrack = {
  id: string;
  neteaseId?: string;
  title: string;
  artist: string;
  album?: string;
  duration?: string;
  cover?: string;
  url: string;
  playable?: boolean;
};

function json(request: Request, value: unknown, status = 200) {
  const headers = corsHeaders(request);
  headers.set("cache-control", "no-store");
  return Response.json(value, { status, headers });
}

export const OPTIONS = optionsResponse;

async function readDocument<T>(key: string, fallback: T): Promise<T> {
  const row = await getDb().prepare("SELECT value FROM vesper_documents WHERE key = ?").bind(key).first<{ value: string }>();
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}

async function writeDocument(key: string, value: unknown) {
  await getDb().prepare(`INSERT INTO vesper_documents(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .bind(key, JSON.stringify(value), new Date().toISOString()).run();
}

function loginCookie(value: unknown) {
  const cookie = String(value || "").trim();
  if (!cookie || cookie.includes("=")) return cookie;
  // Let a user paste either a full `MUSIC_U=…` cookie or just its value.
  return `MUSIC_U=${cookie}`;
}

async function neteaseRequest(baseUrl: string, path: string, params: Record<string, string>, cookie = "") {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ ...params, ...(cookie ? { cookie } : {}) }),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || Number(result.code || 200) >= 400) throw new Error(`NetEase API returned ${result.code || response.status}`);
  return result;
}

function playlistIdFrom(value: string) {
  const trimmed = value.trim();
  const queryMatch = trimmed.match(/[?&]id=(\d+)/i);
  const pathMatch = trimmed.match(/playlist\/(\d+)/i);
  const plainMatch = trimmed.match(/^\d+$/);
  return queryMatch?.[1] || pathMatch?.[1] || (plainMatch ? trimmed : "");
}

export async function POST(request: Request) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  await ensureSchema();
  try {
    const body = await request.json() as {
      action?: "playlists" | "sync";
      baseUrl?: string;
      cookie?: string;
      uid?: string;
      playlistId?: string;
      bidirectional?: string | boolean;
    };
    const baseUrl = (body.baseUrl || "https://music-api.r-vera.com").trim().replace(/\/$/, "");
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error("Invalid NetEase API URL");
    if (body.bidirectional === true || body.bidirectional === "true") throw new Error("Two-way sync is not enabled. This import preserves your local songs.");
    const cookie = loginCookie(body.cookie);
    const uid = String(body.uid || "").trim();
    if (body.action === "playlists") {
      if (!uid) throw new Error("Enter your NetEase UID first.");
      if (!cookie) throw new Error("Paste MUSIC_U before loading your account playlists.");
      const result = await neteaseRequest(baseUrl, "/user/playlist", { uid, limit: "50" }, cookie);
      const playlists = ((result.playlist as Array<{ id?: string | number; name?: string; trackCount?: number }> | undefined) || [])
        .map((item) => ({ id: String(item.id || ""), name: item.name || "Untitled playlist", trackCount: item.trackCount }))
        .filter((item) => item.id);
      return json(request, { playlists });
    }
    if (body.action !== "sync") throw new Error("Unknown sync action");
    let playlistId = playlistIdFrom(String(body.playlistId || ""));
    if (!playlistId && uid && cookie) {
      const result = await neteaseRequest(baseUrl, "/user/playlist", { uid, limit: "50" }, cookie);
      playlistId = String(((result.playlist as Array<{ id?: string | number }> | undefined) || [])[0]?.id || "");
    }
    if (!playlistId) throw new Error("Enter a NetEase playlist ID.");
    const detail = await neteaseRequest(baseUrl, "/playlist/track/all", { id: playlistId, limit: "500", offset: "0" }, cookie);
    const songs = (detail.songs as Array<{ id: number | string; name: string; dt?: number; ar?: Array<{ name?: string }>; al?: { name?: string; picUrl?: string } }> | undefined) || [];
    if (!songs.length) throw new Error("No songs to sync in this playlist.");
    const urlMap = new Map<string, string>();
    for (let offset = 0; offset < songs.length; offset += 100) {
      const ids = songs.slice(offset, offset + 100).map((song) => song.id).join(",");
      const urls = await neteaseRequest(baseUrl, "/song/url/v1", { id: ids, level: "standard" }, cookie);
      for (const item of (urls.data as Array<{ id?: number | string; url?: string }> | undefined) || []) {
        if (item.id && item.url) urlMap.set(String(item.id), item.url.replace(/^http:\/\//i, "https://"));
      }
    }
    const incoming: MusicTrack[] = songs.map((song) => {
      const neteaseId = String(song.id);
      const url = urlMap.get(neteaseId) || "";
      return { id: `netease-${neteaseId}`, neteaseId, title: song.name, artist: song.ar?.map((artist) => artist.name).filter(Boolean).join(" / ") || "Unknown artist", album: song.al?.name || "", duration: song.dt ? `${Math.floor(song.dt / 60000)}:${String(Math.floor(song.dt / 1000) % 60).padStart(2, "0")}` : undefined, cover: song.al?.picUrl || "", url, playable: Boolean(url) };
    });
    const existing = await readDocument<MusicTrack[]>("music", []);
    const existingQueue = await readDocument<MusicTrack[]>("musicQueue", []);
    const byKey = (track: MusicTrack) => track.neteaseId ? `netease:${track.neteaseId}` : `id:${track.id}`;
    const merged = [...existing];
    for (const track of incoming) {
      const index = merged.findIndex((item) => byKey(item) === byKey(track));
      if (index >= 0) merged[index] = { ...merged[index], ...track };
      else merged.push(track);
    }
    // The selected playlist is the current listening queue. Preserve any local
    // metadata for matching entries, but never keep the former queue order: the
    // resulting queue follows the Netease playlist exactly and all signed URLs
    // are refreshed in the same pass.
    const queue = incoming.map((track) => {
      const existingTrack = existingQueue.find((item) => byKey(item) === byKey(track));
      return existingTrack ? { ...existingTrack, ...track } : track;
    });
    await writeDocument("music", merged);
    await writeDocument("musicQueue", queue);
    const syncedAt = new Date().toISOString();
    return json(request, { ok: true, tracks: merged, queue, meta: { baseUrl, uid, playlistId, lastSyncAt: syncedAt }, summary: `Synced ${incoming.length} tracks in playlist order and refreshed playback URLs.` });
  } catch (reason) {
    return json(request, { error: reason instanceof Error ? reason.message : "NetEase sync failed" }, 400);
  }
}
