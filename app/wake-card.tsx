'use client';
import { useEffect, useState } from 'react';
import type { Execution } from './codex-execution';
import { wakeActivities, type WakeRecord } from './wake-summary';
export function WakeCard({ wake, executions, status, online }: { wake: WakeRecord; executions: Execution[]; status: string; online: boolean }) {
  const [now, setNow] = useState(0);
  useEffect(() => { const update = () => setNow(Date.now()); update(); const timer = setInterval(update, 1000); return () => clearInterval(timer); }, []);
  const running = !wake.endedAt && !['error', 'completed'].includes(status);
  const elapsed = wake.startedAt ? Math.max(0, (Date.parse(wake.endedAt || '') || now || Date.parse(wake.startedAt)) - Date.parse(wake.startedAt)) : 0;
  const activity = wakeActivities(executions);
  return <section className="wake-session-note" aria-label="Wake activity"><header><b>{status === 'error' ? "This turn did not finish" : !wake.startedAt ? "Connecting" : running ? online ? "Waking" : "Connection lost · Awaiting status" : "Turn finished"}</b><small>{wake.startedAt ? `${running ? "Awake" : "Duration"} ${Math.floor(elapsed / 60000)}m ${Math.floor(elapsed / 1000) % 60}s` : "Not started"}</small></header><p>{activity.length ? [...new Set(activity.map(item => `${item.label} · ${item.status}`))].join('；') : "No tool call details received yet."}</p>{activity.length > 0 && <details><summary>View {activity.length}  activities</summary><ul>{activity.map(item => <li key={item.id}><span>{item.name}</span><small>{item.status}</small></li>)}</ul></details>}</section>;
}
