'use client';
import { ExecutionCard } from './execution-card';
import type { Execution } from './codex-execution';
export type TurnActivity = { busy: boolean; online: boolean; executions: Execution[]; summary: string };
export function ChatActivity({ busy, online, executions, summary, timestamp, dateTime, status, expanded, onExpandedChange }: TurnActivity & {
  timestamp: string; dateTime?: string; status?: string; expanded?: boolean; onExpandedChange?: (open: boolean) => void;
}) {
  return <details className="chat-activity chat-activity-inline" open={expanded} onToggle={event => onExpandedChange?.(event.currentTarget.open)}>
    <summary aria-label={`${timestamp} Tool calls and thinking summary`}>
      <i aria-hidden="true" /><time dateTime={dateTime}>{timestamp}</time>
      <svg className="activity-chevron" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
      {busy && status && <span className="turn-progress">{status}</span>}
    </summary>
    <section aria-label="Tool call details">
      <h3>Tool calls</h3>
      {executions.length ? executions.map(execution => <ExecutionCard key={execution.id} execution={execution} live={busy && online} />)
        : <p>No tool details received for this turn.</p>}
      <h3>Thinking summary</h3>
      <p className="activity-summary">{summary || (busy ? "Waiting for a thinking summary…" : "No thinking summary was returned for this turn.")}</p>
    </section>
  </details>;
}
