"use client";
import { useEffect, useState } from "react";
import { browserStorage } from "@/lib/browser-storage";
type Appearance = { glass: number; mode: "vesper" | "native"; icon: string };
const key = "vesper-web-material";
const defaults: Appearance = {
  glass: 62,
  mode: "vesper",
  icon: "/icon-192-20260907-moon-v1.png",
};
function read(): Appearance {
  try {
    return { ...defaults, ...JSON.parse(browserStorage.getItem(key) || "{}") };
  } catch {
    return defaults;
  }
}
function apply(value: Appearance) {
  document.documentElement.style.setProperty(
    "--vesper-glass-alpha",
    `${value.glass / 100}`,
  );
  document.documentElement.dataset.webAppearance = value.mode;
  let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement("link");
    icon.rel = "icon";
    document.head.appendChild(icon);
  }
  icon.href = value.icon;
}
function save(value: Appearance) {
  browserStorage.setItem(key, JSON.stringify(value));
  apply(value);
  window.dispatchEvent(new Event("vesper-web-appearance"));
}
export function WebAppearanceToggle() {
  const [value, setValue] = useState(defaults);
  useEffect(() => {
    const sync = () => {
      const next = read();
      setValue(next);
      apply(next);
    };
    sync();
    window.addEventListener("vesper-web-appearance", sync);
    return () => window.removeEventListener("vesper-web-appearance", sync);
  }, []);
  return (
    <button
      className="icon-button"
      aria-label={`Switch to ${value.mode === "vesper" ? "native-style" : "Vesper"} appearance`}
      title={value.mode === "vesper" ? "Native-style" : "Vesper"}
      onClick={() =>
        save({ ...value, mode: value.mode === "vesper" ? "native" : "vesper" })
      }
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <rect x="3" y="4" width="18" height="16" rx="4" />
        <path d="M12 4v16M7 9h1m-1 4h1" />
      </svg>
    </button>
  );
}
export function WebAppearanceControls() {
  const [value, setValue] = useState(read);
  const change = (next: Partial<Appearance>) => {
    const merged = { ...value, ...next };
    setValue(merged);
    save(merged);
  };
  return (
    <section className="appearance-section web-material-controls">
      <label>
        <b>Glass opacity</b>
        <output>{value.glass}%</output>
        <input
          aria-label="Glass opacity"
          type="range"
          min="15"
          max="95"
          value={value.glass}
          onChange={(e) => change({ glass: Number(e.target.value) })}
        />
      </label>
      <div>
        <b>Appearance</b>
        <button
          aria-pressed={value.mode === "vesper"}
          onClick={() => change({ mode: "vesper" })}
        >
          Vesper
        </button>
        <button
          aria-pressed={value.mode === "native"}
          onClick={() => change({ mode: "native" })}
        >
          Native-style
        </button>
      </div>
      <small>
        Native-style uses a simple browser surface. Apple’s native materials are
        available in the iOS app.
      </small>
      <div>
        <b>Browser icon</b>
        {["/icon-192-20260907-moon-v1.png", "/icon-192-20260901-v1.png"].map(
          (icon) => (
            <button
              key={icon}
              aria-pressed={value.icon === icon}
              aria-label={icon.includes("moon") ? "Moon icon" : "Classic icon"}
              onClick={() => change({ icon })}
            >
              <img src={icon} width="32" height="32" alt="" />
            </button>
          ),
        )}
      </div>
      <small>
        This changes this browser’s tab icon. Installed app icons are managed by
        the browser or iOS.
      </small>
    </section>
  );
}
