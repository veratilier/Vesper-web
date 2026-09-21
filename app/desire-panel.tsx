'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DesireFlower } from './desire-flower';
import './desire-panel.css';
function unpack(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const obj = input as { isError?: boolean; content?: { type: string; text?: string }[]; structuredContent?: unknown };
  if (obj.isError) throw Error(obj.content?.map(item => item.text || '').join('\n') || "Desire returned an error");
  if (obj.structuredContent) return obj.structuredContent;
  const text = obj.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
  if (text) { try { return JSON.parse(text); } catch { throw Error("Desire returned unrecognized data"); } }
  return input;
}
type Note = { id: string; note: string; date: string };
function historyNotes(value: unknown): Note[] {
  const object = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rows = Array.isArray(value) ? value : [object.records, object.events, object.history, object.encounters, object.items].find(Array.isArray);
  if (!rows) throw Error("Unrecognized history format");
  return rows.flatMap((row, index) => {
    const item = row && typeof row === 'object' ? row as Record<string, unknown> : {};
    if (typeof item.note !== 'string' || !item.note.trim()) return [];
    return [{ id: String(item.id || item.encounterId || index), note: item.note, date: String(item.eventAt || item.event_at || item.createdAt || item.created_at || '') }];
  });
}
function dateLabel(date: string) { const stamp = new Date(date); return Number.isFinite(stamp.getTime()) ? stamp.toLocaleString("en-US", { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; }
export function DesirePanel({ apiUrl, headers, active, agentName }: {
  apiUrl: (path: string) => string; headers: (json?: boolean) => Record<string, string>;
  active: boolean; agentName: string;
}) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller; setLoading(true);
    const get = async (view: string) => {
      const response = await fetch(apiUrl(`/api/desire?view=${view}`), { headers: headers(), cache: 'no-store', signal: controller.signal });
      const result = await response.json() as { error?: string; data?: unknown };
      if (!response.ok) throw Error(result.error || "Could not load");
      return unpack(result.data);
    };
    try {
      const [status, history] = await Promise.allSettled([get('status'), get('history')]);
      if (controller.signal.aborted) return;
      if (status.status === 'fulfilled') {
        const object = status.value as Record<string, unknown> | null;
        const state = object?.state ?? object;
        if (state && typeof state === 'object' && !Array.isArray(state)) { setData(state as Record<string, unknown>); setError(''); setUpdatedAt(new Date().toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' })); }
        else setError("Unsupported Desire status format");
      } else setError(status.reason instanceof Error ? status.reason.message : "Could not load status");
      if (history.status === 'fulfilled') {
        try { setNotes(historyNotes(history.value)); setHistoryError(''); } catch (reason) { setHistoryError(reason instanceof Error ? reason.message : "Could not load notes"); }
      } else setHistoryError(history.reason instanceof Error ? history.reason.message : "Could not load notes");
    } finally { if (request.current === controller) { request.current = null; setLoading(false); } }
  }, [apiUrl, headers]);
  useEffect(() => {
    if (!active) return;
    const refresh = () => { if (!document.hidden) void load(); };
    const timer = setTimeout(refresh, 0), interval = setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); clearInterval(interval); document.removeEventListener('visibilitychange', refresh); request.current?.abort(); request.current = null; };
  }, [active, load]);
  const note = typeof data?.note === 'string' && data.note.trim() ? data.note : notes[0]?.note;
  return <div className="page-body app-center desire-panel desire-garden">
    <div className="desire-heading"><div><small>INNER WEATHER</small><h1>Now</h1></div></div>
    {error && <p className="desire-error" role="alert">{error}{data ? "· Showing the last loaded values." : ''}</p>}
    <section className="desire-note-surface"><h2>{agentName}</h2><p>{note || (loading ? "Reading the latest note…" : "No notes yet.")}</p>{notes[0]?.date && <time>{dateLabel(notes[0].date)}</time>}</section>
    <section className="desire-flower-surface"><DesireFlower data={data} /><div className="desire-flower-footer"><small>{loading ? "Loading…" : updatedAt ? `Updated ${updatedAt}` : "Values not loaded yet"}</small><button type="button" disabled={loading} onClick={() => void load()} aria-label="Refresh mood"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.5 7a7.5 7.5 0 0 1 12-1L20 9M4 15l2.5 3a7.5 7.5 0 0 0 12-1" /></svg></button></div></section>
    <section className="desire-timeline"><div className="desire-timeline-heading"><h2>Recent notes</h2>{notes.length > 3 && <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? "Collapse" : "Recent entries"} ›</button>}</div>{historyError && <p role="alert">{historyError}</p>}{!notes.length && !historyError && <p className="desire-timeline-empty">{loading ? "Loading…" : "New notes will appear here."}</p>}<ol>{notes.slice(0, expanded ? notes.length : 3).map(item => <li key={item.id}><time>{dateLabel(item.date)}</time><p>{item.note}</p></li>)}</ol></section>
  </div>;
}

/** Read-only home preview: opening Home never records a relationship event. */
export function HomeDesire({ active, apiUrl, headers, onOpen }: {
  active: boolean; apiUrl: (path: string) => string;
  headers: (json?: boolean) => Record<string, string>; onOpen: () => void;
}) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState('Loading…');
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setStatus('Loading…');
    fetch(apiUrl('/api/desire?view=status'), { headers: headers(), cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw Error('Unavailable');
        const result = await response.json() as { data?: unknown };
        const object = unpack(result.data) as Record<string, unknown> | null;
        const state = object?.state ?? object;
        if (!state || typeof state !== 'object' || Array.isArray(state)) throw Error('Unavailable');
        if (!controller.signal.aborted) { setData(state as Record<string, unknown>); setStatus(''); }
      }).catch(() => { if (!controller.signal.aborted) setStatus('Mood unavailable'); });
    return () => controller.abort();
  }, [active, apiUrl, headers]);
  return <section className="home-desire-card">
    <button className="home-card-label" onClick={onOpen}>Desire<span aria-hidden="true">›</span></button>
    <DesireFlower data={data} />
    {status && <small role="status">{status}</small>}
  </section>;
}
