'use client';
import { type ReactNode, type PointerEvent, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
export type GalleryAttachment = { key: string; url: string; name: string; type: string; size: number };
export function AttachmentGallery({ items, onSaveAsSticker, renderDetail }: { renderDetail?: (item: GalleryAttachment) => ReactNode; items: GalleryAttachment[]; onSaveAsSticker?: (item: GalleryAttachment) => void }) {
  const [index, setIndex] = useState(0);
  const [retry, setRetry] = useState(0);
  const [retriedUrls, setRetriedUrls] = useState<Record<string, string>>({});
  const retryBlobs = useRef(new Map<string, string>());
  useEffect(() => () => { retryBlobs.current.forEach(url => URL.revokeObjectURL(url)); retryBlobs.current.clear(); }, []);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const preloadUrls = JSON.stringify(items.length ? [0, 1, -1].map(offset => items[(Math.min(index, items.length - 1) + offset + items.length) % items.length].url) : []);
  useEffect(() => {
    const previews = (JSON.parse(preloadUrls) as string[]).map(url => { const image = new Image(); image.src = url; return image; });
    return () => { previews.forEach(image => { image.onload = null; }); };
  }, [preloadUrls]);
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLButtonElement>(null);
  const underCard = useRef<HTMLImageElement>(null);
  const underAnimation = useRef<Animation | null>(null);
  const start = useRef<{ x: number; y: number; time: number; id: number; axis: 'x' | 'y' | null } | null>(null);
  const swiped = useRef(false);
  const animation = useRef<Animation | null>(null);
  const busy = useRef(false);
  const [drag, setDrag] = useState(0);
  const [direction, setDirection] = useState(1);
  const active = Math.min(index, items.length - 1);
  useEffect(() => () => { animation.current?.cancel(); underAnimation.current?.cancel(); }, []);
  const settle = (by: number) => {
    const element = card.current;
    if (!element || busy.current) return;
    busy.current = true;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = by ? -by * (element.offsetWidth + 48) : 0;
    const timing = { duration: reduced ? 0 : by ? 230 : 280, easing: 'cubic-bezier(.22,.8,.25,1)' };
    if (underCard.current) underAnimation.current = underCard.current.animate([
      { transform: getComputedStyle(underCard.current).transform },
      { transform: by ? 'rotate(0deg) translate(0px, 0px)' : 'rotate(-4deg) translate(-3px, -3px)' },
    ], { ...timing, fill: 'forwards' });
    const motion = element.animate([
      { transform: element.style.transform || 'translateX(0) rotate(0deg)', opacity: 1 },
      { transform: `translateX(${target}px) rotate(${by ? -by * 12 : 0}deg)`, opacity: by ? 0 : 1 },
    ], { ...timing, fill: 'forwards' });
    animation.current = motion;
    motion.onfinish = () => {
      flushSync(() => {
        if (by) setIndex(i => (i + by + items.length) % items.length);
        setDrag(0);
      });
      motion.cancel();
      underAnimation.current?.cancel();
      underAnimation.current = null;
      busy.current = false;
      animation.current = null;
    };
  };
  const move = (by: number) => {
    if (busy.current || start.current) return;
    if (dialog.current?.open) { setIndex(i => (i + by + items.length) % items.length); return; }
    setDirection(by);
    // Let the under-card render in the chosen direction before sliding the top one.
    requestAnimationFrame(() => settle(by));
  };
  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (items.length < 2 || busy.current || !event.isPrimary || event.button !== 0) return;
    swiped.current = false;
    start.current = { x: event.clientX, y: event.clientY, time: event.timeStamp, id: event.pointerId, axis: null };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = start.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 6) gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (gesture.axis !== 'x') return;
    swiped.current = true;
    setDirection(dx < 0 ? 1 : -1);
    setDrag(dx);
  };
  const pointerEnd = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const gesture = start.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    start.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (gesture.axis !== 'x') return;
    const dx = event.clientX - gesture.x;
    const speed = Math.abs(dx) / Math.max(1, event.timeStamp - gesture.time);
    const threshold = Math.min(80, event.currentTarget.offsetWidth * .25);
    const advance = !cancelled && (Math.abs(dx) > threshold || (Math.abs(dx) > 16 && speed > .5));
    settle(advance ? (dx < 0 ? 1 : -1) : 0);
  };
  if (!items.length) return null;
  const item = items[active];
  const retryImage = async () => {
    setFailed(current => ({ ...current, [item.url]: false }));
    // A fresh blob avoids the browser's failed-image cache; original links stay intact.
    try {
      const response = await fetch(item.url, { cache: 'reload' });
      if (!response.ok) throw new Error('Image unavailable');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const previous = retryBlobs.current.get(item.url);
      if (previous) URL.revokeObjectURL(previous);
      retryBlobs.current.set(item.url, url);
      setRetriedUrls(current => ({ ...current, [item.url]: url }));
      setRetry(value => value + 1);
    } catch { setFailed(current => ({ ...current, [item.url]: true })); }
  };
  const imageLoaded = () => setFailed(current => current[item.url] ? { ...current, [item.url]: false } : current);
  const imageFailed = () => setFailed(current => current[item.url] ? current : { ...current, [item.url]: true });
  return <div className="attachment-gallery">
    <div className={items.length > 1 ? 'photo-stack' : 'single-photo'}>
      {items.length > 1 && [2, 1].filter(n => n < items.length).map(n => {
        const behind = items[(active + direction * n + items.length) % items.length];
        const progress = Math.min(1, Math.abs(drag) / Math.max(1, card.current?.offsetWidth || 274));
        return <img ref={n === 1 ? underCard : undefined} style={n === 1 ? { transform: `rotate(${-4 * (1 - progress)}deg) translate(${-3 * (1 - progress)}px, ${-3 * (1 - progress)}px)` } : undefined} className={`stack-under stack-under-${n}`} key={n} src={retriedUrls[behind.url] || behind.url} alt="" loading="eager" aria-hidden="true" draggable={false} />;
      })}
      <button ref={card} className="photo-open" type="button"
        style={items.length > 1 ? { transform: `translateX(${drag}px) rotate(${Math.max(-12, Math.min(12, drag / 24))}deg)` } : undefined}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => pointerEnd(event)} onPointerCancel={event => pointerEnd(event, true)}
        onLostPointerCapture={event => { if (start.current) pointerEnd(event, true); }}
        onClick={() => { if (!swiped.current && !busy.current) dialog.current?.showModal(); swiped.current = false; }}
        aria-label={`View image ${active + 1}/${items.length}: ${item.name}`}><img key={`${item.key}:${retry}`} src={retriedUrls[item.url] || item.url} alt={item.name} loading="eager" draggable={false} onLoad={imageLoaded} onError={imageFailed} /></button>
    </div>
    {failed[item.url] && <button type="button" onClick={retryImage}>Image could not load. Open the original or try again.</button>}
    {items.length > 1 && <div className="gallery-controls"><button type="button" aria-label="Previous image" onClick={() => move(-1)}>‹</button><button type="button" onClick={() => dialog.current?.showModal()} aria-label="Open all images">{active + 1} / {items.length}</button><button type="button" aria-label="Next image" onClick={() => move(1)}>›</button></div>}
    <dialog className={`gallery-dialog${renderDetail ? " album-viewer" : ""}`} ref={dialog} onClick={e => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <header><span>{active + 1} / {items.length}</span><a href={item.url} download={item.name} target="_blank" rel="noreferrer">Open original</a><button autoFocus type="button" aria-label="Close image" onClick={() => dialog.current?.close()}>×</button></header>
      {onSaveAsSticker && <button className="save-as-sticker" type="button" onClick={() => onSaveAsSticker(item)}>Save as sticker</button>}
      <img key={`${item.key}:${retry}`} className="gallery-full-image" src={retriedUrls[item.url] || item.url} alt={item.name} onLoad={imageLoaded} onError={imageFailed} />
      {failed[item.url] && <button type="button" onClick={retryImage}>Reload original</button>}
      {renderDetail && <div className="album-photo-detail">{renderDetail(item)}</div>}
      <nav aria-label="Image gallery">{items.map((image, i) => <button type="button" key={image.key} aria-label={`Image ${i + 1}`} aria-current={active === i ? 'true' : undefined} onClick={() => setIndex(i)}><img src={image.url} alt={image.name} loading="lazy" /></button>)}</nav>
    </dialog>
  </div>;
}
