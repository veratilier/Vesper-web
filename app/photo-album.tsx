'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlbumPhoto } from '../lib/photo-album';
import { AttachmentGallery } from './attachment-gallery';
import './photo-album.css';
type Result = { photos: AlbumPhoto[]; categories: string[]; nextOffset: number | null };
// Older captions contain both sections. Keep only the evaluation in the album UI.
function evaluation(caption: string) {
  const marker = /(?:^|\n)\s*(?:\*\*)?评价\s*[：:]\s*(?:\*\*)?/.exec(caption);
  if (marker) return caption.slice(marker.index + marker[0].length).trim();
  return /^\s*(?:\*\*)?概述\s*[：:]/.test(caption) ? '' : caption.trim();
}
export function PhotoAlbum({ apiUrl, headers, active }: { active: boolean; apiUrl: (path: string) => string; headers: (json?: boolean) => Record<string, string> }) {
  const [result, setResult] = useState<Result>({ photos: [], categories: [], nextOffset: null });
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('');
  const [search, setSearch] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [editing, setEditing] = useState<AlbumPhoto | null>(null);
  const input = useRef<HTMLInputElement>(null), generation = useRef(0);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const categoriesDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (categoriesOpen) categoriesDialog.current?.showModal(); else categoriesDialog.current?.close(); }, [categoriesOpen]);
  const editor = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (editing) editor.current?.showModal(); else editor.current?.close(); }, [editing?.id]);
  const load = useCallback(async (offset = 0) => {
    const id = ++generation.current; setBusy(true);
    try {
      const response = await fetch(apiUrl('/api/photos?' + new URLSearchParams({ query: search, category: filter, offset: String(offset) })), { headers: headers(), cache: 'no-store' });
      const data = await response.json() as Result & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load album");
      if (id === generation.current) { setResult(previous => ({ ...data, photos: offset ? [...previous.photos, ...data.photos] : data.photos })); setMessage(''); }
    } catch (e) { if (id === generation.current) setMessage(e instanceof Error ? e.message : "Could not load"); }
    finally { if (id === generation.current) setBusy(false); }
  }, [apiUrl, headers, search, filter]);
  useEffect(() => {
    if (!active) return;
    const retry = () => { void load(); };
    retry();
    window.addEventListener('online', retry);
    return () => { generation.current++; window.removeEventListener('online', retry); };
  }, [load, active]);
  async function save(key: string, category: string, caption: string) {
    const response = await fetch(apiUrl('/api/photos'), { method: 'POST', headers: headers(true), body: JSON.stringify({ key, category, caption }) });
    const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error || "Save failed");
  }
  async function importPhotos(files: File[]) {
    setBusy(true); let saved = 0;
    try {
      for (const file of files) {
        if (!/^image\/(png|jpeg|gif|webp|avif|heic|heif)$/i.test(file.type)) throw new Error("Choose a supported image file.");
        if (file.size > 32 * 1024 * 1024) throw new Error("Each photo must be under 32 MB.");
        const body = new FormData(); body.set('file', file);
        const response = await fetch(apiUrl('/api/media'), { method: 'POST', headers: headers(), body });
        const data = await response.json() as { key: string; error?: string }; if (!response.ok) throw new Error(data.error || "Upload failed");
        await save(data.key, filter || '未分类', ''); saved++;
      }
      await load();
    } catch (e) { await load(); setMessage(`Saved ${saved} photos. ${e instanceof Error ? e.message : "Import failed"}`); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return <section className="page-body album-page">
    <small className="album-eyebrow">KEEPSAKES</small>
    <div className="album-heading"><h1>Album</h1><button type="button" aria-label="Open album categories" aria-haspopup="dialog" onClick={() => setCategoriesOpen(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 9h18"/></svg><span>Category</span></button></div>
    <p className="album-intro">Keep the photos you want to return to.</p>
    {filter && <div className="album-current-category"><button type="button" onClick={() => setFilter('')}>All albums</button><span> / {filter}</span></div>}
    <form className="album-toolbar" onSubmit={e => { e.preventDefault(); setSearch(query); }}>
      <input aria-label="Search photos" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search photos, comments or categories" />
      <button disabled={busy}>Search</button>
      <button type="button" disabled={busy} onClick={() => input.current?.click()}>＋ Import</button>
      <input ref={input} hidden type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/heic,image/heif" onChange={e => { if (e.target.files?.length) void importPhotos(Array.from(e.target.files)); }} />
    </form>

    <p role="status">{message || (busy ? "Organizing photos…" : '')}</p>
    {message && !busy && <button type="button" onClick={() => void load()}>Reload album</button>}
    {!busy && !message && !result.photos.length && <p className="album-empty">No photos yet. Import some, or share a photo in chat that you would like to keep.</p>}
    <div className="album-grid">{result.photos.map(photo => <article key={photo.id}><AttachmentGallery items={[photo]} renderDetail={() => <><p className="album-evaluation">{evaluation(photo.caption) || "No comment yet."}</p><div className="album-detail-actions"><span>{photo.category === "未分类" ? "Uncategorized" : photo.category}</span><button type="button" onClick={() => { setMessage(''); setEditing({ ...photo, caption: evaluation(photo.caption) }); }}>Edit</button></div></>} /></article>)}</div>
    {result.nextOffset !== null && <button type="button" disabled={busy} onClick={() => void load(result.nextOffset!)}>More photos</button>}
    <dialog ref={editor} className="album-editor-dialog" aria-label="Edit photo" onCancel={() => setEditing(null)} onClick={e => { if (e.target === e.currentTarget) setEditing(null); }}>{editing && <form className="album-edit" aria-label="Edit photo" onSubmit={async e => {
      e.preventDefault(); setBusy(true);
      try { await save(editing.key, editing.category, editing.caption); setEditing(null); await load(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); } finally { setBusy(false); }
    }}><h2 tabIndex={-1} autoFocus>Leave a note</h2><label>Category<input maxLength={60} required value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })} /></label><label>Comment<textarea rows={6} maxLength={500} value={editing.caption} onChange={e => setEditing({ ...editing, caption: e.target.value })} /></label><p role="alert">{message}</p><button disabled={busy}>Save</button><button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button></form>}</dialog>
    <dialog ref={categoriesDialog} className="album-categories-dialog" aria-labelledby="album-categories-title" onCancel={() => setCategoriesOpen(false)} onClick={e => { if (e.target === e.currentTarget) setCategoriesOpen(false); }}>
      <div className="album-category-content"><div className="album-heading"><h2 id="album-categories-title">Albums</h2><button type="button" autoFocus aria-label="Close categories" onClick={() => setCategoriesOpen(false)}>×</button></div>
      <nav aria-label="Albums">{['', ...result.categories].map(category => <button key={category} type="button" aria-current={filter === category ? 'page' : undefined} onClick={() => { setFilter(category); setCategoriesOpen(false); }}><span>{category === "未分类" ? "Uncategorized" : category || "All photos"}</span><span aria-hidden="true">›</span></button>)}</nav></div>
    </dialog>
  </section>;
}
