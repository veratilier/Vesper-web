/** Discard only explicitly identified legacy NetEase entries on music sync. */
export function isLegacyNetEase(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('netease-');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.appleMusicId === 'string' && row.appleMusicId.trim()) return false;
  return [row.id, row.trackId].some(id => typeof id === 'string' && id.startsWith('netease-'))
    || Boolean(row.neteaseId) || row.source === 'netease';
}
export function cleanMusicDocument(key: string, value: unknown): unknown {
  if (['music', 'musicQueue', 'musicFavorites'].includes(key) && Array.isArray(value)) {
    return value.filter(item => !isLegacyNetEase(item));
  }
  if (key === 'musicAnnotations' && value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).filter(([id, item]) => !isLegacyNetEase(id) && !isLegacyNetEase(item)));
  }
  if (['musicPlayback', 'musicControl'].includes(key) && value && typeof value === 'object' && !Array.isArray(value)) {
    if (isLegacyNetEase(value)) return {};
    const row = value as Record<string, unknown>;
    const native = row.nativePlayback as Record<string, unknown> | undefined;
    if (native && isLegacyNetEase(native.track)) {
      const copy = { ...row }; delete copy.nativePlayback; return copy;
    }
  }
  return value;
}
