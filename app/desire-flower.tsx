'use client';
import { useState } from 'react';
import { emotions, emotionLabels } from '@/lib/desire/emotion-keys';
export const desireMetrics = emotions.map((key,i)=>[key,emotionLabels[i]] as const);
const positions = emotions.map((_,i)=>({angle:i*45-22.5,x:180+145*Math.sin((i*45-22.5)*Math.PI/180),y:153-137*Math.cos((i*45-22.5)*Math.PI/180)}));
export function metricValue(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null; }
export function DesireFlower({ data }: { data: Record<string, unknown> | null }) {
  const [selected, setSelected] = useState(1);
  const value = metricValue((data?.values as Record<string,unknown>|undefined)?.[desireMetrics[selected][0]]);
  return <div className="desire-flower">
    <svg viewBox="0 0 360 310" role="group" aria-label="Eight-emotion flower; select a petal to view its value">
      <g className="desire-flower-breath">
        {desireMetrics.map(([key, label], index) => {
          const number = metricValue((data?.values as Record<string,unknown>|undefined)?.[key]);
          const position = positions[index];
          // Map each metric independently: 0 → 45%, 100 → 100%.
          // Single-argument CSS scale is valid; overlapping bases stay under the center.
          const size = number === null ? .45 : .45 + number * .0055;
          return <g key={key} transform={`translate(180 153) rotate(${position.angle})`}>
            <g className={`desire-petal${selected === index ? ' selected' : ''}`} style={{ transform: `scale(${size})`, opacity: number === null ? .3 : .65 + number * .0035 }} role="button" tabIndex={0} aria-label={`${label} ${number ?? "Not loaded yet"}`} aria-pressed={selected === index} onClick={() => setSelected(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(index); } }}>
              <image href="/desire-petal.webp" x="-58" y="-126" width="116" height="140" preserveAspectRatio="none" />
              <path className="desire-petal-focus" d="M0 10 C-62 -40 -48 -89 0 -120 C50 -82 56 -36 0 10Z" />
            </g>
          </g>;
        })}
        <circle cx="180" cy="153" r="8" className="desire-flower-heart" />
      </g>
      {desireMetrics.map(([key, label], index) => <g key={key} className={`desire-petal-label${selected === index ? ' selected' : ''}`} onClick={() => setSelected(index)} aria-hidden="true"><text x={positions[index].x} y={positions[index].y} textAnchor="middle">{label}</text><text x={positions[index].x} y={positions[index].y + 19} textAnchor="middle" className="desire-petal-number">{metricValue((data?.values as Record<string,unknown>|undefined)?.[key]) ?? '—'}</text></g>)}
    </svg>
    <div className="desire-selection" aria-live="polite"><span>{desireMetrics[selected][1]} · {value ?? '—'}</span><small>Select a petal to explore the mood</small></div>
  </div>;
}
