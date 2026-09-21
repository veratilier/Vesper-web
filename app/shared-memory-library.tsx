'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

type Kind = 'episode' | 'preference' | 'agreement' | 'reflection' | 'dream';
type Memory = { id: string; body: string; source: string; kind: Kind; recorded_at: string; occurred_at: string | null; active: number; version: number; versions?: { id: string; version: number; correction_reason: string | null }[] };
const kinds: Kind[] = ['episode', 'preference', 'agreement', 'reflection', 'dream'];
export function SharedMemoryLibrary({ apiUrl, headers, legacy }: { apiUrl: (path: string) => string; headers: (json?: boolean) => Record<string, string>; legacy: ReactNode }) {
  const [old, setOld] = useState(false);
  const [items, setItems] = useState<Memory[]>([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<Kind | ''>('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<Memory | null>(null);
  const request = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(apiUrl('/api/shared-memory?path=' + encodeURIComponent(path)), {
      method: body === undefined ? 'GET' : 'POST', headers: headers(body !== undefined), cache: 'no-store',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Memory is unavailable. Please retry.');
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error || 'Could not load shared memories');
    return data;
  }, [apiUrl, headers]);
  useEffect(() => {
    if (old) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
    setLoading(true); setError('');
    const path = '/api/memories?' + new URLSearchParams({ offset: String(offset), limit: '40', ...(kind ? { kind } : {}) });
    void (search.trim() ? request<{ hits: Memory[]; items?: Memory[]; total?: number }>('/api/search', { query: search.trim(), limit: 20, include_nonfacts: true, ...(kind ? { kind } : {}) }) : request<{ items: Memory[]; total: number; hits?: Memory[] }>(path))
      .then(data => { if (!cancelled) { setItems(data.items || data.hits || []); setTotal(data.total ?? data.hits?.length ?? 0); } })
      .catch(reason => { if (!cancelled) { setItems([]); setError(reason instanceof Error ? reason.message : 'Memory is unavailable'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [request, old, search, kind, offset]);
  const open = async (id: string) => {
    try { setDetail(await request<Memory>('/api/memories/' + encodeURIComponent(id))); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load memory'); }
  };
  return <>
    <nav className="memory-library-tabs" aria-label="Memory libraries">
      <button className={!old ? 'active' : ''} onClick={() => setOld(false)}>Memory</button>
      <button className={old ? 'active' : ''} onClick={() => setOld(true)}>Legacy Vesper memories</button>
    </nav>
    {old ? legacy : <div className="page-body memory-library-page">
      <header className="memory-library-section-head"><div><small>SHARED MEMORY</small><h1>Memory</h1><p>Saved across devices and conversations.</p></div></header>
      <form className="memory-library-tools" onSubmit={event => { event.preventDefault(); setOffset(0); setSearch(query); }}>
        <label><input aria-label="Search shared memories" placeholder="Search memories" value={query} onChange={event => setQuery(event.target.value)} maxLength={1000} /></label>
        <button type="submit">Search</button>
      </form>
      <nav className="memory-library-tabs" aria-label="Memory categories">
        <button className={!kind ? 'active' : ''} onClick={() => { setKind(''); setOffset(0); }}>All</button>
        {kinds.map(value => <button key={value} className={kind === value ? 'active' : ''} onClick={() => { setKind(value); setOffset(0); }}>{value}</button>)}
      </nav>
      {error && <p role="alert" className="memory-library-message">{error}</p>}
      {loading ? <p role="status">Loading memories…</p> : <div className="memory-card-list">{items.map(item => <article className="memory-card" key={item.id} data-memory-id={item.id}>
        <button className="memory-card-open" onClick={() => void open(item.id)}><div className="memory-card-meta"><span>{item.kind}</span><time>{new Date(item.recorded_at).toLocaleDateString()}</time></div><p>{item.body}</p><small>{item.source}</small></button>
      </article>)}{!items.length && !error && <p>No memories found.</p>}</div>}
      {!search && <nav className="memory-library-tabs" aria-label="Memory pages"><button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 40))}>Previous</button><span>{total} memories</span><button disabled={offset + 40 >= total || loading} onClick={() => setOffset(offset + 40)}>Next</button></nav>}
      {search && <p>Showing up to 20 matching records.</p>}
      {detail && <div className="memory-modal-layer"><button className="memory-modal-scrim" aria-label="Close memory" onClick={() => setDetail(null)} /><section className="memory-modal memory-detail-modal" role="dialog" aria-modal="true" aria-label="Shared memory details"><header><h2>{detail.kind}</h2><button onClick={() => setDetail(null)}>Close</button></header><p className="memory-detail-body">{detail.body}</p><p>{detail.source}</p><p>Recorded: {detail.recorded_at}</p><p>Event time: {detail.occurred_at || 'Unknown'}</p><small>Record: {detail.id}</small><section className="memory-revision-list"><h3>Versions</h3>{detail.versions?.map(version => <article key={version.id}><button onClick={() => void open(version.id)}>Version {version.version}</button><span>{version.correction_reason}</span></article>)}</section></section></div>}
    </div>}
  </>;
}
