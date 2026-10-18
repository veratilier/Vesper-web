'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
export function ChatStatusPopover({ visible, online, busy, warning, fallback = false, children }: {
  fallback?: boolean; visible: boolean; online: boolean; busy: boolean; warning: boolean; children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => { setAnchor(visible ? document.getElementById('web-chat-status-anchor') : null); }, [visible]);
  if (!anchor) return fallback ? <div className="chat-status-stack">{children}</div> : null;
  return createPortal(<details className="chat-connection-popover">
    <summary aria-label="Chat connection status" title={online ? warning ? 'Connected · details available' : 'Connected' : 'Disconnected · click to reconnect'}>
      <span className={`chat-connection-dot${busy && online && !warning ? ' spinning' : ''}${!online || warning ? ' attention' : ''}`}>{!online || warning ? "!" : ""}</span>
    </summary>
    <div className="chat-connection-details"><b>{online ? 'Connected' : 'Disconnected'}</b>{children}<button className="status-dismiss" onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>Dismiss</button></div>
  </details>, anchor);
}
