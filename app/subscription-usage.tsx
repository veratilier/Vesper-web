'use client';
import { useEffect, useState } from 'react';
import { usageWindows, type UsageWindow } from '@/lib/subscription-usage';
import './subscription-usage.css';

export function SubscriptionUsage({ active, socketUrl, weeklyOnly = false }: { active: boolean; socketUrl: () => string; weeklyOnly?: boolean }) {
  const [windows, setWindows] = useState<UsageWindow[]>([]);
  const [status, setStatus] = useState('Loading usage…');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let current: WebSocket | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    function poll() {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      let completed = false;
      const finish = (message: string) => {
        if (completed) return;
        completed = true; busy = false; clearTimeout(timeout);
        if (!cancelled) { setStatus(message); if (message) setWindows([]); }
        current?.close();
      };
      try {
        current = new WebSocket(socketUrl());
        const ws = current;
        timeout = setTimeout(() => finish('Usage unavailable'), 12000);
        ws.onopen = () => ws.send(JSON.stringify({ id: 'usage-init', method: 'initialize', params: { clientInfo: { name: 'vesper_usage', version: '1.0.0' } } }));
        ws.onmessage = event => {
          if (cancelled || completed) return;
          try {
            const data = JSON.parse(event.data);
            if (data.id === 'usage-init') {
              if (data.error) { finish('Usage unavailable'); return; }
              ws.send(JSON.stringify({ method: 'initialized' }));
              ws.send(JSON.stringify({ id: 'usage-read', method: 'account/rateLimits/read' }));
            } else if (data.id === 'usage-read') {
              if (data.error) { finish('Usage unavailable'); return; }
              const rows = usageWindows(data.result);
              setWindows(rows); finish(rows.length ? '' : 'No subscription limits available');
            }
          } catch { finish('Usage unavailable'); }
        };
        ws.onerror = () => finish('Usage unavailable');
        ws.onclose = () => finish('Usage unavailable');
      } catch { finish('Usage unavailable'); }
    }
    poll();
    const interval = setInterval(poll, 60000);
    document.addEventListener('visibilitychange', poll);
    return () => { cancelled = true; clearTimeout(timeout); clearInterval(interval); document.removeEventListener('visibilitychange', poll); current?.close(); };
  }, [active, socketUrl, refresh]);
  const visibleWindows = weeklyOnly ? windows.filter(window => window.label === 'Weekly limit') : windows;
  return <section className="subscription-usage" aria-label="Subscription remaining">
    <div className="usage-heading"><span className={weeklyOnly ? "home-card-label" : undefined}>{weeklyOnly ? "Usage" : "Subscription remaining"}</span><button type="button" aria-label="Refresh usage" onClick={() => setRefresh(value => value + 1)}>↻</button></div>
    {!status && weeklyOnly && !visibleWindows.length && <p role="status">Weekly usage unavailable</p>}
    {status ? <p role="status">{status}</p> : visibleWindows.map((window, index) => <div className="usage-window" key={index}>
      <div><span>{window.label}</span><b>{window.remaining}%</b></div>
      <progress max={100} value={window.remaining} aria-label={`${window.label}: ${window.remaining}% remaining`} />
      {!weeklyOnly && <small>{window.resetsAt ? `Resets ${new Date(window.resetsAt * 1000).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'Reset time unavailable'}</small>}
    </div>)}
  </section>;
}
