import { searchAppleMusic, lookupAppleMusic } from './apple-music-search';
import { appleSearchTransport } from './apple-music-transport';
import { createBookmark, listBookmarks } from './bookmarks';
import { legacyDesireRead } from './desire/routing.js';
import { env } from 'cloudflare:workers';
import { executeDesire, type NativeDesireEnv } from './desire/native';
import { desireTools } from './desire/tools';
import { memoryScopeFromRequest } from './memory';
import { listAlbumPhotos, saveAlbumPhoto, getAlbumPhoto } from '@/lib/photo-album';
import { createChatFile } from '@/lib/codex-artifacts';
import { readExecutions } from '@/lib/codex-events';
import { allowedDocumentKeys } from "@/db/schema";
import { ensureSchema, getDb } from "@/lib/db";
import { callConfiguredMcpTool, configuredMcpTools } from "@/lib/mcp-connections";
import { type MemoryScope } from "@/lib/memory";
import { recallSharedMemory, sharedMemoryTool } from "@/lib/shared-memory-tools";
import { claimAgentSticker, listStickers, stickerForUse } from "@/lib/stickers";

type ToolInput = Record<string, unknown>;
type MusicTrack = { id: string; source?: string; appleMusicId?: string; appleMusicURL?: string; artwork?: string; neteaseId?: string; title: string; artist: string; album?: string; cover?: string; duration?: string | number; url?: string; playable?: boolean };
type MusicPlayback = { trackId?: string; playing?: boolean; positionSeconds?: number; durationSeconds?: number; queueLength?: number; updatedAt?: string };
type NeteaseSourceSong = { id?: string | number; name?: string; dt?: number; ar?: Array<{ name?: string }>; al?: { name?: string; picUrl?: string } };
export type CodexToolContext = { conversationId?: string; turnId?: string; origin?: string };

const sectionToKey: Record<string, string> = {
  today: "todos",
  notes: "notes",
  reminders: "todos",
  dates: "anniversaries",
  anniversaries: "anniversaries",
  journal: "diary",
  diary: "diary",
  music: "music",
  settings: "settings",
};

import { codexToolDefinitions } from "./codex-tool-definitions";
export { codexToolDefinitions };

async function readDocument(key: string): Promise<unknown> {
  if (!allowedDocumentKeys.has(key)) throw new Error("Unsupported Vesper document");
  const row = await getDb().prepare("SELECT value FROM vesper_documents WHERE key = ?")
    .bind(key).first<{ value: string }>();
  if (!row) return key === "diary" || key === "settings" ? {} : [];
  try { return JSON.parse(row.value); } catch { return null; }
}

async function writeDocument(key: string, value: unknown) {
  if (!allowedDocumentKeys.has(key)) throw new Error("Unsupported Vesper document");
  await getDb().prepare(`INSERT INTO vesper_documents(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .bind(key, JSON.stringify(value), new Date().toISOString()).run();
  return value;
}

async function readMusicTracks(key: "music" | "musicQueue") {
  const value = await readDocument(key);
  return Array.isArray(value) ? value.filter((item): item is MusicTrack => Boolean(item && typeof item === "object" && typeof (item as MusicTrack).id === "string")) : [];
}
function findMusicTrack(tracks: MusicTrack[], trackId: string) {
  return tracks.find((track) => track.id === trackId || track.neteaseId === trackId || track.appleMusicId === trackId);
}
async function readMusicLibrary() {
  const [library, queue] = await Promise.all([readMusicTracks("music"), readMusicTracks("musicQueue")]);
  const seen = new Set<string>();
  return [...library, ...queue].filter((track) => {
    const stableId = track.neteaseId ? `netease:${track.neteaseId}` : `id:${track.id}`;
    if (seen.has(stableId)) return false;
    seen.add(stableId);
    return true;
  });
}
function musicDuration(milliseconds?: number) {
  if (!milliseconds) return "";
  return `${Math.floor(milliseconds / 60_000)}:${String(Math.floor(milliseconds / 1_000) % 60).padStart(2, "0")}`;
}
function neteaseTrack(song: NeteaseSourceSong, url = ""): MusicTrack {
  const neteaseId = String(song.id || "");
  return {
    id: `netease-${neteaseId}`,
    neteaseId,
    title: song.name || "未命名歌曲",
    artist: song.ar?.map((artist) => artist.name).filter(Boolean).join(" / ") || "未知歌手",
    album: song.al?.name || "",
    duration: musicDuration(song.dt),
    cover: song.al?.picUrl?.replace(/^http:\/\//i, "https://") || "",
    url,
    playable: Boolean(url),
  };
}
async function neteaseRequest(path: string, params: Record<string, string>) {
  const response = await fetch(`https://music-api.r-vera.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams(params),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || Number(result.code || 200) >= 400) throw new Error("网易云搜索暂时不可用");
  return result;
}
async function mergeMusicLibrary(incoming: MusicTrack[]) {
  const library = await readMusicTracks("music");
  const merged = [...library];
  for (const track of incoming) {
    const index = merged.findIndex((item) => item.id === track.id || (item.neteaseId && item.neteaseId === track.neteaseId));
    if (index >= 0) merged[index] = { ...merged[index], ...track };
    else merged.push(track);
  }
  await writeDocument("music", merged);
  return incoming;
}
function publicTrack(track?: MusicTrack) {
  if (!track) return null;
  return { trackId: track.id, title: track.title, artist: track.artist, album: track.album || "", cover: track.cover || track.artwork || "", duration: track.duration || "", playable: Boolean(track.appleMusicId || (track.url && track.playable !== false)), source: track.appleMusicId ? "appleMusic" : track.neteaseId ? "netease" : "vesper", appleMusicId: track.appleMusicId || "", appleMusicURL: track.appleMusicURL || "" };
}
async function readMusicStatus() {
  const [library, queue, playbackValue] = await Promise.all([readMusicLibrary(), readMusicTracks("musicQueue"), readDocument("musicPlayback")]);
  const playback = playbackValue && typeof playbackValue === "object" && !Array.isArray(playbackValue) ? playbackValue as MusicPlayback : {};
  const current = playback.trackId ? findMusicTrack(queue, playback.trackId) || findMusicTrack(library, playback.trackId) : undefined;
  return {
    available: Boolean(current),
    playback: {
      track: publicTrack(current),
      playing: playback.playing === true,
      positionSeconds: Number.isFinite(playback.positionSeconds) ? Math.max(0, Number(playback.positionSeconds)) : null,
      durationSeconds: Number.isFinite(playback.durationSeconds) ? Math.max(0, Number(playback.durationSeconds)) : null,
      updatedAt: typeof playback.updatedAt === "string" ? playback.updatedAt : null,
    },
    queueLength: queue.length,
    libraryLength: library.length,
  };
}

export async function executeCodexTool(name: string, input: ToolInput, memoryScope?: MemoryScope, context: CodexToolContext = {}) {
  if (name === "call_configured_mcp_tool") {
    const nativeRead = legacyDesireRead(input.toolName);
    if (nativeRead) {
      const args = input.arguments && typeof input.arguments === "object" && !Array.isArray(input.arguments) ? input.arguments as ToolInput : {};
      return executeCodexTool(nativeRead, args, memoryScope, context);
    }
  }
  if (desireTools.some(tool => tool.name === name)) {
    const bindings = env as NativeDesireEnv & { VESPER_APP_TOKEN?: string };
    if (!memoryScope || !bindings.VESPER_APP_TOKEN) throw new Error('Owner context required');
    const owner = await memoryScopeFromRequest(new Request('https://vesper.internal', { headers: { 'x-vesper-device-token': bindings.VESPER_APP_TOKEN } }));
    if (owner.userId !== memoryScope.userId) throw new Error('Owner context mismatch');
    // Never initialize defaults when production storage or existing state is missing.
    if (!bindings.DB) throw new Error('Vesper Desire storage is unavailable');
    const existing = await bindings.DB.prepare('SELECT user_id FROM vesper_desire_state WHERE user_id = ?').bind('vesper').first();
    if (!existing) throw new Error('Existing Vesper Desire state was not found; no values have been initialized.');
    return executeDesire(bindings, name, input);
  }
  if (["recall_vesper_memory", "remember_vesper_memory", "manage_vesper_memory"].includes(name)) {
    if (!memoryScope) throw new Error("Memory scope is unavailable");
    return sharedMemoryTool(name, input, context);
  }
  if (name === 'bookmark_create' || name === 'bookmark_list') {
    if (!memoryScope) throw new Error('Account context required');
    return name === 'bookmark_create' ? createBookmark(memoryScope.userId,input)
      : listBookmarks(memoryScope.userId,Number(input.limit || 30),String(input.before || ''));
  }
  await ensureSchema();
  if (['album_save_photo', 'album_search_photos', 'album_send_photos'].includes(name)) {
    if (!memoryScope || !context.origin) throw new Error('Account context required');
    if (name === 'album_save_photo') {
      if (typeof input.evaluation !== 'string' || !input.evaluation.trim()) throw new Error('保存照片时请填写评价');
      return { photo: await saveAlbumPhoto(memoryScope.userId, String(input.key || ''), input.category, input.evaluation.trim().slice(0,240), context.origin) };
    }
    if (name === 'album_search_photos') return listAlbumPhotos(memoryScope.userId, input, context.origin);
    if (!context.conversationId || !Array.isArray(input.photoIds) || !input.photoIds.length || input.photoIds.length > 8 || input.photoIds.some(id => typeof id !== 'string')) throw new Error('Choose 1–8 exact album photo IDs');
    const photos = await Promise.all([...new Set(input.photoIds as string[])].map(id => getAlbumPhoto(memoryScope.userId, id, context.origin!)));
    return { attachments: photos, message: String(input.message || '').slice(0, 2000) };
  }
  if (name === "read_codex_task_progress") {
    if (!memoryScope || !context.conversationId) throw new Error("Conversation context required");
    return readExecutions(memoryScope.userId, context.conversationId);
  }
  if (name === "send_chat_file") {
    if (!memoryScope || !context.conversationId || !context.origin) throw new Error("Conversation context required");
    if (!Array.isArray(input.files) || !input.files.length || input.files.length > 8) throw new Error("Send between 1 and 8 files");
    if (JSON.stringify(input.files).length > 12 * 1024 * 1024) throw new Error("Attachment batch too large");
    const attachments = [];
    for (const file of input.files) {
      if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error("Invalid file");
      attachments.push(await createChatFile(file as ToolInput, memoryScope.userId, context.origin));
    }
    return { attachments, message: String(input.message || '').slice(0, 2000) };
  }
  if (name === "reading_room_read" || name === "reading_room_annotate") {
    const books = await readDocument("readingRoom") as import("@/app/reading-room").ReadingBook[];
    if (!Array.isArray(books)) throw new Error("Reading room data unavailable");
    if (name === "reading_room_read" && !input.bookId) return { books: books.map(book => ({ id: book.id, title: book.title, page: book.page, pages: Math.ceil(book.text.length / 1800), notes: book.notes.length })) };
    const book = books.find(item => item.id === input.bookId);
    if (!book) throw new Error("Book not found. Read the bookshelf first.");
    const page = input.page === undefined ? book.page : input.page;
    const pages = book.text.match(/[\s\S]{1,1800}/g) || [];
    if (typeof page !== "number" || !Number.isInteger(page) || page < 0 || page >= pages.length) throw new Error("Page out of range");
    if (name === "reading_room_read") return { id: book.id, title: book.title, page, pages: pages.length, text: pages[page], notes: book.notes.filter(note => note.page === page) };
    if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 10000 || typeof input.noteId !== "string" || !input.noteId.trim() || input.noteId.length > 100) throw new Error("Provide noteId and annotation text");
    if (input.quote !== undefined && (typeof input.quote !== "string" || input.quote.length > 1800)) throw new Error("Invalid quote");
    const existing = book.notes.find(note => note.id === input.noteId);
    if (existing) {
      if (existing.text !== input.text.trim() || existing.page !== page || existing.quote !== (input.quote || "")) throw new Error("noteId already used for a different annotation");
      return { note: existing, replayed: true };
    }
    const previous = JSON.stringify(books);
    const note = { id: input.noteId, page, text: input.text.trim(), quote: String(input.quote || ""), author: "Rowan", date: new Date().toISOString() };
    book.notes.push(note);
    const result = await getDb().prepare("UPDATE vesper_documents SET value = ?, updated_at = ? WHERE key = ? AND value = ?").bind(JSON.stringify(books), new Date().toISOString(), "readingRoom", previous).run();
    if (!result.meta.changes) throw new Error("Reading room changed. Read again and retry with the same noteId.");
    return { note, replayed: false };
  }
  if (name === "read_vesper_state") {
    const section = String(input.section || "notes").toLowerCase();
    if (section === "memory") {
      if (!memoryScope) throw new Error("Memory scope is unavailable");
      return { section, value: (await recallSharedMemory("")).memories };
    }
    const key = sectionToKey[section];
    if (!key) throw new Error(`Unknown Vesper section: ${section}`);
    if (section === "music") return { section, value: await readMusicStatus() };
    return { section, value: await readDocument(key) };
  }
  if (name === "search_vesper_state") {
    const query = String(input.query || "").trim().toLowerCase();
    if (!query) return { matches: [] };
    const matches: Array<{ section: string; value: unknown }> = [];
    for (const [section, key] of Object.entries(sectionToKey)) {
      const value = await readDocument(key);
      if (JSON.stringify(value).toLowerCase().includes(query)) matches.push({ section, value });
    }
    if (memoryScope) {
      const memories = await recallSharedMemory(query);
      if (memories.memories.length) matches.push({ section: "memory", value: memories.memories });
    }
    return { matches: matches.filter((item, index, list) => list.findIndex((candidate) => candidate.section === item.section) === index) };
  }
  if (name === "write_vesper_state") {
    const kind = String(input.kind || "").toLowerCase();
    const now = new Date().toISOString();
    if (kind === "note") {
      const text = String(input.text || input.title || "").trim();
      if (!text) throw new Error("Note text is required");
      const notes = (await readDocument("notes")) as Array<Record<string, unknown>>;
      const entry = { id: crypto.randomUUID(), text, kind: "agent", tone: "cool", createdAt: now };
      await writeDocument("notes", [...notes, entry]);
      return { saved: true, section: "notes", entry };
    }
    if (kind === "reminder") {
      const title = String(input.title || input.text || "").trim();
      if (!title) throw new Error("Reminder title is required");
      const todos = (await readDocument("todos")) as Array<Record<string, unknown>>;
      const entry = { id: crypto.randomUUID(), title, done: false, due: String(input.due || input.date || ""), tag: String(input.tag || "Agent"), createdAt: now };
      await writeDocument("todos", [...todos, entry]);
      return { saved: true, section: "reminders", entry };
    }
    if (kind === "anniversary") {
      const title = String(input.title || input.text || "").trim();
      const date = String(input.date || "");
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Anniversary title/date is invalid");
      const anniversaries = (await readDocument("anniversaries")) as Array<Record<string, unknown>>;
      const entry = { id: crypto.randomUUID(), title, date, repeats: input.repeats !== false };
      await writeDocument("anniversaries", [...anniversaries, entry]);
      return { saved: true, section: "anniversaries", entry };
    }
    if (kind === "journal") {
      const date = String(input.date || "");
      const text = String(input.text || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !text) throw new Error("Journal date/text is invalid");
      const diary = { ...await readDocument("diary") as Record<string, unknown> };
      diary[date] = { ...(diary[date] as Record<string, unknown> || {}), agent: text, updatedAt: now };
      await writeDocument("diary", diary);
      return { saved: true, section: "journal", date };
    }
    throw new Error(`Unsupported write kind: ${kind}`);
  }
  if (name === "music_get_status") return await readMusicStatus();
  if (name === "music_search") {
    const query = String(input.query || "").trim().toLowerCase();
    const limit = Math.min(20, Math.max(1, Number(input.limit || 8)));
    if (!query) return { matches: [] };
    const local = (await readMusicLibrary()).filter(track => track.appleMusicId && JSON.stringify(track).toLowerCase().includes(query));
    let catalog: MusicTrack[] = [];
    try { catalog = await searchAppleMusic(query, limit, appleSearchTransport((env as { VESPER_APP_TOKEN?: string }).VESPER_APP_TOKEN || '')); }
    catch (error) { if (!local.length) throw error; }
    const seen = new Set<string>();
    const matches = [...local, ...catalog].filter(track => {
      const id = track.appleMusicId || track.id;
      if (seen.has(id)) return false; seen.add(id); return true;
    }).slice(0, limit).map(publicTrack);
    return { provider: "appleMusic", matches };
  }
  if (name === "music_netease_search") {
    const query = String(input.query || "").trim();
    const limit = Math.min(10, Math.max(1, Number(input.limit || 6)));
    if (!query) throw new Error("请输入要搜索的歌名、歌手或专辑");
    const search = await neteaseRequest("/cloudsearch", { keywords: query, limit: String(limit), type: "1" });
    const songs = ((search.result as { songs?: NeteaseSourceSong[] } | undefined)?.songs || []).slice(0, limit);
    const ids = songs.map((song) => String(song.id || "")).filter(Boolean);
    const urls = new Map<string, string>();
    if (ids.length) {
      try {
        const source = await neteaseRequest("/song/url/v1", { id: ids.join(","), level: "standard" });
        for (const item of ((source.data as Array<{ id?: string | number; url?: string }> | undefined) || [])) {
          if (item.id && item.url) urls.set(String(item.id), item.url.replace(/^http:\/\//i, "https://"));
        }
      } catch {
        // Search remains useful when a temporary signed URL cannot be returned.
      }
    }
    const imported = await mergeMusicLibrary(songs.map((song) => neteaseTrack(song, urls.get(String(song.id)) || "")));
    return {
      query,
      imported: imported.length,
      matches: imported.map((track) => publicTrack(track)),
      musicLibraryRefresh: true,
      note: "歌曲已加入 Vesper 音乐库；若该设备已连接网易云账号，聊天中的歌曲卡片会使用本机 MUSIC_U 刷新可播放链接。",
    };
  }
  if (name === "music_play") {
    const trackId = String(input.trackId || "");
    const tracks = await readMusicLibrary();
    const track: MusicTrack | null | undefined = findMusicTrack(tracks, trackId) || await lookupAppleMusic(trackId.replace(/^apple-/, ""));
    if (!track) throw new Error("找不到指定歌曲，请先使用 music_search");
    if ((!track.appleMusicId && !track.url) || track.playable === false) throw new Error("这首歌没有可播放音源");
    const queue = await readMusicTracks("musicQueue");
    const replaceQueue = input.replaceQueue === true;
    const nextQueue = replaceQueue ? [track] : queue.some((item) => item.id === track.id || (item.neteaseId && item.neteaseId === track.neteaseId)) ? queue : [...queue, track];
    await writeDocument("musicQueue", nextQueue);
    const command = { id: crypto.randomUUID(), action: "play_track", trackId: track.id, track, replaceQueue, createdAt: new Date().toISOString() };
    await writeDocument("musicControl", command);
    return { ok: true, action: "playing", track: { trackId: track.id, title: track.title, artist: track.artist }, queueLength: nextQueue.length };
  }
  if (name === "music_control") {
    const action = String(input.action || "");
    if (!(["play", "pause", "next", "previous"] as string[]).includes(action)) throw new Error("Unsupported music control action");
    const status = await readMusicStatus();
    if (action === "play" && !status.playback.track) throw new Error("当前没有可继续播放的歌曲");
    const command = { id: crypto.randomUUID(), action, createdAt: new Date().toISOString() };
    await writeDocument("musicControl", command);
    return { ok: true, action, command, playback: status.playback };
  }
  if (name === "music_queue_add") {
    const trackId = String(input.trackId || "");
    const position = input.position === "next" ? "next" : "end";
    const track: MusicTrack | null | undefined = findMusicTrack(await readMusicLibrary(), trackId) || await lookupAppleMusic(trackId.replace(/^apple-/, ""));
    if (!track) throw new Error("找不到指定歌曲，请先使用 music_search");
    const queue = await readMusicTracks("musicQueue");
    if (queue.some((item) => item.id === track.id || (item.neteaseId && item.neteaseId === track.neteaseId))) return { ok: true, alreadyQueued: true, trackId: track.id, queueLength: queue.length };
    if (position === "next") queue.splice(Math.min(1, queue.length), 0, track);
    else queue.push(track);
    await writeDocument("musicQueue", queue);
    return { ok: true, position, trackId: track.id, queueLength: queue.length };
  }
  if (name === "music_send_card") {
    const trackId = String(input.trackId || "");
    const track: MusicTrack | null | undefined = findMusicTrack(await readMusicLibrary(), trackId) || await lookupAppleMusic(trackId.replace(/^apple-/, ""));
    if (!track) throw new Error("找不到指定歌曲，请先使用 music_search");
    return { ok: true, musicCard: { id: track.id, trackId: track.id, appleMusicId: track.appleMusicId || '', appleMusicURL: track.appleMusicURL || '', shareURL: track.neteaseId ? `https://music.163.com/song?id=${encodeURIComponent(track.neteaseId)}` : '', title: track.title, artist: track.artist, album: track.album || "", cover: track.cover || track.artwork || "", duration: track.duration || "", url: track.url || "", playable: Boolean(track.appleMusicId || (track.url && track.playable !== false)), source: track.appleMusicId ? "appleMusic" : track.source || (track.neteaseId ? "netease" : "vesper"), message: typeof input.message === "string" ? input.message : "" } };
  }
  if (name === "music_playlist_add") {
    const trackId = String(input.trackId || "");
    const tracks = await readMusicLibrary();
    const track: MusicTrack | null | undefined = findMusicTrack(tracks, trackId) || await lookupAppleMusic(trackId.replace(/^apple-/, ""));
    if (!track) throw new Error("找不到指定歌曲，请先使用 music_search");
    const already = Boolean(findMusicTrack(tracks, track.id));
    if (!already) await mergeMusicLibrary([track]);
    return { ok: true, alreadyInPlaylist: already, trackId: track.id, playlist: "Vesper music" };
  }
  if (name === "sticker_search") {
    if (!memoryScope) throw new Error("Sticker scope is unavailable");
    const query = String(input.query || "").trim();
    if (!query) return { stickers: [] };
    const stickers = await listStickers(memoryScope, { query, limit: Math.min(12, Math.max(1, Number(input.limit || 8))) });
    return { stickers: stickers.map((sticker) => ({ assetId: sticker.id, category: sticker.category, description: sticker.description, name: sticker.name, width: sticker.width, height: sticker.height, mimeType: sticker.mimeType })) };
  }
  if (name === "sticker_send") {
    if (!memoryScope) throw new Error("Sticker scope is unavailable");
    const assetId = String(input.assetId || "").trim();
    if (!assetId) throw new Error("assetId is required");
    // Validate the selected catalog record before consuming this turn's one
    // sticker allowance. A stale/cross-scope id must not spend the rate limit.
    await stickerForUse(memoryScope, assetId, false);
    await claimAgentSticker(memoryScope, String(context.conversationId || ""), String(context.turnId || ""));
    const sticker = await stickerForUse(memoryScope, assetId);
    return { ok: true, stickerMessage: { type: "sticker", assetId: sticker.id, url: sticker.url, width: sticker.width, height: sticker.height, mimeType: sticker.mimeType, alt: sticker.description || sticker.name, description: sticker.description, category: sticker.category } };
  }
  if (name === "list_configured_mcp_tools") {
    if (!memoryScope) throw new Error("MCP scope is unavailable");
    return { connections: await configuredMcpTools(memoryScope) };
  }
  if (name === "call_configured_mcp_tool") {
    if (!memoryScope) throw new Error("MCP scope is unavailable");
    return callConfiguredMcpTool(memoryScope, input);
  }
  throw new Error(`Unknown Codex tool: ${name}`);
}
