'use client';
import { useMemo, useRef, useState } from 'react';
import { executionFiles, formatExecutionOutput, type Execution } from './codex-execution';
const labels: Record<string, string> = { inProgress: "Running", running: "Running", completed: "Completed", failed: "Failed", declined: "Not allowed", interrupted: "Interrupted", unknown: "Awaiting status" };
function Code({ text, diff = false }: { text: string; diff?: boolean }) {
  return <pre tabIndex={0}><code>{text.split('\n').map((line, index) => <span key={index} className={diff ? line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-remove' : line.startsWith('@@') ? 'diff-hunk' : undefined : undefined}>{line}{'\n'}</span>)}</code></pre>;
}
export function ExecutionCard({ execution, live }: { execution: Execution; live: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const running = ['inProgress', 'running'].includes(execution.status);
  const status = running && !live ? "Awaiting status" : labels[execution.status] || execution.status;
  const parsed = useMemo(() => {
    if (execution.files?.length) return { files: execution.files, filesTruncated: execution.filesTruncated };
    if (execution.type === 'fileChange') {
      try { return executionFiles(JSON.parse(execution.output)); } catch { /* Older truncated patches remain available as text. */ }
    }
    return { files: [], filesTruncated: execution.filesTruncated };
  }, [execution.files, execution.filesTruncated, execution.type, execution.output]);
  const output = useMemo(() => ['commandExecution', 'shellCall', 'fileChange'].includes(execution.type) ? execution.output : formatExecutionOutput(execution.output), [execution.output, execution.type]);
  const file = parsed.files[Math.min(selected, parsed.files.length - 1)];
  const body = <div className="execution-body">
    <div className="execution-meta"><span>{status}</span>{execution.cwd && <span>{execution.cwd}</span>}{execution.exitCode != null && <span>exit {execution.exitCode}</span>}{execution.durationMs != null && <span>{(execution.durationMs / 1000).toFixed(1)}s</span>}</div>
    {parsed.files.length > 0 && <div className="execution-files" aria-label="Changed files">{parsed.files.map((entry, index) => {
      const lines = entry.diff.split('\n');
      const added = lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
      const removed = lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length;
      return <button key={`${index}:${entry.path}`} type="button" aria-pressed={file === entry} onClick={() => setSelected(index)} title={entry.path}>{entry.path.split('/').pop()} {entry.diff && <><span className="diff-add">+{added}</span> <span className="diff-remove">−{removed}</span></>}{entry.truncated && "· Partial"}</button>;
    })}</div>}
    {file && <><p className="execution-path">{file.path}</p><Code diff text={file.diff || "The server returned file paths without a code diff."} />{file.truncated && <p className="execution-notice">This file change exceeded the storage limit. Only the beginning was saved.</p>}</>}
    {(!file || (execution.files?.length && output)) && <Code text={output || (running && live ? "Waiting for output…" : "No text output")} />}
    {execution.truncated && <p className="execution-notice">Output was truncated. Only the latest part was saved.</p>}
    {parsed.filesTruncated && <p className="execution-notice">File changes exceeded the storage limit. Some content was not saved.</p>}
  </div>;
  return <article className="execution-card" data-status={execution.status}>
    <div className="execution-heading"><button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span aria-hidden="true">›_</span><b>{execution.title}</b><small>{status}</small></button><button type="button" aria-label="Expand execution details to view saved output and file changes" onClick={() => dialog.current?.showModal()}>⤢</button></div>
    {expanded && body}
    <dialog ref={dialog} className="execution-dialog" aria-label={`${execution.title} execution details`} onClick={e => { if (e.target === e.currentTarget) e.currentTarget.close(); }}><header><span className="terminal-lights" aria-hidden="true"><i/><i/><i/></span><b>{execution.title}</b><button autoFocus type="button" onClick={() => dialog.current?.close()} aria-label="Close execution details">×</button></header>{body}</dialog>
  </article>;
}
