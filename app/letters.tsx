'use client';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Letter } from '../lib/letter-policy';
import './letters.css';

type Draft = { id: string; title: string; text: string; unlockAt: string; replyTo?: string; attempted: boolean };
type Result = { letter: Letter; letters: Letter[]; before?: string; serverTime?: string; error?: string };
const freshDraft = (): Draft => ({ id: crypto.randomUUID(), title: '', text: '', unlockAt: '', attempted: false });
const date = (value?: string) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
function localDate(value: string) { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function Envelope({ author = 'Vera', title = '' }: { author?: string; title?: string }) {
  return <span className="letter-envelope" aria-hidden="true"><span className="letter-flap"/><span className="letter-inscription">{title}</span><span className="letter-seal">{author.slice(0, 1)}</span></span>;
}
export function Letters({ apiUrl, headers, theme, active }: { apiUrl: (path: string) => string; headers: (json?: boolean) => Record<string, string>; theme: 'white' | 'black' | 'blue'; active: boolean }) {
  const [letters, setLetters] = useState<Letter[]>([]), [draft, setDraft] = useState<Draft | null>(null);
  const [screen, setScreen] = useState('archive'), [filter, setFilter] = useState('All');
  const [opened, setOpened] = useState<Letter | null>(null), [sealed, setSealed] = useState<Letter | null>(null);
  const [hover, setHover] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0), [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [delivered, setDelivered] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const generation = useRef(0), revision = useRef(0), loadSequence = useRef(0), busyRef = useRef(false), storage = useRef(''), offset = useRef(0);
  const held = useRef<ReturnType<typeof setTimeout> | null>(null), pointer = useRef<{ id: string; x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const token = headers()['x-vesper-device-token'];
  const request = useCallback(async (method = 'GET', body?: object, suffix = ''): Promise<Result> => {
    const response = await fetch(apiUrl('/api/letters' + suffix), { method, cache: 'no-store', headers: { ...headers(Boolean(body)), 'x-vesper-device-token': token }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json() as Result;
    if (!response.ok) throw new Error(result.error || 'Could not open the letter box');
    return result;
  }, [apiUrl, headers, token]);
  const load = useCallback(async (before?: string) => {
    const scope = generation.current, seq = ++loadSequence.current, version = revision.current; setLoading(true);
    try {
      const result = await request('GET', undefined, '?' + new URLSearchParams({ limit: '50', ...(before ? { before } : {}) }));
      if (scope !== generation.current || seq !== loadSequence.current || version !== revision.current) return;
      if (result.serverTime) offset.current = Date.parse(result.serverTime) - Date.now();
      setClock(Date.now() + offset.current);
      setLetters(previous => { const all = before ? [...previous, ...result.letters] : result.letters; return all.filter((letter, i) => all.findIndex(l => l.id === letter.id) === i); });
      setCursor(result.before || null); setStatus('');
    } catch (error) { if (scope === generation.current && seq === loadSequence.current) setStatus(error instanceof Error ? error.message : 'Could not load letters'); }
    finally { if (scope === generation.current && seq === loadSequence.current) setLoading(false); }
  }, [request]);
  useEffect(() => {
    const scope = ++generation.current; storage.current = ''; busyRef.current = false;
    setLetters([]); setDraft(null); setOpened(null); setSealed(null); setScreen('archive'); setSelected(null); setHover(null); setPage(0); setStatus(''); setBusy(false);
    void (async () => {
      try {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiUrl('') + '\n' + token));
        if (scope !== generation.current) return;
        storage.current = 'vesper-letter-draft-' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
        const saved = localStorage.getItem(storage.current);
        const parsed = saved ? JSON.parse(saved) as Draft : freshDraft();
        if (typeof parsed.id !== 'string' || typeof parsed.text !== 'string' || typeof parsed.title !== 'string' || typeof parsed.unlockAt !== 'string') throw new Error('Could not restore the saved letter. Clear this draft in browser storage before continuing.');
        setDraft(parsed);
      } catch (error) { if (scope === generation.current) setStatus(error instanceof Error ? error.message : 'Could not restore draft'); }
    })();
    return () => { generation.current++; if (held.current) clearTimeout(held.current); pointer.current = null; };
  }, [apiUrl, token, load]);
  useEffect(() => {
    if (!active || screen !== 'archive' || !draft) return;
    const refresh = () => { if (!document.hidden && !busyRef.current) void load(); };
    refresh();
    const timer = setInterval(refresh, 60000); window.addEventListener('online', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [screen, Boolean(draft), active, load]);
  useEffect(() => { if (sealed && active) dialog.current?.showModal(); else dialog.current?.close(); }, [sealed, active]);
  const upcoming = letters.filter(l => Boolean(l.unlockAt && Date.parse(l.unlockAt) > clock));
  const filed = letters.filter(l => !upcoming.some(u => u.id === l.id) && (filter === 'All' || (filter === 'Unread' ? l.author !== 'Vera' && !l.read : l.kept)));
  const visible = filed.slice(page * 5, page * 5 + 5), chosen = visible.find(l => l.id === selected);
  useEffect(() => { if (page * 5 >= filed.length) { setPage(0); setSelected(null); setHover(null); } }, [page, filed.length]);
  function persist(next: Draft) {
    if (!storage.current) throw new Error('Wait for the letter box to connect.');
    localStorage.setItem(storage.current, JSON.stringify(next)); setDraft(next);
  }
  function edit(change: Partial<Draft>) {
    if (!draft || draft.attempted) return;
    try { persist({ ...draft, ...change }); setStatus(''); } catch { setStatus('Could not save your draft. Check browser storage and try again.'); }
  }
  function replace(letter: Letter) { revision.current++; setLetters(previous => previous.some(l => l.id === letter.id) ? previous.map(l => l.id === letter.id ? letter : l) : [letter, ...previous]); }
  async function mark(letter: Letter, action: 'read' | 'keep') {
    if (busyRef.current) return;
    const scope = generation.current; busyRef.current = true; setBusy(true);
    try {
      const result = await request('PATCH', { id: letter.id, action, ...(action === 'keep' ? { kept: !letter.kept } : {}) });
      if (scope !== generation.current) return;
      if (action === 'read' && (result.letter.locked || typeof result.letter.text !== 'string')) throw new Error('This letter is still sealed.');
      replace(result.letter); setOpened(result.letter); setStatus(''); if (action === 'read') setScreen('read');
    } catch (error) { if (scope === generation.current) setStatus(error instanceof Error ? error.message : 'Could not open this letter'); }
    finally { if (scope === generation.current) { busyRef.current = false; setBusy(false); } }
  }
  async function post() {
    if (!draft || !draft.text.trim() || busyRef.current) return;
    const scope = generation.current; busyRef.current = true; setBusy(true);
    try {
      const sealedDraft = { ...draft, attempted: true }; persist(sealedDraft);
      const result = await request('POST', { id: draft.id, title: draft.title.trim(), text: draft.text.trim(), ...(draft.unlockAt ? { unlockAt: draft.unlockAt } : {}), ...(draft.replyTo ? { replyTo: draft.replyTo } : {}) });
      if (scope !== generation.current) return;
      if (result.letter.id !== draft.id) throw new Error('Letter delivery was not confirmed.');
      replace(result.letter); setDelivered(true); setStatus('');
      try { persist(freshDraft()); } catch { setDraft(freshDraft()); setStatus('Sent. Could not clear the saved draft.'); }
    } catch (error) { if (scope === generation.current) setStatus(error instanceof Error ? error.message : 'Could not deliver the letter'); }
    finally { if (scope === generation.current) { busyRef.current = false; setBusy(false); } }
  }
  function stop() { if (held.current) clearTimeout(held.current); held.current = null; pointer.current = null; setHover(null); }
  function sweep(event: PointerEvent<HTMLDivElement>) {
    if (!visible.length) return;
    const rect = event.currentTarget.getBoundingClientRect(); const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const slot = Math.max(0, Math.min(visible.length - 1, Math.round((130 - y) / 15))), id = visible[slot].id;
    const previous = pointer.current;
    if (previous?.id === id && Math.hypot(x - previous.x, y - previous.y) <= 7) return;
    if (held.current) clearTimeout(held.current);
    if (previous?.id !== id) setSelected(null);
    pointer.current = { id, x, y }; setHover(id);
    held.current = setTimeout(() => { if (pointer.current?.id === id) setSelected(id); }, 500);
  }
  const title = screen === 'compose' ? 'Write a letter' : screen === 'read' ? 'From ' + opened?.author : 'Letters';
  return <section className="vesper-letters page-body" data-letter-theme={theme}>
    <header className="letters-heading"><button aria-label={screen === 'archive' ? 'Refresh letters' : 'Back to letters'} disabled={busy} onClick={() => { if (screen === 'archive') void load(); else { setScreen('archive'); setDelivered(false); } }}>{screen === 'archive' ? '↻' : '‹'}</button><h1>{title}</h1>{screen === 'archive' ? <button disabled={!draft} onClick={() => setScreen('compose')}>Write</button> : screen === 'compose' ? <button onClick={() => { setStatus('Draft saved'); setScreen('archive'); }}>Save draft</button> : <span/>}</header>
    {status && <p className="letters-status" role="status">{status}</p>}
    {screen === 'archive' && <>
      <nav className="letter-filters" aria-label="Filter letters">{['All', 'Unread', 'Kept'].map(name => <button key={name} aria-pressed={filter === name} onClick={() => { stop(); setFilter(name); setPage(0); setSelected(null); }}>{name}</button>)}</nav>
      {upcoming.length > 0 && <section className="letters-upcoming"><h2>Upcoming</h2><div>{upcoming.map(letter => <button key={letter.id} onClick={() => setSealed(letter)}><Envelope author={letter.author}/><span><b>{letter.title || 'A letter for you'}</b><small>Opens {date(letter.unlockAt)}</small></span><span aria-label="Sealed">♙</span></button>)}</div></section>}
      <div className="letters-section-label"><h2>Your letters</h2><small>{filed.length}</small></div>
      <div className="letters-box" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); sweep(event); }} onPointerMove={event => { if (event.buttons || event.pointerType === 'mouse') sweep(event); }} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) stop(); }} onContextMenu={event => event.preventDefault()}>
        <span className="letter-box-back"/>
        {visible.map((letter, slot) => <button key={letter.id} className={'letter-file' + (hover === letter.id || selected === letter.id ? ' raised' : '')} style={{ top: 140 - slot * 15 - (selected === letter.id ? 64 : hover === letter.id ? 42 : 0), left: `calc(8% + ${slot * 4}px)`, zIndex: 90 - slot }} aria-label={(letter.title || 'Letter') + ', ' + letter.author} aria-pressed={selected === letter.id} onClick={event => { if (event.detail === 0) { stop(); setSelected(letter.id); } }}><span className="letter-date-tab">{new Date(letter.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><Envelope author={letter.author} title={letter.title || 'A letter from ' + letter.author}/></button>)}
        <span className="letter-box-side"/><span className="letter-box-front"><i>RV</i><small>LETTERS TO KEEP</small></span>
      </div>
      {chosen ? <div className="letter-selected"><h2>{chosen.title || 'A letter from ' + chosen.author}</h2><small>{chosen.author} · {date(chosen.createdAt)}</small><button className="letter-primary" disabled={busy} onClick={() => void mark(chosen, 'read')}>Open letter</button></div> : <p className="letters-hint">{loading ? 'Opening the letter box…' : filed.length ? 'Brush across the letters. Hold one to choose.' : 'Letters will find their place here.'}</p>}
      {filed.length > 5 && <nav className="letter-pages" aria-label="Letter box pages"><button disabled={!page} onClick={() => { stop(); setSelected(null); setPage(page - 1); }}>Previous</button><small>{page + 1} / {Math.ceil(filed.length / 5)}</small><button disabled={(page + 1) * 5 >= filed.length} onClick={() => { stop(); setSelected(null); setPage(page + 1); }}>Next</button></nav>}
      {cursor && <button className="letters-more" disabled={loading} onClick={() => void load(cursor)}>Load earlier letters</button>}
    </>}
    {screen === 'compose' && draft && <><div className="letter-to">To　Rowan</div><div className="letter-paper"><input aria-label="Letter title" placeholder="A title, if you like" maxLength={120} value={draft.title} disabled={draft.attempted} onChange={event => edit({ title: event.target.value })}/><p>Dear Rowan,</p><textarea aria-label="Letter body" placeholder="Today, a little thought…" maxLength={12000} value={draft.text} disabled={draft.attempted} onChange={event => edit({ text: event.target.value })}/><div className="letter-signature">Vera</div></div><label className="letter-schedule"><span>Open on a date</span><input type="checkbox" checked={Boolean(draft.unlockAt)} disabled={draft.attempted} onChange={event => edit({ unlockAt: event.target.checked ? new Date(Date.now() + 86400000).toISOString() : '' })}/></label>{draft.unlockAt && <label className="letter-schedule"><span>Opens</span><input aria-label="Letter opening date" type="datetime-local" value={localDate(draft.unlockAt)} disabled={draft.attempted} onChange={event => { if (event.target.value) edit({ unlockAt: new Date(event.target.value).toISOString() }); }}/></label>}{draft.attempted && <p className="letters-hint">Delivery has been attempted. Retry the same sealed letter to confirm it.</p>}<button className="letter-primary" disabled={!draft.text.trim()} onClick={() => { setDelivered(false); setScreen('post'); }}>{draft.attempted ? 'Retry delivery' : 'Seal & send'}</button></>}
    {screen === 'post' && <div className={'letters-posting' + (delivered ? ' delivered' : '')}><div className="letter-postbox"><span className="postbox-crown"/><span className="postbox-dome"/><span className="postbox-name">LETTERS</span><span className="postbox-slot"/><span className="postbox-door"/><span className="postbox-monogram">RV</span><span className="postbox-key">⌕</span><span className="postbox-rim"/><span className="postbox-stem"/><span className="postbox-foot"/></div><div className="letter-posting-envelope"><Envelope/></div><h2>{delivered ? 'Delivered' : 'Ready for delivery'}</h2><div className="letter-ornament">✧</div><button className="letter-primary" disabled={busy} onClick={() => { if (delivered) { setScreen('archive'); setDelivered(false); } else void post(); }}>{delivered ? 'Back to Letters' : busy ? 'Posting…' : 'Post letter'}</button>{!delivered && <button className="letters-more" disabled={busy || draft?.attempted} onClick={() => setScreen('compose')}>Edit letter</button>}</div>}
    {screen === 'read' && opened && <><article className="letter-paper"><h2>{opened.title || 'A letter for you'}</h2><small>{date(opened.createdAt)}</small><hr/><p>Dear {opened.recipient || (opened.author === 'Vera' ? 'Rowan' : 'Vera')},</p><div className="letter-body">{opened.text}</div><div className="letter-signature">{opened.author}</div></article><div className="letter-read-actions"><button className="letter-primary" disabled={busy || !draft} onClick={() => { if (!draft) return; if (draft.text || draft.attempted) { setStatus('Finish your existing draft before starting a reply.'); return; } try { persist({ ...freshDraft(), title: 'Re: ' + opened.title, replyTo: opened.id }); setScreen('compose'); } catch { setStatus('Could not save your reply draft.'); } }}>Reply</button><button disabled={busy} onClick={() => void mark(opened, 'keep')}>{opened.kept ? 'Kept' : 'Keep'}</button></div></>}
    <dialog ref={dialog} className="letter-sealed-dialog" aria-label="Sealed letter" onCancel={() => setSealed(null)} onClick={event => { if (event.target === event.currentTarget) setSealed(null); }}>{sealed && <div><Envelope author={sealed.author}/><h2>{sealed.title || 'A letter for you'}</h2><p>Opens {date(sealed.unlockAt)}</p>{!sealed.locked && <button className="letter-primary" onClick={() => { setSealed(null); void mark(sealed, 'read'); }}>Read your copy</button>}<button autoFocus className="letters-more" onClick={() => setSealed(null)}>Back to Letters</button></div>}</dialog>
  </section>;
}
