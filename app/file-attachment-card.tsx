'use client';
import { useEffect, useRef, useState } from 'react';
type FileItem = { name: string; type: string; size: number; url: string };
export function FileAttachmentCard({ file }: { file: FileItem }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const downloadRequest = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const [prepared, setPrepared] = useState<File | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const html = ['html','htm'].includes(extension);
  const previewable = html || ['md','txt','json','csv','log','xml','yaml','yml'].includes(extension) || file.type.startsWith('text/');
  const size = file.size < 1024 ? `${file.size} B` : file.size < 1048576 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1048576).toFixed(1)} MB`;
  const close = () => { request.current?.abort(); dialog.current?.close(); };
  useEffect(() => {
    setPrepared(null); setDownloadError(''); setDownloading(false);
    return () => { request.current?.abort(); downloadRequest.current?.abort(); };
  }, [file.url]);
  const saveFile = async (value: File) => {
    if (navigator.canShare?.({ files: [value] })) {
      try { await navigator.share({ files: [value] }); }
      catch (reason) {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        setDownloadError("Tap “Save file” again to open the system menu, or download directly.");
      }
    } else downloadBlob(value);
  };
  const downloadBlob = (value: File) => {
    const url = URL.createObjectURL(value);
    const link = document.createElement('a');
    link.href = url; link.download = file.name;
    document.body.appendChild(link); link.click(); link.remove();
    // Safari needs the object URL to remain alive while handing off the file.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const download = async () => {
    if (saving.current) return;
    saving.current = true;
    setDownloadError('');
    const controller = new AbortController(); downloadRequest.current = controller;
    setDownloading(true);
    try {
      // Prepared files share during this click, without another asynchronous fetch.
      if (prepared) { await saveFile(prepared); return; }
      const response = await fetch(file.url, { signal: controller.signal });
      if (!response.ok) throw Error("Could not read the file. Please try again.");
      const bytes = await response.blob();
      if (controller.signal.aborted) return;
      const value = new File([bytes], file.name, { type: file.type || bytes.type || 'application/octet-stream' });
      setPrepared(value);
      if (!navigator.canShare?.({ files: [value] }) || navigator.userActivation?.isActive) await saveFile(value);
      // Slow mobile fetch can consume activation. Keep a ready-to-save button
      // instead of opening an external URL or silently losing the download.
    } catch (reason) {
      if (!controller.signal.aborted) setDownloadError(reason instanceof Error ? reason.message : "Download failed. Please try again.");
    } finally { saving.current = false; if (!controller.signal.aborted) setDownloading(false); }
  };
  const downloadLabel = downloading ? "Loading…" : prepared ? "Save file" : "Download";
  const open = async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setText(''); setError(''); setLoading(true); dialog.current?.showModal();
    try {
      if (file.size > 8 * 1024 * 1024) throw Error("This file is large. Download it to view.");
      const response = await fetch(file.url, { signal: controller.signal });
      if (!response.ok) throw Error("Could not read the file. Try again or download it.");
      const content = await response.text();
      if (!controller.signal.aborted) setText(content);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not read file"); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };
  return <>
    <div className="vesper-file-card">
      <span className="file-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 12l-2 2 2 2M15 12l2 2-2 2M13 11l-2 6"/></svg></span>
      <span className="file-card-details"><b title={file.name}>{file.name}</b><small>{extension.toUpperCase() || 'FILE'} · {size}</small></span>
      <span className="file-card-actions">{previewable && <button type="button" onClick={() => void open()} aria-label={`Open ${file.name}`}>Open</button>}<button type="button" onClick={() => void download()} disabled={downloading} aria-label={`Download ${file.name}`}>{downloadLabel}</button></span>
    </div>
    {downloadError && <p className="file-download-status" role="alert">{downloadError}{prepared && <button type="button" onClick={() => downloadBlob(prepared)}>Download directly</button>}</p>}
    {prepared && navigator.canShare?.({ files: [prepared] }) && !downloadError && <p className="file-download-status">Choose “Save to Files” in the system menu.</p>}
    <dialog ref={dialog} className="file-preview-dialog" onCancel={event => { event.preventDefault(); close(); }}>
      <header><b title={file.name}>{file.name}</b><button type="button" onClick={close} aria-label="Close file preview">×</button></header>
      {loading ? <p role="status">Reading file…</p> : error ? <p role="alert">{error}</p> : html ? <iframe title={file.name} sandbox="" referrerPolicy="no-referrer" srcDoc={text} /> : <pre>{text}</pre>}
      <footer><button type="button" onClick={() => void download()} disabled={downloading}>{downloadLabel}</button>{downloadError && <p role="alert">{downloadError}{prepared && <button type="button" onClick={() => downloadBlob(prepared)}>Download directly</button>}</p>}</footer>
    </dialog>
  </>;
}
