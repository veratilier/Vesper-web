'use client';
import { useState, type ReactNode } from 'react';
import './app-center.css';
type Props = { onWake: () => void; onDesire: () => void; renderWatch: () => ReactNode; renderReading: () => ReactNode };
export function AppCenter({ onWake, onDesire, renderWatch, renderReading }: Props) {
  const [room, setRoom] = useState<'read' | 'watch' | null>(null);
  if (room) return <div className={`page-body app-center ${room === 'watch' ? 'watch-room' : 'internal-reading-room'}`}>
    <div className="watch-room-toolbar"><button type="button" onClick={() => setRoom(null)}>‹ Pandora</button><span>{room === 'watch' ? 'WATCH TOGETHER' : 'READ TOGETHER'}</span></div>
    <div className="page-intro"><h1>{room === 'watch' ? 'Together Watch' : 'Reading Room'}</h1></div>
    {room === 'watch' ? renderWatch() : renderReading()}
  </div>;
  return <div className="page-body app-center"><div className="page-intro"><span>OUR LITTLE ROOMS</span><h1>Pandora</h1><p>Read, or spend a film together.</p></div>
    <div className="room-grid">
      <article className="room-card"><h2>Reading Room</h2><p>Turn the next page together</p><button onClick={() => setRoom('read')}>Enter room →</button></article>
      <article className="room-card"><h2>Together Watch</h2><p>Watch a film together</p><button onClick={() => setRoom('watch')}>Enter room →</button></article>
      <article className="room-card desire-entry"><h2>Desire</h2><p>A feeling, held here</p><button onClick={onDesire}>Open Desire →</button></article>
    </div>
    <section className="room-wake"><div><h2>Wake AI</h2><p>Leave room for a new thought.</p></div><button onClick={onWake}>Wake</button></section>
    <p className="room-caption">Keep Vesper open and connected for a manual wake-up.</p>
  </div>;
}
