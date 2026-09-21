"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { useEffect, useState } from "react";

type Status = "default" | "granted" | "denied" | "provisional" | "ephemeral" | "unknown";
const permission = registerPlugin<{
  check(): Promise<{ status: Status }>;
  request(): Promise<{ status: Status }>;
  openSettings(): Promise<void>;
}>("VesperNotificationPermission");

export function NotificationSettings({ onClose, onWebPush }: {
  onClose: () => void;
  onWebPush: () => void;
}) {
  const [status, setStatus] = useState<Status>("unknown");
  const [available, setAvailable] = useState(false);
  const [native, setNative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const ios = Capacitor.getPlatform() === "ios";
    const ready = ios && Capacitor.isPluginAvailable("VesperNotificationPermission");
    setNative(ios);
    setAvailable(ready);
    let active = true;
    const refresh = () => {
      if (!ready) return;
      void permission.check().then(result => {
        if (active) setStatus(result.status);
      }).catch(() => { if (active) setMessage("Could not read permissions. Please reopen this page."); });
    };
    refresh();
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  const request = async () => {
    setBusy(true);
    setMessage("");
    try {
      if (status === "denied") await permission.openSettings();
      else setStatus((await permission.request()).status);
    } catch {
      setMessage("Could not request notification permission. Please try again.");
    } finally { setBusy(false); }
  };
  const labels: Record<Status, string> = {
    default: "Not requested", granted: "Allowed", denied: "Denied. Enable notifications in Settings.",
    provisional: "Quiet notifications allowed", ephemeral: "Temporarily allowed", unknown: "Checking permission",
  };

  return <div className="modal-layer">
    <button className="modal-scrim" onClick={onClose} aria-label="Close notification settings" />
    <section className="connection-modal">
      <div className="modal-head"><h2>Notification</h2><button onClick={onClose} aria-label="Close">×</button></div>
      <div className="parameter-form">
        <div>
          <h3>Web Push</h3>
          <p className="settings-hint">Push notifications for browsers and Home Screen PWAs.</p>
          <button className="save-profile" onClick={onWebPush}>Set up Web Push</button>
        </div>
        <div>
          <h3>Apple notification permission</h3>
          <p className="settings-hint">{available ? labels[status] : native ? "Install the updated Vesper app to request permission." : "Request permission in the native Vesper iPhone app."}</p>
          <button className="save-profile" disabled={!available || busy || status === "granted" || status === "unknown"} onClick={() => void request()}>
            {busy ? "Working…" : status === "granted" ? "Notifications allowed" : status === "denied" ? "Open Settings" : "Allow Apple notifications"}
          </button>
          <p className="settings-hint">Permission allows the app to show notifications. Remote push delivery is not connected yet.</p>
        </div>
      </div>
      {message && <p className="connection-message" role="status">{message}</p>}
    </section>
  </div>;
}
