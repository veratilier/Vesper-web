"use client";
import { useEffect, useRef, useState } from "react";
import { activeLyric, parseLyrics, type LyricLine } from "@/lib/music-lyrics";
export function MusicLyrics({
  trackId,
  time,
  load,
  onSeek,
}: {
  trackId: string;
  time: number;
  load: (trackId: string) => Promise<string>;
  onSeek: (time: number) => void;
}) {
  const [result, setResult] = useState<{
      id: string;
      lines: LyricLine[];
      error?: string;
    } | null>(null),
    [retry, setRetry] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    void load(trackId)
      .then((text) => {
        if (alive) setResult({ id: trackId, lines: parseLyrics(text) });
      })
      .catch(() => {
        if (alive)
          setResult({ id: trackId, lines: [], error: "Lyrics unavailable" });
      });
    return () => {
      alive = false;
    };
  }, [trackId, load, retry]);
  const lines = result?.id === trackId ? result.lines : [],
    index = activeLyric(lines, time);
  useEffect(() => {
    const container = root.current,
      line = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (container && line)
      container.scrollTo({
        top: line.offsetTop - container.offsetTop - container.clientHeight / 3,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }, [index]);
  return (
    <div className="web-lyrics" ref={root}>
      {result?.id !== trackId ? (
        <p>Loading lyrics…</p>
      ) : result.error ? (
        <button onClick={() => setRetry((n) => n + 1)}>
          {result.error} · Retry
        </button>
      ) : !lines.length ? (
        <p>No timed lyrics available.</p>
      ) : (
        lines.map((line, i) => (
          <button
            key={`${line.time}-${i}`}
            aria-current={index === i ? "true" : undefined}
            onClick={() => onSeek(line.time)}
          >
            {line.text}
          </button>
        ))
      )}
    </div>
  );
}
