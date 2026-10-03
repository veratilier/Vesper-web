'use client';
import { useEffect, useRef, useState } from 'react';
import { startTerminalFeed } from '@/lib/chat-terminal-feed';
export function ChatLiveTerminal({ conversationId, request, onClose }: {
  conversationId: string; request: (path: string, options?: RequestInit) => Promise<Response>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(true), screenRef = useRef<HTMLPreElement>(null);
  const writes = useRef(new Set<AbortController>());
  const [screen, setScreen] = useState(''), [connected, setConnected] = useState(false), [running, setRunning] = useState(false);
  const [connectionError, setConnectionError] = useState(''), [inputError, setInputError] = useState(''), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const endpoint = `/conversations/${encodeURIComponent(conversationId)}/terminal`;
  const follow = useRef(true);
  useEffect(() => {
    alive.current = true; dialog.current?.showModal();
    return () => { alive.current = false; writes.current.forEach(controller => controller.abort()); dialog.current?.close(); };
  }, []);
  useEffect(() => startTerminalFeed({
    conversationId,
    request: signal => request(endpoint, { signal, cache: 'no-store' }),
    onFrame: payload => { setScreen(payload.screen || ''); setRunning(Boolean(payload.running)); setConnected(true); setConnectionError(''); },
    onError: error => { setConnected(false); setConnectionError(error); },
    onHidden: () => setConnected(false),
  }), [conversationId, endpoint, request, retry]);
  useEffect(() => { if (follow.current && screenRef.current) screenRef.current.scrollTop = screenRef.current.scrollHeight; }, [screen]);
  const perform = async (action: string, body?: Record<string, unknown>, sentDraft?: string) => {
    if (busy) return;
    const controller = new AbortController(); writes.current.add(controller); setBusy(true);
    try {
      const response = await request(endpoint + action, { method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]), body: JSON.stringify(body || {}) });
      const payload = await response.json() as { conversationId?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || `Terminal request failed (${response.status}).`);
      if (payload.conversationId !== conversationId) throw new Error('Terminal acknowledgement does not match this chat.');
      if (alive.current) { setInputError(''); if (sentDraft !== undefined) setDraft(value => value === sentDraft ? '' : value); setRetry(value => value + 1); }
    } catch (reason) { if (alive.current) setInputError(`Not confirmed. Check the live screen before sending again. ${reason instanceof Error ? reason.message : 'Connection failed.'}`); }
    finally { writes.current.delete(controller); if (alive.current) setBusy(false); }
  };
  const send = () => { if (draft && connected && running && !busy) void perform('/input', { text: draft }, draft); };
  const keys = [['Esc', 'Escape'], ['Tab', 'Tab'], ['^C', 'C-c'], ['←', 'Left'], ['↑', 'Up'], ['↓', 'Down'], ['→', 'Right'], ['↵', 'Enter']];
  return <dialog ref={dialog} className="chat-terminal-dialog" onCancel={onClose} onClose={onClose} aria-label="Live chat terminal">
    <header><b>Chat terminal</b><button onClick={onClose} aria-label="Close terminal">Done</button></header>
    <div className="terminal-presence"><i className={connected ? 'live' : ''} /><span>{connected ? running ? 'Live · This chat' : 'No active terminal' : 'Disconnected'}</span><button onClick={() => { setConnectionError(''); setRetry(value => value + 1); }} aria-label="Reconnect terminal">↻</button></div>
    <pre ref={screenRef} className="live-terminal-screen" onScroll={event => { const view = event.currentTarget; follow.current = view.scrollHeight - view.scrollTop - view.clientHeight < 40; }}>{screen || 'Open this chat in the VPS terminal to see its live screen.'}</pre>
    {(connectionError || inputError) && <p className="terminal-error" role="status">{connectionError || inputError}</p>}
    {connected && !running && <button className="terminal-open" disabled={busy} onClick={() => void perform('/start')}>Open this chat in terminal</button>}
    <div className="terminal-keys">{keys.map(([label, key]) => <button key={key} disabled={!connected || !running || busy} onClick={() => void perform('/input', { key })}>{label}</button>)}</div>
    <form onSubmit={event => { event.preventDefault(); send(); }}><input aria-label="Terminal input" maxLength={4096} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Type into VPS terminal…" autoCapitalize="none" autoCorrect="off" spellCheck={false} /><button disabled={!draft || !connected || !running || busy} type="submit">Send</button></form>
    <small>Persistent VPS session · closing this window keeps it running</small>
  </dialog>;
}
