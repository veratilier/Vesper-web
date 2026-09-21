export type UsageWindow = { label: string; remaining: number; resetsAt: number | null };
export function usageWindows(payload: unknown): UsageWindow[] {
  if (!payload || typeof payload !== 'object') return [];
  const value = payload as Record<string, any>;
  const limits = value.rateLimitsByLimitId?.codex ?? value.rateLimits;
  if (!limits || (limits.limitId && limits.limitId !== 'codex')) return [];
  return [limits.primary, limits.secondary].flatMap((window, index) => {
    if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) return [];
    const mins = window.windowDurationMins;
    const label = mins === 10080 ? 'Weekly limit' : mins === 300 ? '5-hour limit' : typeof mins === 'number' && mins > 0 ? (mins >= 60 ? `${mins / 60}-hour limit` : `${mins}-minute limit`) : `Limit ${index + 1}`;
    return [{ label, remaining: Math.round(Math.max(0, Math.min(100, 100 - window.usedPercent))), resetsAt: typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt) ? window.resetsAt : null }];
  });
}
