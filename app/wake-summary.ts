import type { Execution } from './codex-execution';
export type WakeRecord = { requestId: string; requestedAt: string; startedAt?: string; endedAt?: string; messageOmitted?: boolean; source: 'manual' | 'automation' };
const labels: [RegExp, string][] = [
  [/atlas_memory|search_memory|recall_memory/, "Read memories"],
  [/atlas_note|list_notes|save_note/, "Read or organize notes"],
  [/journal|diary/, "Read or organize journals"],
  [/galatea|botling|galaxy/, "Browse community"],
  [/desire/, "Read or update Desire"],
  [/search|browse/i, "Search sources"],
];
export function wakeActivities(executions: Execution[]) {
  const unique = new Map(executions.map(item => [item.id, item]));
  return [...unique.values()].map(item => ({ id: item.id, name: item.title, label: labels.find(([pattern]) => pattern.test(item.title))?.[1] || (item.type === 'commandExecution' ? "Run command" : item.type === 'fileChange' ? "Edit file" : "Call tool"), status: ['completed', 'succeeded'].includes(item.status) ? "Completed" : ['failed', 'error', 'declined', 'cancelled', 'interrupted'].includes(item.status) ? "Incomplete" : "Running" }));
}
