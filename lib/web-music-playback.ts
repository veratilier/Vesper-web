import { neteaseTrackId } from './web-music';
import type { MusicSyncTrack, MusicLibraryResult } from './music-service';

type LibraryRequest = (payload: { action: 'resolve'; songIds: string[]; tracks: MusicSyncTrack[] }) => Promise<MusicLibraryResult>;
export async function resolveWebMusic(track: MusicSyncTrack, request: LibraryRequest): Promise<string> {
  const id = neteaseTrackId(track);
  if (!id) throw new Error('Web 使用网易云播放，请在 My Music 选择网易云歌曲。原生 App 的队列保持不变。');
  // NetEase audio URLs expire. Resolve by its real NetEase ID for each new play.
  const result = await request({ action: 'resolve', songIds: [id], tracks: [track] });
  const resolved = result.tracks?.find(item => neteaseTrackId(item) === id);
  if (!resolved?.url || resolved.playable === false) throw new Error('网易云暂未提供这首歌的音源，请检查 My Music 的登录状态或歌曲播放权限。');
  const url = new URL(resolved.url);
  if (url.protocol !== 'https:') throw new Error('网易云音频地址不可用，请重试。');
  return url.toString();
}
