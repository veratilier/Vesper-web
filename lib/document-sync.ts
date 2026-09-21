/** Never publish an untouched default; reconcile actual persisted documents only. */
export function documentSyncAction(localRaw: string | null, localUpdatedAt: string | undefined, remoteValue: unknown, remoteUpdatedAt: string | undefined) {
  const localTime = Date.parse(localUpdatedAt || '') || 0;
  const remoteTime = Date.parse(remoteUpdatedAt || '') || 0;
  if (remoteValue !== null && (localRaw === null || remoteTime > localTime)) return 'download';
  if (localRaw !== null && (!remoteUpdatedAt || localTime > remoteTime)) return 'upload';
  return 'none';
}
