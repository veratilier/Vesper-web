'use client';
import { useEffect, useState } from 'react';
import { nextChatWelcome } from '@/lib/home-desktop';
import { visibleUserContext } from '@/lib/web-chat-context';
export type ContactConversation = { id: string; title: string; updatedAt: string; preview?: string; messageCount: number };
type Match = { id: string; conversationId: string; content: string; role: string; title?: string; createdAt: string };
export function ChatContacts({ active, agentName, avatar, cached, request, onSelect, onNew }: {
  active: boolean; agentName: string; avatar: string; cached: ContactConversation[];
  request: (path: string, signal: AbortSignal) => Promise<Response>;
  onSelect: (id: string, messageId?: string) => void; onNew: () => void;
}) {
  const [rows, setRows] = useState(cached), [query, setQuery] = useState(''), [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState(''), [searching, setSearching] = useState(false), [more, setMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const [welcome, setWelcome] = useState('A place for today, too.');
  useEffect(() => {
    if (!active) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') setWelcome(previous => nextChatWelcome(previous)); };
    refresh(); document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; let loading = false;
    const load = async () => {
      if (loading || controller.signal.aborted || document.visibilityState === 'hidden') return;
      loading = true;
      try {
        const response = await request('/conversations', controller.signal);
        if (!response.ok) throw new Error('Could not refresh conversations.');
        const payload = await response.json() as { conversations?: ContactConversation[] };
        if (!controller.signal.aborted) { setRows(payload.conversations || []); setError(''); }
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'History unavailable.'); }
      finally { loading = false; if (!controller.signal.aborted) timer = setTimeout(load, 20_000); }
    };
    const wake = () => { clearTimeout(timer); void load(); };
    void load(); document.addEventListener('visibilitychange', wake);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', wake); };
  }, [active, request, retry]);
  useEffect(() => {
    const controller = new AbortController(); const q = query.trim();
    setMatches([]); setMore(false); setSearching(Boolean(active && q));
    if (!active || !q) return () => controller.abort();
    const timer = setTimeout(async () => {
      try {
        const response = await request(`/search?q=${encodeURIComponent(q)}`, controller.signal);
        if (!response.ok) throw new Error('Message search unavailable.');
        const payload = await response.json() as { results?: Match[]; hasMore?: boolean };
        if (!controller.signal.aborted) { setMatches(payload.results || []); setMore(Boolean(payload.hasMore)); setError(''); }
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Search unavailable.'); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 300);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, query, request, retry]);
  const filtered = rows.filter(row => `${agentName} ${row.title} ${visibleUserContext(row.preview || '')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const image = <span className="contact-avatar">{avatar ? <img src={avatar} alt="" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 22v-2a8 8 0 0 1 16 0v2" /></svg>}</span>;
  const stamp = (date: string) => Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '';
  return <div className="chat-contacts-page">
    <label className="chat-contact-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></svg><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search messages" aria-label="Search messages" /></label>
    {error && <div className="contact-error" role="status">{error}<button onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    <div className="contact-rows">{filtered.map(row => <button className="chat-contact-row" key={row.id} onClick={() => onSelect(row.id)}>
      {image}<span className="contact-copy"><span><b>{agentName}</b><time>{stamp(row.updatedAt)}</time></span><small>{row.title && row.title !== agentName ? row.title : 'Conversation'}</small><p>{visibleUserContext(row.preview || '') || 'Open conversation'}</p></span>
    </button>)}</div>
    {!rows.length && !query && <div className="contact-empty"><p>No conversations yet.</p><button onClick={onNew}>Start a conversation</button></div>}
    {!query.trim() && <p className="contact-welcome">{welcome}</p>}
    {query.trim() && <section className="contact-search-matches"><h2>Messages</h2>{searching && <p role="status">Searching…</p>}{matches.filter(item => visibleUserContext(item.content).trim()).map(item => <button key={`${item.conversationId}:${item.id}`} className="contact-match" onClick={() => onSelect(item.conversationId, item.id)}><b>{item.title || agentName}</b><p>{visibleUserContext(item.content)}</p><small>{stamp(item.createdAt)}</small></button>)}{!searching && !matches.length && <p>No matching messages.</p>}{more && <p>Showing the 60 most recent matches. Narrow your search to find older messages.</p>}</section>}
  </div>;
}
