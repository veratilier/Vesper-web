'use client';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { parseSubtitles, watchContext, type SubtitleCue, type WatchFrame } from './watch-context';
import './watch-player.css';
export function WatchPlayer({ active, busy, captureRef, onShare }: {
  active: boolean; busy: boolean;
  captureRef: MutableRefObject<(() => Promise<WatchFrame | null>) | null>;
  onShare: (frame: WatchFrame) => Promise<void>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const objectUrl = useRef('');
  const session = useRef(0);
  const alive = useRef(true);
  const capturing = useRef(false);
  const [source, setSource] = useState('');
  const [link, setLink] = useState('');
  const [importing, setImporting] = useState(false);
  const [remote, setRemote] = useState(false);
  const [job, setJob] = useState('');
  const [pollRetry, setPollRetry] = useState(0);
  const watchBase = 'https://codex.r-vera.com/history';
  async function watchRequest(path: string, url?: string) {
    const response = await fetch(`${watchBase}${path}`, {
      method: url ? 'POST' : 'GET', cache: 'no-store',
      headers: { authorization: `Bearer ${localStorage.getItem('vesper-device-token') || ''}`, ...(url ? { 'content-type': 'application/json' } : {}) },
      ...(url ? { body: JSON.stringify({ url }) } : {}), signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) throw new Error("Video import is not installed on the server. Deploy the VPS update first.");
    if (response.status === 401) throw new Error("Connect your Codex service in Settings first.");
    const data = await response.json() as { id: string; status: string; streamPath?: string; title: string; subtitleText?: string; cues?: SubtitleCue[]; error?: string };
    if (!response.ok) throw new Error(data.error || "Video import failed.");
    return data;
  }
  useEffect(() => { setJob(sessionStorage.getItem('vesper-watch-job') || ''); }, []);
  useEffect(() => {
    if (!job || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await watchRequest(`/watch/${job}`);
        if (cancelled) return;
        if (data.status === 'ready') {
          if (typeof data.streamPath !== 'string' || !data.streamPath.startsWith(`/watch/${job}/stream?`)) throw new Error("Invalid playback URL.");
          release(); setScreen(false); setRemote(true); setAutomatic(false);
          setSource(watchBase + data.streamPath); setTitle(data.title);
          setCues(data.subtitleText ? parseSubtitles(data.subtitleText) : data.cues || []);
          setJob(''); setImporting(false); sessionStorage.removeItem('vesper-watch-job');
        } else if (data.status === 'failed') {
          setJob(''); sessionStorage.removeItem('vesper-watch-job');
          throw new Error(data.error || "Video preparation failed.");
        } else { setImporting(true); timer = setTimeout(poll, 3000); }
      } catch (reason) {
        if (!cancelled) { setError(reason instanceof Error ? reason.message : "Could not check video status."); setImporting(false); }
      }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [job, active, pollRetry]);
  async function importLink() {
    if (importing) return;
    setImporting(true); setError('');
    try {
      const data = await watchRequest('/watch', link.trim());
      if (!alive.current) return;
      sessionStorage.setItem('vesper-watch-job', data.id); setJob(data.id);
    } catch (reason) { if (alive.current) { setError(reason instanceof Error ? reason.message : "Import failed."); setImporting(false); } }
  }
  const [screen, setScreen] = useState(false);
  const [title, setTitle] = useState('');
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [automatic, setAutomatic] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const [canShareScreen, setCanShareScreen] = useState(false);
  useEffect(() => { setCanShareScreen(Boolean(navigator.mediaDevices?.getDisplayMedia)); }, []);
  const release = useCallback(() => {
    session.current++;
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    stream.current = null;
    if (video.current) { video.current.pause(); video.current.srcObject = null; }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = '';
  }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; release(); }; }, [release]);
  useEffect(() => {
    if (!active) {
      session.current++;
      setAutomatic(false);
      if (stream.current) { release(); setScreen(false); setSource(''); }
      else video.current?.pause();
    }
  }, [active, release]);
  useEffect(() => {
    const hide = () => { if (document.hidden) { session.current++; setAutomatic(false); video.current?.pause(); if (stream.current) { release(); setScreen(false); setSource(''); } } };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [release]);
  useEffect(() => {
    if (screen && stream.current && video.current) {
      video.current.srcObject = stream.current;
      void video.current.play().catch(() => setError("Could not play the shared preview. Stop and share again."));
    }
  }, [screen, source]);
  function chooseVideo(file?: File) {
    if (!file) return;
    setJob(''); sessionStorage.removeItem('vesper-watch-job'); setImporting(false); setRemote(false);
    release(); setAutomatic(false); setCues([]); setError(''); setScreen(false);
    objectUrl.current = URL.createObjectURL(file);
    setSource(objectUrl.current); setTitle(file.name);
  }
  async function shareScreen() {
    setError('');
    const request = session.current;
    try {
      const media = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (!alive.current || request !== session.current || !active || document.hidden) { media.getTracks().forEach(track => track.stop()); return; }
      setJob(''); sessionStorage.removeItem('vesper-watch-job'); setImporting(false); setRemote(false);
      release(); stream.current = media; setSource(`screen:${session.current}`); setScreen(true); setTitle("Shared movie window"); setCues([]); setAutomatic(false);
      media.getVideoTracks()[0].onended = () => { release(); setScreen(false); setSource(''); setAutomatic(false); };
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "Could not share the screen. Select a local video instead."); }
  }
  const capture = useCallback(async (): Promise<WatchFrame | null> => {
    const element = video.current;
    if (!active || document.hidden || (!source && !stream.current)) return null;
    if (!element || element.readyState < 2 || !element.videoWidth) throw new Error("The frame is not ready. Play the video and try again.");
    const currentSession = session.current;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(1280, element.videoWidth);
    canvas.height = Math.max(1, Math.round(element.videoHeight * canvas.width / element.videoWidth));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("This browser cannot read the frame.");
    ctx.drawImage(element, 0, 0, canvas.width, canvas.height);
    const context = watchContext(title, element.currentTime, cues, Boolean(stream.current));
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .8));
    if (!alive.current || currentSession !== session.current || document.hidden) return null;
    if (!blob) throw new Error("Could not capture a frame. Resume playback and try again.");
    return { file: new File([blob], `watch-${Date.now()}.jpg`, { type: 'image/jpeg' }), context };
  }, [active, source, title, cues]);
  useEffect(() => { captureRef.current = capture; return () => { captureRef.current = null; }; }, [capture, captureRef]);
  async function share(auto = false) {
    if (busy || capturing.current || !active) return;
    capturing.current = true; setSharing(true); setError('');
    try { const frame = await capture(); if (frame) await onShare({ ...frame, automatic: auto }); }
    catch (reason) { setAutomatic(false); setError(reason instanceof Error ? reason.message : "Sharing failed. Please try again."); }
    finally { capturing.current = false; if (alive.current) setSharing(false); }
  }
  const shareRef = useRef(share); shareRef.current = share;
  useEffect(() => {
    if (!automatic || !active) return;
    const timer = setInterval(() => { if (!document.hidden && video.current && !video.current.paused) void shareRef.current(true); }, 30_000);
    return () => clearInterval(timer);
  }, [automatic, active]);
  return <section className="watch-player" aria-label="Cinema player">
    <video crossOrigin="anonymous" ref={video} src={screen ? undefined : source || undefined} controls={!screen} muted={screen} playsInline preload="metadata" onError={() => setError("Cannot play this video. Try a browser-compatible MP4.")} />
    <form className="watch-import" onSubmit={event => { event.preventDefault(); void importLink(); }}>
      <input aria-label="Bilibili video URL" type="url" placeholder="Paste a full Bilibili video or episode URL" value={link} onChange={event => setLink(event.target.value)} required disabled={importing} />
      <button type="submit" disabled={importing || !link.trim()}>{importing ? "Preparing video…" : "Import Bilibili video"}</button>
    </form>
    {job && !importing && <button type="button" onClick={() => { setError(''); setImporting(true); setPollRetry(value => value + 1); }}>Check preparation status</button>}
    {importing && <p className="watch-player-note" role="status">The server is preparing the video. Longer videos take time; you can return later.</p>}
    <div className="watch-player-actions">
      <label className="watch-file-button">Choose video<input type="file" accept="video/*" onChange={event => { chooseVideo(event.target.files?.[0]); event.target.value = ''; }} /></label>
      {canShareScreen && <button type="button" onClick={() => void shareScreen()}>Share movie window</button>}
      {screen && <button type="button" onClick={() => { release(); setScreen(false); setSource(''); setAutomatic(false); }}>Stop sharing</button>}
      <label className="watch-file-button">Import subtitles<input type="file" accept=".srt,.vtt" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        if (file.size > 2 * 1024 * 1024) { setError("Subtitle files must be under 2 MB."); return; }
        const currentSession = session.current;
        try { const parsed = parseSubtitles(await file.text()); if (currentSession !== session.current || !alive.current) return; setCues(parsed); setError(parsed.length ? '' : "No subtitles found. Choose an SRT or VTT file."); }
        catch { setError("Could not read subtitles. Select the file again."); }
      }} /></label>
      <button type="button" disabled={busy || sharing || (!source && !screen)} onClick={() => void share()}>Share this moment</button>
      <label className="watch-auto"><input type="checkbox" checked={automatic} disabled={!source && !screen} onChange={event => setAutomatic(event.target.checked)} />Share a frame every 30 seconds</label>
    </div>
    <p className="watch-player-note">{title || "Select a local video to watch and chat here."}{cues.length ? ` · ${cues.length} subtitles loaded` : ''}</p>
    <p className="watch-player-note">Messages include the current frame and progress; {remote ? "Bilibili videos are cached temporarily on the server. Only frames and matching subtitles are sent to the AI." : "Local videos stay on this device. Only frames and matching subtitles are sent."}movie audio is not shared.{!canShareScreen ? "Use the in-page video player in this browser." : ''}</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
