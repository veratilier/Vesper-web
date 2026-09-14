"use client";
import { VESPER_DESIRE_SESSION_CONFIG, VESPER_DESIRE_INSTRUCTIONS } from "@/lib/desire/routing.js";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { nativeMcpOAuth } from "./native-mcp-oauth";
import { nativeOAuthCode, NATIVE_OAUTH_PREFIX } from "@/lib/mcp-oauth-callback";
import { documentSyncAction } from "@/lib/document-sync";
import { NotificationSettings } from "./notification-settings";
import { WindowOpening } from "./window-opening";
import { WatchPlayer } from "./watch-player";
import type { WatchFrame } from "./watch-context";
import { ReadingRoom, type ReadingBook } from "./reading-room";
import { SubscriptionUsage } from "./subscription-usage";
import { AppCenter } from "./app-center";
import { DesirePanel, HomeDesire } from "./desire-panel";
import { WakeCard } from "./wake-card";
import type { WakeRecord } from "./wake-summary";
import { executionEvent, workspaceOptions, type Execution } from './codex-execution';
import { ChatActivity, type TurnActivity } from './chat-activity';
import { ExecutionCard } from './execution-card';
import { PhotoAlbum } from './photo-album';
import { AttachmentGallery } from './attachment-gallery';
import './activity-glass.css';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
  type CSSProperties,
} from "react";
import { anniversaryTarget, anniversaryDays, daysUntil, anniversaryDayLabel, nextAnniversary } from "./anniversary-dates";
import { codexToolDefinitions, CODEX_TOOL_CATALOG_VERSION, validateCodexToolCatalog } from "@/lib/codex-tool-definitions";
import { syncCodexThread, createConnectionQueue, resumeCodexThread } from "@/lib/codex-thread-lifecycle";
import { FileAttachmentCard } from "./file-attachment-card";
import { CodexUserInput, type UserInputRequest } from "./codex-user-input";
import { attachmentInputText, imageAttachmentInput } from "./codex-attachment-input";
import { useMobileViewport } from "./use-mobile-viewport";
import "./mobile-navigation.css";
import { subscribe, serializeSubscription } from "@mmmike/web-push/client";
import { codexBubbleIdentity, hasCodexChatBubbles, isCompletedCodexItem, mergeCodexMessages } from "./codex-message-merge";
import {
  approvalResultFor,
  approvalWasResolved,
  clearCodexApprovals,
  createCodexApprovalRequest,
  queueCodexApproval,
  removeCodexApproval,
  type PendingCodexApproval,
} from "@/lib/codex-approval";
import { requestNeteaseLibrary, type MusicLibraryResult } from "@/lib/music-service";
import { CodexModelPicker } from "./codex-model-picker";
import { startCodexTurnWithModel, effortLabel, listCodexModels, selectionFromThread, type CodexModel, type CodexModelSelection } from "@/lib/codex-models";
function Notes() {
  const [notes, setNotes] = usePersistentDocument<NoteItem[]>("notes", []);
  const add = () =>
    setNotes((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        text: "",
        kind: "user",
        tone: "warm",
        createdAt: new Date().toISOString(),
      },
    ]);
  return (
    <div className="page-body">
      <PageIntro
        eyebrow="QUICK NOTES"
        title="Notes"
        text="You and Rowan can both leave something here."
      />
      <div className="note-toolbar">
        <span>{notes.length}  notes</span>
        <button onClick={add}>
          <Icon name="plus" />
          New note
        </button>
      </div>
      {!notes.length ? (
        <EmptyState text="No notes yet. Select “New note” to begin." />
      ) : (
        <div className="sticky-wall">
          {notes.map((note) => (
            <article className={`sticky ${note.tone}`} key={note.id}>
              <div className="tape" />
              <div className="sticky-meta">
                <span>{note.kind === "agent" ? "ROWAN" : "VERA"}</span>
                <button
                  aria-label="Delete note"
                  onClick={() =>
                    setNotes((items) =>
                      items.filter((item) => item.id !== note.id),
                    )
                  }
                >
                  <Icon name="close" />
                </button>
              </div>
              {note.kind === "user" ? (
                <textarea
                  className="sticky-editor"
                  aria-label="Edit note"
                  placeholder="Write a note…"
                  value={note.text}
                  onChange={(event) =>
                    setNotes((items) =>
                      items.map((item) =>
                        item.id === note.id
                          ? { ...item, text: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              ) : (
                <p>{note.text}</p>
              )}
              <footer>
                {note.kind === "agent" ? (
                  <>
                    <Icon name="sparkles" />
                    Rowan’s notes
                  </>
                ) : (
                  <>
                    <Icon name="edit" />
                    Editable · Saved automatically
                  </>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
const VESPER_API_ORIGIN = "https://api.vesper.r-vera.com";
const DEFAULT_CANVAS_COLOR = "#eaf0f5";
const DEFAULT_APP_BACKGROUND = 'url("/backgrounds/vesper-marble-20260908.jpg")';
const NEUTRAL_ACCENTS = new Set(["#647e94", "#8299ad", "#4a4a48", "#6b6b68", "#878783", "#a3a39f"]);

function normalizeNeutralAccent(value?: string) {
  return value && NEUTRAL_ACCENTS.has(value.toLowerCase()) ? value.toLowerCase() : "#647e94";
}

function normalizeAppBackground(value?: string) {
  const candidate = value?.trim() || "";
  if (["#f5f5f3", "#f0f2ef", "#eaf0f5"].includes(candidate.toLowerCase())) return DEFAULT_APP_BACKGROUND;
  if (/^#[\da-f]{6}$/i.test(candidate)) return candidate;
  // Uploaded photographs remain user content. Former colour/gradient presets and
  // obsolete default presets become the bundled marble background.
  return candidate.includes("url(") && !candidate.includes("vesper-default-bg.webp")
    ? candidate
    : DEFAULT_APP_BACKGROUND;
}
function apiUrl(path: string) {
  if (typeof window === "undefined") return path;
  return ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? path
    : `${VESPER_API_ORIGIN}${path}`;
}
function appHeaders(json = false) {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    "x-vesper-device-token": deviceToken(),
  };
}
function AnniversaryCard({ item }: { item: AnniversaryItem }) {
  const target = anniversaryTarget(item);
  const days = anniversaryDays(item);
  return (
    <article className="surface anniversary">
      <div className="days">
        <small>{days >= 0 ? "Until" : "Since"}</small>
        <b>{days >= 0 ? daysUntil(item) : -days}</b>
        <small> days</small>
      </div>
      <div className="anniversary-copy">
        <span>
          NEXT · {String(target.getMonth() + 1).padStart(2, "0")} /{" "}
          {String(target.getDate()).padStart(2, "0")}
        </span>
        <h2>{item.title}</h2>
        <p>{target.toLocaleDateString("en-US")}</p>
      </div>
    </article>
  );
}
function anniversaryBackgroundStyle(background?: AnniversaryBackground) {
  if (background?.mode === "image" && background.image) return { backgroundImage: `linear-gradient(0deg, rgba(0,0,0,.62), rgba(0,0,0,.56)), url(${JSON.stringify(background.image)})`, color: "#fff" };
  if (background?.mode === "color" && /^#[0-9a-f]{6}$/i.test(background.color || "")) {
    const color = background.color!;
    const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    return { background: color, color: luminance > .179 ? "#000000" : "#ffffff" };
  }
  return undefined;
}
function Anniversaries() {
  const [items, setItems] = usePersistentDocument<AnniversaryItem[]>("anniversaries", []);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [addingCountdown, setAddingCountdown] = useState(false);
  const blank = (): AnniversaryItem => ({ id: "", title: "", date: new Date().toLocaleDateString("en-CA"), repeats: false, background: { mode: "theme" } });
  const [draft, setDraft] = useState<AnniversaryItem>(blank);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const uploadGeneration = useRef(0);
  const openEditor = (item?: AnniversaryItem) => { setAddingCountdown(false); uploadGeneration.current++; setUploading(false); setUploadError(""); setDraft(item ? { ...item } : blank()); setEditing(true); };
  const openCountdown = () => {
    openEditor();
    setAddingCountdown(true);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    setDraft({ ...blank(), date, repeats: false });
  };
  const closeEditor = () => { uploadGeneration.current++; setEditing(false); setUploading(false); };
  const saveDate = () => {
    if (!draft.title.trim() || !draft.date || uploading) return;
    const saved = { ...draft, id: draft.id || crypto.randomUUID(), title: draft.title.trim() };
    setItems((current) => draft.id ? current.map((item) => item.id === draft.id ? saved : item) : [...current, saved]);
    setSelectedId(saved.id); closeEditor();
  };
  const uploadBackground = async (file?: File) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || file.size > 10 * 1024 * 1024) { setUploadError("Choose a JPG, PNG, WebP or GIF under 10 MB."); return; }
    const generation = ++uploadGeneration.current;
    setUploading(true); setUploadError("");
    try { const { url } = await uploadImage(file); if (generation === uploadGeneration.current) setDraft((current) => ({ ...current, background: { ...current.background, mode: "image", image: url } })); }
    catch (reason) { if (generation === uploadGeneration.current) setUploadError(reason instanceof Error ? reason.message : "Upload failed. Please try again."); }
    finally { if (generation === uploadGeneration.current) setUploading(false); }
  };
  const featured = items.find((item) => item.id === selectedId) || nextAnniversary(items);
  const card = (item: AnniversaryItem, preview = false) => {
    const days = anniversaryDays(item);
    const past = days < 0;
    const count = Math.abs(days);
    return <article className="anniversary-keepsake" style={anniversaryBackgroundStyle(item.background)}>
      <span className="keepsake-label">{past ? "Days remembered" : days === 0 ? "Today is the day" : "Counting down"}</span>
      <h2>{item.title || "Anniversary name"}</h2>
      <div className="keepsake-count"><small>{past ? "Days together" : days === 0 ? "Today is the day" : "Remaining"}</small><b>{count}</b><small> days</small></div>
      <footer><span>{past ? "Since" : "Date"} {item.date}<small>{item.repeats ? "Repeat annually" : "Remember this day"}</small></span>{!preview && <button onClick={() => openEditor(item)}><Icon name="edit" />Edit and background</button>}</footer>
    </article>;
  };
  return <div className="page-body anniversary-page">
    <header className="anniversary-heading"><span>OUR DAYS</span><h1>Days worth remembering</h1></header>
    {featured ? card(featured) : <EmptyState text="Save your first meaningful date here." />}
    {items.length > 1 && <div className="anniv-list">{items.filter((item) => item.id !== featured?.id).map((item) => <button className="anniversary-mini" key={item.id} onClick={() => setSelectedId(item.id)}><time>{item.date.slice(5).replace("-", ".")}</time><strong>{item.title}</strong><span>{anniversaryDayLabel(item)}</span><Icon name="chevron" /></button>)}</div>}
    <div className="anniversary-add-actions"><button className="primary-action anniversary-add" onClick={() => openEditor()}><Icon name="plus" />Add anniversary</button><button className="primary-action anniversary-add" onClick={openCountdown}><Icon name="clock" />Add countdown</button></div>
    {editing && <div className="modal-layer"><button className="modal-scrim" aria-label="Close" onClick={closeEditor} /><section className="connection-modal anniversary-editor" role="dialog" aria-modal="true" aria-labelledby="anniversary-editor-title">
      <div className="modal-head"><h2 id="anniversary-editor-title">{draft.id ? "Edit anniversary" : addingCountdown ? "Add countdown" : "Add anniversary"}</h2><button aria-label="Close" onClick={closeEditor}><Icon name="close" /></button></div>
      <label className="profile-field"><span>Name</span><input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label className="profile-field"><span>{addingCountdown ? "Target date" : "Date"}</span><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
      {addingCountdown && <p className="settings-hint">Choose a date to count down to. On the day, the card says “Today is the day”; afterward, it shows days elapsed.</p>}
      <button className={draft.repeats ? "repeat-choice selected" : "repeat-choice"} aria-pressed={draft.repeats} onClick={() => setDraft({ ...draft, repeats: !draft.repeats })}><span>Repeat annually</span><b>{draft.repeats ? "✓" : ""}</b></button>
      <fieldset className="anniversary-background-options"><legend>Card background</legend><div>{([ ["theme", "Use theme"], ["color", "Solid color"], ["image", "Image"] ] as const).map(([mode, label]) => <button key={mode} aria-pressed={(draft.background?.mode || "theme") === mode} onClick={() => { uploadGeneration.current++; setUploading(false); setUploadError(""); setDraft({ ...draft, background: { color: "#466b7b", ...draft.background, mode } }); }}>{label}</button>)}</div>
      {draft.background?.mode === "color" && <label>Choose color<input type="color" value={draft.background.color || "#466b7b"} onChange={(event) => setDraft({ ...draft, background: { ...draft.background, mode: "color", color: event.target.value } })} /></label>}
      {draft.background?.mode === "image" && <label>Upload background<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading} onChange={(event) => { void uploadBackground(event.target.files?.[0]); event.target.value = ""; }} /></label>}
      <p>Choose “Use theme” to restore the default background.</p></fieldset>
      {uploading && <p role="status">Uploading image…</p>}{uploadError && <p role="alert">{uploadError}</p>}
      {draft.date && <div className="anniversary-preview">{card(draft, true)}</div>}
      <button className="save-profile" disabled={!draft.title.trim() || !draft.date || uploading || (draft.background?.mode === "image" && !draft.background.image)} onClick={saveDate}>Save anniversary</button>
      {draft.id && <button className="anniversary-delete" onClick={() => { if (window.confirm("Delete this anniversary?")) { setItems((current) => current.filter((item) => item.id !== draft.id)); closeEditor(); } }}>Delete anniversary</button>}
    </section></div>}
  </div>;
}

const iconPaths: Record<string, string[]> = {
  archive: ["M3 5h18v5H3z", "M5 10v10h14V10", "M10 14h4"],
  box: ["M3 8l9-5 9 5v8l-9 5-9-5z", "m3 8 9 5 9-5", "M12 13v8"],
  calendar: [
    "M8 2v3",
    "M16 2v3",
    "M3 9h18",
    "M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2z",
  ],
  check: ["M20 6 9 17l-5-5"],
  chevron: ["m9 18 6-6-6-6"],
  cloud: [
    "M13 16a3 3 0 0 1 0 6H7a5 5 0 1 1 4.9-6z",
    "M18.4 14.5a6 6 0 0 0 3.4-4.1c.2-.7-.6-1-1.2-.7a4 4 0 0 1-5.3-5.3c.3-.6-.1-1.4-.7-1.2A6 6 0 0 0 10 8.5",
  ],
  feather: ["M14 18H5v-7l7-7a6 6 0 0 1 8 8z", "M16 8 2 22", "M17 15H9"],
  heart: [
    "M2 9.5a5.5 5.5 0 0 1 9.6-3.7A5.5 5.5 0 0 1 22 9.5c0 2.3-1.5 4-3 5.5l-7 6-7-6c-1.5-1.5-3-3.2-3-5.5",
  ],
  home: ["M15 21v-8H9v8", "M3 10 12 2l9 8v9H3z"],
  library: ["m16 6 4 14", "M12 6v14", "M8 8v12", "M4 4v16"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  music: ["M12 18V3l7 3", "M12 18a4 4 0 1 1-4-4 4 4 0 0 1 4 4"],
  diary: [
    "M13 3H6a2 2 0 0 0-2 2v15h14v-7",
    "M2 7h4M2 11h4M2 15h4",
    "m13 10 7-7 2 2-7 7-3 1z",
  ],
  pause: ["M6 4h4v16H6z", "M14 4h4v16h-4z"],
  plus: ["M5 12h14", "M12 5v14"],
  settings: [
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
    "M9 4a4 4 0 0 1 6 0l3 2a4 4 0 0 1 3 5v3a4 4 0 0 1-3 4l-3 2a4 4 0 0 1-6 0l-3-2a4 4 0 0 1-3-4v-3a4 4 0 0 1 3-5z",
  ],
  sparkles: ["M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"],
  note: [
    "M5 3h10l6 6v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
    "M15 3v6h6",
  ],
  close: ["M18 6 6 18", "M6 6l12 12"],
  chat: ["M21 15a4 4 0 0 1-4 4H8l-5 3 1.6-4A8 8 0 1 1 21 15z"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
  volume: [
    "M11 5 6 9H3v6h3l5 4z",
    "M15 9a4 4 0 0 1 0 6",
    "M18 6a8 8 0 0 1 0 12",
  ],
  phone: [
    "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1z",
  ],
  link: [
    "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2",
    "M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
  ],
  send: ["m22 2-7 20-4-9-9-4z", "M22 2 11 13"],
  queue: ["M4 6h11", "M4 12h11", "M4 18h7", "M18 15v6", "m15 18 3 3 3-3"],
  one: ["M9 7h2v10", "M8 17h6"],
  lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
  edit: ["M12 20h9", "m16 4 4 4L8 20H4v-4z"],
  more: ["M5 12h.01M12 12h.01M19 12h.01"],
  search: ["M11 19a8 8 0 1 1 5.65-2.35L22 22", "m16.65 16.65 4.2 4.2"],
  wifi: ["M5 12a10 10 0 0 1 14 0", "M8 15a6 6 0 0 1 8 0", "M12 19h.01"],
};
Object.assign(iconPaths, {
  play: ["M8 5v14l11-7z"],
  back: ["M19 20 9 12l10-8z", "M5 19V5"],
  forward: ["m5 4 10 8-10 8z", "M19 5v14"],
  repeat: [
    "m17 1 4 4-4 4",
    "M3 11V9a4 4 0 0 1 4-4h14",
    "m7 23-4-4 4-4",
    "M21 13v2a4 4 0 0 1-4 4H3",
  ],
  shuffle: ["M16 3h5v5", "M4 20 21 3", "M21 16v5h-5", "M15 15l6 6", "M4 4l5 5"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"],
  upload: ["M12 21V9", "m17 14-5-5-5 5", "M5 3h14"],
  database: [
    "M4 6c0-2 4-3 8-3s8 1 8 3-4 3-8 3-8-1-8-3z",
    "M4 6v6c0 2 4 3 8 3s8-1 8-3V6",
    "M4 12v6c0 2 4 3 8 3s8-1 8-3v-6",
  ],
});
Object.assign(iconPaths, {
  location: [
    "M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0z",
    "M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  ],
});
Object.assign(iconPaths, {
  clock: ["M12 22a10 10 0 1 0-10-10", "M12 6v6l4 2"],
  copy: ["M9 9h11v11H9z", "M4 15H3V4h11v1"],
  bookmark: ["M6 3h12v18l-6-4-6 4z"],
  like: [
    "M7 10v11H3V10z",
    "M7 18c4 3 10 2 11-1l2-6c.3-2-1-3-3-3h-4l1-4c.3-2-2-3-3-1L7 10",
  ],
  dislike: [
    "M7 14V3H3v11z",
    "M7 6c4-3 10-2 11 1l2 6c.3 2-1 3-3 3h-4l1 4c.3 2-2 3-3 1l-4-7",
  ],
  refresh: ["M20 11a8 8 0 1 0-2 5", "M20 4v7h-7"],
  trash: ["M4 7h16", "M9 3h6l1 4H8z", "M7 7l1 14h8l1-14", "M10 11v6", "M14 11v6"],
  sticker: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M8 9h.01", "M16 9h.01", "M8 14c1.1 1.3 2.4 2 4 2s2.9-.7 4-2", "M16 3v4h4"],
  mic: [
    "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z",
    "M5 10v2a7 7 0 0 0 14 0v-2",
    "M12 19v3",
  ],
});
// Deliberately open contours rather than dashed outlines; small controls keep their shape.
const brokenIconPaths: Record<string, string[]> = {
  "file-code": ["M14 2H6a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V9L14 2Z", "M14 2v7h7", "m8 12-3 3 3 3m8-6 3 3-3 3m-3-7-2 8"],
  "arrow-up": ["M12 19V5", "m5 12 7-7 7 7"],
  image: ["M10 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V8", "M3 16l5-5 5 5 3-3 5 5", "M16 3h5v5", "M14 8h.01"],
  home: ["M3 10 12 3l9 7", "M4 13v6a2 2 0 0 0 2 2h3v-7h6v7h3a2 2 0 0 0 2-2v-6"],
  chat: ["M21 10V7a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v10l5-3h9a4 4 0 0 0 4-4", "M8 8h8"],
  note: ["M10 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6", "M14 3v6h6"],
  diary: ["M10 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12V5a2 2 0 0 0-2-2h-2", "M3 8h3M3 12h3M3 16h3", "M10 9h5M10 13h5"],
  calendar: ["M9 5h9a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8", "M7 3v4M17 3v4M3 11h18"],
  music: ["M10 14V5l10-2v12", "M10 17a3 3 0 1 1-3-3", "M20 17a3 3 0 1 1-3-3", "M10 9l10-2"],
  check: ["M21 12a9 9 0 1 1-7-8.8", "m9 11 3 3 8-8"],
  box: ["m3 7 9-5 9 5-9 5-9-5v10l9 5 9-5v-6", "M12 12v6"],
  library: ["M4 4v16h4V8M12 4v12M12 19v1M16 5l4 15"],
  settings: ["M3 6h4M11 6h10M3 12h10M17 12h4M3 18h4M11 18h10", "M7 4v4M17 10v4M7 16v4"],
  trash: ["M3 7h18M9 3h6l1 4", "M5 10l1 9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-9", "M10 11v6M14 11v6"],
  copy: ["M14 8h6v12H8V8h2", "M4 15H3V3h12v1"],
  bookmark: ["M10 3H6v18l6-4 6 4V3h-4"],
  search: ["M18 10a7 7 0 1 0-2 6", "m16 16 5 5"],
  bell: ["M6 9v2c0 3-3 4-3 6h18c0-2-3-3-3-6V8a6 6 0 0 0-10-4", "M10 21h4"],
  play: ["M8 9V5l11 7-11 7v-6"],
  menu: ["M4 6h16M4 12h10M18 12h2M4 18h16"],
};
function Icon({ name }: { name: string }) {
  const paths = brokenIconPaths[name] || iconPaths[name] || iconPaths.sparkles;
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g>
        {paths.map((d, i) => (
          <path d={d} key={i} />
        ))}
      </g>
    </svg>
  );
}

const vesperNavMarks: Record<string, string[]> = {
  home: ["M2.75 9.1 10 2.8l7.25 6.3v7.4h-4.7v-4.75h-5.1v4.75h-4.7z"],
  chat: [
    "M3 3.5h14v10.25H9.2L5.25 17v-3.25H3z",
    "M6.2 8.5h.01M10 8.5h.01M13.8 8.5h.01",
  ],
  diary: [
    "M4 2.5h8.8L16 5.7v11.8H4z",
    "M12.8 2.5v3.2H16",
    "M6.5 8.5h6.8",
    "M6.5 11.5h6.8",
    "M6.5 14.5h4.2",
  ],
  note: [
    "M2.75 4.2c2.9-.75 5.25-.3 7.25 1.25 2-1.55 4.35-2 7.25-1.25v12.3c-2.75-.7-5.2-.25-7.25 1.25-2.05-1.5-4.5-1.95-7.25-1.25z",
    "M10 5.45v12.3",
  ],
  check: ["m11.2 2.5-7.1 8.35h5.15L7.9 17.5l8-9.25h-5.4z"],
  calendar: [
    "M10 17.25 3.9 11.7C.35 8.45 2.25 3.25 6.25 3.25c1.65 0 2.95.8 3.75 2.1.8-1.3 2.1-2.1 3.75-2.1 4 0 5.9 5.2 2.35 8.45z",
  ],
  box: [
    "m10 2.4 7 3.9v7.4l-7 3.9-7-3.9V6.3z",
    "m3 6.3 7 4 7-4",
    "M10 10.3v7.3",
    "m6.5 4.35 7 4",
  ],
  music: [
    "M8.2 14.2V4.4l7-1.5v9.4",
    "M8.2 6.8l7-1.5",
    "M8.2 14.2a3 3 0 1 1-3-3h3z",
    "M15.2 12.3a3 3 0 1 1-3-3h3z",
  ],
  library: [
    "M10 4c-1.2-2.25-4.65-1.55-4.65 1.05-2.55-.1-3.7 3.05-1.55 4.35-2.15 1.3-.95 4.45 1.55 4.35-.05 2.6 3.35 3.35 4.65 1.05 1.25 2.25 4.65 1.55 4.65-1.05 2.55.1 3.7-3.05 1.55-4.35 2.15-1.3.95-4.45-1.55-4.35.05-2.6-3.35-3.35-4.65-1.05z",
    "M10 4v12",
    "M6.65 6.35c1.25.1 2.05.9 2.1 2.2",
    "M6.4 12.95c1.45-.05 2.25-.75 2.35-2.05",
    "M13.35 6.35c-1.25.1-2.05.9-2.1 2.2",
    "M13.6 12.95c-1.45-.05-2.25-.75-2.35-2.05",
  ],
  settings: [
    "M3 5.2h14",
    "M3 10h14",
    "M3 14.8h14",
    "M7 3.5v3.4",
    "M13.5 8.3v3.4",
    "M8.8 13.1v3.4",
  ],
};
function VesperNavIcon({ name }: { name: string }) {
  return (
    <svg
      className="vesper-nav-icon"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <g className="nav-etch-primary">
        {vesperNavMarks[name].map((d, i) => (
          <path d={d} key={i} />
        ))}
      </g>
    </svg>
  );
}
const navIconPaths: Record<string, string[]> = {
  home: ["M3 10.5 10 4l7 6.5", "M5.5 9.5V17h9V9.5", "M8.5 17v-4h3v4"],
  chat: ["M17 11.5a6.5 6.5 0 0 1-9.7 5.6L3 18.5l1.5-3.7A6.5 6.5 0 1 1 17 11.5z"],
  diary: ["M5 3.5h7l3 3v10H5z", "M12 3.5v3h3", "M7.5 10h5", "M7.5 13h5"],
  note: ["M4 3.5h9l3 3v10H4z", "M13 3.5v3h3", "M7 10h6", "M7 13h4"],
  check: ["M15.5 8.5a5.5 5.5 0 1 1-2-3.9", "M10 8.5l2 2 4.5-5"],
  calendar: ["M10 17.2 4.5 12a4.4 4.4 0 0 1 6.2-6.2L10 7l-.7-1.2A4.4 4.4 0 0 1 15.5 12z"],
  box: ["m10 3 7 4v8l-7 4-7-4V7z", "m3 7 7 4 7-4", "M10 11v8"],
  music: ["M8 14V4l7-1.5v9.5", "M8 14a3 3 0 1 1-3-3h3z", "M15 12a3 3 0 1 1-3-3h3z"],
  library: ["M10 17a7 7 0 1 1 0-14", "M10 3v14", "M6 6.5h2M6 10h2M6 13.5h2"],
  settings: ["M3 5h14M3 10h14M3 15h14", "M7 3v4M13 8v4M9 13v4"],
};
function NavIcon({ name }: { name: string }) {
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">{(brokenIconPaths[name] || iconPaths[name] || []).map((d, i) => <path d={d} key={i} />)}</svg>;
}
// Display labels only; persisted section and connection keys remain unchanged.
const uiLabels: Record<string, string> = {
  "今日": "Today", "聊天": "Chat", "日记": "Journal", "便笺": "Notes",
  "提醒": "Reminders", "纪念日": "Dates", "音乐": "Music", "相册": "Album",
  "记忆库": "Memory", "欲望": "Desire", "设置": "Settings",
  "Agent 声音": "Agent Voice", "MCP 工具": "MCP Tools",
  "通知偏好": "Notification Preferences", "记忆权限": "Memory Permissions",
  "导出与备份": "Export & Backup", "关心频率": "Care Frequency",
  "AI 连接": "AI Connection", "MCP 服务": "MCP Service",
  "定位与环境": "Location & Environment"
};
const uiLabel = (key: string) => uiLabels[key] || key;
const nav = [
  { label: "今日", english: "Today", icon: "home" },
  { label: "聊天", english: "Chat", icon: "chat" },
  { label: "欲望", english: "Desire", icon: "heart" },
  { label: "日记", english: "Journal", icon: "diary" },
  { label: "便笺", english: "Notes", icon: "note" },
  { label: "提醒", english: "Reminders", icon: "check" },
  { label: "纪念日", english: "Dates", icon: "calendar" },
  { label: "音乐", english: "Music", icon: "music" },
  { label: "相册", english: "Album", icon: "image" },
  { label: "记忆库", english: "Memory", icon: "library" },
  { label: "Pandora", english: "Pandora", icon: "box" },
  { label: "设置", english: "Settings", icon: "settings" },
];
type NoteItem = {
  id: string;
  text: string;
  kind: "user" | "agent";
  tone: string;
  createdAt: string;
};
type TodoItem = {
  id: string;
  title: string;
  done: boolean;
  tag: string;
  due: string;
  createdAt: string;
};
type AnniversaryBackground = { mode: "theme" | "color" | "image"; color?: string; image?: string };
type AnniversaryItem = {
  id: string;
  title: string;
  date: string;
  repeats: boolean;
  background?: AnniversaryBackground;
};
type DiaryEntry = { user: string; agent: string; updatedAt: string };
type DiaryDocument = Record<string, DiaryEntry>;
type Track = {
  id: string;
  title: string;
  artist: string;
  duration?: string;
  url: string;
  cover?: string;
  neteaseId?: string;
  album?: string;
  playable?: boolean;
  lyrics?: Array<{ time: number; text: string }>;
};
type MusicPlayMode = "order" | "repeat" | "single" | "random";
type MusicTogetherState = {
  status?: "idle" | "invited" | "connected" | "offline";
  distanceKm?: number;
  totalListeningSeconds?: number;
  sessionStartedAt?: string;
  updatedAt?: string;
  inviteRequestedAt?: string;
};
type PlayerSnapshot = {
  playing: boolean;
  currentTime: number;
  duration: number;
  trackId?: string;
  canSeek: boolean;
};
type PlayerAdapter = {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  previous: () => void;
  next: () => void;
  select: (index: number) => void;
  getState: () => PlayerSnapshot;
};
type MusicCardData = {
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: string;
  url?: string;
  playable?: boolean;
  message?: string;
  source?: string;
};
type MusicPlaylistIntent = Pick<MusicCardData, "trackId" | "title" | "artist" | "album" | "cover" | "duration" | "url" | "playable" | "source">;
type FavoriteItem = {
  id: string;
  folderId: string;
  messageId: string;
  itemId?: string;
  threadId?: string;
  conversationId: string;
  conversationTitle: string;
  role: "user" | "agent" | "system";
  content: string;
  createdAt: string;
};
type MusicControl = { id: string; action: "play" | "pause" | "next" | "previous" | "play_track"; trackId?: string; replaceQueue?: boolean; processedAt?: string };
type MusicPlaybackState = { trackId?: string; playing?: boolean; positionSeconds?: number; durationSeconds?: number; queueLength?: number; updatedAt?: string };
type MusicResumeState = Pick<MusicPlaybackState, "trackId" | "positionSeconds" | "updatedAt">;
type MusicQueueUpdate = { autoplay?: boolean; trackId?: string };
type ConnectionSettings = Record<string, Record<string, string>>;
type ChatAttachment = {
  key: string;
  url: string;
  name: string;
  type: string;
  size: number;
};
type StickerMessageData = {
  assetId: string;
  url: string;
  width: number;
  height: number;
  mimeType: string;
  alt: string;
  description?: string;
  category?: string;
};
type StickerCatalogItem = StickerMessageData & { name?: string; categoryId?: string | null; favorite?: boolean; createdAt?: string; lastUsedAt?: string | null; useCount?: number; status?: string };
type StickerCategoryItem = { id: string; name: string; description: string; sortOrder: number };
type EnvironmentSnapshot = {
  permission: "unknown" | "granted" | "denied";
  latitude?: number;
  longitude?: number;
  temperature?: number;
  weatherCode?: number;
  timezone?: string;
  updatedAt?: string;
  error?: string;
};
type VesperPreferences = {
  reminders: boolean;
  anniversaries: boolean;
  agentNotes: boolean;
  careFrequency: "off" | "daily" | "twice-weekly";
  memoryDiary: boolean;
  memoryNotes: boolean;
  memoryChat: boolean;
  lastExportAt?: string;
};
const defaultPreferences: VesperPreferences = {
  reminders: true,
  anniversaries: true,
  agentNotes: true,
  careFrequency: "daily",
  memoryDiary: true,
  memoryNotes: true,
  memoryChat: true,
};

function readLocalValue<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(window.localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

function mergeMusicTracks(current: Track[], incoming: Track[]) {
  const next = [...current];
  for (const track of incoming) {
    const index = next.findIndex((item) => item.id === track.id || (item.neteaseId && item.neteaseId === track.neteaseId));
    if (index >= 0) next[index] = { ...next[index], ...track };
    else next.push(track);
  }
  return next;
}

export default function Home() {
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  useEffect(() => {
    if (Capacitor.isNativePlatform()) document.documentElement.dataset.native = "true";
    if (Capacitor.getPlatform() !== "ios") return;
    const hideAccessory = () => {
      if (!Capacitor.isPluginAvailable("Keyboard")) return;
      void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(error => {
        console.warn("Could not hide the keyboard accessory bar", error);
      });
    };
    hideAccessory();
    document.addEventListener("focusin", hideAccessory);
    return () => document.removeEventListener("focusin", hideAccessory);
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [desktopNavigation, setDesktopNavigation] = useState(false);
  useEffect(() => {
    const viewport = window.matchMedia("(min-width: 1024px)");
    const syncNavigation = () => {
      setDesktopNavigation(viewport.matches);
      setDrawerOpen(false);
    };
    syncNavigation();
    viewport.addEventListener("change", syncNavigation);
    return () => viewport.removeEventListener("change", syncNavigation);
  }, []);
  const [active, setActiveSection] = useState("今日");
  const [visitedSections, setVisitedSections] = useState(["今日"]);
  const setActive = useCallback((section: string) => {
    setVisitedSections((sections) => sections.includes(section) ? sections : [...sections, section]);
    setActiveSection(section);
  }, []);
  useMobileViewport();

  const [historyOpen, setHistoryOpen] = useState(false);
  const [voiceCallOpen, setVoiceCallOpen] = useState(false);
  const [conversationId, setConversationId] = useState(() => latestLocalConversationId());
  const [watchConversationId, setWatchConversationId] = useLocalDocument("watch-conversation", "watch-together");
  const [focusMessageId, setFocusMessageId] = useState("");
  const initialProfile = readLocalValue("vesper-local-profile", { userName: "Vera", agentName: "Rowan", userAvatar: "", agentAvatar: "" });
  const storedAppearance = readLocalValue("vesper-local-appearance", { accent: "#647e94", background: DEFAULT_APP_BACKGROUND });
  const initialAppearance = {
    accent: normalizeNeutralAccent(storedAppearance.accent),
    background: normalizeAppBackground(storedAppearance.background),
  };
  const [userName, setUserName] = useState(!initialProfile.userName || initialProfile.userName === "我" ? "Vera" : initialProfile.userName);
  const [agentName, setAgentName] = useState(!initialProfile.agentName || initialProfile.agentName === "Vesper" ? "Rowan" : initialProfile.agentName);
  const [userAvatar, setUserAvatar] = useState(initialProfile.userAvatar);
  const [agentAvatar, setAgentAvatar] = useState(initialProfile.agentAvatar);
  const [accent, setAccent] = useState(initialAppearance.accent);
  const [customBackground, setCustomBackground] = useState(initialAppearance.background || DEFAULT_APP_BACKGROUND);
  const [trackIndex, setTrackIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [tracks, setTracks] = usePersistentDocument<Track[]>("music", []);
  const [queue, setQueue] = usePersistentDocument<Track[]>("musicQueue", []);
  const avatarInput = useRef<HTMLInputElement>(null);
  const agentAvatarInput = useRef<HTMLInputElement>(null);
  const changeAvatar = async (file: File | undefined, setter: (photo: string) => void) => {
    if (!file) return;
    try {
      const preview = await localImage(file, 640, 0.88);
      setter(preview);
      try { const { url } = await uploadImage(file); setter(url); } catch { /* Keep the local preview for profile sync. */ }
    } catch { window.alert("Could not read the image. Please select it again."); }
  };
  const [favorites, setFavorites] = usePersistentDocument<FavoriteItem[]>("favorites", []);
  const [musicControl, setMusicControl] = usePersistentDocument<MusicControl | null>("musicControl", null);
  const [, setMusicPlayback] = usePersistentDocument<MusicPlaybackState>("musicPlayback", {});
  const [musicResume, setMusicResume] = useLocalDocument<MusicResumeState>("music-resume", {});
  const [savedMusicCookie] = useLocalDocument("netease-music-u", "");
  const [musicTogether, setMusicTogether] = usePersistentDocument<MusicTogetherState>("musicTogether", {});
  const [playMode, setPlayMode] = useState<MusicPlayMode>(() => readLocalValue<MusicPlayMode>("vesper-music-play-mode", "order"));
  const [musicToast, setMusicToast] = useState("");
  const [musicPlaylistIntent, setMusicPlaylistIntent] = useState<MusicPlaylistIntent | null>(null);
  const globalPlayer = useRef<HTMLAudioElement>(null);
  const playbackTimeRef = useRef(0);
  const playbackResumeReady = useRef(false);
  const [storageReady, setStorageReady] = useState(false);
  const [environment, setEnvironment] =
    usePersistentDocument<EnvironmentSnapshot>("environment", {
      permission: "unknown",
    });
  const queueSeeded = readLocalValue<boolean>("vesper-music-queue-seeded", false);
  // `music` is the full library. `musicQueue` is the selected playlist that is
  // currently being listened to. A fresh PWA install has no local queue marker,
  // but it can still receive a non-empty queue from D1; never fall back to the
  // full library in that case.
  const activeTracks = queue.length > 0 || queueSeeded ? queue : tracks;
  const currentTrack = activeTracks[trackIndex];
  const showMusicToast = (message: string) => {
    setMusicToast(message);
    window.setTimeout(() => setMusicToast((current) => current === message ? "" : current), 1800);
  };
  const replaceMusicQueue = useCallback((nextQueue: Track[], options: MusicQueueUpdate = {}) => {
    const now = new Date().toISOString();
    const preferredTrackId = options.trackId;
    const retainedIndex = preferredTrackId
      ? nextQueue.findIndex((track) => track.id === preferredTrackId || track.neteaseId === preferredTrackId)
      : currentTrack
        ? nextQueue.findIndex((track) => track.id === currentTrack.id || track.neteaseId === currentTrack.neteaseId)
        : -1;
    const nextIndex = retainedIndex >= 0 ? retainedIndex : 0;

    // Stamp the local revision before React's deferred persistence effect runs.
    // The queue poller uses this timestamp to reject an older server snapshot
    // while the selected playlist is being written to D1.
    window.localStorage.setItem("vesper-music-queue-seeded", "true");
    window.localStorage.setItem("vesper-document-meta-musicQueue", JSON.stringify({ updatedAt: now, source: "local" }));
    setQueue(nextQueue);
    setTrackIndex(nextIndex);
    if (options.autoplay) {
      const target = nextQueue[nextIndex];
      if (target?.url && target.playable !== false) setPlaying(true);
      else {
        setPlaying(false);
        const message = "No playable source is available for this song.";
        setMusicToast(message);
        window.setTimeout(() => setMusicToast((current) => current === message ? "" : current), 1800);
      }
    } else if (currentTrack && retainedIndex < 0) {
      setPlaying(false);
    }

    // Do not leave a window for the three-second device poll to read the old
    // playlist back from D1. The generic document hook still provides its
    // retry path if this immediate write is unavailable.
    void fetch(apiUrl("/api/state"), {
      method: "PUT",
      headers: appHeaders(true),
      body: JSON.stringify({ key: "musicQueue", value: nextQueue }),
    }).then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { updatedAt?: string };
      window.localStorage.setItem("vesper-document-meta-musicQueue", JSON.stringify({ updatedAt: result.updatedAt || now, source: "local" }));
    }).catch(() => {});
  }, [currentTrack, setQueue]);
  useEffect(() => {
    const resolveCard = (event: Event) => {
      const card = (event as CustomEvent<{ card?: MusicCardData }>).detail?.card;
      const neteaseId = card?.trackId?.replace(/^netease-/, "");
      if (!card || card.source !== "netease" || !neteaseId) return;
      const existing = tracks.find((track) => track.id === card.trackId || track.neteaseId === neteaseId);
      if (existing?.url && savedMusicCookie) return;
      void requestNeteaseLibrary(apiUrl("/api/music/library"), appHeaders(true), {
        action: "resolve",
        songIds: [neteaseId],
        cookie: savedMusicCookie,
        tracks: [{
          id: card.trackId,
          neteaseId,
          title: card.title,
          artist: card.artist,
          album: card.album,
          cover: card.cover,
          duration: card.duration,
          url: card.url || "",
          playable: card.playable,
        }],
      }).then((result) => {
        if (!result.tracks?.length) return;
        setTracks((current) => mergeMusicTracks(current, result.tracks as Track[]));
      }).catch(() => {});
    };
    window.addEventListener("vesper-music-card", resolveCard);
    return () => window.removeEventListener("vesper-music-card", resolveCard);
  }, [savedMusicCookie, setTracks, tracks]);
  useEffect(() => {
    const refreshLibrary = () => {
      void fetch(apiUrl("/api/state?key=music"), { cache: "no-store", headers: appHeaders() })
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((result: { value?: Track[] | null }) => {
          if (!Array.isArray(result.value)) return;
          window.dispatchEvent(new CustomEvent("vesper-document-change", { detail: { key: "music", value: result.value } }));
        })
        .catch(() => {});
    };
    window.addEventListener("vesper-music-library-refresh", refreshLibrary);
    return () => window.removeEventListener("vesper-music-library-refresh", refreshLibrary);
  }, []);
  const playerAdapter: PlayerAdapter = {
    play: () => {
      if (!currentTrack?.url || currentTrack.playable === false) return showMusicToast("No playable audio is available for this song.");
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    toggle: () => {
      if (playing) setPlaying(false);
      else {
        if (!currentTrack?.url || currentTrack.playable === false) return showMusicToast("No playable audio is available for this song.");
        setPlaying(true);
      }
    },
    seek: (time) => {
      if (!Number.isFinite(playbackDuration) || playbackDuration <= 0) return showMusicToast("Audio duration is not available yet.");
      const nextTime = Math.max(0, Math.min(playbackDuration, time));
      if (globalPlayer.current) globalPlayer.current.currentTime = nextTime;
      setPlaybackTime(nextTime);
    },
    previous: () => {
      if (!activeTracks.length) return;
      setTrackIndex((index) => (index - 1 + activeTracks.length) % activeTracks.length);
    },
    next: () => {
      if (!activeTracks.length) return;
      setTrackIndex((index) => (index + 1) % activeTracks.length);
    },
    select: (index) => {
      const track = activeTracks[index];
      if (!track) return;
      if (!track.url || track.playable === false) return showMusicToast("No playable audio is available for this song.");
      setTrackIndex(index);
      setPlaying(true);
    },
    getState: () => ({
      playing,
      currentTime: playbackTime,
      duration: playbackDuration,
      trackId: currentTrack?.id,
      canSeek: Boolean(currentTrack?.url && playbackDuration > 0),
    }),
  };
  useEffect(() => {
    if (musicTogether.status !== "connected" || musicTogether.sessionStartedAt) return;
    const startedAt = new Date().toISOString();
    setMusicTogether((current) => current.status === "connected" && !current.sessionStartedAt ? { ...current, sessionStartedAt: startedAt, updatedAt: startedAt } : current);
  }, [musicTogether.status, musicTogether.sessionStartedAt, setMusicTogether]);
  useEffect(() => {
    playbackTimeRef.current = playbackTime;
  }, [playbackTime]);
  useEffect(() => {
    // Resume is a one-time bootstrap action. Re-running it whenever the current
    // track changes makes a manual next/previous action bounce back to the old
    // song and can leave the audio element between two sources.
    if (playbackResumeReady.current || !activeTracks.length) return;
    const savedIndex = musicResume.trackId
      ? activeTracks.findIndex((track) => track.id === musicResume.trackId || track.neteaseId === musicResume.trackId)
      : -1;
    if (savedIndex >= 0) setTrackIndex(savedIndex);
    playbackResumeReady.current = true;
  }, [activeTracks, musicResume.trackId]);
  useEffect(() => {
    if (!playbackResumeReady.current || !currentTrack?.id) return;
    setMusicResume((current) => current.trackId === currentTrack.id ? current : {
      trackId: currentTrack.id,
      positionSeconds: Math.floor(playbackTimeRef.current),
      updatedAt: new Date().toISOString(),
    });
  }, [currentTrack?.id, setMusicResume]);
  useEffect(() => {
    if (!playbackResumeReady.current || !currentTrack?.id) return;
    const publish = () => {
      setMusicPlayback({
        trackId: currentTrack?.id,
        playing,
        positionSeconds: Math.floor(playbackTimeRef.current),
        durationSeconds: Math.floor(playbackDuration),
        queueLength: activeTracks.length,
        updatedAt: new Date().toISOString(),
      });
    };
    publish();
    if (!playing) return;
    const timer = window.setInterval(publish, 10_000);
    return () => window.clearInterval(timer);
  }, [activeTracks.length, currentTrack?.id, playbackDuration, playing, setMusicPlayback]);
  const [wakeRequest, setWakeRequest] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("vesper-pwa")) {
      url.searchParams.delete("vesper-pwa");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);
  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const section = (event as CustomEvent<{ section?: string }>).detail?.section;
      const match = nav.find((item) => item.label === section || item.english.toLowerCase() === String(section || "").toLowerCase());
      if (match) setActive(match.label);
    };
    window.addEventListener("vesper-navigate", handleNavigate);
    return () => window.removeEventListener("vesper-navigate", handleNavigate);
  }, []);
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js?v=29", { scope: "/", updateViaCache: "none" }).then((registration) => registration.update());
    }
  }, []);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const openSection = (event: MessageEvent) => {
      if (event.data?.type !== 'vesper-open-section') return;
      if (event.data.section === 'chat' && typeof event.data.conversationId === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(event.data.conversationId)) {
        setVisitedSections(sections => sections.includes('聊天') ? sections : [...sections, '聊天']);
        setConversationId(event.data.conversationId); setActive('聊天'); return;
      }
      if (event.data.section !== 'desire') return;
      setVisitedSections(sections => sections.includes('欲望') ? sections : [...sections, '欲望']);
      setActive('欲望');
    };
    navigator.serviceWorker.addEventListener('message', openSection);
    return () => navigator.serviceWorker.removeEventListener('message', openSection);
  }, []);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('section') === 'chat' && /^[a-zA-Z0-9:_-]{1,128}$/.test(query.get('conversation') || '')) {
      setVisitedSections(sections => sections.includes('聊天') ? sections : [...sections, '聊天']);
      setConversationId(query.get('conversation')!); setActive('聊天');
    }
    if (query.get('section') === 'desire') {
      setVisitedSections(sections => sections.includes('欲望') ? sections : [...sections, '欲望']);
      setActive('欲望');
    }
    const code = query.get("code");
    const state = query.get("state");
    const oauthError = query.get("error");
    const oauthErrorDescription = query.get("error_description");
    const raw = window.sessionStorage.getItem("vesper-mcp-oauth-pending");
    if (!raw || (!code && !oauthError)) return;
    const returnToDesire = () => {
      if (window.sessionStorage.getItem("vesper-mcp-return") !== "desire") return;
      window.sessionStorage.removeItem("vesper-mcp-return");
      setVisitedSections(sections => sections.includes("欲望") ? sections : [...sections, "欲望"]);
      setActive("欲望");
    };
    try {
      const pending = JSON.parse(raw) as {
        serverId: string;
        state: string;
        verifier: string;
        tokenUrl: string;
        clientId: string;
        clientSecret?: string;
        redirectUri: string;
        resource?: string;
      };
      if (pending.state !== state) throw new Error("OAuth state mismatch");
      if (oauthError) {
        const detail = oauthErrorDescription?.trim() || oauthError;
        const key = "vesper-local-external-mcp-servers";
        const servers = readLocalValue<ExternalMcpEntry[]>(key, []);
        window.localStorage.setItem(
          key,
          JSON.stringify(servers.map((server) => server.id === pending.serverId ? { ...server, oauthStatus: undefined } : server)),
        );
        window.sessionStorage.setItem("vesper-mcp-oauth-result", `OAuth authorization incomplete: ${detail.slice(0, 180)}`);
        window.sessionStorage.removeItem("vesper-mcp-oauth-pending");
        window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
        returnToDesire();
        return;
      }
      if (!code) throw new Error("The OAuth callback is missing an authorization code.");
      void fetch("/api/mcp/oauth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...pending, code }),
      })
        .then(async (response) => {
          const result = (await response.json()) as { accessToken?: string; error?: string };
          if (!response.ok || !result.accessToken)
            throw new Error(result.error || "OAuth authorization failed");
          const key = "vesper-local-external-mcp-servers";
          const servers = readLocalValue<ExternalMcpEntry[]>(key, []);
          window.localStorage.setItem(
            key,
            JSON.stringify(
              servers.map((server) =>
                server.id === pending.serverId
                  ? { ...server, token: result.accessToken, oauthStatus: "authorized" }
                  : server,
              ),
            ),
          );
          window.sessionStorage.setItem("vesper-mcp-oauth-result", "Authorized");
        })
        .catch((reason) =>
          window.sessionStorage.setItem(
            "vesper-mcp-oauth-result",
            reason instanceof Error ? reason.message : "OAuth authorization failed",
          ),
        )
        .finally(() => {
          window.sessionStorage.removeItem("vesper-mcp-oauth-pending");
          window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
          returnToDesire();
        });
    } catch (reason) {
      window.sessionStorage.setItem(
        "vesper-mcp-oauth-result",
        reason instanceof Error ? reason.message : "OAuth authorization failed",
      );
      returnToDesire();
    }
  }, []);
  useEffect(() => {
    const audio = globalPlayer.current;
    if (!audio) return;
    if (playing && currentTrack)
      void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, [playing, currentTrack]);
  useEffect(() => {
    if (queueSeeded || !tracks.length) return;
    setQueue(tracks);
    window.localStorage.setItem("vesper-music-queue-seeded", "true");
  }, [queueSeeded, tracks, setQueue]);
  useEffect(() => {
    if (trackIndex < activeTracks.length) return;
    const timer = window.setTimeout(() => {
      setTrackIndex(Math.max(0, activeTracks.length - 1));
      if (!activeTracks.length) setPlaying(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTracks.length, trackIndex]);
  useEffect(() => {
    const audio = globalPlayer.current;
    if (!audio) return;
    audio.currentTime = 0;
    setPlaybackTime(0);
  }, [currentTrack?.id]);
  useEffect(() => {
    if (!musicControl || musicControl.processedAt) return;
    const timer = window.setTimeout(() => {
      if (musicControl.action === "play") setPlaying(true);
      if (musicControl.action === "pause") setPlaying(false);
      if (musicControl.action === "next" && activeTracks.length) setTrackIndex((index) => (index + 1) % activeTracks.length);
      if (musicControl.action === "previous" && activeTracks.length) setTrackIndex((index) => (index - 1 + activeTracks.length) % activeTracks.length);
      if (musicControl.action === "play_track" && musicControl.trackId) {
        const index = activeTracks.findIndex((track) => track.id === musicControl.trackId || track.neteaseId === musicControl.trackId);
        // The queue is polled separately. Keep the command pending until the
        // newly-written queue has arrived, otherwise a fast poll could mark a
        // valid server command as processed before its track is visible.
        if (index < 0) return;
        if (activeTracks[index].url) { setTrackIndex(index); setPlaying(true); }
      }
      setMusicControl({ ...musicControl, processedAt: new Date().toISOString() });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [musicControl, setMusicControl, activeTracks]);
  useEffect(() => {
    const poll = async () => {
      try {
        const response = await fetch(apiUrl("/api/state?key=musicControl"), { cache: "no-store", headers: appHeaders() });
        if (!response.ok) return;
        const result = await response.json() as { value?: MusicControl | null };
        if (result.value?.id && result.value.id !== musicControl?.id) setMusicControl(result.value);
        const queueResponse = await fetch(apiUrl("/api/state?key=musicQueue"), { cache: "no-store", headers: appHeaders() });
        if (queueResponse.ok) {
          const queueResult = await queueResponse.json() as { value?: Track[] | null; updatedAt?: string };
          if (Array.isArray(queueResult.value)) {
            const localMeta = readLocalValue<{ updatedAt?: string }>("vesper-document-meta-musicQueue", {});
            const localUpdatedAt = localMeta.updatedAt ? Date.parse(localMeta.updatedAt) : 0;
            const remoteUpdatedAt = queueResult.updatedAt ? Date.parse(queueResult.updatedAt) : 0;
            // A playlist selection is written optimistically. Never let a stale
            // poll put the previous playlist (and its cover) back on screen.
            if (localUpdatedAt && remoteUpdatedAt && remoteUpdatedAt < localUpdatedAt) return;
            window.localStorage.setItem("vesper-music-queue-seeded", "true");
            if (queueResult.updatedAt) window.localStorage.setItem("vesper-document-meta-musicQueue", JSON.stringify({ updatedAt: queueResult.updatedAt, source: "remote" }));
            setQueue(queueResult.value);
          }
        }
      } catch {}
    };
    const timer = window.setInterval(() => void poll(), 3000);
    return () => window.clearInterval(timer);
  }, [musicControl?.id, setMusicControl, setQueue]);
  useEffect(() => {
    const nextTrack = () => {
      if (!activeTracks.length) return;
      setTrackIndex((index) => {
        if (playMode === "single") return index;
        if (playMode === "order" && index >= activeTracks.length - 1) {
          window.setTimeout(() => setPlaying(false), 0);
          return index;
        }
        if (playMode === "random") {
          if (activeTracks.length < 2) return index;
          let next = index;
          while (next === index) next = Math.floor(Math.random() * activeTracks.length);
          return next;
        }
        return (index + 1) % activeTracks.length;
      });
      setPlaying(true);
    };
    const audio = globalPlayer.current;
    if (audio) audio.onended = nextTrack;
    return () => { if (audio) audio.onended = null; };
  }, [activeTracks, playMode]);
  useEffect(() => {
    const showToast = (message: string) => {
      setMusicToast(message);
      window.setTimeout(() => setMusicToast((current) => current === message ? "" : current), 1600);
    };
    const play = (event: Event) => {
      const trackId = (event as CustomEvent<{ trackId?: string }>).detail?.trackId;
      const index = activeTracks.findIndex((track) => track.id === trackId || track.neteaseId === trackId);
      if (index < 0) return showToast("This song is not in the current queue.");
      if (!activeTracks[index].url) return showToast("No playable source is available for this song.");
      setTrackIndex(index); setPlaying(true);
    };
    const add = (event: Event) => {
      const trackId = (event as CustomEvent<{ trackId?: string }>).detail?.trackId;
      const track = tracks.find((item) => item.id === trackId || item.neteaseId === trackId);
      if (!track) return showToast("Song not found");
      if (activeTracks.some((item) => item.id === track.id || item.neteaseId === track.neteaseId)) return showToast("Already in the queue");
      replaceMusicQueue([...activeTracks, track]);
      showToast("Added to queue");
    };
    const open = () => setActive("音乐");
    window.addEventListener("vesper-music-play", play);
    window.addEventListener("vesper-music-queue-add", add);
    window.addEventListener("vesper-music-open", open);
    return () => {
      window.removeEventListener("vesper-music-play", play);
      window.removeEventListener("vesper-music-queue-add", add);
      window.removeEventListener("vesper-music-open", open);
    };
  }, [activeTracks, playMode, queueSeeded, replaceMusicQueue, tracks]);
  const cyclePlayMode = () => {
    const modes: MusicPlayMode[] = ["order", "repeat", "single", "random"];
    const next = modes[(modes.indexOf(playMode) + 1) % modes.length];
    setPlayMode(next);
    window.localStorage.setItem("vesper-music-play-mode", next);
    const labels: Record<MusicPlayMode, string> = { order: "Play in order", repeat: "Repeat queue", single: "Repeat one", random: "Shuffle" };
    setMusicToast(labels[next]);
    window.setTimeout(() => setMusicToast(""), 1600);
  };
  const isPhotoBackground = customBackground.includes("url(");
  const canvasColor = isPhotoBackground ? DEFAULT_CANVAS_COLOR : customBackground || DEFAULT_CANVAS_COLOR;
  // Keep Safari chrome and the overscroll canvas in step with the saved appearance.
  useEffect(() => {
    const root = document.documentElement;
    const previousCanvas = root.style.getPropertyValue("--vesper-browser-canvas");
    root.style.setProperty("--vesper-browser-canvas", canvasColor);
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const previous = metas.map((meta) => meta.content);
    metas.forEach((meta) => { meta.content = canvasColor; });
    return () => {
      if (previousCanvas) root.style.setProperty("--vesper-browser-canvas", previousCanvas);
      else root.style.removeProperty("--vesper-browser-canvas");
      metas.forEach((meta, index) => { meta.content = previous[index]; });
    };
  }, [canvasColor]);
  const shellStyle = {
    "--theme-accent": accent,
    backgroundColor: canvasColor,
    backgroundImage: isPhotoBackground ? customBackground : "none",
    "--vesper-page-background": isPhotoBackground ? customBackground : "none",
  } as CSSProperties;
  const navigateTo = (label: string) => {
    setDrawerOpen(false);
    if (label !== active) setActive(label);
  };
  const chatInitialized = useRef(false);
  useEffect(() => {
    if (active !== "聊天" || chatInitialized.current) return;
    let cancelled = false;
    void resolveLatestConversationId().then((id) => {
      if (!cancelled) {
        chatInitialized.current = true;
        setConversationId(id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active]);
  useEffect(() => {
    let live = true;
    let hasLocalProfile = false;
    let hasLocalAppearance = false;
    try {
      const localProfile = window.localStorage.getItem("vesper-local-profile");
      const localAppearance = window.localStorage.getItem("vesper-local-appearance");
      if (localProfile) hasLocalProfile = true;
      if (localAppearance) hasLocalAppearance = true;
    } catch {}
    fetch(apiUrl("/api/state"), { headers: appHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((raw) => {
        if (!live) return;
        const data = raw as { documents: Record<string, { value: unknown }> };
        const docs = data.documents;
        const profile = docs.profile?.value as
          | {
              userName?: string;
              agentName?: string;
              userAvatar?: string;
              agentAvatar?: string;
            }
          | undefined;
        const appearance = docs.appearance?.value as
          { accent?: string; background?: string } | undefined;
        if (profile && !hasLocalProfile) {
          setUserName(!profile.userName || profile.userName === "我" ? "Vera" : profile.userName);
          setAgentName(!profile.agentName || profile.agentName === "Vesper" ? "Rowan" : profile.agentName);
          setUserAvatar(profile.userAvatar || "");
          setAgentAvatar(profile.agentAvatar || "");
        }
        if (appearance && !hasLocalAppearance) {
          setAccent(normalizeNeutralAccent(appearance.accent));
          setCustomBackground(normalizeAppBackground(appearance.background));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (live) setStorageReady(true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(
      "vesper-local-profile",
      JSON.stringify({ userName, agentName, userAvatar, agentAvatar }),
    );
    const timer = window.setTimeout(
      () =>
        fetch(apiUrl("/api/state"), {
          method: "PUT",
          headers: appHeaders(true),
          body: JSON.stringify({
            key: "profile",
            value: { userName, agentName, userAvatar, agentAvatar },
          }),
        }).catch(() => {}),
      260,
    );
    return () => window.clearTimeout(timer);
  }, [storageReady, userName, agentName, userAvatar, agentAvatar]);
  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(
      "vesper-local-appearance",
      JSON.stringify({ accent, background: customBackground }),
    );
    const timer = window.setTimeout(
      () =>
        fetch(apiUrl("/api/state"), {
          method: "PUT",
          headers: appHeaders(true),
          body: JSON.stringify({
            key: "appearance",
            value: { accent, background: customBackground },
          }),
        }).catch(() => {}),
      260,
    );
    return () => window.clearTimeout(timer);
  }, [storageReady, accent, customBackground]);
  if (!mounted)
    return (
      <main className="stage">
        <section className="app-shell" />
      </main>
    );
  return (
    <main className="stage" style={shellStyle}>
      <WindowOpening />
      <input ref={avatarInput} type="file" accept="image/*" hidden onChange={e => { void changeAvatar(e.target.files?.[0], setUserAvatar); e.target.value = ""; }} />
      <input ref={agentAvatarInput} type="file" accept="image/*" hidden onChange={e => { void changeAvatar(e.target.files?.[0], setAgentAvatar); e.target.value = ""; }} />
      <audio
        ref={globalPlayer}
        src={currentTrack?.url}
        onTimeUpdate={(event) => setPlaybackTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setPlaybackDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onError={() => {
          setPlaying(false);
          setPlaybackDuration(0);
          showMusicToast("This audio cannot be played in the browser.");
        }}
      />
      <section className="app-shell" style={{ "--theme-accent": accent } as CSSProperties}>
        <header
          className={`${active === "聊天" ? "app-header chat-mode" : active === "音乐" ? "app-header music-mode" : "app-header"}${historyOpen ? " history-host-shift" : ""}`}
        >
          <button
            className="icon-button"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
          >
            <Icon name="menu" />
          </button>
          {active === "今日" ? (
            <div className="wordmark">
              <span className="home-app-mark">
                <img src="/icon-192-20260907-moon-v1.png" alt="" />
              </span>
              <b>Vesper</b>
            </div>
          ) : active === "聊天" ? (
            <div
              className="chat-identity"
              aria-label={`${userName} and ${agentName}`}
            >
              <button className="identity-avatar" aria-label="Change Vera’s avatar" onClick={() => avatarInput.current?.click()}><AvatarMark src={userAvatar} label={userName} kind="user" /></button>
              <button className="identity-avatar" aria-label="Change Rowan’s avatar" onClick={() => agentAvatarInput.current?.click()}><AvatarMark src={agentAvatar} label={agentName} kind="agent" /></button>
            </div>
          ) : (
            <h1 className="page-name">{nav.find((item) => item.label === active)?.english || active}</h1>
          )}
          {active === "聊天" ? (
            <div className="chat-header-actions">
              <button
                aria-label="New conversation"
                onClick={() => {
                  const id = `chat-${Date.now()}-${crypto.randomUUID()}`;
                  rememberConversation(id, "New conversation");
                  setConversationId(id);
                }}
              >
                <Icon name="plus" />
              </button>
              <button
                aria-label="Voice call"
                onClick={() => setVoiceCallOpen(true)}
              >
                <Icon name="phone" />
              </button>
              <button
                aria-label="Chat history"
                onClick={() => setHistoryOpen(true)}
              >
                <Icon name="archive" />
              </button>
            </div>
          ) : active === "音乐" ? (
            <span className="music-header-spacer" aria-hidden="true" />
          ) : (
            <button
              className="avatar-button"
              onClick={() => avatarInput.current?.click()}
            >
              {userAvatar ? (
                <AvatarMark src={userAvatar} label={userName} kind="user" />
              ) : (
                userName.slice(0, 1)
              )}
            </button>
          )}
        </header>
        {visitedSections.map((section) => (
        <div className={`scroll-view${section === "音乐" ? " music-scroll-view" : ""}${historyOpen ? " history-host-shift" : ""}`} key={section} hidden={active !== section} data-section={section}>
          {section === "今日" ? (
            <Today
              active={active === "今日"}
              onPrevious={() => { if (activeTracks.length) setTrackIndex(index => (index - 1 + activeTracks.length) % activeTracks.length); }}
              onNext={() => { if (activeTracks.length) setTrackIndex(index => (index + 1) % activeTracks.length); }}
              track={currentTrack}
              playing={playing}
              onToggle={() => setPlaying(!playing)}
              userName={userName}
              onOpenSection={(section) => setActive(section)}
            />
          ) : section === "聊天" ? (
              active === "Pandora" && conversationId === watchConversationId ? null : <ConnectedChat
                wakeRequest={wakeRequest}
                onWakeHandled={() => setWakeRequest(null)}
                key={conversationId}
                conversationId={conversationId}
                onSelectConversation={setConversationId}
              agentName={agentName}
              userName={userName}
                favorites={favorites}
                setFavorites={setFavorites}
                focusMessageId={focusMessageId}
                currentTrack={currentTrack}
                playing={playing}
                onToggleMusic={() => setPlaying((value) => !value)}
                onNextMusic={() => {
                  if (activeTracks.length) setTrackIndex((index) => (index + 1) % activeTracks.length);
                }}
                onOpenMusic={() => setActive("音乐")}
                onAddMusicToPlaylist={(card) => {
                  setMusicPlaylistIntent(card);
                  setActive("音乐");
                }}
              />
          ) : section === "日记" ? (
            <Diary />
          ) : section === "便笺" ? (
            <Notes />
          ) : section === "提醒" ? (
            <Todos />
          ) : section === "纪念日" ? (
            <Anniversaries />
          ) : section === "音乐" ? (
            <MusicPlayerUI
              queue={activeTracks}
              onQueue={replaceMusicQueue}
              selected={trackIndex}
              onTracks={(incoming) => setTracks((current) => {
                return mergeMusicTracks(current, incoming);
              })}
              playlistIntent={musicPlaylistIntent}
              onPlaylistIntentConsumed={() => setMusicPlaylistIntent(null)}
              playMode={playMode}
              onCycleMode={cyclePlayMode}
              toast={musicToast}
              adapter={playerAdapter}
              userName={userName}
              agentName={agentName}
              userAvatar={userAvatar}
              agentAvatar={agentAvatar}
              together={musicTogether}
              onInvite={() => setMusicTogether((current) => current.status === "connected" ? current : { ...current, status: "invited", inviteRequestedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })}
              onRemoveQueueItem={(index) => {
                const nextQueue = activeTracks.filter((_, itemIndex) => itemIndex !== index);
                replaceMusicQueue(nextQueue);
                if (!nextQueue.length) setPlaying(false);
              }}
            />
          ) : section === "相册" ? (
            <PhotoAlbum apiUrl={apiUrl} headers={appHeaders} active={active === "相册"} />
          ) : section === "记忆库" ? (
            <MemoryLibrary />
          ) : section === "Pandora" ? (
            <AppCenter renderReading={() => <InternalReadingRoom />} renderWatch={() => conversationId === watchConversationId && active !== "Pandora" ? null : <ConnectedChat key={watchConversationId} watchMode watchActive={active === "Pandora"} conversationId={watchConversationId} onSelectConversation={setWatchConversationId} agentName={agentName} userName={userName} favorites={favorites} setFavorites={setFavorites} playing={playing} onToggleMusic={() => setPlaying(value => !value)} onNextMusic={() => { if (activeTracks.length) setTrackIndex(index => (index + 1) % activeTracks.length); }} onOpenMusic={() => navigateTo("音乐")} onAddMusicToPlaylist={card => { setMusicPlaylistIntent(card); navigateTo("音乐"); }} />} onDesire={() => navigateTo("欲望")} onWake={() => { setWakeRequest(crypto.randomUUID()); navigateTo("聊天"); }} />
          ) : section === "欲望" ? (
            <DesirePanel agentName={agentName} apiUrl={apiUrl} headers={appHeaders} active={active === "欲望"} />
          ) : section === "设置" ? (
            <SettingsPage
              onOpenSection={navigateTo}
              accent={accent}
              onAccent={(value) => setAccent(normalizeNeutralAccent(value))}
              onBackground={(value) => setCustomBackground(normalizeAppBackground(value))}
              environment={environment}
              onEnvironment={setEnvironment}
            />
          ) : (
            <Placeholder title={section} />
          )}
        </div>
        ))}
        <nav className="mobile-navigation" aria-label="Navigation">
          {nav.filter(({ label }) => ["今日", "聊天", "音乐", "设置"].includes(label)).map(({ label, english, icon }) => (
            <button key={label} type="button" aria-current={active === label ? "page" : undefined}
              onClick={() => navigateTo(label)}>
              <NavIcon name={icon} />
              <span>{label === "今日" ? "Home" : label === "聊天" ? "Chat" : label === "设置" ? "Setting" : english}</span>
            </button>
          ))}
        </nav>
        <div
          className={drawerOpen ? "drawer-layer visible" : "drawer-layer"}
          aria-hidden={!desktopNavigation && !drawerOpen}
        >
          <button
            className="scrim"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="drawer" aria-label="Main navigation">
            <div className="drawer-head">
              <div className="drawer-brand">
                <span className="drawer-app-mark">
                  <img src="/icon-192-20260907-moon-v1.png" alt="" />
                </span>
                <div>
                  <b>Vesper</b>
                  <small>YOUR QUIET CORNER</small>
                </div>
              </div>
              <button
                className="icon-button"
                onClick={() => setDrawerOpen(false)}
              >
                <Icon name="close" />
              </button>
            </div>
            <nav>
              {nav.filter(item => item.label !== "设置").map(({ label, english, icon }) => (
                <button
                  key={label}
                  className={active === label ? "nav-row active" : "nav-row"}
                  aria-current={active === label ? "page" : undefined}
                  onClick={() => navigateTo(label)}
                >
                  <NavIcon name={icon} />
                  <span>{english}</span>
                  {active === label && <i />}
                </button>
              ))}
            </nav>
            <div className="drawer-bottom">
              <button
                className={active === "设置" ? "nav-row active" : "nav-row"}
                aria-current={active === "设置" ? "page" : undefined}
                onClick={() => navigateTo("设置")}
              >
                <NavIcon name="settings" />
                <span>Settings</span>
                {active === "设置" && <i />}
              </button>
              <SubscriptionUsage active={desktopNavigation || drawerOpen} socketUrl={codexSocketUrl} />
            </div>
          </aside>
        </div>
        {historyOpen && (
          <HistoryModal
            activeId={conversationId}
            favorites={favorites}
            onSelect={(id) => {
              setConversationId(id);
              setFocusMessageId("");
              setHistoryOpen(false);
            }}
            onDelete={(id) => {
              if (id === conversationId) setConversationId("main");
            }}
            onSelectFavorite={(item) => {
              setConversationId(item.conversationId);
              setFocusMessageId(item.messageId);
              setHistoryOpen(false);
            }}
            onRemoveFavorite={(id) => setFavorites((items) => items.filter((item) => item.id !== id))}
            onClose={() => setHistoryOpen(false)}
          />
        )}
        {voiceCallOpen && (
          <VoiceCallModal
            agentName={agentName}
            agentAvatar={agentAvatar}
            conversationId={conversationId}
            onClose={() => setVoiceCallOpen(false)}
          />
        )}
      </section>
    </main>
  );
}

function AvatarMark({
  src,
  label,
  kind,
}: {
  src: string;
  label: string;
  kind: "user" | "agent";
}) {
  return (
    <span
      className={`avatar-mark ${kind}`}
      style={src ? { backgroundImage: `url("${src}")` } : undefined}
    >
      <span>{src ? "" : label.slice(0, 1)}</span>
    </span>
  );
}

async function uploadImage(file: File) {
  const data = new FormData();
  data.append("file", file);
  const response = await fetch(apiUrl("/api/media"), {
    method: "POST",
    headers: appHeaders(),
    body: data,
  });
  if (!response.ok) throw new Error("Image upload failed");
  return (await response.json()) as { key: string; url: string };
}
async function localImage(file: File, maxSize = 1200, quality = 0.86) {
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    image.src = url;
  });
  const scale = Math.min(1, maxSize / Math.max(source.naturalWidth, source.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}
async function uploadMedia(file: File) {
  const data = new FormData();
  data.append("file", file);
  const response = await fetch(apiUrl("/api/media"), {
    method: "POST",
    headers: appHeaders(),
    body: data,
  });
  if (!response.ok) throw new Error("Attachment upload failed");
  return (await response.json()) as ChatAttachment;
}
async function fileSha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}
function usePersistentDocument<T>(key: string, initial: T) {
  const storageKey = `vesper-document-${key}`;
  const metaKey = `vesper-document-meta-${key}`;
  const [value, setValue] = useState<T>(() => readLocalValue<T>(storageKey, initial));
  const [ready, setReady] = useState(false);
  const lastSerialized = useRef(
    JSON.stringify(readLocalValue<T>(storageKey, initial)),
  );
  useEffect(() => {
    let live = true;
    let syncing = false;
    const reconcile = async (initialLoad = false) => {
      if (syncing) return;
      syncing = true;
      const localRaw = window.localStorage.getItem(storageKey);
      const localMeta = readLocalValue<{ updatedAt?: string }>(metaKey, {});
      try {
        const response = await fetch(apiUrl(`/api/state?key=${encodeURIComponent(key)}`), {
          cache: "no-store",
          headers: appHeaders(),
        });
        if (!response.ok) throw new Error("sync unavailable");
        const remote = (await response.json()) as { value: T | null; updatedAt?: string };
        if (!live || window.localStorage.getItem(storageKey) !== localRaw) return;
        // One-time recovery of favorites kept in the old PWA before empty-state sync was fixed.
        const migrationKey = "vesper-favorites-sync-v2";
        if (key === "favorites" && !window.localStorage.getItem(migrationKey)) {
          const localItems = localRaw ? JSON.parse(localRaw) as FavoriteItem[] : [];
          const remoteItems = Array.isArray(remote.value) ? remote.value as FavoriteItem[] : [];
          if (Array.isArray(localItems) && localItems.length) {
            window.localStorage.setItem("vesper-favorites-before-sync-v2", localRaw!);
            const merged = [...new Map([...remoteItems, ...localItems].map(item => [`${item.conversationId}:${item.messageId}`, item])).values()];
            const upload = await fetch(apiUrl("/api/state"), { method: "PUT", headers: appHeaders(true), body: JSON.stringify({ key, value: merged }) });
            if (!upload.ok) throw new Error("favorites recovery pending");
            const result = await upload.json() as { updatedAt: string };
            if (!live || window.localStorage.getItem(storageKey) !== localRaw) return;
            const serialized = JSON.stringify(merged);
            window.localStorage.setItem(storageKey, serialized);
            window.localStorage.setItem(metaKey, JSON.stringify({ updatedAt: result.updatedAt, source: "remote" }));
            lastSerialized.current = serialized;
            setValue(merged as T);
            window.localStorage.setItem(migrationKey, "done");
            return;
          }
          window.localStorage.setItem(migrationKey, "done");
        }
        const action = documentSyncAction(localRaw, localMeta.updatedAt, remote.value, remote.updatedAt);
        if (action === "download") {
          const serialized = JSON.stringify(remote.value);
          lastSerialized.current = serialized;
          window.localStorage.setItem(storageKey, serialized);
          window.localStorage.setItem(metaKey, JSON.stringify({ updatedAt: remote.updatedAt, source: "remote" }));
          if (live) setValue(remote.value as T);
        } else if (action === "upload" && localRaw !== null) {
          const upload = await fetch(apiUrl("/api/state"), {
            method: "PUT",
            headers: appHeaders(true),
            body: JSON.stringify({ key, value: JSON.parse(localRaw) }),
          });
          if (upload.ok) {
            const result = (await upload.json()) as { updatedAt?: string };
            if (window.localStorage.getItem(storageKey) === localRaw) window.localStorage.setItem(metaKey, JSON.stringify({ updatedAt: result.updatedAt || new Date().toISOString(), source: "local" }));
          }
        }
      } catch {
        // Local data remains authoritative while offline or when cloud sync is unavailable.
      } finally {
        syncing = false;
        if (live && initialLoad) setReady(true);
      }
    };
    void reconcile(true);
    const refresh = () => {
      if (document.visibilityState === "visible") void reconcile(false);
    };
    const refreshTimer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      live = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [key, metaKey, storageKey]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: T }>).detail;
      if (detail?.key === key) {
        lastSerialized.current = JSON.stringify(detail.value);
        setValue(detail.value);
      }
    };
    window.addEventListener("vesper-document-change", receive);
    return () => window.removeEventListener("vesper-document-change", receive);
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    const serialized = JSON.stringify(value);
    if (lastSerialized.current === serialized) return;
    lastSerialized.current = serialized;
    window.localStorage.setItem(storageKey, serialized);
    window.localStorage.setItem(metaKey, JSON.stringify({ updatedAt: new Date().toISOString(), source: "local" }));
    window.dispatchEvent(
      new CustomEvent("vesper-document-change", { detail: { key, value } }),
    );
    const timer = window.setTimeout(() => {
      fetch(apiUrl("/api/state"), {
        method: "PUT",
        headers: appHeaders(true),
        body: JSON.stringify({ key, value }),
      })
        .then(async (response) => {
          if (!response.ok) return;
          const result = (await response.json()) as { updatedAt?: string };
          if (window.localStorage.getItem(storageKey) === serialized) window.localStorage.setItem(metaKey, JSON.stringify({ updatedAt: result.updatedAt || new Date().toISOString(), source: "local" }));
        })
        .catch(() => {});
    }, 260);
    return () => window.clearTimeout(timer);
  }, [key, metaKey, ready, storageKey, value]);
  return [value, setValue] as const;
}
function useLocalDocument<T>(key: string, initial: T) {
  const storageKey = `vesper-local-${key}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      return JSON.parse(window.localStorage.getItem(storageKey) || "") as T;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  }, [storageKey, value]);
  return [value, setValue] as const;
}

function wakeThreshold() {
  const sample = new Uint32Array(1);
  crypto.getRandomValues(sample);
  const unit = Math.max(1 / 2 ** 32, sample[0] / 2 ** 32);
  return -Math.log(unit);
}

type AutonomousPushKind = "message" | "call" | "note";

async function sendAutonomousPush(
  kind: AutonomousPushKind,
  title: string,
  body: string,
  url = "/",
) {
  if (!("serviceWorker" in navigator) || Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  if (!current) return false;
  const response = await fetch(apiUrl("/api/push"), {
    method: "POST",
    headers: appHeaders(true),
    body: JSON.stringify({
      action: "notify",
      subscription: serializeSubscription(current),
      notification: {
        title,
        body,
        url,
        tag: `vesper-agent-${kind}-${Date.now()}`,
        kind,
      },
    }),
  });
  return response.ok;
}


function Today({
  active, onPrevious, onNext,
  track,
  playing,
  onToggle,
  userName,
  onOpenSection,
}: {
  active: boolean;
  onPrevious: () => void;
  onNext: () => void;
  track?: Track;
  playing: boolean;
  onToggle: () => void;
  userName: string;
  onOpenSection: (section: "便笺" | "提醒" | "纪念日" | "音乐" | "日记" | "欲望") => void;
}) {
  const [notes] = usePersistentDocument<NoteItem[]>("notes", []);
  const [todos, setTodos] = usePersistentDocument<TodoItem[]>("todos", []);
  const now = new Date();
  const dateText = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
  const hour = now.getHours();
  const greeting =
    hour < 6
      ? "Late night"
      : hour < 11
        ? "Good morning"
        : hour < 14
          ? "Good afternoon"
          : hour < 18
            ? "Good afternoon"
            : "Good evening";
  const homeSignal =
    hour < 6
      ? "Take the night slowly."
      : hour < 11
        ? "The light is still on."
        : hour < 18
          ? "A place for today, too."
          : "Welcome back.";
  const realNotes = [...notes]
    .filter((note) => note.text.trim().length > 0)
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt);
      const rightTime = Date.parse(right.createdAt);
      return (Number.isFinite(rightTime) ? rightTime : 0) -
        (Number.isFinite(leftTime) ? leftTime : 0);
    });
  const latestNote = realNotes[0];
  const latestNoteTimestamp = latestNote
    ? new Intl.DateTimeFormat("en-US", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(latestNote.createdAt))
    : "";
  const pendingTodos = todos.filter(item => !item.done);
  return (
    <div className="today-home home-overview home-cards">
      <section className="welcome">
        <div className="date-row"><span>{dateText}</span></div>
        <h1>{greeting}, {userName}</h1>
        <p className="home-return-signal">{homeSignal}</p>
      </section>
      <div className="home-upper-grid">
        <HomeDesire active={active} apiUrl={apiUrl} headers={appHeaders} onOpen={() => onOpenSection("欲望")} />
        <section className="home-usage-card"><SubscriptionUsage active={active} socketUrl={codexSocketUrl} weeklyOnly /></section>
        <section className="home-notes-card">
          <button className="home-card-label home-notes-heading" onClick={() => onOpenSection("便笺")}>Notes<Icon name="chevron" /></button>
          <div className="home-note-scroll" tabIndex={0} role="region" aria-label="Latest note preview">
            <p>{latestNote?.text || "Leave today’s first words here."}</p>
            {latestNoteTimestamp && <small>{latestNoteTimestamp}</small>}
          </div>
        </section>
      </div>
      <div className="home-lower-grid">
      <section className="home-reminders-card">
        <button className="home-card-label home-reminders-heading" onClick={() => onOpenSection("提醒")}>Reminders<Icon name="chevron" /></button>
        {pendingTodos.slice(0, 3).map((item) => (
          <button className="reminder-row" key={item.id} aria-pressed={item.done} onClick={() => setTodos((items) => items.map((x) => x.id === item.id ? { ...x, done: !x.done } : x))}>
            <span className={item.done ? "round-check checked" : "round-check"}>{item.done && <Icon name="check" />}</span>
            <span className={item.done ? "reminder-copy crossed" : "reminder-copy"}>{item.title}<small>{item.done ? "Completed" : item.due || item.tag}</small></span>
          </button>
        ))}
        {!pendingTodos.length && <p className="home-card-empty">Something you want to do today? Leave yourself a reminder.</p>}
      </section>
      <section className="home-music-card">
        <button className="home-panel-heading" onClick={() => onOpenSection("音乐")}><span className="home-card-label">Music</span><span>{playing ? "Now playing" : "Listen together"}<Icon name="chevron" /></span></button>
        {track ? <div className="home-music-content">
          <button className="home-track-link" onClick={() => onOpenSection("音乐")}>
            {track.cover ? <img src={track.cover} alt="" /> : <span className="home-cover-fallback"><Icon name="music" /></span>}
            <span><strong>{track.title}</strong><small>{track.artist || "Unknown artist"}</small></span>
          </button>
          <div className="home-player-controls">
          <button onClick={onPrevious} aria-label="Previous track"><Icon name="back" /></button>
          <button className="home-play" onClick={onToggle} aria-label={playing ? "Pause playback" : "Start playback"}><Icon name={playing ? "pause" : "play"} /></button>
          <button onClick={onNext} aria-label="Next track"><Icon name="forward" /></button>
          </div>
        </div> : <button className="home-music-empty" onClick={() => onOpenSection("音乐")}><Icon name="music" /><span>Choose a song to keep you company.</span></button>}
      </section>
      </div>
    </div>
  );
}

type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
  createdAt?: string;
  messageCount: number;
};

function conversationUpdatedTimestamp(item: ConversationSummary) {
  const timestamp = Date.parse(item.updatedAt || item.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeConversationSummaries(remote: ConversationSummary[], local: ConversationSummary[]) {
  const byId = new Map<string, ConversationSummary>();
  for (const item of [...remote, ...local]) {
    if (!item?.id) continue;
    const existing = byId.get(item.id);
    if (!existing || conversationUpdatedTimestamp(item) > conversationUpdatedTimestamp(existing)) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()].sort((left, right) => conversationUpdatedTimestamp(right) - conversationUpdatedTimestamp(left));
}

function latestLocalConversationId() {
  const conversations = readLocalValue<ConversationSummary[]>("vesper-local-conversation-index", []);
  return mergeConversationSummaries([], conversations)[0]?.id || "main";
}

async function resolveLatestConversationId() {
  const local = readLocalValue<ConversationSummary[]>("vesper-local-conversation-index", []);
  try {
    const response = await fetch(codexHistoryUrl("/conversations"), {
      headers: codexHistoryHeaders(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("History is unavailable");
    const payload = await response.json() as { conversations?: ConversationSummary[] };
    const conversations = mergeConversationSummaries(payload.conversations || [], local);
    window.localStorage.setItem("vesper-local-conversation-index", JSON.stringify(conversations.slice(0, 100)));
    return conversations[0]?.id || "main";
  } catch {
    return mergeConversationSummaries([], local)[0]?.id || "main";
  }
}

function rememberConversation(id: string, title = "New conversation", messageCount?: number) {
  if (typeof window === "undefined") return;
  const key = "vesper-local-conversation-index";
  const current = readLocalValue<ConversationSummary[]>(key, []);
  const existing = current.find((item) => item.id === id);
  const next = [
    {
      id,
      title: title || existing?.title || "New conversation",
      updatedAt: new Date().toISOString(),
      messageCount: messageCount ?? Math.max(1, (existing?.messageCount || 0) + 1),
    },
    ...current.filter((item) => item.id !== id),
  ];
  window.localStorage.setItem(key, JSON.stringify(next.slice(0, 100)));
}

function HistoryModal({
  activeId,
  favorites,
  onSelect,
  onSelectFavorite,
  onRemoveFavorite,
  onDelete,
  onClose,
}: {
  activeId: string;
  favorites: FavoriteItem[];
  onSelect: (id: string) => void;
  onSelectFavorite: (item: FavoriteItem) => void;
  onRemoveFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>(() =>
    readLocalValue<ConversationSummary[]>("vesper-local-conversation-index", []),
  );
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"conversations" | "favorites">("conversations");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuId, setMenuId] = useState("");
  const [historyError, setHistoryError] = useState("");
  useEffect(() => {
    const token = deviceToken();
    if (!token) return;
    void migrateLegacyHistory().then(async () => {
      const response = await fetch(codexHistoryUrl("/conversations"), { headers: codexHistoryHeaders(), cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { conversations?: ConversationSummary[] };
      setConversations(data.conversations || []);
    }).catch((reason) => setHistoryError(reason instanceof Error ? reason.message : "Could not migrate old history"));
    fetch(codexHistoryUrl("/conversations"), {
      headers: codexHistoryHeaders(),
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) =>
        setConversations((current) => {
          const remote = (data as { conversations?: ConversationSummary[] }).conversations || [];
          return [...remote, ...current.filter((local) => !remote.some((item) => item.id === local.id))];
        }),
      )
      .catch(() => {});
  }, []);
  const visible = conversations.filter((item) =>
    String(item.title || "未命名对话").toLowerCase().includes(query.trim().toLowerCase()),
  );
  const remove = async (item: ConversationSummary) => {
    if (!window.confirm(`Delete “${item.title || "Untitled conversation"}”? This cannot be undone.`)) return;
    const token = deviceToken();
    if (!token) {
      setHistoryError("Delete failed: this device is not connected to the server");
      return;
    }
    try {
      const response = await fetch(
        codexHistoryUrl(`/conversations/${encodeURIComponent(item.id)}`),
        { method: "DELETE", headers: codexHistoryHeaders() },
      );
      const payload = await response.json().catch(() => ({})) as { error?: string; ok?: boolean; permanentlyDeleted?: boolean };
      if (!response.ok || !payload.ok || !payload.permanentlyDeleted) {
        setHistoryError(payload.error || `Delete failed (HTTP ${response.status})`);
        return;
      }
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : "Delete failed");
      return;
    }
    for (const key of Object.keys(window.localStorage)) {
      if ((key.startsWith("vesper-local-chat-") || key.startsWith("vesper-codex-chat-")) && key.endsWith(`-${item.id}`))
        window.localStorage.removeItem(key);
    }
    const next = conversations.filter((conversation) => conversation.id !== item.id);
    setConversations(next);
    window.localStorage.setItem("vesper-local-conversation-index", JSON.stringify(next));
    onDelete(item.id);
    setMenuId("");
  };
  const rename = async (item: ConversationSummary) => {
    const title = window.prompt("Rename conversation", item.title || "Conversations")?.trim();
    if (!title || title === item.title) return;
    try {
      await persistCodexConversation(item.id, { title });
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : "Could not sync the title");
      return;
    }
    const next = conversations.map((entry) => entry.id === item.id ? { ...entry, title, updatedAt: new Date().toISOString() } : entry);
    setConversations(next);
    window.localStorage.setItem("vesper-local-conversation-index", JSON.stringify(next));
    setMenuId("");
  };
  const nowMs = new Date().getTime();
  const groups = [
    ["Today", visible.filter((item) => new Date(item.updatedAt).toDateString() === new Date().toDateString())],
    
    ["Past 7 days", visible.filter((item) => {
      const age = nowMs - new Date(item.updatedAt).getTime();
      return age >= 86_400_000 && age <= 7 * 86_400_000;
    })],
    ["Earlier", visible.filter((item) => nowMs - new Date(item.updatedAt).getTime() > 7 * 86_400_000)],
  ] as const;
  const visibleFavorites = favorites.filter((item) => `${item.content} ${item.conversationTitle}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="modal-layer history-layer">
      <button className="modal-scrim" onClick={onClose} />
      <section className="history-modal history-drawer" aria-label="Conversation navigation">
        <header className="history-drawer-head">
          <div className="history-drawer-title"><button className={tab === "conversations" ? "active" : ""} onClick={() => setTab("conversations")}>Conversations</button><button className={tab === "favorites" ? "active" : ""} onClick={() => setTab("favorites")}>Favorites</button></div>
          <div className="history-drawer-actions"><button aria-label="Search" onClick={() => setSearchOpen((value) => !value)}><Icon name="search" /></button><button aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
        </header>
        {searchOpen && <label className="history-search compact"><Icon name="search" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "favorites" ? "Search favorites" : "Search conversations"} /></label>}
        {historyError && <div className="history-error" role="alert">{historyError}</div>}
        {tab === "conversations" ? (
          <div className="history-list drawer-list">
            {groups.map(([label, items]) => items.length ? <section className="history-group" key={label}><h3>{label}</h3>{items.map((item) => <article className={item.id === activeId ? "history-item-row selected" : "history-item-row"} key={item.id}><button className="history-open" onClick={() => onSelect(item.id)}><b>{item.title || "Untitled conversation"}</b><span>{item.messageCount}  messages · {new Date(item.updatedAt).toLocaleDateString("en-US")}</span></button><button className="history-delete" aria-label={`More actions for ${item.title || "Conversation"}`} aria-expanded={menuId === item.id} onClick={() => setMenuId((current) => current === item.id ? "" : item.id)}><Icon name="more" /></button>{menuId === item.id && <div className="history-item-menu" role="menu"><button role="menuitem" onClick={() => void rename(item)}><Icon name="edit" />Rename</button><button role="menuitem" className="danger" onClick={() => void remove(item)}><Icon name="trash" />Delete conversation</button></div>}</article>)}</section> : null)}
            {!visible.length && <EmptyState text="No conversations yet." />}
          </div>
        ) : (
          <div className="history-list drawer-list favorites-list">
            {visibleFavorites.map((item) => <article className="favorite-row" key={item.id}><button onClick={() => onSelectFavorite(item)}><b>{item.content.split("\n").slice(0, 2).join(" ").slice(0, 100)}</b><span>{item.conversationTitle} · {new Date(item.createdAt).toLocaleDateString("en-US")}</span></button><button aria-label="Remove favorite" onClick={() => onRemoveFavorite(item.id)}><Icon name="trash" /></button></article>)}
            {!visibleFavorites.length && <EmptyState text="No favorites yet." />}
          </div>
        )}
        {tab === "conversations" && <button className="history-new" onClick={() => { const id = `chat-${Date.now()}-${crypto.randomUUID()}`; rememberConversation(id, "New conversation"); onSelect(id); }}><Icon name="plus" />New conversation</button>}
      </section>
    </div>
  );
}

function VoiceCallModal({
  agentName,
  agentAvatar,
  conversationId,
  onClose,
}: {
  agentName: string;
  agentAvatar: string;
  conversationId: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error"
  >("idle");
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const [caption, setCaption] = useState("");
  const [connections] = useLocalDocument<AiConnectionStore>(
    "ai-connections-v1",
    { active: "api", api: {}, mcp: {}, cyberboss: {} },
  );
  const [connectionSettings] = useLocalDocument<ConnectionSettings>("connections", {});
  const ttsSettings = connectionSettings["Agent 声音"] || {};
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const stateRef = useRef(state);
  const mutedRef = useRef(muted);
  const speakerRef = useRef(speaker);
  const playback = useRef<HTMLAudioElement | null>(null);
  const playbackUrl = useRef("");
  const recognition = useRef<{ start: () => void; stop: () => void } | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    speakerRef.current = speaker;
  }, [speaker]);
  const restartRecognition = () => {
    if (mutedRef.current || stateRef.current !== "listening") return;
    window.setTimeout(() => {
      try {
        recognition.current?.start();
      } catch {}
    }, 180);
  };
  const stopPlayback = () => {
    playback.current?.pause();
    playback.current = null;
    if (playbackUrl.current) URL.revokeObjectURL(playbackUrl.current);
    playbackUrl.current = "";
  };
  const speak = async (text: string, id: number) => {
    if (generation.current !== id) return;
    if (!speakerRef.current) {
      stateRef.current = "listening";
      setState("listening");
      restartRecognition();
      return;
    }
    try {
      if (!ttsSettings.baseUrl || !ttsSettings.apiKey)
        throw new Error("Configure TTS in Settings → Agent Voice first.");
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, connection: ttsSettings }),
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error || "TTS request failed");
      }
      if (generation.current !== id) return;
      stopPlayback();
      const url = URL.createObjectURL(await response.blob());
      playbackUrl.current = url;
      const audio = new Audio(url);
      playback.current = audio;
      audio.onplay = () => {
        if (generation.current === id) {
          stateRef.current = "speaking";
          setState("speaking");
        }
      };
      audio.onended = () => {
        stopPlayback();
        if (generation.current !== id) return;
        stateRef.current = "listening";
        setState("listening");
        restartRecognition();
      };
      audio.onerror = () => {
        stopPlayback();
        setCaption("Could not play TTS audio");
        stateRef.current = "listening";
        setState("listening");
        restartRecognition();
      };
      await audio.play();
    } catch (reason) {
      setCaption(reason instanceof Error ? reason.message : "TTS playback failed");
      stateRef.current = "listening";
      setState("listening");
      restartRecognition();
    }
  };
  const runTurn = async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const id = ++generation.current;
    stopPlayback();
    setCaption(clean);
    stateRef.current = "thinking";
    setState("thinking");
    try { recognition.current?.stop(); } catch {}
    try {
      if (connections.active === "cyberboss") {
        const response = await fetch(apiUrl("/api/chat"), {
          method: "POST",
          headers: deviceHeaders(),
          body: JSON.stringify({ conversationId, content: clean }),
        });
        if (!response.ok) throw new Error("The AI service is not responding.");
        if (generation.current === id) {
          setCaption("Message sent to the AI service. Waiting for a reply.");
          stateRef.current = "listening";
          setState("listening");
          restartRecognition();
        }
        return;
      }
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: deviceHeaders(),
        body: JSON.stringify({
          mode: connections.active,
          connection: connections[connections.active],
          conversationId,
          messages: [{ role: "user", content: clean }],
        }),
      });
      const result = (await response.json()) as { content?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Voice call request failed");
      if (generation.current !== id) return;
      const answer = result.content || "I’m here.";
      setCaption(answer);
      void speak(answer, id);
    } catch (reason) {
      if (generation.current !== id) return;
      setCaption(reason instanceof Error ? reason.message : "Voice call connection failed");
      stateRef.current = "error";
      setState("error");
    }
  };
  const start = async () => {
    setState("connecting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Speech = (
        window as Window & {
          SpeechRecognition?: new () => {
            lang: string;
            continuous: boolean;
            interimResults: boolean;
            onresult: (event: {
              results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
              resultIndex: number;
            }) => void;
            onend: () => void;
            onerror: () => void;
            start: () => void;
            stop: () => void;
          };
          webkitSpeechRecognition?: new () => {
            lang: string;
            continuous: boolean;
            interimResults: boolean;
            onresult: (event: {
              results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
              resultIndex: number;
            }) => void;
            onend: () => void;
            onerror: () => void;
            start: () => void;
            stop: () => void;
          };
        }
      ).SpeechRecognition ||
        (window as Window & { webkitSpeechRecognition?: new () => {
          lang: string;
          continuous: boolean;
          interimResults: boolean;
          onresult: (event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>; resultIndex: number }) => void;
          onend: () => void;
          onerror: () => void;
          start: () => void;
          stop: () => void;
        } }).webkitSpeechRecognition;
      if (!Speech) throw new Error("Live speech recognition is not supported in this browser.");
      const session = new Speech();
      session.lang = "en-US";
      session.continuous = false;
      session.interimResults = true;
      session.onresult = (event) => {
        let interim = "";
        let final = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const part = event.results[index];
          if (part.isFinal) final += part[0].transcript;
          else interim += part[0].transcript;
        }
        if (interim) {
          if (stateRef.current === "speaking") {
            generation.current += 1;
            stopPlayback();
          }
          setCaption(interim);
        }
        if (final) void runTurn(final);
      };
      session.onend = () => {
        if (stream.current && !mutedRef.current && stateRef.current === "listening") restartRecognition();
      };
      session.onerror = () => {
        if (stream.current) restartRecognition();
      };
      recognition.current = session;
      stateRef.current = "listening";
      setState("listening");
      setCaption("Listening");
      session.start();
    } catch (reason) {
      setState("error");
      setCaption(reason instanceof Error ? reason.message : "Could not start the call. Check microphone and speech recognition permissions.");
    }
  };
  const finish = () => {
    generation.current += 1;
    stopPlayback();
    recognition.current?.stop();
    recognition.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    onClose();
  };
  useEffect(() => {
    if (!["listening", "thinking", "speaking"].includes(state)) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state]);
  useEffect(() => () => {
    stopPlayback();
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);
  const toggleMute = () => {
    const next = !muted;
    stream.current?.getAudioTracks().forEach((track) => (track.enabled = !next));
    if (next) recognition.current?.stop();
    else restartRecognition();
    setMuted(next);
  };
  return (
    <div className="modal-layer call-layer">
      <button className="modal-scrim" onClick={finish} />
      <section className="voice-call-modal">
        <div className={`call-avatar-rings ${state}`}>
          <i /><i /><i />
          <AvatarMark src={agentAvatar} label={agentName} kind="agent" />
        </div>
        <small>· {state === "idle" ? "VOICE CALL" : "LIVE DUPLEX"} ·</small>
        <h2>{agentName}</h2>
        <p>
          {["listening", "thinking", "speaking"].includes(state)
            ? `${state === "listening" ? "Listening" : state === "thinking" ? "Thinking" : "Responding"} · ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
            : state === "connecting"
              ? "Requesting microphone access…"
              : state === "error"
                ? caption
                : "Start a voice call with the current AI connection"}
        </p>
        {caption && !["idle", "error"].includes(state) && <blockquote>{caption}</blockquote>}
        {state === "idle" || state === "error" ? (
          <button className="call-start" onClick={() => void start()}>
            <Icon name="phone" />
            Start call
          </button>
        ) : (
          <div className="call-actions">
            <button onClick={toggleMute} aria-label={muted ? "Enable microphone" : "Mute"}>
              <Icon name="mic" />
              <small>{muted ? "Unmute" : "Mute"}</small>
            </button>
            <button onClick={() => {
              const next = !speakerRef.current;
              speakerRef.current = next;
              setSpeaker(next);
              if (!next) stopPlayback();
            }} aria-label="Speaker">
              <Icon name="volume" />
              <small>{speaker ? "Speaker" : "Earpiece"}</small>
            </button>
            <button className="call-end" onClick={finish} aria-label="End call">
              <Icon name="phone" />
              <small>End call</small>
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

type BridgeChatMessage = {
  id: string;
  conversationId: string;
  role: "user" | "agent" | "system";
  content: string;
  status: string;
  metadata?: {
    execution?: Execution;
    wake?: WakeRecord;
    thoughtSummary?: string;
    durationMs?: number;
    tools?: string[];
    attachments?: ChatAttachment[];
    modelInputText?: string;
    turnId?: string;
    threadId?: string;
    itemId?: string;
    turnStatus?: "thinking" | "tool" | "completed" | "error";
    showTurnStatus?: boolean;
    blockType?: string;
    musicCard?: MusicCardData;
    sticker?: StickerMessageData;
    timeSource?: "message" | "turn" | "thread" | "unknown";
  };
  createdAt: string;
  source?: "legacy-vesper" | "codex";
  type?: "text" | "sticker";
  timeSource?: "message" | "turn" | "thread" | "unknown";
};
type BridgeSnapshot = {
  messages: BridgeChatMessage[];
  bridge: { runtime: string; online: boolean; lastSeenAt?: string };
};
const deviceToken = () =>
  typeof window === "undefined"
    ? ""
    : window.localStorage.getItem("vesper-device-token") || "";
const deviceHeaders = () => ({
  "content-type": "application/json",
  "x-vesper-device-token": deviceToken(),
});

function LegacyConnectedChat({
  conversationId,
  agentName,
  userName,
  agentAvatar,
  userAvatar,
}: {
  conversationId: string;
  agentName: string;
  userName: string;
  agentAvatar: string;
  userAvatar: string;
}) {
  const [draft, setDraft] = useState("");
  const [data, setData] = useState<BridgeSnapshot>({
    messages: [],
    bridge: { runtime: "cyberboss", online: false },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [thought, setThought] = useState<BridgeChatMessage | null>(null);
  const [pending, setPending] = useState<{ file: File; preview: string }[]>([]);
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [connections, setConnections] = useLocalDocument<AiConnectionStore>(
    "ai-connections-v1",
    { active: "api", api: {}, mcp: {}, cyberboss: {} },
  );
  const streamEnd = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingStream = useRef<MediaStream | null>(null);
  const recordingChunks = useRef<Blob[]>([]);
  const localMessageKey = () =>
    `vesper-local-chat-${connections.active}-${conversationId}`;
  const saveLocalMessages = (messages: BridgeChatMessage[]) => {
    window.localStorage.setItem(localMessageKey(), JSON.stringify(messages));
    setData({
      messages,
      bridge: { runtime: connections.active, online: true },
    });
  };
  const editMessage = async (item: BridgeChatMessage) => {
    const content = window.prompt("Edit message", item.content)?.trim();
    if (!content || content === item.content) return;
    if (connections.active === "cyberboss") {
      const response = await fetch(apiUrl("/api/chat"), {
        method: "PATCH",
        headers: deviceHeaders(),
        body: JSON.stringify({ id: item.id, content }),
      });
      if (!response.ok) {
        setError("Could not edit message");
        return;
      }
      await refresh();
      return;
    }
    const current = readLocalValue<BridgeChatMessage[]>(localMessageKey(), []);
    saveLocalMessages(current.map((message) => message.id === item.id ? { ...message, content } : message));
  };
  const refresh = async () => {
    if (connections.active !== "cyberboss") {
      const configured =
        connections.active === "api"
          ? Boolean(
              connections.api.baseUrl &&
                connections.api.apiKey &&
                connections.api.model,
            )
          : Boolean(connections.mcp.url);
      const messages = readLocalValue<BridgeChatMessage[]>(localMessageKey(), []);
      setData({
        messages,
        bridge: { runtime: connections.active, online: configured },
      });
      setError(
        configured
          ? ""
          : `Configure ${connections.active === "api" ? "API Key" : "MCP"} in Settings → AI Connection first.`,
      );
      return;
    }
    const token = deviceToken();
    if (!token) {
      setError("Configure a connection in Settings → AI Connection first.");
      return;
    }
    try {
      const response = await fetch(
        apiUrl(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`),
        {
        headers: { "x-vesper-device-token": token },
        cache: "no-store",
        },
      );
      if (response.status === 401) throw new Error("This AI connection is not authorized.");
      if (!response.ok) throw new Error("Could not load conversation");
      setData((await response.json()) as BridgeSnapshot);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connection failed");
    }
  };
  const send = async () => {
    const content = draft.trim();
    if ((!content && !pending.length) || busy) return;
    setBusy(true);
    setDraft("");
    try {
      const attachments = await Promise.all(
        pending.map(async ({ file }) => uploadMedia(file)),
      );
      if (connections.active !== "cyberboss") {
        const createdAt = new Date().toISOString();
        const userMessage: BridgeChatMessage = {
          id: crypto.randomUUID(),
          conversationId,
          role: "user",
          content: content || "Attachments",
          status: "delivered",
          metadata: { attachments },
          createdAt,
        };
        const current = readLocalValue<BridgeChatMessage[]>(localMessageKey(), []);
        saveLocalMessages([...current, userMessage]);
        // eslint-disable-next-line react-hooks/purity
        const startedAt = performance.now();
        const response = await fetch("/api/ai", {
          method: "POST",
          headers: deviceHeaders(),
          body: JSON.stringify({
            mode: connections.active,
            connection: connections[connections.active],
            conversationId,
            messages: [...current, userMessage].map((item) => ({
              role: item.role === "agent" ? "assistant" : item.role,
              content: item.content,
            })),
            attachments,
            documents: Object.fromEntries(
              ["notes", "todos", "anniversaries", "diary", "music", "musicControl"].map((key) => [
                key,
                readLocalValue(`vesper-document-${key}`, key === "diary" || key === "musicControl" ? {} : []),
              ]),
            ),
          }),
        });
        const result = (await response.json()) as {
          content?: string;
          reasoningSummary?: string;
          changedDocuments?: Record<string, unknown>;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || "AI connection request failed");
        for (const [key, value] of Object.entries(result.changedDocuments || {})) {
          window.localStorage.setItem(`vesper-document-${key}`, JSON.stringify(value));
          window.dispatchEvent(new CustomEvent("vesper-document-change", { detail: { key, value } }));
        }
        const agentMessage: BridgeChatMessage = {
          id: crypto.randomUUID(),
          conversationId,
          role: "agent",
          content: result.content || "The AI returned no content.",
          status: "delivered",
          metadata: {
            // eslint-disable-next-line react-hooks/purity
            durationMs: Math.round(performance.now() - startedAt),
            thoughtSummary: result.reasoningSummary || undefined,
          },
          createdAt: new Date().toISOString(),
        };
        saveLocalMessages([...current, userMessage, agentMessage]);
        rememberConversation(conversationId, content.slice(0, 28) || "Attachments");
        pending.forEach((item) => URL.revokeObjectURL(item.preview));
        setPending([]);
        setError("");
        return;
      }
      const response = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: deviceHeaders(),
        body: JSON.stringify({
          conversationId,
          content: content || (attachments.length ? "Attachments" : ""),
          attachments,
        }),
      });
      if (response.status === 401)
        throw new Error("Complete authorization in Settings → AI Connection first.");
      if (!response.ok) throw new Error("Could not send message");
      rememberConversation(conversationId, content.slice(0, 28) || "Attachments");
      pending.forEach((item) => URL.revokeObjectURL(item.preview));
      setPending([]);
      await refresh();
    } catch (reason) {
      setDraft(content);
      setError(reason instanceof Error ? reason.message : "Could not send message");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const initial = window.setTimeout(() => {
      setData({ messages: [], bridge: { runtime: "connection", online: false } });
      setError("");
      void refresh();
    }, 0);
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [conversationId, connections.active]);
  useLayoutEffect(() => {
    const scroller = streamEnd.current?.closest(
      ".scroll-view",
    ) as HTMLElement | null;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [data.messages.length]);
  const stamp = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  const selectFiles = (files: FileList | null) => {
    if (!files) return;
    setPending((current) => [
      ...current,
      ...Array.from(files).map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      })),
    ]);
  };
  const startStt = () => {
    const Speech = (
      window as Window & {
        SpeechRecognition?: new () => {
          lang: string;
          interimResults: boolean;
          onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void;
          onend: () => void;
          onerror: () => void;
          start: () => void;
        };
        webkitSpeechRecognition?: new () => {
          lang: string;
          interimResults: boolean;
          onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void;
          onend: () => void;
          onerror: () => void;
          start: () => void;
        };
      }
    ).SpeechRecognition ||
      (
        window as Window & {
          webkitSpeechRecognition?: new () => {
            lang: string;
            interimResults: boolean;
            onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void;
            onend: () => void;
            onerror: () => void;
            start: () => void;
          };
        }
      ).webkitSpeechRecognition;
    if (!Speech) {
      setError("Speech-to-text is not supported in this browser.");
      return;
    }
    const recognition = new Speech();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event) =>
      setDraft((value) => `${value}${value ? " " : ""}${event.results[0][0].transcript}`);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      setError("Speech recognition failed. Check microphone permission.");
    };
    setListening(true);
    recognition.start();
  };
  const toggleVoiceMessage = async () => {
    if (recording && recorder.current) {
      recorder.current.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStream.current = stream;
      recordingChunks.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      recorder.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunks.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordingChunks.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });
        const file = new File([blob], `voice-${Date.now()}.webm`, {
          type: blob.type,
        });
        const preview = URL.createObjectURL(file);
        setPending((current) => [...current, { file, preview }]);
        recordingStream.current?.getTracks().forEach((track) => track.stop());
        recordingStream.current = null;
        setBusy(true);
        void uploadMedia(file)
          .then(async (attachment) => {
            const response = await fetch(apiUrl("/api/chat"), {
              method: "POST",
              headers: deviceHeaders(),
              body: JSON.stringify({
                conversationId,
                content: "Voice message",
                attachments: [attachment],
              }),
            });
            if (!response.ok) throw new Error("Could not send voice message");
            URL.revokeObjectURL(preview);
            setPending((current) =>
              current.filter((item) => item.preview !== preview),
            );
            await refresh();
          })
          .catch((reason) =>
            setError(reason instanceof Error ? reason.message : "Could not send voice message"),
          )
          .finally(() => setBusy(false));
      };
      mediaRecorder.start();
      setRecording(true);
    } catch {
      setError("Could not record. Check microphone permission.");
    }
  };
  return (
    <div className="page-body chat-page">
      <div className="bridge-presence">
        <i className={data.bridge.online ? "online" : ""} />
        <span>
          {data.bridge.online ? "AI service connected" : "AI service offline"}
        </span>
      </div>
      <div className="chat-stream">
        {!data.messages.length && (
          <div className="chat-empty">
            <Icon name="chat" />
            <b>{error || "No conversation yet"}</b>
            <span>
              {error
                ? "Go to Settings → AI Connection"
                : "Start a conversation with Rowan here"}
            </span>
          </div>
        )}
        {data.messages.map((item) =>
          item.role === "agent" ? (
            <div className="agent-turn" key={item.id}>
              <time>{stamp(item.createdAt)}</time>
              <div className="message assistant">
                <AvatarMark src={agentAvatar} label={agentName} kind="agent" />
                <div>
                  {item.metadata?.thoughtSummary && (
                    <button
                      className="thought-toggle"
                      onClick={() => setThought(item)}
                    >
                      <Icon name="clock" />
                      <span>
                        {item.metadata.durationMs
                          ? `Thought for ${Math.max(1, Math.round(item.metadata.durationMs / 1000))}s`
                          : "View activity summary"}
                      </span>
                      <Icon name="chevron" />
                    </button>
                  )}
                  <p>{item.content}</p>
                  <MessageAttachments items={item.metadata?.attachments || []} />
                  <small>{agentName} · AI</small>
                </div>
              </div>
            </div>
          ) : (
            <div className="sent-turn" key={item.id}>
              <time>{stamp(item.createdAt)}</time>
              <div className="message mine sent-message">
                <div>
                  <p>{item.content}</p>
                  <MessageAttachments items={item.metadata?.attachments || []} />

                </div>
                <AvatarMark src={userAvatar} label={userName} kind="user" />
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="agent-typing" aria-label={`${agentName} is typing`}>
            <AvatarMark src={agentAvatar} label={agentName} kind="agent" />
            <div><i /><i /><i /><span>{agentName} Typing</span></div>
          </div>
        )}
        <div ref={streamEnd} />
      </div>
      <div className="chat-compose">
        {pending.length > 0 && (
          <div className="compose-previews">
            {pending.map((item, index) => (
              <div className="compose-preview" key={`${item.file.name}-${index}`}>
                {item.file.type.startsWith("image/") ? (
                  <img src={item.preview} alt={item.file.name} />
                ) : item.file.type.startsWith("video/") ? (
                  <video src={item.preview} muted />
                ) : item.file.type.startsWith("audio/") ? (
                  <audio src={item.preview} controls />
                ) : (
                  <span><Icon name="archive" />{item.file.name}</span>
                )}
                <button
                  aria-label="Remove attachment"
                  onClick={() =>
                    setPending((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <Icon name="close" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          placeholder={`Reply to ${agentName}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="compose-actions">
          <button aria-label="Add attachment" onClick={() => fileInput.current?.click()}>
            <Icon name="plus" />
          </button>
          <input
            ref={fileInput}
            hidden
            multiple
            type="file"
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.md,.zip"
            onChange={(event) => {
              selectFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <label className="compose-connection" aria-label="Choose AI connection">
            <i className={`connection-dot ${connections.active}`} />
            <select
              value={connections.active}
              onChange={(event) => {
                const active = event.target.value as AiConnectionStore["active"];
                setConnections({ ...connections, active });
                const token = connections.cyberboss.deviceToken?.trim();
                if (active === "cyberboss" && token)
                  window.localStorage.setItem("vesper-device-token", token);
              }}
            >
              <option value="api">API Key</option>
              <option value="mcp">MCP</option>
              <option value="cyberboss">CyberBoss</option>
            </select>
            <Icon name="chevron" />
          </label>
          <span>{busy ? "Sending…" : recording ? "Recording. Tap again to stop." : ""}</span>
          <button
            className={listening ? "active" : ""}
            aria-label="Speech-to-text"
            onClick={startStt}
          >
            <Icon name="mic" />
          </button>
          {draft.trim() || pending.length ? (
            <button
              className="send-message-button"
              aria-label="Send message"
              onClick={() => void send()}
            >
              <Icon name="send" />
            </button>
          ) : (
            <button
              className={recording ? "voice recording" : "voice"}
              aria-label={recording ? "Stop and send recording" : "Send voice message"}
              onClick={() => void toggleVoiceMessage()}
            >
              <i />
              <i />
              <i />
              <i />
            </button>
          )}
        </div>
      </div>
      {thought && (
        <div className="thought-sheet-layer">
          <button
            className="thought-scrim"
            aria-label="Close activity summary"
            onClick={() => setThought(null)}
          />
          <section className="thought-sheet">
            <div className="thought-sheet-head">
              <button aria-label="Close" onClick={() => setThought(null)}>
                <Icon name="close" />
              </button>
              <h2>Thought process</h2>
            </div>
            <div className="thought-raw">{thought.metadata?.thoughtSummary?.split("\n").map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</div>
          </section>
        </div>
      )}
    </div>
  );
}

type CodexSocketMessage = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
};
type CodexItem = {
  id?: string;
  type?: string;
  role?: string;
  text?: unknown;
  summary?: unknown;
  content?: unknown;
};
type CodexInput =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "audio"; url: string };
type CodexPendingFile = { file: File; preview: string };
type CodexMessageTombstone = { threadId?: string | null; stableId?: string; itemId?: string | null; messageId: string; deletedAt?: string };

const CODEX_DYNAMIC_TOOLS = codexToolDefinitions;

// Vesper is a companion chat, not a report console. This always travels through
// the app-server's developer-instruction channel, never through a user turn.
// Putting it in `turn/start.input` made the app-server correctly persist it as
// a thread item, which in turn made it possible for private context to surface
// in Vesper's visible history.
const VESPER_CONVERSATIONAL_STYLE = [
  "You are Rowan in Vesper. Default to the cadence of a natural one-to-one chat.",
  "For an ordinary conversational message, reply with one short, complete sentence; at most two short sentences when needed.",
  "When you send two or three short chat sentences, put each sentence on its own line.",
  "Say one thing at a time. Do not volunteer a plan, recap, headings, bullets, or a long explanation unless the user explicitly asks for detail, analysis, writing, or a multi-step task.",
  "When a task needs time, give one brief human update rather than a long report. Keep warmth without filler.",
  "File delivery in Vesper: when Vera asks for a file, call send_chat_file to upload its actual bytes and create a downloadable chat attachment. Creating a file in your workspace is not delivery. Never present /tmp, /workspace, file:// or sandbox: paths as download links: Vera is on a separate phone browser.",
  "For Markdown or other text files, pass the complete content directly, for example send_chat_file({files:[{name: 'rowan-test.md', mimeType: 'text/markdown', text: '# Hello Vera\\nA file delivery test.'}]}). No terminal step is needed for short text files. For an existing generated file, read its real contents and pass text or base64; never invent bytes or URLs.",
  "Only say a file was sent after send_chat_file succeeds and returns attachments. If it fails or is unavailable, report that delivery failed; do not substitute a local-path link. These instructions govern file delivery, not ordinary links to public websites.",
].join(" ");

const VESPER_INTERNAL_CONTEXT_PREFIXES = [
  "[vesper response preference — not user content:",
  "旧记忆背景（只作为长期背景",
];

function isVesperInternalContextText(value: unknown) {
  const text = typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";
  return VESPER_INTERNAL_CONTEXT_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function vesperDeveloperInstructions(memoryBackground = "") {
  return [VESPER_CONVERSATIONAL_STYLE, VESPER_DESIRE_INSTRUCTIONS, memoryBackground.trim()].filter(Boolean).join("\n\n");
}

const CODEX_ASSISTANT_ITEM_TYPES = new Set(["agentMessage", "assistantMessage", "outputMessage"]);
const CODEX_ASSISTANT_CONTENT_TYPES = new Set(["text", "outputText"]);
const CODEX_TOOL_ITEM_TYPES = new Set(["toolCall", "functionCall", "mcpCall", "shellCall", "computerCall", "webSearchCall", "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch"]);
const CODEX_REASONING_ITEM_TYPES = new Set(["reasoning", "reasoningSummary"]);
const CODEX_DYNAMIC_TOOL_METHODS = new Set(["item/tool/call", "tool/call", "tools/call"]);

function cleanReasoningSummary(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(cleanReasoningSummary);
  if (typeof value !== "string") return [] as string[];
  return value
    .replace(/\*\*/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 2 && !/^\$?\s*\/bin\//.test(line));
}

function visibleAssistantText(item: CodexItem) {
  if (!CODEX_ASSISTANT_ITEM_TYPES.has(String(item.type || ""))) return "";
  if (item.role && item.role !== "assistant") return "";
  if (Array.isArray(item.content)) {
    const chunks = item.content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const content = part as { type?: unknown; text?: unknown };
      return CODEX_ASSISTANT_CONTENT_TYPES.has(String(content.type || "")) && typeof content.text === "string" ? [content.text] : [];
    });
    if (chunks.length) return chunks.join("");
  }
  return typeof item.text === "string" ? item.text : "";
}

function visibleUserText(item: CodexItem) {
  if (typeof item.text === "string") return item.text;
  if (!Array.isArray(item.content)) return "";
  return item.content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const value = part as { text?: unknown };
    return typeof value.text === "string" ? [value.text] : [];
  }).join("");
}

function codexTimestamp(value: unknown, fallback = "") {
  if (typeof value === "number" && Number.isFinite(value))
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return fallback;
}

function visibleMessageTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).getUTCFullYear() > 1971 ? timestamp : Number.NaN;
}

function normalizeCodexMessages(value: unknown, conversationId: string): BridgeChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as BridgeChatMessage;
    // These markers identify only Vesper's former internal presentation and
    // memory input. They are never user-authored messages and must not survive
    // a restore from local cache, the VPS history service, or a legacy import.
    if (isVesperInternalContextText(item.content)) return [];
    const isMusicCard = item.metadata?.blockType === "musicCard" || Boolean(item.metadata?.attachments?.length);
    // Older VPS history servers do not yet persist `message_type`, but they do
    // preserve metadata. Treat that durable metadata as authoritative so an
    // already-sent sticker never falls back to its compatibility text after a
    // refresh or a device switch.
    const isSticker = Boolean(item.metadata?.sticker?.assetId) && (item.type === "sticker" || !item.type);
    if (item.role === "agent" && item.metadata?.blockType && !isMusicCard && !isSticker && !CODEX_ASSISTANT_ITEM_TYPES.has(item.metadata.blockType)) return [];
    if (item.role === "agent" && item.metadata?.blockType && !isMusicCard && !isSticker && !item.content.trim()) return [];
    return [{ ...item, type: isSticker ? "sticker" : "text", conversationId: item.conversationId || conversationId }];
  });
}

function messageWasDeleted(item: BridgeChatMessage, tombstones: CodexMessageTombstone[]) {
  return tombstones.some((deleted) =>
    deleted.messageId === item.id || deleted.stableId === item.id ||
    Boolean(item.metadata?.itemId && (deleted.itemId === item.metadata.itemId || deleted.stableId === item.metadata.itemId)));
}

function codexSocketUrl() {
  const configured = readLocalValue<string>("vesper-codex-endpoint", "").trim();
  // The fixed personal deployment uses the authenticated VPS tunnel directly.
  // The token is appended as a query parameter and validated by the VPS proxy.
  const base = configured || "wss://codex.r-vera.com";
  const url = new URL(base || "http://localhost/api/codex");
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  const token = deviceToken();
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

const CODEX_HISTORY_ORIGIN = "https://codex.r-vera.com/history";

function codexHistoryUrl(path: string) {
  return `${CODEX_HISTORY_ORIGIN}${path}`;
}

function codexHistoryHeaders(json = false) {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    authorization: `Bearer ${deviceToken()}`,
  };
}

async function persistMemoryMessage(item: BridgeChatMessage) {
  if (item.role !== "user" && item.role !== "agent") return;
  const response = await fetch(apiUrl("/api/memory/messages"), {
    method: "POST",
    headers: appHeaders(true),
    cache: "no-store",
    body: JSON.stringify({
      conversationId: item.conversationId,
      messageId: item.id,
      role: item.role,
      content: item.content,
      createdAt: item.createdAt,
      turnId: item.metadata?.turnId,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("memory-message-sync-failed");
}

async function recallMemoryBackground(query: string) {
  try {
    const response = await fetch(apiUrl("/api/memory/context"), {
      method: "POST",
      headers: appHeaders(true),
      cache: "no-store",
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return "";
    const payload = await response.json() as { context?: string };
    return typeof payload.context === "string" ? payload.context : "";
  } catch {
    // Memory retrieval is intentionally degradable: it can never stop a chat turn.
    return "";
  }
}

function scheduleMemoryDistillation(conversationId: string) {
  return fetch(apiUrl("/api/memory/distill"), {
    method: "POST",
    headers: appHeaders(true),
    cache: "no-store",
    body: JSON.stringify({ conversationId }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
}

async function persistCodexConversation(conversationId: string, value: { title?: string; codexThreadId?: string | null; createdAt?: string; updatedAt?: string; source?: "legacy-vesper" | "codex" }) {
  const response = await fetch(codexHistoryUrl(`/conversations/${encodeURIComponent(conversationId)}`), {
    method: "POST",
    headers: codexHistoryHeaders(true),
    cache: "no-store",
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error("Conversation history could not be saved");
  return response.json() as Promise<{ conversation?: { codexThreadId?: string | null; title?: string } }>;
}

async function persistCodexMessage(item: BridgeChatMessage, title?: string) {
  // This is a hard guard in addition to the rendering filter. Context is never
  // a chat message and must not reach durable history through a delayed retry
  // or a legacy migration.
  if (isVesperInternalContextText(item.content)) return;
  const response = await fetch(codexHistoryUrl(`/conversations/${encodeURIComponent(item.conversationId)}/messages`), {
    method: "POST",
    headers: codexHistoryHeaders(true),
    cache: "no-store",
    body: JSON.stringify({ ...item, title, source: item.source || "codex", timeSource: item.timeSource || item.metadata?.timeSource || (item.createdAt ? "message" : "unknown") }),
  });
  if (!response.ok) throw new Error("Message history could not be saved");
}

async function removeLeakedInternalHistoryMessages(conversationId: string, messages: BridgeChatMessage[]) {
  const leaked = messages.filter((item) => isVesperInternalContextText(item.content));
  if (!leaked.length) return;
  await Promise.all(leaked.map(async (item) => {
    const response = await fetch(codexHistoryUrl(`/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(item.id)}`), {
      method: "DELETE",
      headers: codexHistoryHeaders(true),
      cache: "no-store",
      body: JSON.stringify({
        messageId: item.id,
        itemId: item.metadata?.itemId || null,
        threadId: item.metadata?.threadId || null,
      }),
    });
    if (!response.ok) throw new Error("Could not clear internal context records");
  }));
}

let legacyHistoryMigration: Promise<void> | null = null;

function migrateLegacyHistory() {
  if (legacyHistoryMigration) return legacyHistoryMigration;
  legacyHistoryMigration = (async () => {
    if (!deviceToken() || window.localStorage.getItem("vesper-history-migration-v1") === "complete") return;
    const summaries = readLocalValue<ConversationSummary[]>("vesper-local-conversation-index", []);
    const conversations = new Map<string, { id: string; title: string; createdAt: string; updatedAt: string; messages: BridgeChatMessage[] }>();
    const ensureConversation = (id: string, title = "未命名对话", updatedAt = "") => {
      const existing = conversations.get(id);
      if (existing) {
        if (title && existing.title === "未命名对话") existing.title = title;
        if (updatedAt && (!existing.updatedAt || updatedAt > existing.updatedAt)) existing.updatedAt = updatedAt;
        return existing;
      }
      const value = { id, title: title || "未命名对话", createdAt: "", updatedAt, messages: [] as BridgeChatMessage[] };
      conversations.set(id, value);
      return value;
    };
    for (const summary of summaries) ensureConversation(summary.id, summary.title, summary.updatedAt);

    const listResponse = await fetch(apiUrl("/api/chat?list=1"), { headers: deviceHeaders(), cache: "no-store" });
    if (listResponse.ok) {
      const list = await listResponse.json() as { conversations?: ConversationSummary[] };
      for (const summary of list.conversations || []) {
        const detail = await fetch(apiUrl(`/api/chat?conversationId=${encodeURIComponent(summary.id)}`), { headers: deviceHeaders(), cache: "no-store" });
        if (!detail.ok) throw new Error(`Could not load old D1 conversation ${summary.id}`);
        const payload = await detail.json() as { messages?: BridgeChatMessage[] };
        ensureConversation(summary.id, summary.title, summary.updatedAt).messages.push(...(payload.messages || []).map((message) => ({ ...message, source: "legacy-vesper" as const })));
      }
    } else if (listResponse.status !== 404) {
      throw new Error("Could not load old D1 history");
    }

    for (const key of Object.keys(window.localStorage)) {
      if (!key.startsWith("vesper-local-chat-") && !key.startsWith("vesper-codex-chat-")) continue;
      const summary = summaries.find((item) => key.endsWith(`-${item.id}`));
      const id = summary?.id || (key.startsWith("vesper-codex-chat-")
        ? key.slice("vesper-codex-chat-".length)
        : key.slice("vesper-local-chat-".length).replace(/^(api|mcp|cyberboss)-/, ""));
      if (!id) continue;
      const source = key.startsWith("vesper-codex-chat-") ? "codex" as const : "legacy-vesper" as const;
      const items = normalizeCodexMessages(readLocalValue<BridgeChatMessage[]>(key, []), id).map((message) => ({ ...message, source: message.source || source }));
      ensureConversation(id, summary?.title || items[0]?.content.slice(0, 42) || "未命名对话", summary?.updatedAt || "").messages.push(...items);
    }

    for (const entry of conversations.values()) {
      const unique = new Map<string, BridgeChatMessage>();
      entry.messages.forEach((message, index) => {
        const id = message.id || `legacy-${entry.id}-${index}`;
        const normalized = { ...message, id, conversationId: entry.id, source: message.source || "legacy-vesper" as const, timeSource: message.createdAt ? "message" as const : "unknown" as const };
        unique.set(id, unique.has(id) ? { ...unique.get(id)!, ...normalized } : normalized);
      });
      const messages = [...unique.values()];
      const dated = messages.map((item) => item.createdAt).filter((value) => Number.isFinite(Date.parse(value))).sort();
      entry.createdAt ||= dated[0] || entry.updatedAt || new Date().toISOString();
      entry.updatedAt ||= dated.at(-1) || entry.createdAt;
      const source = messages.some((message) => message.source === "codex") ? "codex" : "legacy-vesper";
      await persistCodexConversation(entry.id, { title: entry.title, createdAt: entry.createdAt, updatedAt: entry.updatedAt, source });
      for (const message of messages) await persistCodexMessage(message, entry.title);
    }
    window.localStorage.setItem("vesper-history-migration-v1", "complete");
  })().catch((reason) => {
    legacyHistoryMigration = null;
    throw reason;
  });
  return legacyHistoryMigration;
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

async function videoPoster(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Video preview failed"));
    });
    video.currentTime = Math.min(1, Number.isFinite(video.duration) ? video.duration / 2 : 1);
    await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth || 1, video.videoHeight || 1));
    canvas.width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function StickerImage({ sticker, className = "" }: { sticker: StickerMessageData; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className={`sticker-image-placeholder ${className}`} role="img" aria-label="Sticker no longer available"><Icon name="sticker" /><span>Sticker no longer available</span></div>;
  return <img className={`sticker-image ${className}`} src={sticker.url} alt={sticker.alt || "Stickers"} loading="lazy" onError={() => setFailed(true)} />;
}

function StickerPickerSheet({ open, onClose, onSelect, onManage }: { open: boolean; onClose: () => void; onSelect: (sticker: StickerCatalogItem) => void; onManage: () => void }) {
  const [view, setView] = useState<"recent" | "favorites" | "all">("recent");
  const [query, setQuery] = useState("");
  const [stickers, setStickers] = useState<StickerCatalogItem[]>([]);
  const [categories, setCategories] = useState<StickerCategoryItem[]>([]);
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    if (!open) return;
    try {
      setError("");
      const search = new URLSearchParams();
      if (view !== "all") search.set("view", view);
      if (query.trim()) search.set("q", query.trim());
      if (category) search.set("category", category);
      const response = await fetch(apiUrl(`/api/stickers?${search}`), { headers: appHeaders(), cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { stickers?: StickerCatalogItem[]; categories?: StickerCategoryItem[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load stickers");
      setStickers(payload.stickers || []); setCategories(payload.categories || []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load stickers"); }
  };
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [open, view, category]);
  useEffect(() => { if (!open) return; const timer = window.setTimeout(() => void load(), 220); return () => window.clearTimeout(timer); }, [query]);
  if (!open) return null;
  return <div className="sticker-sheet-layer" role="presentation"><button className="sticker-sheet-scrim" aria-label="Close stickers" onClick={onClose} /><section className="sticker-sheet" role="dialog" aria-modal="true" aria-label="Stickers">
    <div className="sticker-sheet-handle" />
    <header><div><h2>Stickers</h2><p>Send only to this conversation</p></div><button className="sticker-manage-trigger" onClick={onManage}>Manage</button><button className="sticker-close" aria-label="Close" onClick={onClose}><Icon name="close" /></button></header>
    <div className="sticker-picker-controls"><label><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search stickers or situations" /></label><div className="sticker-picker-tabs"><button className={view === "recent" ? "active" : ""} onClick={() => setView("recent")}>Recent</button><button className={view === "favorites" ? "active" : ""} onClick={() => setView("favorites")}>Favorites</button><button className={view === "all" ? "active" : ""} onClick={() => setView("all")}>All</button></div></div>
    {categories.length > 0 && <div className="sticker-category-strip"><button className={!category ? "active" : ""} onClick={() => setCategory("")}>All</button>{categories.map((item) => <button key={item.id} className={category === item.id ? "active" : ""} onClick={() => setCategory(item.id)}>{item.name}</button>)}</div>}
    {error ? <p className="sticker-sheet-error">{error}</p> : stickers.length ? <div className="sticker-grid">{stickers.map((sticker) => <button key={sticker.assetId} className="sticker-grid-item" title={sticker.description || sticker.name || "Stickers"} onClick={() => onSelect(sticker)}><StickerImage sticker={sticker} /><span>{sticker.description || sticker.category || "Stickers"}</span></button>)}</div> : <div className="sticker-empty"><Icon name="sticker" /><p>No stickers here yet.</p><button onClick={onManage}>Add stickers</button></div>}
  </section></div>;
}

function StickerManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stickers, setStickers] = useState<StickerCatalogItem[]>([]); const [categories, setCategories] = useState<StickerCategoryItem[]>([]);
  const [selected, setSelected] = useState<StickerCatalogItem | null>(null); const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [categoryId, setCategoryId] = useState("");
  const [autoCollect, setAutoCollect] = useState(false); const [visionAvailable, setVisionAvailable] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const uploadRef = useRef<HTMLInputElement>(null);
  const load = async () => {
    if (!open) return;
    try { const [catalog, settings] = await Promise.all([fetch(apiUrl("/api/stickers?view=all"), { headers: appHeaders(), cache: "no-store" }), fetch(apiUrl("/api/stickers/settings"), { headers: appHeaders(), cache: "no-store" })]);
      const catalogData = await catalog.json() as { stickers?: StickerCatalogItem[]; categories?: StickerCategoryItem[]; error?: string }; const settingsData = await settings.json().catch(() => ({})) as { settings?: { enabled?: boolean; visionAvailable?: boolean } };
      if (!catalog.ok) throw new Error(catalogData.error || "Could not load stickers"); setStickers(catalogData.stickers || []); setCategories(catalogData.categories || []); setAutoCollect(Boolean(settingsData.settings?.enabled)); setVisionAvailable(Boolean(settingsData.settings?.visionAvailable));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load stickers"); }
  };
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [open]);
  const selectSticker = (sticker: StickerCatalogItem | null) => { setSelected(sticker); setName(sticker?.name || ""); setDescription(sticker?.description || ""); setCategoryId(sticker?.categoryId || ""); };
  const upload = async (files: FileList | File[]) => { const list = Array.from(files); if (!list.length) return; setBusy(true); setError(""); try { for (const file of list) { const form = new FormData(); form.append("file", file); if (categoryId) form.append("categoryId", categoryId); const response = await fetch(apiUrl("/api/stickers"), { method: "POST", headers: appHeaders(), body: form }); const payload = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) throw new Error(payload.error || `${file.name} upload failed`); } await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed"); } finally { setBusy(false); } };
  const save = async () => { if (!selected) return; setBusy(true); try { const response = await fetch(apiUrl(`/api/stickers/${encodeURIComponent(selected.assetId)}`), { method: "PATCH", headers: appHeaders(true), body: JSON.stringify({ name, description, categoryId: categoryId || null }) }); const payload = await response.json().catch(() => ({})) as { sticker?: StickerCatalogItem; error?: string }; if (!response.ok) throw new Error(payload.error || "Save failed"); selectSticker(payload.sticker || null); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Save failed"); } finally { setBusy(false); } };
  const remove = async () => { if (!selected || !window.confirm("Delete this sticker? Existing messages will show an unavailable placeholder.")) return; setBusy(true); try { const response = await fetch(apiUrl(`/api/stickers/${encodeURIComponent(selected.assetId)}`), { method: "DELETE", headers: appHeaders(true) }); const payload = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) throw new Error(payload.error || "Delete failed"); selectSticker(null); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Delete failed"); } finally { setBusy(false); } };
  const favorite = async () => { if (!selected) return; const response = await fetch(apiUrl(`/api/stickers/${encodeURIComponent(selected.assetId)}`), { method: "PATCH", headers: appHeaders(true), body: JSON.stringify({ favorite: !selected.favorite }) }); const payload = await response.json().catch(() => ({})) as { sticker?: StickerCatalogItem; error?: string }; if (!response.ok) return setError(payload.error || "Could not save favorite"); selectSticker(payload.sticker || null); await load(); };
  const createCategory = async () => { const name = window.prompt("New category name")?.trim(); if (!name) return; const response = await fetch(apiUrl("/api/stickers/categories"), { method: "POST", headers: appHeaders(true), body: JSON.stringify({ name }) }); const payload = await response.json().catch(() => ({})) as { category?: StickerCategoryItem; error?: string }; if (!response.ok) return setError(payload.error || "Could not create category"); await load(); if (payload.category) setCategoryId(payload.category.id); };
  const editCategory = async () => { const current = categories.find((item) => item.id === categoryId); if (!current) return setError("Select a category first"); const nextName = window.prompt("Category name", current.name)?.trim(); if (!nextName) return; const description = window.prompt("Category description (optional)", current.description); if (description === null) return; const response = await fetch(apiUrl(`/api/stickers/categories/${encodeURIComponent(current.id)}`), { method: "PATCH", headers: appHeaders(true), body: JSON.stringify({ name: nextName, description }) }); const payload = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) return setError(payload.error || "Could not edit category"); await load(); };
  const setCollection = async (enabled: boolean) => { const response = await fetch(apiUrl("/api/stickers/settings"), { method: "PATCH", headers: appHeaders(true), body: JSON.stringify({ enabled }) }); const payload = await response.json().catch(() => ({})) as { settings?: { enabled?: boolean }; error?: string }; if (!response.ok) return setError(payload.error || "Could not save setting"); setAutoCollect(Boolean(payload.settings?.enabled)); };
  if (!open) return null;
  return <div className="sticker-manager-layer" role="presentation"><button className="sticker-sheet-scrim" aria-label="Close sticker manager" onClick={onClose} /><section className="sticker-manager" role="dialog" aria-modal="true" aria-label="Manage stickers" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files); }}>
    <header><div><p>VERA&apos;S STICKERS</p><h2>Manage stickers</h2></div><button className="sticker-close" aria-label="Close" onClick={onClose}><Icon name="close" /></button></header>
    <div className="sticker-manager-upload"><input ref={uploadRef} hidden type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => { if (event.target.files) void upload(event.target.files); event.target.value = ""; }} /><button onClick={() => uploadRef.current?.click()} disabled={busy}><Icon name="upload" />{busy ? "Saving…" : "Add images"}</button><span>Drop a PNG, JPG, GIF or WebP here, up to 12 MB each.</span></div>
    <div className="sticker-manager-category"><span>Category</span><div>{categories.map((item) => <button key={item.id} className={categoryId === item.id ? "active" : ""} onClick={() => setCategoryId(item.id)}>{item.name}</button>)}<button onClick={createCategory}>＋ New</button><button onClick={editCategory}>Edit selected</button></div></div>
    <label className="sticker-collect-toggle"><span><b>Collect chat stickers automatically</b><small>{visionAvailable ? "Only images identified as stickers are saved. You can turn this off anytime." : "Enable visual recognition on the server first. Regular photos are not saved automatically."}</small></span><input type="checkbox" checked={autoCollect} disabled={!visionAvailable} onChange={(event) => void setCollection(event.target.checked)} /></label>
    {error && <p className="sticker-sheet-error">{error}</p>}
    <div className="sticker-manager-content"><div className="sticker-manager-grid">{stickers.map((sticker) => <button key={sticker.assetId} className={selected?.assetId === sticker.assetId ? "selected" : ""} onClick={() => selectSticker(sticker)}><StickerImage sticker={sticker} /><i>{sticker.favorite ? "★" : ""}</i></button>)}</div>{selected && <aside className="sticker-detail"><StickerImage sticker={selected} /><label>Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label><label>When to use<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={280} placeholder="For example: shy agreement, goodnight, affection" /></label><label>Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Uncategorized</option>{categories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><div><button onClick={() => void favorite()}>{selected.favorite ? "Remove favorite" : "Favorites"}</button><button onClick={() => void save()} disabled={busy}>Save</button><button className="danger" onClick={() => void remove()} disabled={busy}>Delete</button></div></aside>}</div>
  </section></div>;
}

function formatTurnTimestamp(value: string) {
  const timestamp = visibleMessageTimestamp(value);
  if (!Number.isFinite(timestamp)) return "Unknown time";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("month")}/${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function CodexChatMessage({
  item,
  activity,
  activityExpanded,
  onActivityExpandedChange,
  turnInProgress = false,
  agentName,
  userName,
  onThought,
  onCopy,
  favorite,
  onFavorite,
  onDelete,
  onPlayMusic,
  onQueueMusic,
  onOpenMusic,
  onAddMusicToPlaylist,
  onSaveAttachmentAsSticker,
}: {
  item: BridgeChatMessage;
  activity?: TurnActivity;
  activityExpanded?: boolean;
  onActivityExpandedChange?: (open: boolean) => void;
  turnInProgress?: boolean;
  agentName: string;
  userName: string;
  onThought: (item: BridgeChatMessage) => void;
  onCopy: (item: BridgeChatMessage) => void;
  favorite: boolean;
  onFavorite: (item: BridgeChatMessage) => void;
  onDelete: (item: BridgeChatMessage) => Promise<void>;
  onPlayMusic: (trackId: string) => void;
  onQueueMusic: (trackId: string) => void;
  onOpenMusic: () => void;
  onAddMusicToPlaylist: (card: MusicPlaylistIntent) => void;
  onSaveAttachmentAsSticker?: (attachment: ChatAttachment, item: BridgeChatMessage) => void;
}) {
  if (item.metadata?.execution) return <ExecutionCard execution={item.metadata.execution} live={turnInProgress} />;
  const attachmentOnly = item.role === "agent" && item.id.startsWith("files:") &&
    !!item.metadata?.attachments?.length && (!item.content?.trim() || item.content.trim() === "文件");
  const assistant = item.role === "agent";
  const timestamp = visibleMessageTimestamp(item.createdAt);
  const stamp = Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp))
    : "Unknown time";
  const status = item.metadata?.turnStatus;
  const statusText = status === "thinking" ? "Thinking…" : status === "tool" ? "Using a tool…" : status === "error" ? "Failed" : "";
  const statusLabel = formatTurnTimestamp(item.createdAt);
  const sticker = item.type === "sticker" ? item.metadata?.sticker : undefined;
  return (
    <div data-message-id={item.id} className={`${assistant ? "agent-turn" : "sent-turn"}${favorite ? " is-favorite" : ""}`}>
      {assistant && activity && <ChatActivity {...activity} expanded={activityExpanded} onExpandedChange={onActivityExpandedChange} timestamp={statusLabel} dateTime={Number.isFinite(timestamp) ? item.createdAt : undefined} status={statusText} />}
      {assistant && !activity && item.metadata?.showTurnStatus !== false && (
        item.metadata?.thoughtSummary ? (
          <button className="turn-status" onClick={() => onThought(item)} aria-label="View thought process">
            <i aria-hidden="true" /> <time dateTime={Number.isFinite(timestamp) ? item.createdAt : undefined}>{statusLabel}</time>{statusText && <span className="turn-progress">{statusText}</span>}
          </button>
        ) : (
          <div className="turn-status" aria-live="polite"><i aria-hidden="true" /> <time dateTime={Number.isFinite(timestamp) ? item.createdAt : undefined}>{statusLabel}</time>{statusText && <span className="turn-progress">{statusText}</span>}</div>
        )
      )}
      {!attachmentOnly && <div className={assistant ? "message assistant" : "message mine sent-message"}>
        {sticker ? <div className="sticker-bubble"><StickerImage sticker={sticker} /></div> : <div className={assistant ? "assistant-message-content" : undefined}>
          {item.content && <p>{item.content}</p>}
          {item.metadata?.musicCard && <MusicMessageCard card={item.metadata.musicCard} onPlay={onPlayMusic} onQueue={onQueueMusic} onOpen={onOpenMusic} onAddToPlaylist={onAddMusicToPlaylist} />}
        </div>}
      </div>}
      {!attachmentOnly && item.status !== "streaming" && !(assistant && turnInProgress) && <div className="message-actions">
        {!assistant && <time dateTime={Number.isFinite(timestamp) ? item.createdAt : undefined}>{stamp}</time>}
        <button className="message-action" aria-label="Copy" title="Copy" onClick={() => onCopy(item)}><Icon name="copy" /></button>
        <button className={`message-action${favorite ? " active" : ""}`} aria-label={favorite ? "Remove favorite" : "Favorites"} title={favorite ? "Remove favorite" : "Favorites"} onClick={() => onFavorite(item)}><Icon name="bookmark" /></button>

        <button className="message-action danger" aria-label="Delete" title="Delete" onClick={() => void onDelete(item).catch(() => {})}><Icon name="trash" /></button>
      </div>}
      <MessageAttachments items={item.metadata?.attachments || []} onSaveAsSticker={onSaveAttachmentAsSticker ? (attachment) => onSaveAttachmentAsSticker(attachment, item) : undefined} />
    </div>
  );
}

function CodexApprovalDialog({
  approval,
  queuedCount,
  onDecision,
}: {
  approval: PendingCodexApproval;
  queuedCount: number;
  onDecision: (action: "allow" | "deny") => void;
}) {
  const type = approval.kind === "command" ? "Command" : approval.kind === "file" ? "File changes" : "Additional permissions";
  return (
    <div className="codex-approval-layer" role="presentation">
      <section className="codex-approval-dialog" role="alertdialog" aria-modal="true" aria-labelledby="codex-approval-title" aria-describedby="codex-approval-description">
        <p className="codex-approval-kicker">CODEX APPROVAL · {type}</p>
        <h2 id="codex-approval-title">{approval.title}</h2>
        <p id="codex-approval-description" className="codex-approval-summary">{approval.summary}</p>
        <dl className="codex-approval-details">
          <div><dt>{approval.targetLabel}</dt><dd>{approval.target}</dd></div>
          <div><dt>{approval.detailLabel}</dt><dd><pre>{approval.detail}</pre></dd></div>
        </dl>
        {queuedCount > 1 && <p className="codex-approval-queue">Remaining {queuedCount - 1}  requests awaiting your decision.</p>}
        <p className="codex-approval-note">Permission applies only to this request and will not enable automatic approval.</p>
        <div className="codex-approval-actions">
          <button className="codex-approval-deny" onClick={() => onDecision("deny")}>Deny</button>
          <button className="codex-approval-allow" autoFocus onClick={() => onDecision("allow")}>Allow once</button>
        </div>
      </section>
    </div>
  );
}

function MusicMessageCard({
  card,
  onPlay,
  onQueue,
  onOpen,
  onAddToPlaylist,
}: {
  card: MusicCardData;
  onPlay: (trackId: string) => void;
  onQueue: (trackId: string) => void;
  onOpen: () => void;
  onAddToPlaylist: (card: MusicPlaylistIntent) => void;
}) {
  return (
    <article className="music-message-card">
      {card.cover ? <img src={card.cover} alt="" /> : <div className="music-card-placeholder">V</div>}
      <div className="music-card-copy">
        <b>{card.title}</b>
        <span>{card.artist || "Unknown artist"}{card.album ? ` · ${card.album}` : ""}</span>
        {card.message && <p>{card.message}</p>}
        <div className="music-card-actions">
          <button disabled={!card.playable} onClick={() => onPlay(card.trackId)}><Icon name="play" /> Play</button>
          <button onClick={() => onQueue(card.trackId)}><Icon name="plus" /> Queue</button>
          {card.source === "netease" && <button onClick={() => onAddToPlaylist(card)}><Icon name="library" /> Playlists</button>}
          <button onClick={onOpen}><Icon name="music" /> Player</button>
        </div>
      </div>
    </article>
  );
}

function ConnectedChat({
  watchMode = false,
  watchActive = false,
  wakeRequest,
  onWakeHandled,
  conversationId,
  onSelectConversation,
  agentName,
  userName,
  favorites,
  setFavorites,
  focusMessageId,
  currentTrack,
  playing,
  onToggleMusic,
  onNextMusic,
  onOpenMusic,
  onAddMusicToPlaylist,
}: {
  watchMode?: boolean;
  watchActive?: boolean;
  wakeRequest?: string | null;
  onWakeHandled?: () => void;
  conversationId: string;
  onSelectConversation: (id: string) => void;
  agentName: string;
  userName: string;
  favorites: FavoriteItem[];
  setFavorites: Dispatch<SetStateAction<FavoriteItem[]>>;
  focusMessageId?: string;
  currentTrack?: Track;
  playing: boolean;
  onToggleMusic: () => void;
  onNextMusic: () => void;
  onOpenMusic: () => void;
  onAddMusicToPlaylist: (card: MusicPlaylistIntent) => void;
}) {
  const [draft, setDraft] = useState("");
  const watchCapture = useRef<(() => Promise<WatchFrame | null>) | null>(null);
  const wakeConsumed = useRef(new Set<string>());
  const sending = useRef(false);
  const [expandedActivities, setExpandedActivities] = useState<Record<string, boolean>>({});
  const [messages, setMessages] = useState<BridgeChatMessage[]>(() => mergeCodexMessages(normalizeCodexMessages(readLocalValue(`vesper-codex-chat-${conversationId}`, []), conversationId)).filter((item) => !messageWasDeleted(item, readLocalValue(`vesper-codex-tombstones-${conversationId}`, []))));
  const [pending, setPending] = useState<CodexPendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState("");
  const [historyWarning, setHistoryWarning] = useState("");
  const [toolQuestions, setToolQuestions] = useState<UserInputRequest[]>([]);
  const answeredToolQuestions = useRef(new Set<string | number>());
  const completedQuestionTurns = useRef(new Set<string>());
  const [resumeError, setResumeError] = useState("");
  const [toolUpgradeNeeded, setToolUpgradeNeeded] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [, refreshActivity] = useState(0);
  const [streamingItems, setStreamingItems] = useState<Record<string, string>>({});
  const streamStartedAt = useRef(new Map<string, string>());
  const [thought, setThought] = useState<BridgeChatMessage | null>(null);
  const [listening, setListening] = useState(false);
  const [approvalQueue, setApprovalQueue] = useState<PendingCodexApproval[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [models, setModels] = useState<CodexModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelError, setModelError] = useState("");
  const [currentModel, setCurrentModel] = useState<CodexModelSelection | null>(null);
  const [nextModel, setNextModel] = useState<CodexModelSelection | null>(null);
  const modelCatalog = useRef<CodexModel[]>([]);
  const nextModelRef = useRef<CodexModelSelection | null>(null);
  const modelLoadId = useRef(0);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [stickerManagerOpen, setStickerManagerOpen] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const messagesRef = useRef(messages);
  const rpcId = useRef(1);
  const rpc = useRef(new Map<number, { resolve: (value: CodexSocketMessage) => void; reject: (reason: Error) => void }>());
  const threadId = useRef("");
  const connectionQueue = useRef(createConnectionQueue());
  const streamBuffers = useRef(new Map<string, string>());
  const reasoningBuffers = useRef(new Map<string, string>());
  const reasoningSummaries = useRef<string[]>([]);
  const appliedDeveloperInstructions = useRef("");
  const turnDone = useRef<((value?: unknown) => void) | null>(null);
  const activeTurnId = useRef("");
  const activeTurnUserId = useRef("");
  const streamEnd = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const executionPending = useRef(new Map<string, BridgeChatMessage>());
  const executionWrites = useRef(new Map<string, Promise<void>>());
  const executionFlush = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearBottomRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const jumpingToBottomRef = useRef(false);
  const tombstonesRef = useRef<CodexMessageTombstone[]>(readLocalValue(`vesper-codex-tombstones-${conversationId}`, []));
  const approvalQueueRef = useRef<PendingCodexApproval[]>([]);
  const approvalResponses = useRef(new Map<string, { result: Record<string, unknown>; expiresAt: number }>());
  const pendingAgentStickers = useRef<StickerMessageData[]>([]);

  const updateApprovalQueue = (update: (current: PendingCodexApproval[]) => PendingCodexApproval[]) => {
    setApprovalQueue((current) => {
      const next = update(current);
      approvalQueueRef.current = next;
      return next;
    });
  };
  const clearApprovalQueue = (filter?: { threadId?: string; turnId?: string; itemId?: string }) => {
    updateApprovalQueue((current) => clearCodexApprovals(current, filter));
  };

  const save = (next: BridgeChatMessage[]) => {
    const sanitized = mergeCodexMessages(normalizeCodexMessages(next, conversationId)).filter((item) => !messageWasDeleted(item, tombstonesRef.current));
    // A thread snapshot is only one source of a Vesper conversation.  Keep a
    // separate, union-only local recovery copy so a short/empty snapshot (or a
    // temporarily incomplete history response) can never replace old messages.
    // Tombstones still win, so an intentionally deleted message is not revived.
    const backupKey = `vesper-codex-chat-backup-${conversationId}`;
    const previousBackup = normalizeCodexMessages(readLocalValue<BridgeChatMessage[]>(backupKey, []), conversationId);
    const recoveryCopy = mergeCodexMessages(previousBackup, sanitized)
      .filter((item) => !messageWasDeleted(item, tombstonesRef.current));
    messagesRef.current = sanitized;
    setMessages(sanitized);
    window.localStorage.setItem(`vesper-codex-chat-${conversationId}`, JSON.stringify(sanitized));
    window.localStorage.setItem(backupKey, JSON.stringify(recoveryCopy));
  };
  const updateMessage = (id: string, update: (item: BridgeChatMessage) => BridgeChatMessage) => {
    const updated = messagesRef.current.map((item) => item.id === id ? update(item) : item);
    save(updated);
    const item = updated.find((candidate) => candidate.id === id);
    if (item) void persistCodexMessage(item).catch(() => setHistoryWarning("History not synced yet"));
  };
  const flushExecutions = () => {
    if (executionFlush.current) clearTimeout(executionFlush.current);
    executionFlush.current = null;
    const pending = [...executionPending.current.values()];
    executionPending.current.clear();
    if (!pending.length) return;
    save(mergeCodexMessages(messagesRef.current, pending));
    for (const item of pending) {
      // Serialize each item's checkpoints so a slow running write cannot overwrite completion.
      const writes = executionWrites.current;
      const write = (writes.get(item.id) || Promise.resolve())
        .then(() => persistCodexMessage(item)).catch(() => setHistoryWarning("Execution details not synced yet"));
      writes.set(item.id, write);
      void write.finally(() => { if (writes.get(item.id) === write) writes.delete(item.id); });
      void fetch(apiUrl('/api/codex/events'), { method: 'POST', headers: appHeaders(true), body: JSON.stringify({ conversationId, event: { ...item.metadata?.execution, id: item.id } }) })
        .then(response => { if (!response.ok) throw new Error('event sync failed'); }).catch(() => setHistoryWarning("Execution details not synced yet"));
    }
  };
  const observeExecution = (method: string, params: Record<string, unknown>) => {
    if (params.threadId && params.threadId !== threadId.current) return;
    const raw = params.item as Record<string, unknown> | undefined;
    const itemId = String(raw?.id || params.itemId || '');
    if (!itemId) return;
    const id = `${threadId.current}:execution:${itemId}`;
    const previous = executionPending.current.get(id) || messagesRef.current.find(item => item.id === id);
    const execution = executionEvent(method, params, previous?.metadata?.execution);
    if (!execution) return;
    const item: BridgeChatMessage = { id, conversationId, role: 'system', content: execution.title, status: execution.status,
      createdAt: previous?.createdAt || new Date().toISOString(), metadata: { execution, threadId: threadId.current, itemId: `execution:${itemId}`, turnId: String(params.turnId || activeTurnId.current || ''), blockType: 'execution', showTurnStatus: false } };
    executionPending.current.set(id, item);
    // Render live output without writing the full conversation to storage per token.
    const next = mergeCodexMessages(messagesRef.current, [item]);
    messagesRef.current = next; setMessages(next);
    if (method === 'item/completed') flushExecutions();
    else if (!executionFlush.current) executionFlush.current = setTimeout(flushExecutions, 1000);
  };
  useEffect(() => () => {
    if (executionFlush.current) clearTimeout(executionFlush.current);
    executionFlush.current = null;
    executionPending.current.clear();
  }, [conversationId]);
  const logCodexDiagnostic = (message: CodexSocketMessage) => {
    const method = typeof message.method === "string" ? message.method : "rpc-response";
    const itemType = message.params && typeof message.params.item === "object" && message.params.item !== null
      ? String((message.params.item as { type?: unknown }).type || "")
      : "";
    const entry = { method, itemType, at: new Date().toISOString() };
    const current = readLocalValue<typeof entry[]>("vesper-codex-diagnostics", []);
    window.localStorage.setItem("vesper-codex-diagnostics", JSON.stringify([...current.slice(-49), entry]));
    console.debug("[Vesper Codex diagnostic]", entry);
  };

  const setTurnStatus = (status: "thinking" | "tool" | "completed" | "error") => {
    if (!activeTurnUserId.current) return;
    if (messagesRef.current.find((item) => item.id === activeTurnUserId.current)?.metadata?.turnStatus === status) return;
    updateMessage(activeTurnUserId.current, (item) => ({ ...item, metadata: { ...item.metadata, turnStatus: status } }));
  };

  const callServerTool = async (name: string, args: Record<string, unknown>, itemId: string) => {
    const response = await fetch(apiUrl("/api/codex/tools"), {
      method: "POST",
      headers: appHeaders(true),
      cache: "no-store",
      body: JSON.stringify({ name, arguments: args, threadId: threadId.current, itemId, conversationId, turnId: activeTurnId.current }),
    });
    const payload = await response.json().catch(() => ({})) as { result?: unknown; error?: string };
    if (!response.ok) throw new Error(payload.error || `Tool ${name} failed`);
    return payload.result;
  };

  const dynamicToolCall = (params: Record<string, unknown>) => {
    const nested = params.toolCall && typeof params.toolCall === "object" ? params.toolCall as Record<string, unknown> : {};
    const rawArguments = params.arguments ?? params.input ?? nested.arguments ?? nested.input ?? {};
    let argumentsValue: Record<string, unknown> = {};
    if (rawArguments && typeof rawArguments === "object" && !Array.isArray(rawArguments)) argumentsValue = rawArguments as Record<string, unknown>;
    if (typeof rawArguments === "string") {
      try {
        const parsed = JSON.parse(rawArguments) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) argumentsValue = parsed as Record<string, unknown>;
      } catch {}
    }
    return {
      name: String(params.tool ?? params.name ?? nested.tool ?? nested.name ?? ""),
      itemId: String(params.itemId ?? params.callId ?? nested.itemId ?? nested.callId ?? nested.id ?? ""),
      argumentsValue,
    };
  };

  const sendToolResult = async (message: CodexSocketMessage) => {
    if (typeof message.id !== "number" && typeof message.id !== "string") return;
    const { name, itemId, argumentsValue } = dynamicToolCall(message.params || {});
    if (!name) {
      socket.current?.send(JSON.stringify({ id: message.id, result: { success: false, error: "Dynamic tool name is missing" } }));
      return;
    }
    setTurnStatus("tool");
    const activityId = itemId || String(message.id);
    const activityThread = threadId.current;
    const activityTurn = activeTurnId.current;
    observeExecution("item/started", { threadId: activityThread, turnId: activityTurn, item: { id: activityId, type: "dynamicToolCall", name, status: "inProgress" } });
    try {
      const result = await callServerTool(name, argumentsValue, itemId);
      if (['send_chat_file', 'album_send_photos'].includes(name) && result && typeof result === 'object' && 'attachments' in result) {
        const sent = result as { attachments: ChatAttachment[]; message?: string };
        const attachmentId = `files:${threadId.current}:${itemId}`;
        const existing = messagesRef.current.find(item => item.id === attachmentId);
        const fileMessage: BridgeChatMessage = { id: attachmentId, conversationId, role: 'agent', content: sent.message || '文件', status: 'delivered', createdAt: existing?.createdAt || new Date().toISOString(), metadata: { attachments: sent.attachments, itemId: attachmentId, threadId: threadId.current, turnId: activeTurnId.current, blockType: 'agentMessage', showTurnStatus: false } };
        save(mergeCodexMessages(messagesRef.current, [fileMessage]));
        await persistCodexMessage(fileMessage);
      }
      if (result && typeof result === "object" && "musicCard" in result) {
        window.dispatchEvent(new CustomEvent("vesper-music-card", { detail: { conversationId, card: (result as { musicCard: MusicCardData }).musicCard } }));
      }
      if (result && typeof result === "object" && (result as { musicLibraryRefresh?: unknown }).musicLibraryRefresh === true) {
        window.dispatchEvent(new CustomEvent("vesper-music-library-refresh"));
      }
      if (result && typeof result === "object" && "stickerMessage" in result) {
        const sticker = (result as { stickerMessage?: unknown }).stickerMessage;
        if (sticker && typeof sticker === "object" && typeof (sticker as StickerMessageData).assetId === "string") pendingAgentStickers.current.push(sticker as StickerMessageData);
      }
      observeExecution("item/completed", { threadId: activityThread, turnId: activityTurn, item: { id: activityId, type: "dynamicToolCall", name, status: "completed", result: "The tool returned a result." } });
      socket.current?.send(JSON.stringify({ id: message.id, result: { contentItems: [{ type: "inputText", text: JSON.stringify(result) }], success: true } }));
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : "Tool failed";
      observeExecution("item/completed", { threadId: activityThread, turnId: activityTurn, item: { id: activityId, type: "dynamicToolCall", name, status: "failed", error: text } });
      socket.current?.send(JSON.stringify({ id: message.id, result: { contentItems: [{ type: "inputText", text }], success: false, error: text } }));
      setError(text);
    }
  };
  const sendRpc = (method: string, params: Record<string, unknown>, timeoutMs = 0) => new Promise<CodexSocketMessage>((resolve, reject) => {
    const current = socket.current;
    if (!current || current.readyState !== WebSocket.OPEN) return reject(new Error("Codex socket is not open"));
    const id = rpcId.current++;
    const timer = timeoutMs ? window.setTimeout(() => {
      rpc.current.delete(id);
      reject(new Error("Codex request timed out. Please try again."));
    }, timeoutMs) : undefined;
    rpc.current.set(id, {
      resolve: (value) => { window.clearTimeout(timer); resolve(value); },
      reject: (reason) => { window.clearTimeout(timer); reject(reason); },
    });
    current.send(JSON.stringify({ id, method, params }));
  });
  const refreshModels = async () => {
    const loadId = ++modelLoadId.current;
    setModelsLoading(true);
    setModelError("");
    try {
      const catalog = await listCodexModels((method, params) => sendRpc(method, params, 15000));
      if (loadId !== modelLoadId.current) return;
      modelCatalog.current = catalog;
      setModels(catalog);
    } catch {
      if (loadId === modelLoadId.current) setModelError("Could not sync models. Please try again.");
    } finally {
      if (loadId === modelLoadId.current) setModelsLoading(false);
    }
  };
  const syncThreadModel = (message: CodexSocketMessage) => {
    setCurrentModel(selectionFromThread(message.result));
  };
  const answerApproval = (approval: PendingCodexApproval, action: "allow" | "deny") => {
    const current = socket.current;
    if (!current || current.readyState !== WebSocket.OPEN) {
      clearApprovalQueue();
      setError("Codex disconnected. Your approval was not sent. Reconnect and try again.");
      return;
    }
    // Guard against a double tap while React is scheduling the dialog removal.
    if (approvalResponses.current.has(approval.requestKey)) return;
    const result = approvalResultFor(approval, action);
    const expiresAt = Date.now() + 30_000;
    approvalResponses.current.set(approval.requestKey, { result, expiresAt });
    for (const id of approval.rpcIds) current.send(JSON.stringify({ id, result }));
    window.setTimeout(() => {
      const saved = approvalResponses.current.get(approval.requestKey);
      if (saved && saved.expiresAt <= Date.now()) approvalResponses.current.delete(approval.requestKey);
    }, 30_100);
    updateApprovalQueue((queue) => removeCodexApproval(queue, approval.requestKey));
  };
  const handleSocketMessage = (message: CodexSocketMessage) => {
    if (typeof message.id === "number" && rpc.current.has(message.id) && !message.method) {
      const pendingRpc = rpc.current.get(message.id)!;
      rpc.current.delete(message.id);
      if (message.error) pendingRpc.reject(new Error(message.error.message || "Codex request failed"));
      else pendingRpc.resolve(message);
      return;
    }
    const params = message.params || {};
    if (params.threadId && threadId.current && params.threadId !== threadId.current) {
      if (message.id != null && message.method && CODEX_DYNAMIC_TOOL_METHODS.has(message.method)) {
        socket.current?.send(JSON.stringify({ id: message.id, error: { code: -32602, message: "Tool request belongs to another thread" } }));
      }
      return;
    }
    // App-server versions have used each of these request names for dynamic tools.
    if (message.method && CODEX_DYNAMIC_TOOL_METHODS.has(message.method)) {
      void sendToolResult(message);
      return;
    }
    if (message.method === "currentTime/read" && typeof message.id === "number") {
      socket.current?.send(JSON.stringify({ id: message.id, result: { currentTimeAt: Math.floor(Date.now() / 1000) } }));
      return;
    }
    if (message.method === "serverRequest/resolved") {
      if (typeof params.requestId === "string" || typeof params.requestId === "number") answeredToolQuestions.current.add(params.requestId);
      setToolQuestions(current => current.filter(request => request.id !== params.requestId));
      updateApprovalQueue((queue) => queue.filter((approval) => !approvalWasResolved(approval, params)));
      for (const [key, response] of approvalResponses.current) {
        if (response.expiresAt <= Date.now()) approvalResponses.current.delete(key);
      }
      return;
    }
    if (["item/tool/requestUserInput", "tool/requestUserInput", "mcpServer/elicitation/request"].includes(message.method || "") && (typeof message.id === "string" || typeof message.id === "number")) {
      if (answeredToolQuestions.current.has(message.id)) return;
      const questionTurnId = String(params.turnId || activeTurnId.current || "");
      if (questionTurnId && completedQuestionTurns.current.has(questionTurnId)) return;
      const request = { id: message.id, method: message.method!, params: { ...params, turnId: questionTurnId } };
      setToolQuestions(current => current.some(entry => entry.id === request.id) ? current : [...current, request]);
      return;
    }
    const approval = createCodexApprovalRequest(message);
    if (approval) {
      const cachedResponse = approvalResponses.current.get(approval.requestKey);
      if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
        socket.current?.send(JSON.stringify({ id: message.id, result: cachedResponse.result }));
      } else {
        if (cachedResponse) approvalResponses.current.delete(approval.requestKey);
        updateApprovalQueue((queue) => queueCodexApproval(queue, approval));
      }
      return;
    }
    if (message.method?.endsWith("/requestApproval")) {
      // This is intentionally not a decision: the client only supports the
      // explicit command, file-change, and permissions request schemas above.
      // Returning a JSON-RPC error keeps an unknown server request from leaving
      // an uncloseable modal behind without guessing an approval payload.
      logCodexDiagnostic(message);
      setError("This Codex approval request cannot be safely displayed. No decision was sent.");
      if (typeof message.id === "number" || typeof message.id === "string") {
        socket.current?.send(JSON.stringify({ id: message.id, error: { code: -32601, message: "Unsupported approval request type" } }));
      }
      return;
    }
    if (message.method === 'item/started' || message.method === 'item/completed' || message.method === 'item/commandExecution/outputDelta' || message.method === 'item/fileChange/outputDelta') observeExecution(message.method, params);
    if (message.method === 'item/commandExecution/outputDelta' || message.method === 'item/fileChange/outputDelta') return;
    if (['turn/started', 'turn/completed', 'turn/plan/updated', 'turn/diff/updated'].includes(message.method || '')) {
      const turn = (params.turn || {}) as Record<string, unknown>;
      const turnId = String(turn.id || params.turnId || activeTurnId.current || '');
      if (turnId) {
        const plan = message.method === 'turn/plan/updated';
        const diff = message.method === 'turn/diff/updated';
        const finished = message.method === 'turn/completed';
        observeExecution(finished || plan || diff ? 'item/completed' : 'item/started', { ...params, turnId, item: {
          id: `${plan ? 'plan' : diff ? 'diff' : 'turn'}:${turnId}`, type: 'toolCall', name: plan ? "Task plan" : diff ? "Changes this turn" : "Reply task",
          status: plan || diff ? 'completed' : turn.status || (finished ? 'completed' : 'inProgress'), result: plan ? params.plan : diff ? params.diff : turn.error || (finished ? "Turn finished" : "Started"),
        } });
      }
      if (message.method === 'turn/plan/updated' || message.method === 'turn/diff/updated') return;
    }
    if (message.method === "item/agentMessage/delta") {
      const id = String(params.itemId || "agent");
      if (isCompletedCodexItem(messagesRef.current, id)) return;
      if (!streamStartedAt.current.has(id)) streamStartedAt.current.set(id, new Date().toISOString());
      setTurnStatus("thinking");
      const next = `${streamBuffers.current.get(id) || ""}${String(params.delta || "")}`;
      streamBuffers.current.set(id, next);
      setStreamingItems((current) => ({ ...current, [id]: next }));
    }
    if (message.method === "item/reasoning/summaryTextDelta") {
      if (params.turnId && params.turnId !== activeTurnId.current) return;
      const id = String(params.itemId || "reasoning");
      reasoningBuffers.current.set(id, `${reasoningBuffers.current.get(id) || ""}${String(params.delta || "")}`);
      refreshActivity(value => value + 1);
    }
    if (message.method === "item/started" && CODEX_TOOL_ITEM_TYPES.has(String((params.item as CodexItem | undefined)?.type || ""))) setTurnStatus("tool");
    if (message.method === "item/completed") {
      const item = (params.item || {}) as CodexItem;
      const itemId = String(item.id || params.itemId || "");
      const itemType = String(item.type || "");
      if (itemId) clearApprovalQueue({ threadId: String(params.threadId || threadId.current || ""), itemId });
      if (CODEX_REASONING_ITEM_TYPES.has(itemType) && (!params.turnId || params.turnId === activeTurnId.current)) {
        const summaries = cleanReasoningSummary(item.summary ?? (itemType === "reasoningSummary" ? item.text : undefined) ?? reasoningBuffers.current.get(itemId) ?? "");
        reasoningSummaries.current.push(...summaries.filter((line) => !reasoningSummaries.current.includes(line)));
        reasoningBuffers.current.delete(itemId);
        refreshActivity(value => value + 1);
      }
      if (CODEX_TOOL_ITEM_TYPES.has(itemType)) {
        setTurnStatus("tool");
      }
      const content = (visibleAssistantText(item) || streamBuffers.current.get(itemId) || "").trim();
      if (content && activeTurnId.current && CODEX_ASSISTANT_ITEM_TYPES.has(itemType) && (!item.role || item.role === "assistant")) {
        const current = messagesRef.current;
        // Keep the complete assistant item intact; punctuation is not a message boundary.
        const bubbles = [content];
        const agentMessages = bubbles.map((bubble, index) => {
          const bubbleItemId = index === 0 ? itemId : `${itemId}:bubble:${index}`;
          const existing = current.find((candidate) => {
            const identity = codexBubbleIdentity(candidate);
            return identity?.parentId === itemId && identity.index === index;
          });
          return {
            id: existing?.id || (itemId ? `${itemId}:bubble:${index}` : crypto.randomUUID()),
            conversationId,
            role: "agent" as const,
            content: bubble,
            status: "delivered",
            metadata: {
              ...existing?.metadata,
              turnId: activeTurnId.current,
              threadId: threadId.current,
              itemId: bubbleItemId,
              blockType: itemType,
              turnStatus: index === 0 ? "completed" as const : undefined,
              showTurnStatus: index === 0,
            },
            createdAt: existing?.createdAt || streamStartedAt.current.get(itemId) || new Date().toISOString(),
          } satisfies BridgeChatMessage;
        });
        save(mergeCodexMessages(current, agentMessages));
        void Promise.all(agentMessages.map((agentMessage) => persistCodexMessage(agentMessage)))
          .catch(() => setHistoryWarning("History not synced yet"));
        agentMessages.forEach((agentMessage) => void persistMemoryMessage(agentMessage).catch(() => {}));
      }
      if (CODEX_ASSISTANT_ITEM_TYPES.has(itemType)) {
        setStreamingItems((current) => {
          const next = { ...current };
          delete next[itemId];
          return next;
        });
        streamBuffers.current.delete(itemId);
      }
    }
    if (message.method === "turn/completed") {
      const questionTurnId = (params.turn as { id?: string } | undefined)?.id || params.turnId || activeTurnId.current;
      if (questionTurnId) completedQuestionTurns.current.add(String(questionTurnId));
      setToolQuestions(current => current.filter(request => request.params.turnId !== questionTurnId));
      flushExecutions();
      const completedTurn = params.turn && typeof params.turn === "object" ? params.turn as { id?: unknown } : {};
      const completedTurnId = String(completedTurn.id || activeTurnId.current || "");
      if (completedTurnId) clearApprovalQueue({ threadId: threadId.current, turnId: completedTurnId });
      reasoningSummaries.current = [...new Set([...reasoningSummaries.current, ...Array.from(reasoningBuffers.current.values()).flatMap(cleanReasoningSummary)])];
      setBusy(false);
      sending.current = false;
      const turnFailed = ["failed", "interrupted"].includes(String((params.turn as Record<string, unknown> | undefined)?.status));
      if (activeTurnUserId.current) {
        updateMessage(activeTurnUserId.current, (item) => ({
          ...item,
          status: turnFailed ? "error" : "completed",
          metadata: {
            ...item.metadata,
            turnId: activeTurnId.current || item.metadata?.turnId,
            turnStatus: turnFailed ? "error" : "completed",
            wake: item.metadata?.wake ? { ...item.metadata.wake, endedAt: new Date().toISOString() } : undefined,
            thoughtSummary: reasoningSummaries.current.length ? reasoningSummaries.current.join("\n") : undefined,
          },
        }));
      }
      const stickers = pendingAgentStickers.current.splice(0, pendingAgentStickers.current.length);
      if (stickers.length) {
        const stickerMessages = stickers.map((sticker, index) => ({
          id: `${completedTurnId || crypto.randomUUID()}:sticker:${index}`,
          conversationId,
          role: "agent" as const,
          type: "sticker" as const,
          // The deployed VPS history service previously required non-empty
          // content. The renderer ignores this compatibility value whenever a
          // structured sticker is present.
          content: "[Sticker]",
          status: "delivered",
          metadata: { sticker, turnId: completedTurnId, threadId: threadId.current, itemId: `${completedTurnId}:sticker:${index}`, blockType: "sticker", showTurnStatus: false },
          createdAt: new Date().toISOString(),
        } satisfies BridgeChatMessage));
        save(mergeCodexMessages(messagesRef.current, stickerMessages));
        void Promise.all(stickerMessages.map((item) => persistCodexMessage(item))).catch(() => setHistoryWarning("History not synced yet"));
      }
      setStreamingItems({});
      streamBuffers.current.clear();
      streamStartedAt.current.clear();
      reasoningBuffers.current.clear();
      reasoningSummaries.current = [];
      turnDone.current?.(params.turn);
      turnDone.current = null;
      activeTurnId.current = "";
      activeTurnUserId.current = "";
      void scheduleMemoryDistillation(conversationId);
    }
    if (message.method === "turn/started" || message.method === "turn/inProgress") setTurnStatus("thinking");
    const knownMethods = new Set(["item/agentMessage/delta", "item/reasoning/summaryTextDelta", "item/completed", "turn/completed", "turn/started", "turn/inProgress", "item/started", "currentTime/read", "serverRequest/resolved", ...CODEX_DYNAMIC_TOOL_METHODS]);
    if (message.method && !knownMethods.has(message.method)) {
      logCodexDiagnostic(message);
      if (typeof message.id === "number" || typeof message.id === "string") socket.current?.send(JSON.stringify({ id: message.id, error: { code: -32601, message: "Unsupported app-server request" } }));
    }
  };
  const hydrateThreadSnapshot = (response: CodexSocketMessage) => {
    const root = response.result || {};
    const thread = (root.thread || root) as { createdAt?: unknown; turns?: unknown[]; items?: unknown[]; messages?: unknown[] };
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    const rawItems = [
      ...(Array.isArray(thread.items) ? thread.items.map((item) => ({ item, turnId: "", createdAt: thread.createdAt })) : []),
      ...(Array.isArray(thread.messages) ? thread.messages.map((item) => ({ item, turnId: "", createdAt: thread.createdAt })) : []),
      ...turns.flatMap((turn) => {
        if (!turn || typeof turn !== "object") return [];
        const value = turn as { id?: string; startedAt?: unknown; items?: unknown[] };
        return Array.isArray(value.items) ? value.items.map((item) => ({ item, turnId: value.id || "", createdAt: value.startedAt })) : [];
      }),
    ];
    const restored = rawItems.flatMap<BridgeChatMessage>((entry) => {
      if (!entry.item || typeof entry.item !== "object") return [];
      const item = entry.item as CodexItem & { createdAt?: unknown; startedAt?: unknown };
      const type = String(item.type || "");
      const execution = executionEvent('item/completed', { item });
      if (execution) return [{ id: `${threadId.current}:execution:${execution.id}`, conversationId, role: 'system' as const, content: execution.title, status: execution.status, createdAt: codexTimestamp(item.createdAt ?? item.startedAt ?? entry.createdAt, new Date().toISOString()), metadata: { execution, threadId: threadId.current, itemId: `execution:${execution.id}`, turnId: entry.turnId, blockType: 'execution', showTurnStatus: false } } satisfies BridgeChatMessage];
      const role = item.role === "user" || type === "userMessage" || type === "userInput" ? "user" : "agent";
      const content = role === "agent" ? visibleAssistantText(item) : visibleUserText(item);
      if (!content.trim()) return [];
      if (isVesperInternalContextText(content)) return [];
      if (role === "agent" && (!CODEX_ASSISTANT_ITEM_TYPES.has(type) || (item.role && item.role !== "assistant"))) return [];
      // A completed app-server item remains one item in its own snapshot, but
      // Vesper may have saved it as two or three chat bubbles. The persisted
      // bubbles are authoritative here; do not merge the original full text
      // back into their first bubble on a later resume.
      if (role === "agent" && item.id && hasCodexChatBubbles(messagesRef.current, item.id)) return [];
      const existing = messagesRef.current.find((candidate) =>
        (item.id && candidate.metadata?.itemId === item.id) ||
        (entry.turnId && candidate.metadata?.turnId === entry.turnId && candidate.role === role && (candidate.content === content.trim() || candidate.metadata?.modelInputText === content.trim())));
      const messageTime = codexTimestamp(item.createdAt ?? item.startedAt);
      const turnTime = codexTimestamp(entry.createdAt);
      const threadTime = codexTimestamp(thread.createdAt);
      const createdAt = existing?.createdAt || messageTime || turnTime || threadTime;
      const timeSource = existing?.timeSource || existing?.metadata?.timeSource || (messageTime ? "message" : turnTime ? "turn" : threadTime ? "thread" : "unknown");
      return [{ id: existing?.id || String(item.id || crypto.randomUUID()), conversationId, role: role as "user" | "agent", content: role === "user" && existing ? existing.content : content.trim(), status: "delivered", metadata: { ...existing?.metadata, itemId: item.id, turnId: entry.turnId || existing?.metadata?.turnId, blockType: type, threadId: threadId.current, timeSource }, createdAt, source: "codex", timeSource } satisfies BridgeChatMessage];
    });
    if (restored.length) save(mergeCodexMessages(messagesRef.current, restored.filter((item) => !messageWasDeleted(item, tombstonesRef.current))));
    for (const item of restored) if (item.metadata?.execution && !messageWasDeleted(item, tombstonesRef.current)) executionPending.current.set(item.id, item);
    if (executionPending.current.size) flushExecutions();
  };
  const loadDynamicTools = async () => {
    const catalog = await fetch(apiUrl("/api/codex/tools"), { headers: appHeaders(), cache: "no-store" });
    if (!catalog.ok) throw new Error(catalog.status === 401 ? "Could not load Vesper tools. Pair this device again in Settings." : "Vesper’s tool catalog is unavailable. Reconnect later.");
    const payload = await catalog.json() as { tools?: unknown };
    return validateCodexToolCatalog(payload.tools);
  };
  const startThreadWithTools = async (dynamicTools: typeof CODEX_DYNAMIC_TOOLS, developerInstructions: string) => {
    const result = await sendRpc("thread/start", {
      dynamicTools,
      config: VESPER_DESIRE_SESSION_CONFIG,
      ...workspaceOptions(readLocalValue("vesper-codex-workspace", "")),
      approvalPolicy: "on-request",
      summary: "concise",
      developerInstructions,
    });
    const thread = (result.result?.thread || {}) as { id?: string };
    if (!thread.id) throw new Error("Codex did not return a thread id");
    threadId.current = thread.id;
    try { window.localStorage.setItem(`vesper-thread-tools-${thread.id}`, CODEX_TOOL_CATALOG_VERSION); } catch {}
    setToolUpgradeNeeded(false);
    syncThreadModel(result);
    appliedDeveloperInstructions.current = developerInstructions;
    void persistCodexConversation(conversationId, { codexThreadId: thread.id })
      .catch(() => setHistoryWarning("History not synced yet"));
    return thread.id;
  };
  const resumeThread = async (developerInstructions: string) => {
    // Dynamic tools belong to thread/start and persisted rollout metadata.
    // thread/resume cannot replace them, even when it accepts unknown fields.
    let registeredVersion = "";
    try { registeredVersion = window.localStorage.getItem(`vesper-thread-tools-${threadId.current}`) || ""; } catch {}
    setToolUpgradeNeeded(registeredVersion !== CODEX_TOOL_CATALOG_VERSION);
    try {
      const resumed = await resumeCodexThread(sendRpc, threadId.current!, developerInstructions);
      syncThreadModel(resumed);
      hydrateThreadSnapshot(resumed);
      appliedDeveloperInstructions.current = developerInstructions;
      setResumeError("");
    } catch (reason) {
      logCodexDiagnostic({ method: "thread/resume/failed", params: { kind: reason instanceof Error ? reason.name : "unknown" } });
      setResumeError(`Conversation connection failed: ${reason instanceof Error ? reason.message : "Unknown error"}. Saved history is still available.`);
      throw new Error("This conversation cannot continue right now. You can start a replacement.");
    }
  };
  const connectInternal = async (memoryBackground = "", createIfMissing = false) => {
    const developerInstructions = vesperDeveloperInstructions(memoryBackground);
    if (socket.current?.readyState === WebSocket.OPEN) {
      await syncCodexThread({
        hasThread: !!threadId.current, newConnection: false, createIfMissing,
        instructionsChanged: appliedDeveloperInstructions.current !== developerInstructions,
        start: async () => { await startThreadWithTools(await loadDynamicTools(), developerInstructions); },
        resume: () => resumeThread(developerInstructions),
      });
      return;
    }
    const ws = new WebSocket(codexSocketUrl());
    socket.current = ws;
    ws.onmessage = (event) => {
      try { handleSocketMessage(JSON.parse(String(event.data)) as CodexSocketMessage); } catch { setError("Invalid message from Codex app-server"); }
    };
    ws.onclose = () => {
      if (socket.current !== ws) return;
      const hadPendingApproval = approvalQueueRef.current.length > 0;
      setOnline(false);
      setToolQuestions([]);
      answeredToolQuestions.current.clear();
      completedQuestionTurns.current.clear();
      socket.current = null;
      for (const request of rpc.current.values()) request.reject(new Error("Codex disconnected"));
      rpc.current.clear();
      clearApprovalQueue();
      approvalResponses.current.clear();
      if (hadPendingApproval) setError("Codex disconnected. Pending approvals were not sent.");
    };
    ws.onerror = () => setError("Codex app-server is offline");
    await new Promise<void>((resolve, reject) => {
      const closedBeforeOpen = () => reject(new Error("Codex disconnected before the handshake finished."));
      ws.addEventListener("close", closedBeforeOpen, { once: true });
      ws.onopen = () => { ws.removeEventListener("close", closedBeforeOpen); resolve(); };
      ws.onerror = () => { ws.removeEventListener("close", closedBeforeOpen); reject(new Error("Codex app-server is offline")); };
    });
    try {
      await sendRpc("initialize", { clientInfo: { name: "vesper_web", title: "Vesper", version: "0.6.0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
      ws.send(JSON.stringify({ method: "initialized" }));
      void refreshModels();
      await syncCodexThread({
        hasThread: !!threadId.current, newConnection: true, createIfMissing,
        instructionsChanged: appliedDeveloperInstructions.current !== developerInstructions,
        start: async () => { await startThreadWithTools(await loadDynamicTools(), developerInstructions); },
        resume: () => resumeThread(developerInstructions),
      });
      setOnline(true);
      setError("");
    } catch (reason) {
      setOnline(false);
      ws.close();
      throw reason;
    }
  };
  const connect = (memoryBackground = "", createIfMissing = false) =>
    connectionQueue.current(() => connectInternal(memoryBackground, createIfMissing));
  const createReplacementConversation = async () => {
    if (busy) return;
    const replacementId = `chat-${Date.now()}-${crypto.randomUUID()}`;
    setBusy(true);
    try {
      // Create the Vesper conversation only. Its mounted chat starts its own
      // app-server thread; an empty thread on this old socket may not have a rollout yet.
      await persistCodexConversation(replacementId, { title: "New conversation", codexThreadId: null });
      rememberConversation(replacementId, "New conversation", 0);
      onSelectConversation(replacementId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create replacement conversation");
    } finally {
      setBusy(false);
    }
  };
  const cancelActiveTurn = async () => {
    if (!activeTurnId.current || !threadId.current) return;
    clearApprovalQueue({ threadId: threadId.current, turnId: activeTurnId.current });
    try {
      await sendRpc("turn/interrupt", { threadId: threadId.current, turnId: activeTurnId.current });
      setError("Cancellation requested.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not cancel the active turn");
    }
  };
  const editMessage = (item: BridgeChatMessage) => {
    const content = window.prompt("Edit message", item.content)?.trim();
    if (!content || content === item.content) return;
    const updated = { ...item, content };
    save(messagesRef.current.map((message) => message.id === item.id ? updated : message));
    void persistCodexMessage(updated).catch(() => setHistoryWarning("History not synced yet"));
  };
  const copyMessage = async (item: BridgeChatMessage) => {
    try {
      await navigator.clipboard.writeText(item.content || item.metadata?.sticker?.description || item.metadata?.sticker?.alt || "Stickers");
      setError("Copied");
      window.setTimeout(() => setError((current) => current === "Copied" ? "" : current), 1200);
    } catch {
      setError("Copy failed");
    }
  };
  const toggleFavorite = (item: BridgeChatMessage) => {
    if (favorites.some((favorite) => favorite.messageId === item.id)) {
      setFavorites((current) => current.filter((favorite) => favorite.messageId !== item.id));
      return;
    }
    const title = readLocalValue<ConversationSummary[]>("vesper-local-conversation-index", []).find((entry) => entry.id === conversationId)?.title || "Conversations";
    setFavorites((current) => [...current, {
      id: crypto.randomUUID(), folderId: "default", messageId: item.id,
      itemId: item.metadata?.itemId || item.metadata?.blockType, threadId: item.metadata?.threadId || item.metadata?.turnId,
      conversationId, conversationTitle: title, role: item.role, content: item.content, createdAt: item.createdAt,
    }]);
  };
  const deleteMessage = async (item: BridgeChatMessage) => {
    if (!window.confirm("Delete this message? This cannot be undone.")) return;
    const response = await fetch(codexHistoryUrl(`/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(item.id)}`), {
      method: "DELETE",
      headers: codexHistoryHeaders(true),
      cache: "no-store",
      body: JSON.stringify({ messageId: item.id, itemId: item.metadata?.itemId || null, threadId: item.metadata?.threadId || threadId.current || null }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      const detail = payload.error || `Delete failed (HTTP ${response.status})`;
      setError(detail);
      throw new Error(detail);
    }
    const tombstone = { messageId: item.id, itemId: item.metadata?.itemId || null, threadId: item.metadata?.threadId || threadId.current || null, deletedAt: new Date().toISOString() };
    tombstonesRef.current = [...tombstonesRef.current.filter((entry) => entry.messageId !== tombstone.messageId && (!tombstone.itemId || entry.itemId !== tombstone.itemId)), tombstone];
    window.localStorage.setItem(`vesper-codex-tombstones-${conversationId}`, JSON.stringify(tombstonesRef.current));
    save(messagesRef.current.filter((message) => !messageWasDeleted(message, tombstonesRef.current)));
    setFavorites((current) => current.filter((favorite) => favorite.messageId !== item.id));
  };
  const prepareFile = async (item: CodexPendingFile): Promise<{ attachment: ChatAttachment; input?: CodexInput; text?: string }> => {
    const { file } = item;
    const attachment = await uploadMedia(file);
    const downloadText = attachmentInputText(attachment);
    if (file.type.startsWith("image/")) return imageAttachmentInput(attachment, await localImage(file, 1600, 0.84));
    if (file.type.startsWith("audio/")) return { attachment, input: { type: "audio", url: await readDataUrl(file) } };
    if (file.type.startsWith("video/")) return { attachment, input: { type: "image", url: await videoPoster(file) }, text: `${downloadText}\nA representative frame is included.` };
    if (file.type.startsWith("text/") || /\.(json|html?|md|csv|tsx?|jsx?)$/i.test(file.name)) return { attachment, text: `${downloadText}\nFile preview:\n${(await file.text()).slice(0, 120000)}` };
    return { attachment, text: downloadText };
  };
  const stickerInputForModel = async (sticker: StickerCatalogItem): Promise<CodexInput | null> => {
    try {
      const response = await fetch(sticker.url, { cache: "no-store" });
      if (!response.ok) return null;
      const blob = await response.blob();
      return { type: "image", url: await localImage(new File([blob], sticker.name || "sticker", { type: sticker.mimeType || blob.type })) };
    } catch { return null; }
  };
  const send = async (selectedSticker?: StickerCatalogItem, wakeId?: string, sharedFrame?: WatchFrame) => {
    const content = wakeId ? `这是一次 Vesper 主动唤醒，request_id=${wakeId}。这段文字是应用生成的唤醒上下文，不是 Vera 的新聊天消息。结合已有上下文，自行选择一件适合现在做的小事，可以调用已授权工具，然后自然地给 Vera 留话。只报告实际完成的事，不虚构工具调用。若记录这次自主行动，来源使用 automation，同一事件复用 request_id，不重复提交。涉及对外发送或其他需确认的操作仍遵守原有权限。` : sharedFrame ? (sharedFrame.automatic ? "陪看画面自动更新（不是新的用户发言，若记录互动须使用 automation 来源）：根据这一幕简短陪聊，不必每次重复描述画面。" : "陪我看看这一幕。") : draft.trim();
    if ((!content && !pending.length && !selectedSticker) || busy || sending.current) return;
    sending.current = true;
    const outgoingFiles = wakeId || sharedFrame ? [] : pending;
    setBusy(true); setError(""); if (!wakeId && !sharedFrame) setDraft("");
    pendingAgentStickers.current = [];
    nearBottomRef.current = true;
    const userMessage: BridgeChatMessage = { id: crypto.randomUUID(), conversationId, role: "user", type: selectedSticker ? "sticker" : "text", content: wakeId ? "Wake AI" : content || (selectedSticker ? "[Sticker]" : "Attachment"), status: "thinking", metadata: { wake: wakeId ? { requestId: wakeId, requestedAt: new Date().toISOString(), source: wakeId.startsWith("auto-") ? "automation" : "manual" } : undefined, attachments: [], sticker: selectedSticker ? { assetId: selectedSticker.assetId, url: selectedSticker.url, width: selectedSticker.width, height: selectedSticker.height, mimeType: selectedSticker.mimeType, alt: selectedSticker.alt || selectedSticker.description || selectedSticker.name || "Stickers", description: selectedSticker.description, category: selectedSticker.category } : undefined, turnId: `pending-${crypto.randomUUID()}`, turnStatus: "thinking" }, createdAt: new Date().toISOString() };
    activeTurnUserId.current = userMessage.id;
    save([...messagesRef.current, userMessage]);
    if (selectedSticker) void fetch(apiUrl(`/api/stickers/${encodeURIComponent(selectedSticker.assetId)}`), { method: "POST", headers: appHeaders(true), body: JSON.stringify({ action: "use" }) }).catch(() => {});
    rememberConversation(conversationId, wakeId ? "Wake AI" : content.slice(0, 28) || (selectedSticker ? "Stickers" : "Attachment"));
    try {
      void persistCodexMessage(userMessage, wakeId ? "Wake AI" : content.slice(0, 42) || (selectedSticker ? "Stickers" : "Attachment"))
        .catch(() => setHistoryWarning("History not synced yet"));
      if (!wakeId && !sharedFrame?.automatic && userMessage.content && userMessage.type !== "sticker") void persistMemoryMessage(userMessage).catch(() => {});
      const prepared = await Promise.all(outgoingFiles.map(prepareFile));
      const frame = sharedFrame || (watchMode && !wakeId && !selectedSticker ? await watchCapture.current?.() : null);
      if (frame) {
        const image = await prepareFile({ file: frame.file, preview: "" });
        prepared.push({ ...image, text: frame.context });
      }
      userMessage.metadata = { ...userMessage.metadata, attachments: prepared.map((item) => item.attachment) };
      updateMessage(userMessage.id, () => userMessage);
      // Opt-in automatic collection is server-owned and classification-gated.
      // This notification deliberately remains non-blocking so an ordinary
      // photo never delays a chat turn or silently turns into a sticker.
      for (const [index, item] of prepared.entries()) {
        const source = outgoingFiles[index]?.file;
        if (!source?.type.startsWith("image/")) continue;
        void fileSha256(source).then((sha256) => fetch(apiUrl("/api/stickers/collect"), {
          method: "POST", headers: appHeaders(true), body: JSON.stringify({ key: item.attachment.key, messageId: userMessage.id, conversationId, sha256 }),
        })).catch(() => {});
      }
      const stickerText = selectedSticker ? `[Vesper sticker sent by Vera. This is a private catalog asset, not a user text message. category: ${selectedSticker.category || "未分类"}; description: ${selectedSticker.description || selectedSticker.alt || "None"}; assetId: ${selectedSticker.assetId}]` : "";
      const memoryBackground = await recallMemoryBackground((selectedSticker ? "" : content) || stickerText);
      const input: CodexInput[] = [
        { type: "text", text: [selectedSticker ? "" : content, stickerText, ...prepared.map((item) => item.text).filter(Boolean)].filter(Boolean).join("\n\n") || "Please inspect the attached files." },
      ];
      userMessage.metadata = { ...userMessage.metadata, modelInputText: input[0].type === "text" ? input[0].text : undefined };
      updateMessage(userMessage.id, () => userMessage);
      for (const item of prepared) if (item.input) input.push(item.input);
      if (selectedSticker) { const image = await stickerInputForModel(selectedSticker); if (image) input.push(image); }
      await connect(memoryBackground, true);
      if (!threadId.current) throw new Error("No Codex thread");
      const done = new Promise<void>((resolve) => { turnDone.current = () => resolve(); });
      const requestedModel = nextModelRef.current;
      const started = await startCodexTurnWithModel(sendRpc, { threadId: threadId.current, ...workspaceOptions(readLocalValue("vesper-codex-workspace", "")), clientUserMessageId: userMessage.id, input, summary: "concise" }, requestedModel, modelCatalog.current);
      // The server has accepted these attachments. Do not wait for the
      // assistant reply (which may time out), or remove newly selected files.
      const sentFiles = new Set(outgoingFiles);
      setPending((current) => current.filter((item) => !sentFiles.has(item)));
      for (const item of sentFiles) URL.revokeObjectURL(item.preview);
      // A rejected RPC must retain the pending selection, not pretend it applied.
      if (requestedModel) {
        setCurrentModel(requestedModel);
        nextModelRef.current = null;
        setNextModel(null);
      }
      const turn = (started.result?.turn || {}) as { id?: string; createdAt?: unknown };
      activeTurnId.current = turn.id || `turn-${userMessage.id}`;
      sending.current = false;
      updateMessage(userMessage.id, (item) => ({ ...item, metadata: { ...item.metadata, turnId: activeTurnId.current, turnStatus: "thinking", wake: item.metadata?.wake ? { ...item.metadata.wake, startedAt: codexTimestamp(turn.createdAt, new Date().toISOString()) } : undefined } }));
      const completion = await Promise.race([done.then(() => "completed" as const), new Promise<"listening">((resolve) => window.setTimeout(() => resolve("listening"), 120000))]);
      if (completion === "listening") {
        setError("The reply is still running on the server. Vesper will keep listening; you can also cancel it.");
        return;
      }
    } catch (reason) {
      updateMessage(userMessage.id, (item) => ({ ...item, status: "error", metadata: { ...item.metadata, turnStatus: "error" } }));
      if (!wakeId && !sharedFrame) setDraft(content); setError(reason instanceof Error ? reason.message : "Message failed"); setBusy(false); sending.current = false;
      if (sharedFrame) throw reason;
    }
  };
  useEffect(() => {
    if (!wakeRequest || wakeConsumed.current.has(wakeRequest)) return;
    wakeConsumed.current.add(wakeRequest); onWakeHandled?.();
    void fetch(codexHistoryUrl('/wake'), { method: 'POST', headers: codexHistoryHeaders(true),
      body: JSON.stringify({action: 'request', requestId: wakeRequest}) }).then(async response => {
      if (!response.ok) throw new Error("Background wake-up is unavailable. Please try again later.");
      const result = await response.json() as {conversationId: string};
      if (result.conversationId) onSelectConversation(result.conversationId);
    }).catch(reason => setError(reason.message));
  }, [wakeRequest, onWakeHandled, onSelectConversation]);
  useEffect(() => {
    const deviceId = `web-${conversationId}-${crypto.randomUUID()}`;
    const publish = () => { void fetch(codexHistoryUrl('/wake'), {method:'POST',headers:codexHistoryHeaders(true),
      body:JSON.stringify({action:'presence',deviceId,busy})}).catch(() => {}); };
    publish(); const timer=window.setInterval(publish,30000);
    return () => {window.clearInterval(timer); void fetch(codexHistoryUrl('/wake'), {method:'POST',headers:codexHistoryHeaders(true),
      body:JSON.stringify({action:'presence',deviceId,busy:false}),keepalive:true}).catch(() => {});};
  }, [busy, conversationId]);
  useEffect(() => {
    if (!conversationId || !historyReady || busy) return;
    let stopped=false;
    const refresh=async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response=await fetch(codexHistoryUrl(`/conversations/${conversationId}`), {headers:codexHistoryHeaders(),cache:'no-store'});
        if (!response.ok) return;
        const payload=await response.json() as {messages?: BridgeChatMessage[]; tombstones?: CodexMessageTombstone[]};
        if (!stopped) {
          tombstonesRef.current=[...tombstonesRef.current,...(payload.tombstones || [])];
          save(mergeCodexMessages(messagesRef.current, normalizeCodexMessages(payload.messages || [],conversationId)).filter(item=>!messageWasDeleted(item,tombstonesRef.current)));
        }
      } catch {}
    };
    const timer=window.setInterval(() => void refresh(),5000);
    document.addEventListener('visibilitychange',refresh);
    return () => {stopped=true;window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  }, [conversationId, historyReady, busy]);
  const saveAttachmentAsSticker = async (attachment: ChatAttachment, item: BridgeChatMessage) => {
    const description = window.prompt("When would you use this sticker? (Optional)", "") ?? null;
    if (description === null) return;
    try {
      const response = await fetch(apiUrl("/api/stickers/from-message"), { method: "POST", headers: appHeaders(true), body: JSON.stringify({ key: attachment.key, name: attachment.name, type: attachment.type, conversationId: item.conversationId, messageId: item.id, description }) });
      const payload = await response.json().catch(() => ({})) as { duplicate?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "Save failed");
      setError(payload.duplicate ? "This image is already a sticker." : "Saved as sticker");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save as sticker"); }
  };
  const selectFiles = (files: FileList | null) => {
    if (!files) return;
    setPending((current) => [...current, ...Array.from(files).map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  };
  const startStt = () => {
    const Speech = (window as Window & { SpeechRecognition?: new () => { lang: string; interimResults: boolean; onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void; onend: () => void; onerror: () => void; start: () => void } }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: new () => { lang: string; interimResults: boolean; onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void; onend: () => void; onerror: () => void; start: () => void } }).webkitSpeechRecognition;
    if (!Speech) return setError("Speech recognition is not supported here");
    const recognition = new Speech(); recognition.lang = "en-US"; recognition.interimResults = false;
    recognition.onresult = (event) => setDraft((value) => `${value}${value ? " " : ""}${event.results[0][0].transcript}`);
    recognition.onend = () => setListening(false); recognition.onerror = () => { setListening(false); setError("Speech recognition failed"); };
    setListening(true); recognition.start();
  };
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      setHistoryReady(false);
      try {
        await migrateLegacyHistory();
      } catch {
        if (!cancelled) setHistoryWarning("History not synced yet");
      }
      try {
        const response = await fetch(codexHistoryUrl(`/conversations/${encodeURIComponent(conversationId)}`), {
          headers: codexHistoryHeaders(),
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load VPS history");
        const payload = await response.json() as {
          conversation?: { codexThreadId?: string | null } | null;
          messages?: BridgeChatMessage[];
          tombstones?: CodexMessageTombstone[];
        };
        if (cancelled) return;
        tombstonesRef.current = [...(payload.tombstones || []), ...readLocalValue<CodexMessageTombstone[]>(`vesper-codex-tombstones-${conversationId}`, [])]
          .filter((item, index, all) => all.findIndex((candidate) => candidate.messageId === item.messageId && candidate.itemId === item.itemId) === index);
        window.localStorage.setItem(`vesper-codex-tombstones-${conversationId}`, JSON.stringify(tombstonesRef.current));
        const rawRemote = payload.messages || [];
        // Versions that used a faux input item may already have copied that
        // item into the VPS history through a legacy migration. Remove only
        // those tagged internal records, then immediately exclude them from
        // this render even if the cleanup request is temporarily offline.
        void removeLeakedInternalHistoryMessages(conversationId, rawRemote)
          .catch(() => setHistoryWarning("History not synced yet"));
        const remote = normalizeCodexMessages(rawRemote, conversationId);
        const cached = normalizeCodexMessages(readLocalValue(`vesper-codex-chat-${conversationId}`, []), conversationId);
        const backup = normalizeCodexMessages(readLocalValue(`vesper-codex-chat-backup-${conversationId}`, []), conversationId);
        save(mergeCodexMessages(remote, cached, backup).filter((item) => !messageWasDeleted(item, tombstonesRef.current)));
        threadId.current = payload.conversation?.codexThreadId || threadId.current;
      } catch {
        if (!cancelled) setHistoryWarning("History not synced yet");
      } finally {
        if (!cancelled) setHistoryReady(true);
      }
      if (cancelled) return;
      try {
        await connect();
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Codex app-server is offline");
      }
    };
    let restoring = false;
    let recoveryPending = false;
    const recover = () => {
      if (cancelled) return;
      if (restoring) { recoveryPending = true; return; }
      restoring = true;
      recoveryPending = false;
      void restore().finally(() => {
        restoring = false;
        if (recoveryPending && navigator.onLine) recover();
      });
    };
    const offline = () => { setOnline(false); socket.current?.close(); };
    window.addEventListener("online", recover);
    window.addEventListener("offline", offline);
    recover();
    return () => {
      cancelled = true;
      window.removeEventListener("online", recover);
      window.removeEventListener("offline", offline);
      socket.current?.close(); socket.current = null;
    };
  }, [conversationId]);
  useEffect(() => {
    const receiveCard = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string; card?: MusicCardData }>).detail;
      if (detail?.conversationId !== conversationId || !detail.card) return;
      const current = messagesRef.current;
      const cardMessage: BridgeChatMessage = {
        id: crypto.randomUUID(),
        conversationId,
        role: "agent",
        content: detail.card.message || "",
        status: "delivered",
        metadata: { musicCard: detail.card, blockType: "musicCard", threadId: threadId.current },
        createdAt: new Date().toISOString(),
      };
      save([...current, cardMessage]);
      void persistCodexMessage(cardMessage).catch(() => setHistoryWarning("History not synced yet"));
    };
    window.addEventListener("vesper-music-card", receiveCard);
    return () => window.removeEventListener("vesper-music-card", receiveCard);
  }, [conversationId]);
  useLayoutEffect(() => {
    const scroller = streamEnd.current?.closest(".chat-stream") as HTMLElement | null;
    if (!scroller) return;
    const updateNearBottom = () => {
      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      nearBottomRef.current = distance <= 96;
      // An explicit jump stays visible until arrival; manual scrolling keeps
      // the normal near-bottom threshold while the long smooth animation runs.
      if (distance <= 1) jumpingToBottomRef.current = false;
      setShowScrollToBottom(jumpingToBottomRef.current || !nearBottomRef.current);
    };
    updateNearBottom();
    scroller.addEventListener("scroll", updateNearBottom, { passive: true });
    const cancelJump = () => { jumpingToBottomRef.current = false; updateNearBottom(); };
    scroller.addEventListener("wheel", cancelJump, { passive: true });
    scroller.addEventListener("touchstart", cancelJump, { passive: true });
    const resizeObserver = new ResizeObserver(() => {
      if (nearBottomRef.current) scroller.scrollTop = scroller.scrollHeight;
      updateNearBottom();
    });
    resizeObserver.observe(scroller);
    nearBottomRef.current = true;
    jumpingToBottomRef.current = false;
    setShowScrollToBottom(false);
    const frame = requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
      updateNearBottom();
    });
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", updateNearBottom);
      scroller.removeEventListener("wheel", cancelJump);
      scroller.removeEventListener("touchstart", cancelJump);
    };
  }, [conversationId]);
  useLayoutEffect(() => {
    const composer = textareaRef.current?.closest(".chat-compose") as HTMLElement | null;
    const chat = composer?.closest(".codex-chat") as HTMLElement | null;
    if (!composer || !chat || chat.classList.contains("watch-chat")) return;
    const measure = () => {
      chat.style.setProperty("--floating-compose-height", `${composer.getBoundingClientRect().height}px`);
      if (nearBottomRef.current) {
        const stream = streamEnd.current?.closest(".chat-stream") as HTMLElement | null;
        if (stream) stream.scrollTop = stream.scrollHeight;
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [conversationId]);
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "24px";
    const styles = getComputedStyle(node);
    const lineHeight = parseFloat(styles.lineHeight) || 20;
    const maxHeight = Math.ceil(lineHeight * 4 + (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0));
    const nextHeight = Math.min(node.scrollHeight, maxHeight);
    const fieldHeight = Math.max(24, nextHeight);
    node.style.height = `${fieldHeight}px`;
    if (node.parentElement?.classList.contains("compose-text-field")) {
      node.parentElement.style.height = `${fieldHeight * 0.875}px`;
    }
    node.style.overflowY = node.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);
  useLayoutEffect(() => {
    if (!nearBottomRef.current) return;
    const scroller = streamEnd.current?.closest(".chat-stream") as HTMLElement | null;
    if (!scroller) return;
    requestAnimationFrame(() => {
      if (nearBottomRef.current) scroller.scrollTop = scroller.scrollHeight;
    });
  }, [messages, streamingItems]);
  useLayoutEffect(() => {
    if (!focusMessageId) return;
    const timer = window.setTimeout(() => {
      const target = document.querySelector(`[data-message-id="${CSS.escape(focusMessageId)}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.classList.add("focus-message");
      window.setTimeout(() => target?.classList.remove("focus-message"), 2200);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [focusMessageId, messages.length]);
  // A live item and its saved form share their React key, so completion updates
  // the existing row instead of appending a second message or remounting it.
  const displayMessages: BridgeChatMessage[] = [...messages];
  for (const [itemId, content] of Object.entries(streamingItems)) {
    if (isCompletedCodexItem(messages, itemId)) continue;
    displayMessages.push({
      id: `${itemId}:bubble:0`, conversationId, role: "agent", content,
      status: "streaming", createdAt: streamStartedAt.current.get(itemId) || "",
      metadata: { itemId, turnId: activeTurnId.current, showTurnStatus: true },
    });
  }
  const scrollToLatest = () => {
    const scroller = streamEnd.current?.closest(".chat-stream") as HTMLElement | null;
    if (!scroller) return;
    jumpingToBottomRef.current = true;
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  };
  // One disclosure per turn, attached to its first assistant timestamp.
  // Tool-only turns retain a timestamp row so their records remain reachable.
  const activityAnchors = new Map<string, string>();
  const turnActivities = new Map<string, TurnActivity>();
  for (const item of displayMessages) {
    const turnId = item.metadata?.turnId;
    if (!turnId) continue;
    if (!turnActivities.has(turnId)) turnActivities.set(turnId, { busy: busy && turnId === activeTurnId.current, online, executions: [], summary: '' });
    const activity = turnActivities.get(turnId)!;
    if (item.metadata?.execution && !item.metadata.execution.id.startsWith('turn:')) activity.executions.push(item.metadata.execution);
    if (item.metadata?.thoughtSummary && !activity.summary.includes(item.metadata.thoughtSummary)) activity.summary += `${activity.summary ? '\n' : ''}${item.metadata.thoughtSummary}`;
    if ((item.role === 'agent' || item.metadata?.wake?.messageOmitted) && !item.metadata?.execution && !activityAnchors.has(turnId)) activityAnchors.set(turnId, item.id);
  }
  if (busy && activeTurnId.current) {
    const activity = turnActivities.get(activeTurnId.current) || { busy: true, online, executions: [], summary: '' };
    activity.summary = [...new Set([activity.summary, ...reasoningSummaries.current, ...reasoningBuffers.current.values()])].filter(Boolean).join('\n');
    turnActivities.set(activeTurnId.current, activity);
  }
  const activityOnlyRows: BridgeChatMessage[] = [];
  for (const [turnId, activity] of turnActivities) {
    if (activityAnchors.has(turnId) || (!activity.busy && !activity.executions.length && !activity.summary)) continue;
    const source = displayMessages.find(item => item.metadata?.turnId === turnId);
    const id = `activity:${turnId}`;
    activityAnchors.set(turnId, id);
    activityOnlyRows.push({ id, conversationId, role: 'system', content: '', status: 'delivered', createdAt: source?.createdAt || '', metadata: { turnId } });
  }
  const lastTurnIndex = new Map<string, number>();
  displayMessages.forEach((item, index) => { if (item.metadata?.turnId) lastTurnIndex.set(item.metadata.turnId, index); });
  const activityOnlyByTurn = new Map(activityOnlyRows.map(row => [row.metadata!.turnId!, row]));
  const visibleRows: BridgeChatMessage[] = [];
  displayMessages.forEach((item, index) => {
    if (!item.metadata?.execution || !item.metadata?.turnId) visibleRows.push(item);
    const turnId = item.metadata?.turnId;
    if (turnId && lastTurnIndex.get(turnId) === index && activityOnlyByTurn.has(turnId)) visibleRows.push(activityOnlyByTurn.get(turnId)!);
  });
  for (const row of activityOnlyRows) if (!lastTurnIndex.has(row.metadata!.turnId!)) visibleRows.push(row);
  const liveTurnStatus = messages.find((item) => item.id === activeTurnUserId.current)?.metadata?.turnStatus;
  const displayedModel = nextModel || currentModel;
  const displayedModelName = models.find((item) => item.model === displayedModel?.model)?.displayName || displayedModel?.model || "Select model";
  return (
    <div className={`page-body chat-page codex-chat${watchMode ? " watch-chat" : ""}`}>
      {watchMode && <WatchPlayer active={watchActive} busy={busy || !historyReady} captureRef={watchCapture} onShare={frame => send(undefined, undefined, frame)} />}
      {toolQuestions[0] && <CodexUserInput key={toolQuestions[0].id} request={toolQuestions[0]} onRespond={result => {
        const request = toolQuestions[0];
        if (socket.current?.readyState !== WebSocket.OPEN) { setError("Disconnected. Your confirmation was not sent."); return; }
        if (answeredToolQuestions.current.has(request.id)) return;
        answeredToolQuestions.current.add(request.id);
        socket.current.send(JSON.stringify({ id: request.id, result }));
        setToolQuestions(current => current.filter(entry => entry.id !== request.id));
      }} />}
      <div className="chat-status-stack">
        {error && <div className="chat-restore-error" role="alert"><span>{error}</span>{!online && <button type="button" disabled={busy} onClick={() => void connect().catch(reason => setError(reason instanceof Error ? reason.message : "Connection failed. Please try again."))}>Reconnect</button>}</div>}
        {historyWarning && <div className="chat-history-warning" role="status">{historyWarning}</div>}
        {toolUpgradeNeeded && !resumeError && <div className="chat-history-warning" role="status"><span>This conversation uses an older tool catalog. Start a new conversation to load all current tools, including Vesper’s independent Desire. Existing history is preserved.</span><button type="button" disabled={busy || !online} onClick={() => void createReplacementConversation()}>New conversation with updated tools</button></div>}
        {resumeError && <div className="chat-restore-error" role="alert"><span>{resumeError}</span><button onClick={() => void createReplacementConversation()}>Continue in a new conversation</button></div>}
      </div>
      <div className="chat-stream">
        {!messages.length && !Object.keys(streamingItems).length && <div className="chat-empty"><Icon name="chat" /><b>{!historyReady ? "Preparing conversation…" : "A quiet place to think"}</b><span>One private Codex connection · files, images, audio and tools ready</span></div>}
        {visibleRows.map((item, index) => {
          const timestamp = visibleMessageTimestamp(item.createdAt);
          const previousTimestamp = index ? visibleMessageTimestamp(visibleRows[index - 1].createdAt) : Number.NaN;
          const day = Number.isFinite(timestamp) ? new Date(timestamp).toDateString() : "";
          const previousDay = Number.isFinite(previousTimestamp) ? new Date(previousTimestamp).toDateString() : "";
          const divider = day && day !== previousDay ? new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(new Date(timestamp)) : "";
          const activity = item.metadata?.turnId && activityAnchors.get(item.metadata.turnId) === item.id ? turnActivities.get(item.metadata.turnId) : undefined;
          const activityExpanded = expandedActivities[item.metadata?.turnId || ''] || false;
          const onActivityExpandedChange = (open: boolean) => { const turnId = item.metadata?.turnId; if (turnId) setExpandedActivities(current => current[turnId] === open ? current : { ...current, [turnId]: open }); };
          if (item.metadata?.wake?.messageOmitted) return <div className="message-with-date" key={item.id}>{divider && <div className="chat-date-divider"><span>{divider}</span></div>}<ChatActivity busy={false} online={online} executions={turnActivities.get(item.metadata.turnId || '')?.executions || []} summary="" expanded={activityExpanded} onExpandedChange={onActivityExpandedChange} timestamp={formatTurnTimestamp(item.createdAt)} dateTime={item.createdAt} /></div>;
          if (item.metadata?.wake) return <div className="message-with-date" key={item.id}><WakeCard wake={item.metadata.wake} executions={turnActivities.get(item.metadata.turnId || '')?.executions || []} status={item.metadata.turnStatus || item.status} online={online} /></div>;
          if (activity && item.id.startsWith('activity:')) return <div className="message-with-date" key={item.id}>{divider && <div className="chat-date-divider"><span>{divider}</span></div>}<ChatActivity {...activity} expanded={activityExpanded} onExpandedChange={onActivityExpandedChange} timestamp={formatTurnTimestamp(item.createdAt)} dateTime={Number.isFinite(timestamp) ? item.createdAt : undefined} status={liveTurnStatus === 'tool' ? 'Using a tool…' : 'Thinking…'} /></div>;
          return <div className="message-with-date" key={item.id}>{divider && <div className="chat-date-divider"><span>{divider}</span></div>}<CodexChatMessage item={item} activity={activity} activityExpanded={activityExpanded} onActivityExpandedChange={onActivityExpandedChange} turnInProgress={online && busy && Boolean(activeTurnId.current) && item.metadata?.turnId === activeTurnId.current} agentName={agentName} userName={userName} onThought={setThought} onCopy={copyMessage} favorite={favorites.some((favorite) => favorite.messageId === item.id)} onFavorite={toggleFavorite} onDelete={deleteMessage} onPlayMusic={(trackId) => window.dispatchEvent(new CustomEvent("vesper-music-play", { detail: { trackId } }))} onQueueMusic={(trackId) => window.dispatchEvent(new CustomEvent("vesper-music-queue-add", { detail: { trackId } }))} onOpenMusic={onOpenMusic} onAddMusicToPlaylist={onAddMusicToPlaylist} onSaveAttachmentAsSticker={item.role === "user" ? saveAttachmentAsSticker : undefined} /></div>;
        })}
        <div ref={streamEnd} />
      </div>
      {showScrollToBottom && <button className="chat-scroll-to-bottom" type="button" aria-label="Jump to latest message" title="Jump to latest message" onClick={scrollToLatest}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v15m-6-6 6 6 6-6" /></svg>
      </button>}
      <div className="chat-compose">
        {pending.length > 0 && <div className="compose-previews">{pending.map((item, index) => <div className="compose-preview" key={`${item.file.name}-${index}`}>{item.file.type.startsWith("image/") ? <img src={item.preview} alt={item.file.name} /> : item.file.type.startsWith("video/") ? <video src={item.preview} muted /> : item.file.type.startsWith("audio/") ? <audio src={item.preview} controls /> : <span><Icon name="archive" />{item.file.name}</span>}<button aria-label="Remove attachment" onClick={() => setPending((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Icon name="close" /></button></div>)}</div>}
        <div className="compose-text-field"><textarea ref={textareaRef} placeholder="Write to Codex…" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /></div>
        <div className="compose-actions"><details className="compose-add-menu"><summary aria-label="Add attachments or stickers"><Icon name="plus" /></summary><div className="compose-add-options"><button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); fileInput.current?.click(); }}><Icon name="file-code" />Files</button><button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setStickerPickerOpen(true); }}><Icon name="sticker" />Stickers</button></div></details><input ref={fileInput} hidden multiple type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.md,.json,.html,.csv,.zip" onChange={(event) => { selectFiles(event.target.files); event.target.value = ""; }} />
          <span className="composer-status"><i className={online ? "online" : ""} role="img" aria-label={online ? "Connected" : "Disconnected"} title={online ? "Connected" : "Disconnected"} /><button className="codex-model-trigger" type="button" aria-label="Select model and reasoning effort" aria-haspopup="dialog" disabled={busy || !online} onClick={() => { setModelPickerOpen(true); void refreshModels(); }}><span>{busy ? "Replying…" : listening ? "Listening…" : displayedModelName}</span><small>{nextModel ? "Next ·" : ""}{effortLabel(displayedModel?.effort ?? null)}⌄</small></button></span>
          {busy && <button aria-label="Cancel active response" onClick={() => void cancelActiveTurn()}><Icon name="close" /></button>}<button className={listening ? "active" : ""} aria-label="Voice input" onClick={startStt}><Icon name="mic" /></button><button className="send-message-button" aria-label="Send message" disabled={busy || (!draft.trim() && !pending.length)} onClick={() => void send()}><Icon name="arrow-up" /></button></div>
      </div>
      {thought && <div className="thought-sheet-layer"><button className="thought-scrim" aria-label="Close reasoning" onClick={() => setThought(null)} /><section className="thought-sheet"><div className="thought-sheet-head"><button aria-label="Close" onClick={() => setThought(null)}><Icon name="close" /></button><h2>Thought process</h2></div><div className="thought-raw">{thought.metadata?.thoughtSummary?.split("\n").map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</div></section></div>}
      {approvalQueue[0] && <CodexApprovalDialog approval={approvalQueue[0]} queuedCount={approvalQueue.length} onDecision={(action) => answerApproval(approvalQueue[0], action)} />}
      {modelPickerOpen && <CodexModelPicker models={models} current={displayedModel} loading={modelsLoading} error={modelError} online={online} onRefresh={() => void refreshModels()} onClose={() => setModelPickerOpen(false)} onSelect={(selection) => { nextModelRef.current = selection; setNextModel(selection); setModelPickerOpen(false); }} />}
      <StickerPickerSheet open={stickerPickerOpen} onClose={() => setStickerPickerOpen(false)} onSelect={(sticker) => { setStickerPickerOpen(false); void send(sticker); }} onManage={() => { setStickerPickerOpen(false); setStickerManagerOpen(true); }} />
      <StickerManagerModal open={stickerManagerOpen} onClose={() => setStickerManagerOpen(false)} />
    </div>
  );
}

function MessageAttachments({ items, onSaveAsSticker }: { items: ChatAttachment[]; onSaveAsSticker?: (item: ChatAttachment) => void }) {
  if (!items.length) return null;
  return (
    <div className="message-attachments">
      <AttachmentGallery items={items.filter(item => item.type.startsWith('image/'))} onSaveAsSticker={onSaveAsSticker} />
      {items.filter(item => !item.type.startsWith('image/')).map((item) =>
        item.type.startsWith("video/") ? (
          <video src={item.url} controls playsInline key={item.key} />
        ) : item.type.startsWith("audio/") ? (
          <audio src={item.url} controls key={item.key} />
        ) : (
          <FileAttachmentCard key={item.key} file={item} />
        ),
      )}
    </div>
  );
}

type DiaryActivity = { user: number; agent: number; autonomous: number; total: number };
const emptyDiaryActivity: DiaryActivity = { user: 0, agent: 0, autonomous: 0, total: 0 };
function diaryToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function Diary() {
  const [entries, setEntries] = usePersistentDocument<DiaryDocument>("diary", {});
  const [month, setMonth] = useState(() => new Date(`${diaryToday().slice(0, 7)}-01T12:00:00`));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activity, setActivity] = useState<{ month: string; days: Record<string, DiaryActivity> } | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  useEffect(() => {
    let alive = true;
    let pending = false;
    const controller = new AbortController();
    const read = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(codexHistoryUrl(`/activity?month=${monthKey}`), { headers: codexHistoryHeaders(), signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Activity unavailable");
        const data = await response.json() as { month: string; days: Record<string, DiaryActivity> };
        if (data.month !== monthKey || !data.days) throw new Error("Invalid activity");
        if (alive) { setActivity(data); setError(false); }
      } catch { if (alive) setError(true); }
      finally { pending = false; }
    };
    void read();
    const update = () => { if (!document.hidden) void read(); };
    const timer = window.setInterval(update, 30000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { alive = false; controller.abort(); clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [monthKey, refresh]);
  const ready = activity?.month === monthKey;
  const selected = selectedKey ? entries[selectedKey] || { user: "", agent: "", updatedAt: "" } : null;
  const stats = selectedKey && ready ? activity.days[selectedKey] || emptyDiaryActivity : null;
  const saveUser = (value: string) => {
    if (!selectedKey) return;
    setEntries(current => ({ ...current, [selectedKey]: { ...(current[selectedKey] || { agent: "" }), user: value, updatedAt: new Date().toISOString() } }));
  };
  const status = error ? <button className="diary-count-status" onClick={() => setRefresh(v => v + 1)}>Chat statistics unavailable. Tap to retry.</button> : !ready ? <p className="diary-count-status">Loading chat history…</p> : null;
  if (selectedKey && selected) return (
    <div className="page-body diary-day-page">
      <button className="diary-back" onClick={() => setSelectedKey(null)}>‹ Back to calendar</button>
      <PageIntro eyebrow={selectedKey} title="This day" text={new Date(`${selectedKey}T12:00:00+08:00`).toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Shanghai" })} />
      {status}
      <section className="surface diary-day-counts" aria-label="Daily message counts">
        <div><strong>{stats?.total ?? "—"}</strong><span> chat messages</span></div>
        <p>You sent  {stats?.user ?? "—"}  · Rowan replied  {stats?.agent ?? "—"}  messages</p>
        <small>Autonomous notes {stats?.autonomous ?? "—"} , counted separately</small>
      </section>
            <label className="diary-sheet user-sheet">
              <span>
                <b>VERA</b>
                <em>Editable</em>
              </span>
              <textarea
                placeholder="Write about today…"
                value={selected.user}
                onChange={(event) => saveUser(event.target.value)}
              />
              <small>
                {selected.updatedAt
                  ? `Saved at ${new Date(selected.updatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
                  : "Saved automatically as you type"}
              </small>
            </label>
            <article className="diary-sheet agent-sheet">
              <span>
                <b>ROWAN</b>
                <em>
                  <Icon name="link" />
                  Agent can write
                </em>
              </span>
              <p>{selected.agent || "Rowan has not written about this day yet."}</p>
            </article>

    </div>
  );
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((firstWeekday + dayCount) / 7) * 7 }, (_, i) => { const d = i - firstWeekday + 1; return d > 0 && d <= dayCount ? d : null; });
  return (
    <div className="page-body diary-activity-page">
      <PageIntro eyebrow={`${year} · ${String(monthIndex + 1).padStart(2, "0")}`} title="Journal" text="Conversations and moments, day by day. Select a date to explore." />
      <div className="calendar-head">
        <button aria-label="Previous month" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}>‹</button>
        <h2>{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
        <button aria-label="Next month" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}>›</button>
      </div>
      <div className="calendar surface">
        <div className="week">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(label => <span key={label}>{label}</span>)}</div>
        <div className="calendar-grid diary-heat-grid">{cells.map((day, index) => {
          if (!day) return <span key={`blank-${index}`} />;
          const key = `${monthKey}-${String(day).padStart(2, "0")}`;
          const count = ready ? activity.days[key]?.total || 0 : null;
          const level = count === null || count === 0 ? 0 : count < 10 ? 1 : count < 30 ? 2 : count < 60 ? 3 : 4;
          const entry = entries[key];
          return <button key={key} className={`diary-heat-${level}${key === diaryToday() ? " today" : ""}`} aria-label={`${key}${count === null ? "" : `, ${count} chat messages`}${entry?.user ? ", Vera’s journal available" : ""}${entry?.agent ? ", Rowan’s journal available" : ""}`} onClick={() => setSelectedKey(key)}>
            <b>{day}</b><small>{key > diaryToday() ? "" : count === null ? "—" : `${count} msgs`}</small>
            <span className="diary-entry-dots">{entry?.user && <i className="user-dot" />}{entry?.agent && <i className="agent-dot" />}</span>
          </button>;
        })}</div>
      </div>
      <div className="diary-heat-legend"><span>Less</span>{[0, 1, 2, 3, 4].map(n => <i key={n} className={`diary-heat-${n}`} />)}<span>More</span></div>
      <div className="diary-legend"><span><i className="user-dot" />Vera’s journal</span><span><i className="agent-dot" />Rowan’s journal</span></div>
      {status}
      <p className="diary-count-status">Dates use Beijing time · Autonomous notes are listed separately in daily details</p>
    </div>
  );
}

function Todos() {
  const [items, setItems] = usePersistentDocument<TodoItem[]>("todos", []);
  const add = () => {
    const title = window.prompt("Reminder");
    if (!title?.trim()) return;
    const due = window.prompt("Time or date (optional)") || "";
    setItems((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        title: title.trim(),
        done: false,
        tag: "未分类",
        due: due.trim(),
        createdAt: new Date().toISOString(),
      },
    ]);
  };
  const completed = items.filter((item) => item.done).length;
  return (
    <div className="page-body">
      <PageIntro
        eyebrow="TO DO"
        title="Reminders"
        text="Create, complete and delete your reminders."
      />
      <div className="todo-summary">
        <div>
          <b>
            {completed}/{items.length}
          </b>
          <span>Completed</span>
        </div>
        <div className="summary-line">
          <i
            style={{
              width: items.length
                ? `${(completed / items.length) * 100}%`
                : "0%",
            }}
          />
        </div>
      </div>
      {!items.length ? (
        <EmptyState text="No reminders yet." />
      ) : (
        <div className="surface todo-list">
          {items.map((item) => (
            <div className="todo-item" key={item.id}>
              <button
                aria-label="Toggle completion"
                onClick={() =>
                  setItems((current) =>
                    current.map((entry) =>
                      entry.id === item.id
                        ? { ...entry, done: !entry.done }
                        : entry,
                    ),
                  )
                }
              >
                <span
                  className={item.done ? "round-check checked" : "round-check"}
                >
                  {item.done && <Icon name="check" />}
                </span>
              </button>
              <span className={item.done ? "crossed" : ""}>
                <b>{item.title}</b>
                <small>
                  {[item.tag, item.due].filter(Boolean).join(" · ") ||
                    "No time set"}
                </small>
              </span>
              <button
                aria-label="Delete reminder"
                onClick={() =>
                  setItems((current) =>
                    current.filter((entry) => entry.id !== item.id),
                  )
                }
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button className="primary-action" onClick={add}>
        <Icon name="plus" />
        Add reminder
      </button>
    </div>
  );
}

function SettingsPage({
  onOpenSection,
  accent,
  onAccent,
  onBackground,
  environment,
  onEnvironment,
}: {
  onOpenSection: (section: string) => void;
  accent: string;
  onAccent: (value: string) => void;
  onBackground: (value: string) => void;
  environment: EnvironmentSnapshot;
  onEnvironment: (value: EnvironmentSnapshot) => void;
}) {
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailClosing, setDetailClosing] = useState(false);
  const [preferences, setPreferences] =
    usePersistentDocument<VesperPreferences>("settings", defaultPreferences);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>(() =>
      typeof window !== "undefined" && "Notification" in window
        ? Notification.permission
        : "default",
    );
  const careLabel =
    preferences.careFrequency === "off"
      ? "Close"
      : preferences.careFrequency === "twice-weekly"
        ? "Twice a week"
        : "Daily";
  const locationLabel =
    environment.permission === "granted"
      ? environment.temperature === undefined
        ? "Allowed"
        : `Located · ${Math.round(environment.temperature)}°`
      : environment.permission === "denied"
        ? "Location denied"
        : "Not requested";
  const notificationLabel =
    notificationPermission === "granted"
      ? "Notifications allowed"
      : notificationPermission === "denied"
        ? "Notifications denied"
        : "Not requested";
  const closeDetail = () => {
    if (detailClosing) return;
    setDetailClosing(true);
    window.setTimeout(() => {
      setSelected(null);
      setDetailClosing(false);
    }, 260);
  };
  return (
    <div className={`${selected ? "page-body settings-page detail-active" : "page-body settings-page"}${detailClosing ? " detail-closing" : ""}`}>
      <PageIntro eyebrow="PREFERENCES" title="Settings" text="Make Vesper feel like you." />
      <div className="settings-category-list settings-accordion">
        <section className="surface settings-accordion-item"><SettingRow icon="sparkles" title="Autonomous Wake" sub="Schedule, controls and recent activity" onClick={() => setSelected("Autonomous Wake")} /></section>
        {[
          ["sparkles", "Agent", "Model connection and voice"],
          ["link", "Tools", "MCP connections and notifications"],
          ["archive", "Data", "Memory permissions, export and backup"],
        ].map(([icon, title, description]) => (
          <section className="surface settings-accordion-item" key={title}>
            <SettingRow icon={icon} title={title} sub={description}
              expanded={category === title} controls={`settings-options-${title}`}
              onClick={() => setCategory(current => current === title ? null : title)} />
            <div id={`settings-options-${title}`} className="settings-accordion-content" hidden={category !== title}>
        {title === "Agent" && <>
          <SettingRow icon="sparkles" title="Codex Server" sub="Model service and connection" onClick={() => setSelected("Codex Server")} />
          <SettingRow icon="volume" title="Agent Voice (TTS)" sub="Voice service and voice selection" onClick={() => setSelected("Agent 声音")} />
        </>}
        {title === "Tools" && <>
          <SettingRow icon="link" title="MCP Servers" sub="Connect external tools and services" onClick={() => setSelected("MCP 工具")} />
          <SettingRow icon="link" title="Vesper MCP" sub="Connect external AI to journals, notes and memory" onClick={() => setSelected("Vesper MCP")} />
          <SettingRow icon="bell" title="Notification" sub="Web Push and Apple notification permissions" onClick={() => setSelected("Notification")} />
          <SettingRow icon="bell" title="Notification Preferences" sub={`${preferences.reminders ? "Reminders " : ""}${preferences.anniversaries ? "Dates " : ""}${preferences.agentNotes ? "Rowan’s notes" : ""}`.trim() || "All off"} onClick={() => setSelected("通知偏好")} />
        </>}
        {title === "Data" && <>
          <SettingRow icon="lock" title="Memory Permissions" sub="Control access to journals, notes and chat separately" onClick={() => setSelected("记忆权限")} />
          <SettingRow icon="archive" title="Export &amp; Backup" sub={preferences.lastExportAt ? `Last export: ${new Date(preferences.lastExportAt).toLocaleString("en-US")}` : "Saved locally · App updates preserve your data"} onClick={() => setSelected("导出与备份")} />
        </>}
            </div>
          </section>
        ))}
      </div>
      {selected === "Autonomous Wake" ? (
        <WakeVisualizer onClose={closeDetail} />
      ) : selected === "Notification" ? (
        <NotificationSettings onClose={closeDetail} onWebPush={() => setSelected("Web Push")} />
      ) : selected === "Codex Server" ? (
        <CodexConnectionModal onClose={closeDetail} />
      ) : selected === "MCP 工具" ? (
        <ExternalMcpModal onClose={closeDetail} />
      ) : selected === "Vesper MCP" ? (
        <VesperMcpModal onClose={closeDetail} />

      ) : selected === "Agent 声音" ? (
        <VoiceSettingsModal onClose={closeDetail} />
      ) : selected &&
        ["通知偏好", "关心频率", "记忆权限", "导出与备份"].includes(
          selected,
        ) ? (
        <FunctionalSettingsModal
          type={selected}
          preferences={preferences}
          onPreferences={setPreferences}
          onClose={closeDetail}
        />
      ) : (
        selected && (
          <ConnectionModal
            type={selected}
            environment={environment}
            onEnvironment={onEnvironment}
            onNotificationPermission={setNotificationPermission}
            onClose={selected === "Web Push" ? () => setSelected("Notification") : closeDetail}
          />
        )
      )}
    </div>
  );
}

type WakeRuntime = {
  configVersion?: number;
  prompt?: string; defaultPrompt?: string; promptMaxLength?: number;
  config?: { enabled: boolean; intervalMinutes: number | null };
  heartbeat?: number; nextAt?: number; schedulerError?: string;
  jobs?: { id: string; source: string; status: string; created: number; started?: number;
    finished?: number; tools: number; decision?: string; tokens?: number;
    calls?: { name: string; status: string }[] }[];
};

function WakeVisualizer({ onClose }: { onClose: () => void }) {
  const [runtime, setRuntime] = useState<WakeRuntime | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [interval, setIntervalValue] = useState("auto");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);
  const savingRef = useRef(false);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      if (savingRef.current) return;
      try {
        const response = await fetch(codexHistoryUrl('/wake'), { headers: codexHistoryHeaders(), cache: 'no-store' });
        if (!response.ok) throw new Error("Cannot load wake settings. Check the server connection.");
        const value = await response.json() as WakeRuntime;
        if (stopped || savingRef.current) return;
        setRuntime(value); setError("");
        if (!initialized.current && value.config) {
          setEnabled(value.config.enabled);
          setIntervalValue(value.config.intervalMinutes === null ? "auto" : String(value.config.intervalMinutes));
          setPrompt(value.prompt || "");
          initialized.current = true;
        }
      } catch (reason) { if (!stopped) setError(reason instanceof Error ? reason.message : "Connection unavailable."); }
    };
    void refresh(); const timer = window.setInterval(refresh, 15000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(""); setSaved(false);
    try {
      const response = await fetch(codexHistoryUrl('/wake'), { method: 'POST', headers: codexHistoryHeaders(true),
        body: JSON.stringify({ action: 'configure', enabled, intervalMinutes: interval === 'auto' ? null : Number(interval), ...(runtime?.configVersion && runtime.configVersion >= 2 ? { prompt } : {}) }) });
      if (!response.ok) throw new Error("Settings were not saved. Please try again.");
      const value = await response.json() as WakeRuntime;
      if (!value.configVersion || !value.config) throw new Error("The background service needs an update before settings can be saved.");
      if ((runtime?.configVersion || 0) >= 2 && ((value.configVersion || 0) < 2 || value.prompt !== prompt)) throw new Error("The prompt was not saved. Update the background service and try again.");
      setRuntime(value); setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Settings were not saved."); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const format = (seconds?: number) => seconds ? new Date(seconds * 1000).toLocaleString('en-GB', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const alive = !!runtime?.heartbeat && Date.now() / 1000 - runtime.heartbeat < 1000;
  const supported = (runtime?.configVersion || 0) >= 1;
  const promptSupported = (runtime?.configVersion || 0) >= 2;
  const promptInvalid = promptSupported && (!prompt.trim() || [...prompt].length > (runtime?.promptMaxLength || 8000));
  return <div className="modal-layer"><button className="modal-scrim" aria-label="Close wake settings" onClick={onClose}/>
    <section className="connection-modal wake-visualizer" role="dialog" aria-modal="true" aria-labelledby="wake-title">
      <div className="modal-head"><button className="settings-back" aria-label="Back to settings" onClick={onClose}><Icon name="chevron"/></button><div><small>AUTONOMOUS WAKE</small><h2 id="wake-title">Autonomous Wake</h2></div></div>
      <div className="wake-controls">
        <label className="wake-toggle"><span>Automatic wake-up</span><input type="checkbox" role="switch" checked={enabled} disabled={!supported || saving} onChange={event => {setEnabled(event.target.checked);setSaved(false);}} /></label>
        <label>Interval<select value={interval} disabled={!supported || saving} onChange={event => {setIntervalValue(event.target.value);setSaved(false);}}>
          <option value="auto">Adaptive · 30–120 minutes</option>
          {[30,60,120,240,360,720,1440].map(minutes => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hours`}</option>)}
          {interval !== 'auto' && ![30,60,120,240,360,720,1440].includes(Number(interval)) && <option value={interval}>{interval} minutes</option>}
        </select></label>
        <p className="settings-hint">Active chats and quiet requests can postpone a wake-up. Turning this off prevents new automatic runs; a running task may finish.</p>
        <div className="wake-prompt-editor">
          <label htmlFor="wake-prompt">Wake prompt</label>
          <textarea id="wake-prompt" value={prompt} disabled={!promptSupported || saving} rows={8} aria-describedby="wake-prompt-help" onChange={event => {setPrompt(event.target.value);setSaved(false);}} />
          <p id="wake-prompt-help" className="settings-hint">Describe what you want each wake-up to do. Saved changes apply from the next run; tool permissions and delivery rules remain in effect.</p>
          <div className="wake-prompt-footer"><small>{[...prompt].length} / {runtime?.promptMaxLength || 8000}</small><button type="button" disabled={!promptSupported || saving} onClick={() => {setPrompt(runtime?.defaultPrompt || "");setSaved(false);}}>Restore default</button></div>
          {runtime && !promptSupported && <p className="settings-hint">Update the background service to edit the wake prompt.</p>}
          {promptInvalid && <p role="alert">Enter a prompt of 1–8000 characters.</p>}
        </div>
        <button className="reset-background" disabled={!supported || saving || promptInvalid} onClick={() => void save()}>{saving ? 'Saving…' : 'Save settings'}</button>
        <p role="status">{saved ? 'Saved. Changes apply from the next run.' : ''}</p>
      </div>
      {error && <p role="alert" className="settings-hint">{error}</p>}
      {runtime && !supported && <p className="settings-hint">Update the background service to enable controls and history.</p>}
      <div className="wake-status-grid">
        <div><small>Status</small><b>{!runtime ? 'Loading…' : !alive ? 'Connection unknown' : runtime.config?.enabled === false ? 'Paused' : 'Online'}</b></div>
        <div><small>Next wake · Beijing time</small><b>{runtime?.config?.enabled === false ? 'Paused' : format(runtime?.nextAt)}</b></div>
      </div>
      {runtime?.schedulerError && <p className="settings-hint">The scheduler reported an error. The next wake is not confirmed.</p>}
      <div className="wake-history"><h3>Recent activity</h3>
        {supported && !runtime?.jobs?.length && <p>No wake records yet.</p>}
        {runtime?.jobs?.map(job => <details key={job.id}>
          <summary><span>{format(job.created)}</span><b>{job.status.replaceAll('_', ' ')}</b></summary>
          <dl><dt>Source</dt><dd>{job.source}</dd><dt>Started</dt><dd>{format(job.started)}</dd><dt>Finished</dt><dd>{format(job.finished)}</dd><dt>Tools</dt><dd>{job.tools}</dd>{job.decision && <><dt>Outcome</dt><dd>{job.decision.replaceAll('_', ' ')}</dd></>}</dl>
          {!!job.calls?.length && <ul>{job.calls.map((call, index) => <li key={index}>{call.name || 'Tool'} · {call.status}</li>)}</ul>}
          <small>Run {job.id}</small>
        </details>)}
        <p className="settings-hint">Latest 50 runs. All times are in Beijing time. Replies appear in chat; a saved reply does not confirm a phone notification.</p>
      </div>
    </section></div>;
}

const VESPER_MCP_URL = "https://mcp.vesper.r-vera.com/mcp";

type ExternalMcpEntry = {
  id: string;
  name: string;
  url: string;
  token: string;
  enabled: boolean;
  authMode?: "none" | "oauth";
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string;
  oauthStatus?: "authorized" | "pending";
  resource?: string;
};

function ExternalMcpModal({ onClose, context }: { onClose: () => void; context?: "desire" }) {
  const [servers, setServers] = useLocalDocument<ExternalMcpEntry[]>("external-mcp-servers", []);
  const [message, setMessage] = useState(() => {
    if (typeof window === "undefined") return "";
    const value = window.sessionStorage.getItem("vesper-mcp-oauth-result") || "";
    window.sessionStorage.removeItem("vesper-mcp-oauth-result");
    return value;
  });
  const [testingId, setTestingId] = useState("");
  const [authorizingId, setAuthorizingId] = useState("");
  const [editor, setEditor] = useState<ExternalMcpEntry | null>(() => context === "desire" && !servers.some(server => /desire|欲望/i.test(server.name))
    ? { id: crypto.randomUUID(), name: "Desire", url: "", token: "", enabled: true, authMode: "none" }
    : null);
  const [saving, setSaving] = useState(false);
  const [editorMessage, setEditorMessage] = useState("");
  const syncedConnections = useRef(new Set<string>());
  const configuredServers = servers.filter(
    (server) => Boolean(server.name.trim() || server.url.trim()),
  );
  const closeEditor = () => {
    setEditor(null);
    setEditorMessage("");
  };
  const openEditor = (server: ExternalMcpEntry) => {
    setEditor({ ...server });
    setEditorMessage("");
  };
  const add = () => {
    setEditor({
      id: crypto.randomUUID(),
      name: context === "desire" ? "Desire" : "",
      url: "",
      token: "",
      enabled: true,
      authMode: "none",
    });
    setEditorMessage("");
  };
  const updateEditor = (patch: Partial<ExternalMcpEntry>) =>
    setEditor((current) => (current ? { ...current, ...patch } : current));
  const saveEditor = async () => {
    if (!editor || saving) return;
    const next = {
      ...editor,
      name: editor.name.trim(),
      url: editor.url.trim(),
    };
    if (!next.name && !next.url) {
      setEditorMessage("Enter a name or MCP server URL.");
      return;
    }
    if (context === "desire" && (!next.url || !next.name)) {
      setEditorMessage("Enter a name and MCP server URL.");
      return;
    }
    if (context === "desire" && next.authMode !== "oauth") {
      setSaving(true);
      try {
        await syncToCodex(next);
        setMessage("Connection saved. Return to Desire to load the latest state.");
      } catch (reason) {
        setEditorMessage(reason instanceof Error ? reason.message : "Connection failed. Check the URL and credentials.");
        return;
      } finally {
        setSaving(false);
      }
    }
    setServers((current) =>
      current.some((server) => server.id === next.id)
        ? current.map((server) => (server.id === next.id ? next : server))
        : [...current, next],
    );
    closeEditor();
  };
  const update = (id: string, patch: Partial<ExternalMcpEntry>) =>
    setServers((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const syncToCodex = async (server: ExternalMcpEntry) => {
    const response = await fetch(apiUrl("/api/mcp/connections"), {
      method: "PUT",
      headers: appHeaders(true),
      cache: "no-store",
      body: JSON.stringify({
        id: server.id,
        name: server.name,
        url: server.url,
        authMode: server.authMode || "none",
        token: server.token,
        enabled: server.enabled,
      }),
    });
    const result = await response.json().catch(() => ({})) as { serverName?: string; toolCount?: number; error?: string };
    if (!response.ok) throw new Error(result.error || "Could not sync MCP tools to Codex");
    return result;
  };
  useEffect(() => {
    for (const server of servers) {
      const signature = `${server.id}:${server.url}:${server.token}:${server.enabled}`;
      if (!server.enabled || !server.url || !server.token || syncedConnections.current.has(signature)) continue;
      syncedConnections.current.add(signature);
      void syncToCodex(server).catch(() => {
        syncedConnections.current.delete(signature);
      });
    }
  }, [servers]);
  const authorize = async (server: ExternalMcpEntry) => {
    if (authorizingId) return;
    if (!server.url) {
      setMessage("Enter the MCP server URL first.");
      return;
    }
    setAuthorizingId(server.id);
    let stage = "Reading OAuth configuration";
    try {
      const native = Capacitor.getPlatform() === "ios";
      setMessage(`${stage}…`);
      const redirectUri = native ? "https://vesper.r-vera.com/mcp/oauth/callback" : `${window.location.origin}/mcp/oauth/callback`;
      const discoveryResponse = await fetch(apiUrl("/api/mcp/oauth/discover"), {
        method: "POST",
        signal: AbortSignal.timeout(60000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: server.url, redirectUri, clientId: server.clientId }),
      });
      const discovered = (await discoveryResponse.json()) as {
        authorizationUrl?: string;
        tokenUrl?: string;
        clientId?: string;
        clientSecret?: string;
        scopes?: string;
        resource?: string;
        needsClientId?: boolean;
        error?: string;
      };
      if (!discoveryResponse.ok || !discovered.authorizationUrl || !discovered.tokenUrl) {
        throw new Error(discovered.error || "Could not discover the OAuth authorization page");
      }
      if (discovered.needsClientId || !discovered.clientId) {
        throw new Error("This service requires a Client ID. Enter the one assigned to Vesper and try again.");
      }
      update(server.id, {
        authorizationUrl: discovered.authorizationUrl,
        tokenUrl: discovered.tokenUrl,
        clientId: discovered.clientId,
        clientSecret: discovered.clientSecret || server.clientSecret,
        scopes: discovered.scopes,
        resource: discovered.resource,
      });
      if (context === "desire") window.sessionStorage.setItem("vesper-mcp-return", "desire");
      const verifier = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
      const state = `${native ? NATIVE_OAUTH_PREFIX : ""}${crypto.randomUUID()}`;
      const pending = {
        serverId: server.id, state, verifier,
        tokenUrl: discovered.tokenUrl, clientId: discovered.clientId,
        clientSecret: discovered.clientSecret || server.clientSecret,
        redirectUri, resource: discovered.resource,
      };
      if (!native) window.sessionStorage.setItem("vesper-mcp-oauth-pending", JSON.stringify(pending));
      update(server.id, { oauthStatus: "pending" });
      const target = new URL(discovered.authorizationUrl);
      target.searchParams.set("response_type", "code");
      target.searchParams.set("client_id", discovered.clientId);
      target.searchParams.set("redirect_uri", redirectUri);
      target.searchParams.set("state", state);
      target.searchParams.set("code_challenge", challenge);
      target.searchParams.set("code_challenge_method", "S256");
      if (discovered.scopes) target.searchParams.set("scope", discovered.scopes);
      target.searchParams.set("resource", discovered.resource || server.url);
      if (!native) {
        window.location.assign(target.toString());
        return;
      }
      stage = "Waiting for iOS authorization";
      setMessage(`${stage}…`);
      const callback = await nativeMcpOAuth.authorize({ url: target.toString() });
      const code = nativeOAuthCode(callback.url, state);
      stage = "Completing OAuth authorization";
      setMessage(`${stage}…`);
      const exchange = await fetch(apiUrl("/api/mcp/oauth"), {
        method: "POST", signal: AbortSignal.timeout(30000), headers: appHeaders(true),
        body: JSON.stringify({ ...pending, code }),
      });
      const result = await exchange.json() as { accessToken?: string; error?: string };
      if (!exchange.ok || !result.accessToken) throw new Error(result.error || "OAuth authorization failed");
      const authorized = { ...server, token: result.accessToken, oauthStatus: "authorized" as const };
      const signature = `${server.id}:${server.url}:${result.accessToken}:${server.enabled}`;
      syncedConnections.current.add(signature);
      update(server.id, { token: result.accessToken, oauthStatus: "authorized" });
      window.sessionStorage.removeItem("vesper-mcp-return");
      try {
        await syncToCodex(authorized);
        setMessage("Authorized and synced. Start a new conversation to use these tools.");
      } catch {
        syncedConnections.current.delete(signature);
        setMessage("Authorized. Tool sync failed; use Test to retry.");
      }
    } catch (reason) {
      update(server.id, { oauthStatus: server.token ? "authorized" : undefined });
      window.sessionStorage.removeItem("vesper-mcp-return");
      setMessage(`${stage}: ${reason instanceof Error ? reason.message : "Authorization failed"}`);
    } finally {
      setAuthorizingId("");
    }
  };
  const test = async (server: ExternalMcpEntry) => {
    if (!server.url) {
      setMessage("Enter the MCP server URL first.");
      return;
    }
    setTestingId(server.id);
    setMessage("");
    try {
      const result = await syncToCodex(server);
      setMessage(context === "desire" ? "Connected and tools synced. Return to Desire to refresh." : `Connected${result.serverName ? ` · ${result.serverName}` : ""}${typeof result.toolCount === "number" ? ` · ${result.toolCount} tools` : ""}. Synced to Codex; start a new conversation to use them.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "MCP connection failed");
    } finally {
      setTestingId("");
    }
  };
  return (
    <div className="modal-layer settings-subpage-layer mcp-settings-page">
      <button className="modal-scrim" onClick={onClose} />
      {editor ? (
        <section className="connection-modal external-mcp-modal mcp-editor-modal">
          <div className="modal-head">
            <button className="settings-back" onClick={closeEditor} aria-label="Back"><Icon name="chevron" /></button>
            <div><small>MCP SERVER</small><h2>{editor.name ? "Edit MCP server" : "Add MCP server"}</h2></div>
            <span className="mcp-editor-head-spacer" aria-hidden="true" />
          </div>
          <div className="mcp-editor-scroll">
            <label className="profile-field"><span>Name</span><input value={editor.name} onChange={(event) => updateEditor({ name: event.target.value })} /></label>
            <label className="profile-field"><span>Streamable HTTP URL</span><input value={editor.url} placeholder="https://example.com/mcp" autoCapitalize="none" autoCorrect="off" onChange={(event) => updateEditor({ url: event.target.value })} /></label>
            <div className="mcp-auth-choice"><span>OAuth authorization</span><div><button className={(editor.authMode || "none") === "none" ? "selected" : ""} onClick={() => updateEditor({ authMode: "none" })}>None</button><button className={editor.authMode === "oauth" ? "selected" : ""} onClick={() => updateEditor({ authMode: "oauth" })}>Yes</button></div></div>
            {editor.authMode === "oauth" ? <><p className="settings-hint">Vesper discovers and opens the OAuth page automatically. If the service requires a registered callback URL, use <code>https://vesper.r-vera.com/mcp/oauth/callback</code>。</p><label className="profile-field"><span>Client ID (if required)</span><input value={editor.clientId || ""} onChange={(event) => updateEditor({ clientId: event.target.value })} /></label></> : <label className="profile-field"><span>Bearer Token (optional)</span><input type="password" value={editor.token} onChange={(event) => updateEditor({ token: event.target.value })} /></label>}
            <button className={editor.enabled ? "mcp-enable on" : "mcp-enable"} onClick={() => updateEditor({ enabled: !editor.enabled })}><span>{editor.enabled ? "Enabled" : "Disabled"}</span><i><u /></i></button>
            {editorMessage && <p className="connection-message">{editorMessage}</p>}
          </div>
          <div className="mcp-editor-actions"><button disabled={saving} onClick={closeEditor}>Cancel</button><button className="save-profile" disabled={saving} onClick={() => void saveEditor()}>{saving ? "Connecting…" : context === "desire" && editor.authMode !== "oauth" ? "Save and connect" : "Save"}</button></div>
        </section>
      ) : (
        <section className="connection-modal external-mcp-modal">
          <div className="modal-head">
            <button className="settings-back" onClick={onClose} aria-label="Back"><Icon name="chevron" /></button>
            <div><small>TOOL CONNECTIONS</small><h2>{context === "desire" ? "Desire connection" : "MCP Tools"}</h2></div>
            <button onClick={add} aria-label="Add MCP"><Icon name="plus" /></button>
          </div>
          <div className="mcp-list-scroll">
            <p className="mcp-list-intro">{context === "desire" ? "Connect your Desire MCP URL. For OAuth services, save, authorize, then test to sync. Return here to view the state." : "Connect search, files, memory or other MCP tools here. These tools are available to your AI; the MCP option in AI Connection is the conversation service."}</p>
            <div className="mcp-server-list">
              {!configuredServers.length && <EmptyState text="No external MCP servers connected yet." />}
              {configuredServers.map((server) => (
                <article className="mcp-server-card" key={server.id}>
                  <div className="mcp-server-summary">
                    <span className={server.enabled ? "mcp-live-dot" : "mcp-live-dot off"} />
                    <div><b>{server.name || "Untitled MCP"}</b><small>{server.url || "No URL set"} · {server.authMode === "oauth" ? `OAuth ${server.oauthStatus === "authorized" ? "Allowed" : "Authorization needed"}` : "Bearer / No authorization"}</small></div>
                  </div>
                  <div className="mcp-card-actions">
                    <button disabled={testingId === server.id} onClick={() => void test(server)}>{testingId === server.id ? "Testing" : "Test"}</button>
                    {server.authMode === "oauth" && <button disabled={Boolean(authorizingId)} onClick={() => void authorize(server)}>{authorizingId === server.id ? "Authorizing…" : "Authorize"}</button>}
                    <button onClick={() => openEditor(server)}>Edit</button>
                    <button onClick={() => void (async () => {
                      try {
                        const response = await fetch(`${apiUrl("/api/mcp/connections")}?id=${encodeURIComponent(server.id)}`, { method: "DELETE", headers: appHeaders(true), cache: "no-store" });
                        const result = await response.json().catch(() => ({})) as { error?: string };
                        if (!response.ok) throw new Error(result.error || "Could not delete server-side MCP credentials");
                        setServers((current) => current.filter((item) => item.id !== server.id));
                      } catch (reason) {
                        setMessage(reason instanceof Error ? reason.message : "Could not delete MCP");
                      }
                    })()}>Delete</button>
                  </div>
                </article>
              ))}
            </div>
            {message && <p className="connection-message">{message}</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function VesperMcpModal({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useLocalDocument("mcp-access-token", "");
  const [draft, setDraft] = useState(token);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const generateToken = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const setup = async (rotate = false) => {
    const nextToken = rotate ? generateToken() : draft.trim() || generateToken();
    if (nextToken.length < 16) return setMessage("The access token must be at least 16 characters.");
    setVerified(false);
    setToolCount(null);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(apiUrl("/api/mcp/owner-token"), {
        method: "POST",
        headers: appHeaders(true),
        body: JSON.stringify({ token: nextToken }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || `Setup failed (${response.status})`);
      setToken(nextToken);
      setDraft(nextToken);
      setVerified(true);
      const testResponse = await fetch(apiUrl("/api/mcp"), {
        method: "POST",
        headers: appHeaders(true),
        body: JSON.stringify({ url: VESPER_MCP_URL, token: nextToken }),
      });
      const tested = (await testResponse.json()) as { toolCount?: number; error?: string };
      if (!testResponse.ok) throw new Error(`Token saved, but the connection test failed: ${tested.error || "Please try again later."}`);
      setToolCount(tested.toolCount ?? 0);
      setMessage(`MCP enabled and connected. Found ${tested.toolCount ?? 0} tools.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "MCP setup failed");
    } finally {
      setBusy(false);
    }
  };
  const testTools = async () => {
    if (!draft.trim()) return setMessage("Generate and enable a connection token first.");
    setVerified(false);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(apiUrl("/api/mcp"), {
        method: "POST",
        headers: appHeaders(true),
        body: JSON.stringify({ url: VESPER_MCP_URL, token: draft.trim() }),
      });
      const result = (await response.json()) as { toolCount?: number; serverName?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "MCP tools test failed");
      setToken(draft.trim());
      setVerified(true);
      setToolCount(result.toolCount ?? 0);
      setMessage(`${result.serverName || "Vesper"} connected. Found ${result.toolCount ?? 0} tools.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "MCP tools test failed");
    } finally {
      setBusy(false);
    }
  };
  const copy = async (tokenOnly = false) => {
    if (!verified || draft.trim() !== token) return setMessage("Save or test the connection before copying its settings.");
    try {
      await navigator.clipboard.writeText(
        tokenOnly ? token : JSON.stringify({ url: VESPER_MCP_URL, headers: { Authorization: `Bearer ${token}` } }, null, 2),
      );
      setMessage(tokenOnly ? "Access token copied. Paste it into the OAuth authorization page." : "Connection settings copied");
    } catch {
      setMessage("Clipboard unavailable. Allow copying and try again. Your token is still saved.");
    }
  };
  return (
    <div className="modal-layer settings-subpage-layer">
      <button className="modal-scrim" onClick={onClose} />
      <section className="connection-modal ai-connection-modal">
        <div className="modal-head">
          <button className="settings-back" onClick={onClose} aria-label="Back"><Icon name="chevron" /></button>
          <div><small>VESPER MCP</small><h2>Vesper MCP</h2></div>
        </div>
        <div className="connection-symbol"><Icon name="link" /></div>
        <p>Vesper provides notes, reminders, journals, dates, memory and notification tools to Codex and other AI clients that support remote MCP.</p>
        <div className="parameter-form">
          <label className="profile-field">
            <span>Streamable HTTP URL</span>
            <input value={VESPER_MCP_URL} readOnly />
          </label>
          <label className="profile-field">
            <span>Access token</span>
            <input type="password" disabled={busy} value={draft} autoCapitalize="none" autoCorrect="off" placeholder="Leave blank to generate a secure token" onChange={(event) => { setDraft(event.target.value); setVerified(false); setToolCount(null); }} />
          </label>
        </div>
        <p className="settings-hint">After saving, choose OAuth in ChatGPT and paste only the access token, without “Bearer”. A paired device can replace a lost or expired token. Existing Bearer connections must then use the new token.</p>
        {message && <p className="connection-message">{message}</p>}
        {toolCount !== null && <p className="settings-hint">Remote catalog: {toolCount}  MCP tools</p>}
        <button className="save-profile" disabled={busy} onClick={() => void setup()}>{busy ? "Configuring…" : token ? "Save and test MCP" : "Generate token and enable MCP"}</button>
        <button className="reset-background" disabled={busy} onClick={() => void setup(true)}>Generate replacement token</button>
        <button className="reset-background" disabled={busy || !draft.trim()} onClick={() => void testTools()}>Test MCP tools</button>
        <button className="reset-background" disabled={busy || !verified || draft.trim() !== token} onClick={() => void copy(true)}>Copy access token (OAuth)</button>
        <button className="reset-background" disabled={busy || !verified || draft.trim() !== token} onClick={() => void copy()}>Copy AI client connection settings</button>
      </section>
    </div>
  );
}

function CodexConnectionModal({ onClose }: { onClose: () => void }) {
  const [endpoint, setEndpoint] = useState(() => readLocalValue("vesper-codex-endpoint", "wss://codex.r-vera.com"));
  const [workspace, setWorkspace] = useState(() => readLocalValue<string>('vesper-codex-workspace', ''));
  const [token, setToken] = useState(() => deviceToken());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const cleanEndpoint = endpoint.trim().replace(/\/$/, "");
    window.localStorage.setItem("vesper-codex-endpoint", cleanEndpoint);
    try { workspaceOptions(workspace); } catch (e) { setMessage(e instanceof Error ? e.message : 'Invalid workspace'); setBusy(false); return; }
    window.localStorage.setItem('vesper-codex-workspace', JSON.stringify(workspace.trim()));
    if (token.trim()) window.localStorage.setItem("vesper-device-token", token.trim());
    try {
      if (/^wss?:\/\//i.test(cleanEndpoint)) {
        await new Promise<void>((resolve, reject) => {
          const probe = new WebSocket(`${cleanEndpoint}${cleanEndpoint.includes("?") ? "&" : "?"}token=${encodeURIComponent(token.trim())}`);
          probe.onopen = () => { probe.close(); resolve(); };
          probe.onerror = () => reject(new Error("WebSocket endpoint is unreachable"));
        });
      } else {
        const url = cleanEndpoint || `${window.location.origin}/api/codex`;
        const response = await fetch(url, { headers: { "x-vesper-device-token": token.trim() }, cache: "no-store" });
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
      }
      setMessage("Codex app-server is reachable. The chat uses this single connection.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not reach the app-server");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={onClose} />
      <section className="connection-modal ai-connection-modal">
        <div className="modal-head">
          <div><small>CODEX APP-SERVER</small><h2>One private connection</h2></div>
          <button onClick={onClose}><Icon name="close" /></button>
        </div>
        <p className="settings-hint">Your private Codex tunnel is preconfigured. Keep this endpoint as <code>wss://codex.r-vera.com</code> and enter your Vesper device token.</p>
        <label className="profile-field"><span>WebSocket endpoint (optional)</span><input value={endpoint} placeholder="wss://codex.example.com" onChange={(event) => setEndpoint(event.target.value)} /></label>
        <label className="profile-field"><span>Project workspace (optional)</span><input value={workspace} placeholder="/home/ubuntu/Vesper" onChange={e => setWorkspace(e.target.value)} /></label>
        <p className="settings-hint">Enter the project path on the app-server machine for your next message. Code and dependencies must already be there. Server permissions still control file changes, commands and network access.</p>
        <label className="profile-field"><span>Vesper device token</span><input type="password" value={token} placeholder="The VESPER_APP_TOKEN value" onChange={(event) => setToken(event.target.value)} /></label>
        {message && <p className="connection-message">{message}</p>}
        <button className="save-profile" disabled={busy} onClick={() => void save()}>{busy ? "Testing…" : "Save and test"}</button>
      </section>
    </div>
  );
}

type AiConnectionStore = {
  active: "api" | "mcp" | "cyberboss";
  api: Record<string, string>;
  mcp: Record<string, string>;
  cyberboss: Record<string, string>;
};

function AiConnectionModal({ onClose }: { onClose: () => void }) {
  const [stored, setStored] = useLocalDocument<AiConnectionStore>(
    "ai-connections-v1",
    { active: "api", api: {}, mcp: {}, cyberboss: {} },
  );
  const [active, setActive] = useState<AiConnectionStore["active"]>(stored.active);
  const [form, setForm] = useState<Record<string, string>>(() => stored[stored.active]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>(() => {
    try { return JSON.parse(stored.api.availableModels || "[]") as string[]; } catch { return []; }
  });
  const choices = [
    { id: "api" as const, label: "API Key", icon: "sparkles" },
    { id: "mcp" as const, label: "MCP", icon: "link" },
    { id: "cyberboss" as const, label: "CyberBoss", icon: "chat" },
  ];
  const fields: Record<AiConnectionStore["active"], Array<{ key: string; label: string; placeholder?: string; type?: string }>> = {
    api: [
      { key: "baseUrl", label: "API URL", placeholder: "https://api.openai.com/v1" },
      { key: "apiKey", label: "API Key", type: "password", placeholder: "sk-…" },
    ],
    mcp: [
      { key: "url", label: "MCP server URL", placeholder: "https://…/mcp" },
      { key: "transport", label: "Transport", placeholder: "Streamable HTTP / SSE" },
      { key: "token", label: "Access token", type: "password", placeholder: "Bearer token (optional)" },
      { key: "serverName", label: "Service name", placeholder: "My MCP" },
      { key: "toolName", label: "Chat tool name", placeholder: "chat" },
    ],
    cyberboss: [
      { key: "endpoint", label: "Service URL", placeholder: "https://api.vesper.r-vera.com" },
      { key: "deviceToken", label: "Device pairing code", type: "password", placeholder: "vsp_…" },
      { key: "runtime", label: "Runtime name", placeholder: "CyberBoss / Codex" },
      { key: "workspace", label: "Workspace", placeholder: "/path/to/workspace (optional)" },
    ],
  };
  const switchChoice = (next: AiConnectionStore["active"]) => {
    setStored({ ...stored, [active]: form, active: next });
    setActive(next);
    setForm(stored[next] || {});
    setMessage("");
  };
  const fetchModels = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: form.baseUrl, apiKey: form.apiKey }),
      });
      const result = await response.json() as { models?: string[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Could not load models");
      const available = result.models || [];
      setModels(available);
      setForm((current) => ({ ...current, availableModels: JSON.stringify(available), model: current.model || available[0] || "" }));
      setMessage(available.length ? `Loaded ${available.length} available models` : "The API returned no available models.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not load models");
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setMessage("");
    const next = { ...stored, [active]: form, active };
    setStored(next);
    if (active === "cyberboss" && form.deviceToken)
      window.localStorage.setItem("vesper-device-token", form.deviceToken.trim());
    try {
      if (active === "api") {
        if (!form.baseUrl || !form.apiKey || !form.model)
          throw new Error("Enter a Base URL, model and API Key.");
        const response = await fetch("/api/ai/models", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ baseUrl: form.baseUrl, apiKey: form.apiKey }),
        });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
      } else if (active === "mcp") {
        if (!form.url) throw new Error("Enter the MCP server URL.");
        const response = await fetch("/api/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: form.url, token: form.token }),
        });
        const result = await response.json() as { toolCount?: number; error?: string };
        if (!response.ok) throw new Error(result.error || `MCP returned ${response.status}`);
        setMessage(`Settings saved. Found ${result.toolCount || 0} MCP tools.`);
        return;
      } else {
        if (!form.deviceToken) throw new Error("Enter the device pairing code.");
        const endpoint = (form.endpoint || VESPER_API_ORIGIN).replace(/\/$/, "");
        const response = await fetch(`${endpoint}/api/chat?conversationId=main`, {
          headers: { "x-vesper-device-token": form.deviceToken.trim() },
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Invalid pairing code or service URL");
      }
      setMessage("Settings saved and connection test passed");
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? `Settings saved; ${reason.message}`
          : "Settings saved, but the test failed",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={onClose} />
      <section className="connection-modal ai-connection-modal">
        <div className="modal-head">
          <div><small>AI CONNECTION</small><h2>Choose connection</h2></div>
          <button onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="ai-connection-tabs">
          {choices.map((choice) => (
            <button
              className={active === choice.id ? "active" : ""}
              key={choice.id}
              onClick={() => switchChoice(choice.id)}
            >
              <Icon name={choice.icon} />
              <span>{choice.label}</span>
            </button>
          ))}
        </div>
        <div className="parameter-form">
          {active === "api" && (
            <label className="profile-field"><span>API type</span>
              <select value={form.provider || "OpenAI-compatible"} onChange={(event) => setForm({ ...form, provider: event.target.value })}>
                <option value="OpenAI-compatible">OpenAI-compatible</option>
                <option value="Anthropic">Anthropic</option>
              </select>
            </label>
          )}
          {fields[active].map((field) => (
            <label className="profile-field" key={field.key}>
              <span>{field.label}</span>
              <input
                type={field.type || "text"}
                value={form[field.key] || ""}
                placeholder={field.placeholder || ""}
                autoCapitalize="none"
                autoCorrect="off"
                onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
              />
            </label>
          ))}
          {active === "api" && (
            <>
              <button className="model-fetch-button" disabled={busy || !form.baseUrl || !form.apiKey} onClick={() => void fetchModels()}>
                {busy ? "Loading…" : "Load models available to this key"}
              </button>
              <label className="profile-field"><span>Current model</span>
                  <select value={form.model || ""} onChange={(event) => setForm({ ...form, model: event.target.value })}>
                    <option value="">Load models first</option>
                    {form.model && !models.includes(form.model) && <option value={form.model}>{form.model}</option>}
                    {models.map((model) => <option value={model} key={model}>{model}</option>)}
                  </select>
                </label>
            </>
          )}
        </div>
        {message && <p className="connection-message">{message}</p>}
        <button className="save-profile" disabled={busy} onClick={() => void save()}>
          {busy ? "Testing…" : "Save and test"}
        </button>
      </section>
    </div>
  );
}

function CyberbossConnectionModal({
  onPaired,
  onClose,
}: {
  onPaired: (value: boolean) => void;
  onClose: () => void;
}) {
  const [token, setToken] = useState(deviceToken);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const verify = async () => {
    const value = token.trim();
    if (!value) {
      setMessage("Enter the device pairing code");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(apiUrl("/api/chat?conversationId=main"), {
        headers: { "x-vesper-device-token": value },
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      window.localStorage.setItem("vesper-device-token", value);
      onPaired(true);
      setMessage("Device paired. It will connect when CyberBoss starts.");
    } catch {
      setMessage("Incorrect pairing code");
    } finally {
      setBusy(false);
    }
  };
  const remove = () => {
    window.localStorage.removeItem("vesper-device-token");
    setToken("");
    onPaired(false);
    setMessage("Pairing information removed from this device");
  };
  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={onClose} />
      <section className="connection-modal">
        <div className="modal-head">
          <div>
            <small>CYBERBOSS BRIDGE</small>
            <h2>Connect service</h2>
          </div>
          <button onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="connection-symbol">
          <Icon name="chat" />
        </div>
        <p>
          Vesper provides the mobile interface. CyberBoss runs Codex or Claude, reminders, journals and proactive care on your computer or server.
        </p>
        <label className="bridge-token-field">
          <span>Device pairing code</span>
          <input
            type="password"
            autoCapitalize="none"
            autoCorrect="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste pairing code"
          />
        </label>
        {message && <p className="connection-message">{message}</p>}
        <button
          className="save-profile"
          disabled={busy}
          onClick={() => void verify()}
        >
          {busy ? "Verifying…" : "Verify and save on this device"}
        </button>
        {deviceToken() && (
          <button className="reset-background" onClick={remove}>
            Remove this device
          </button>
        )}
      </section>
    </div>
  );
}

function AppearanceModal({
  accent,
  onAccent,
  onBackground,
  onClose,
}: {
  accent: string;
  onAccent: (value: string) => void;
  onBackground: (value: string) => void;
  onClose: () => void;
}) {
  const [color, setColor] = useState("#e4e4e0");
  const accents = [
    ["Slate blue", "#647e94"],
    ["Mist blue", "#8299ad"],
    ["Graphite", "#4a4a48"],
    ["Stone", "#6b6b68"],
    ["Mist gray", "#878783"],
    ["Light gray", "#a3a39f"],
  ];
  const backgrounds = [
    ["Default marble", DEFAULT_APP_BACKGROUND],
    ["Pale mist blue", "#e1eaf2"],
    ["Paper gray", "#eeeeeb"],
    ["Mist gray", "#e2e2df"],
  ];
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const preview = await localImage(file, 1600, 0.86);
    onBackground(
      `linear-gradient(rgba(245,247,247,.18),rgba(245,247,247,.18)),url("${preview}")`,
    );
    try {
      const { url } = await uploadImage(file);
      onBackground(`linear-gradient(rgba(245,247,247,.18),rgba(245,247,247,.18)),url("${url}")`);
    } catch {}
  };
  return (
    <div className="modal-layer appearance-layer">
      <button className="modal-scrim" onClick={onClose} />
      <section className="appearance-modal">
        <div className="modal-head">
          <div>
            <small>APPEARANCE</small>
            <h2>Appearance</h2>
          </div>
          <button onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="appearance-section">
          <div className="appearance-title">
            <b>Accent color</b>
            <small>Used for selection and subtle highlights</small>
          </div>
          <div className="accent-options">
            {accents.map(([name, value]) => (
              <button
                className={accent === value ? "selected" : ""}
                key={value}
                onClick={() => onAccent(value)}
              >
                <i style={{ background: value }} />
                <span>{name}</span>
                {accent === value && <em>✓</em>}
              </button>
            ))}
          </div>
        </div>
        <div className="appearance-section">
          <div className="appearance-title">
            <b>Background</b>
            <small>Choose a preset, import an image or generate from a color</small>
          </div>
          <div className="background-presets">
            {backgrounds.map(([name, value]) => (
              <button
                key={name}
                style={{ backgroundColor: value }}
                onClick={() => onBackground(value)}
              >
                <span>{name}</span>
              </button>
            ))}
          </div>
          <div className="appearance-tools">
            <label>
              <Icon name="upload" />
              <span>Import image</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </label>
            <div>
              <input
                aria-label="Background color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <button
                onClick={() => onBackground(color)}
              >
                Generate from color
              </button>
            </div>
          </div>
          <button className="reset-background" onClick={() => onBackground("")}>
            Restore warm white background
          </button>
        </div>
        <button className="save-profile" onClick={onClose}>
          Done
        </button>
      </section>
    </div>
  );
}
function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-group">
      <h2>{title}</h2>
      <div className="surface">{children}</div>
    </section>
  );
}
function SettingRow({
  icon,
  title,
  sub,
  status,
  badge,
  onClick,
  expanded,
  controls,
}: {
  icon: string;
  title: string;
  sub: string;
  status?: boolean;
  badge?: string;
  onClick?: () => void;
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button className="setting-row" onClick={onClick} aria-expanded={expanded} aria-controls={controls}>
      <span className="setting-icon">
        <Icon name={icon} />
      </span>
      <span>
        <b>{title}</b>
        <small>{sub}</small>
      </span>
      {status ? (
        <i className="connection-dot" />
      ) : badge ? (
        <em>{badge}</em>
      ) : (
        <Icon name="chevron" />
      )}
    </button>
  );
}

async function exportVesperData() {
  const local = Object.fromEntries(
    Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith("vesper-")))
      .map((key) => {
        const raw = window.localStorage.getItem(key) || "";
        try { return [key, JSON.parse(raw)]; } catch { return [key, raw]; }
      }),
  );
  let cloud: Record<string, unknown> | null = null;
  try {
    const response = await fetch(apiUrl("/api/state"), { cache: "no-store", headers: appHeaders() });
    if (response.ok) cloud = ((await response.json()) as { documents: Record<string, unknown> }).documents;
  } catch {}
  const blob = new Blob(
    [
      JSON.stringify(
        { exportedAt: new Date().toISOString(), version: 2, storageMode: "local-first", local, cloud },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vesper-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function FunctionalSettingsModal({
  type,
  preferences,
  onPreferences,
  onClose,
}: {
  type: string;
  preferences: VesperPreferences;
  onPreferences: (value: VesperPreferences) => void;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const toggle = (
    key: keyof Pick<
      VesperPreferences,
      | "reminders"
      | "anniversaries"
      | "agentNotes"
      | "memoryDiary"
      | "memoryNotes"
      | "memoryChat"
    >,
  ) => onPreferences({ ...preferences, [key]: !preferences[key] });
  const doExport = async () => {
    try {
      await exportVesperData();
      onPreferences({ ...preferences, lastExportAt: new Date().toISOString() });
      setMessage("Backup file created");
    } catch {
      setMessage("Export failed. Please try again.");
    }
  };
  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={onClose} />
      <section className="connection-modal functional-modal">
        <div className="modal-head">
          <div>
            <small>SETTINGS</small>
            <h2>{uiLabel(type)}</h2>
          </div>
          <button onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {type === "通知偏好" && (
          <div className="preference-list">
            <PreferenceToggle
              label="Reminders"
              detail="Notify when a reminder is due"
              value={preferences.reminders}
              onChange={() => toggle("reminders")}
            />
            <PreferenceToggle
              label="Dates"
              detail="Notify before important dates"
              value={preferences.anniversaries}
              onChange={() => toggle("anniversaries")}
            />
            <PreferenceToggle
              label="Rowan’s notes"
              detail="Allow Vesper to leave messages"
              value={preferences.agentNotes}
              onChange={() => toggle("agentNotes")}
            />
          </div>
        )}
        {type === "关心频率" && (
          <div className="choice-list">
            {(
              [
                ["daily", "Daily"],
                ["twice-weekly", "Twice a week"],
                ["off", "Close"],
              ] as const
            ).map(([value, label]) => (
              <button
                className={
                  preferences.careFrequency === value ? "selected" : ""
                }
                key={value}
                onClick={() =>
                  onPreferences({ ...preferences, careFrequency: value })
                }
              >
                <span>{label}</span>
                {preferences.careFrequency === value && <b>✓</b>}
              </button>
            ))}
          </div>
        )}
        {type === "记忆权限" && (
          <div className="preference-list">
            <PreferenceToggle
              label="Journal"
              detail="Allow Rowan to read journals for memories"
              value={preferences.memoryDiary}
              onChange={() => toggle("memoryDiary")}
            />
            <PreferenceToggle
              label="Notes"
              detail="Allow Rowan to organize and connect notes"
              value={preferences.memoryNotes}
              onChange={() => toggle("memoryNotes")}
            />
            <PreferenceToggle
              label="Chat"
              detail="Allow long-term memories from conversations"
              value={preferences.memoryChat}
              onChange={() => toggle("memoryChat")}
            />
          </div>
        )}
        {type === "导出与备份" && (
          <div className="export-panel">
            <Icon name="archive" />
            <h3>Export Vesper data</h3>
            <p>
              Vesper stores data on this device. Updates replace the app and cache without clearing your data. Exports include local data and available cloud copies.
            </p>
            <button className="save-profile" onClick={doExport}>
              Download backup
            </button>
            {message && <small>{message}</small>}
          </div>
        )}
        <button className="save-profile secondary-save" onClick={onClose}>
          Done
        </button>
      </section>
    </div>
  );
}

function PreferenceToggle({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <button onClick={onChange}>
      <span>
        <b>{label}</b>
        <small>{detail}</small>
      </span>
      <i className={value ? "switch on" : "switch"}>
        <u />
      </i>
    </button>
  );
}

function VoiceSettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useLocalDocument<ConnectionSettings>("connections", {});
  const [form, setForm] = useState<Record<string, string>>(() => ({
    provider: "ElevenLabs",
    baseUrl: "https://api.elevenlabs.io",
    model: "eleven_multilingual_v2",
    speed: "1",
    autoPlay: "true",
    ...(settings["Agent 声音"] || {}),
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [micStatus, setMicStatus] = useState("Not tested");
  const [apiStatus, setApiStatus] = useState("Not tested");
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const requestMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicStatus("Allowed");
    } catch { setMicStatus("Not authorized"); }
  };
  const testVoice = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Vesper’s voice connection is working.", connection: form }),
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || "Voice service test failed");
      }
      setSettings({ ...settings, "Agent 声音": form });
      setApiStatus("Available");
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
      setMessage("Settings saved and voice preview completed");
    } catch (reason) {
      setApiStatus("Request failed");
      setMessage(reason instanceof Error ? reason.message : "Voice service test failed");
    } finally { setBusy(false); }
  };
  const eleven = /eleven/i.test(form.provider || "");
  return (
    <div className="modal-layer settings-subpage-layer">
      <button className="modal-scrim" onClick={onClose} />
      <section className="connection-modal voice-settings-modal">
        <div className="modal-head"><button className="settings-back" aria-label="Back" onClick={onClose}><Icon name="chevron" /></button><div><small>VOICE</small><h2>Voice</h2></div></div>
        <div className="parameter-form">
          <label className="profile-field"><span>Voice service</span><select value={form.provider} onChange={(event) => {
            const provider = event.target.value;
            const minimax = provider === "MiniMax";
            setForm((current) => ({ ...current, provider, baseUrl: provider === "ElevenLabs" ? "https://api.elevenlabs.io" : minimax ? "https://api.minimax.chat" : "https://api.openai.com/v1", model: provider === "ElevenLabs" ? "eleven_multilingual_v2" : minimax ? "speech-2.6-hd" : "gpt-4o-mini-tts" }));
          }}><option>ElevenLabs</option><option>MiniMax</option><option>OpenAI-compatible</option></select></label>
          <label className="profile-field"><span>API Base URL</span><input value={form.baseUrl || ""} onChange={(event) => update("baseUrl", event.target.value)} /></label>
          <label className="profile-field"><span>{eleven ? "ElevenLabs API Key" : "API Key"}</span><input type="password" value={form.apiKey || ""} onChange={(event) => update("apiKey", event.target.value)} /></label>
          <label className="profile-field"><span>{eleven ? "ElevenLabs Voice ID" : "Voice ID"}</span><input value={form.voiceId || ""} placeholder={form.provider === "MiniMax" ? "male-qn-qingse" : "alloy / custom voice ID"} onChange={(event) => update("voiceId", event.target.value)} /></label>
          {form.provider === "MiniMax" && <label className="profile-field"><span>MiniMax Group ID (optional)</span><input value={form.groupId || ""} onChange={(event) => update("groupId", event.target.value)} /></label>}
          <label className="profile-field"><span>{eleven ? "ElevenLabs model" : "TTS model"}</span><input value={form.model || ""} onChange={(event) => update("model", event.target.value)} /></label>
          <label className="voice-speed"><span>Speed {Number(form.speed || 1).toFixed(1)}×</span><input type="range" min="0.7" max="1.3" step="0.1" value={form.speed || "1"} onChange={(event) => update("speed", event.target.value)} /></label>
          <button className="voice-autoplay" onClick={() => update("autoPlay", form.autoPlay === "false" ? "true" : "false")}><i className={form.autoPlay === "false" ? "switch" : "switch on"}><u /></i><span><b>Autoplay voice messages</b><small>Play received voice messages automatically</small></span></button>
        </div>
        <button className="save-profile" disabled={busy} onClick={() => void testVoice()}>{busy ? "Playing preview…" : "Preview"}</button>
        <section className="voice-test-panel"><div><b>Voice test</b><button onClick={() => void Promise.all([requestMic(), testVoice()])}>Test all</button></div><p><span>1  Microphone permission</span><em><i className={micStatus === "Allowed" ? "voice-status-dot ok" : "voice-status-dot"} />{micStatus}</em><button onClick={() => void requestMic()}>Request permission</button></p><p><span>2  Voice service availability</span><em><i className={apiStatus === "Available" ? "voice-status-dot ok" : "voice-status-dot"} />{apiStatus}</em></p><p><span>3  Current environment</span><em><i className="voice-status-dot ok" />{window.matchMedia("(display-mode: standalone)").matches ? "iPhone Home Screen PWA" : "Browser"}</em></p></section>
        {message && <p className="connection-message">{message}</p>}
      </section>
    </div>
  );
}

function ConnectionModal({
  type,
  environment,
  onEnvironment,
  onNotificationPermission,
  onClose,
}: {
  type: string;
  environment: EnvironmentSnapshot;
  onEnvironment: (value: EnvironmentSnapshot) => void;
  onNotificationPermission: (value: NotificationPermission) => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useLocalDocument<ConnectionSettings>(
    "connections",
    {},
  );
  const [form, setForm] = useState<Record<string, string>>(
    () => settings[type] || {},
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const definitions: Record<
    string,
    { label: string; key: string; type?: string; placeholder?: string }[]
  > = {
    "AI 连接": [
      {
        label: "Provider",
        key: "provider",
        placeholder: "OpenAI / Anthropic / Custom",
      },
      {
        label: "API Base URL",
        key: "baseUrl",
        placeholder: "https://api.openai.com/v1",
      },
      { label: "Model", key: "model", placeholder: "Model ID" },
      { label: "API Key", key: "apiKey", type: "password" },
    ],
    "Agent 声音": [
      { label: "TTS provider", key: "provider", placeholder: "OpenAI / ElevenLabs / Compatible service" },
      { label: "API Base URL", key: "baseUrl", placeholder: "https://api.openai.com/v1" },
      { label: "Full request URL (optional)", key: "endpoint", placeholder: "Use if your service does not support the standard API" },
      { label: "Model", key: "model", placeholder: "gpt-4o-mini-tts" },
      { label: "Voice ID", key: "voiceId", placeholder: "alloy / custom voice ID" },
      { label: "API Key", key: "apiKey", type: "password" },
    ],
    "MCP 服务": [
      { label: "MCP server URL", key: "url", placeholder: "https://…" },
      { label: "Access token", key: "token", type: "password" },
    ],
    "Web Push": [],
  };
  const fields = definitions[type] || [];
  const save = () => {
    setSettings({ ...settings, [type]: form });
    setMessage("Settings saved on this device");
  };
  const test = async () => {
    setBusy(true);
    setMessage("");
    try {
      if (type === "AI 连接") {
        const base = (form.baseUrl || "").replace(/\/$/, "");
        if (!base || !form.apiKey)
          throw new Error("Enter a Base URL and API Key.");
        const response = await fetch(`${base}/models`, {
          headers: { authorization: `Bearer ${form.apiKey}` },
        });
        if (!response.ok) throw new Error(`Connection failed (${response.status})`);
      } else if (type === "MCP 服务") {
        if (!form.url) throw new Error("Enter the MCP server URL.");
        const response = await fetch(form.url, {
          headers: form.token
            ? { authorization: `Bearer ${form.token}` }
            : undefined,
        });
        if (!response.ok) throw new Error(`Connection failed (${response.status})`);
      } else if (type === "Agent 声音") {
        if (!form.baseUrl || !form.apiKey)
          throw new Error("Enter the TTS Base URL and API Key.");
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "Vesper’s voice connection is working.", connection: form }),
        });
        if (!response.ok) {
          const result = (await response.json()) as { error?: string };
          throw new Error(result.error || "TTS test failed");
        }
        await new Audio(URL.createObjectURL(await response.blob())).play();
      } else if (type === "Web Push") {
        if (Capacitor.isNativePlatform()) throw new Error("Enable Web Push in a browser or Home Screen PWA. Use Apple notification permission in the native app.");
        if (!window.matchMedia("(display-mode: standalone)").matches && /iPhone|iPad|iPod/.test(navigator.userAgent))
          throw new Error("On iPhone, add Vesper to the Home Screen and enable push from the PWA.");
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const configResponse = await fetch(apiUrl("/api/push"));
        const config = (await configResponse.json()) as { configured?: boolean; publicKey?: string };
        if (!configResponse.ok || !config.configured || !config.publicKey)
          throw new Error("The push server is not configured yet.");
        const result = await subscribe(config.publicKey);
        if (result.status === "denied") {
          onNotificationPermission("denied");
          throw new Error("Notification permission denied");
        }
        if (result.status === "unsupported") throw new Error("Web Push is not supported in this environment.");
        onNotificationPermission("granted");
        const subscription = serializeSubscription(result.subscription);
        const response = await fetch(apiUrl("/api/push"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "test", subscription }),
        });
        if (!response.ok) throw new Error("Subscribed, but the server test notification failed.");
      }
      save();
      setMessage("Connection test passed");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };
  const locate = () => {
    if (!navigator.geolocation) {
      setMessage("Location is not supported in this browser.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = position.coords.latitude,
          longitude = position.coords.longitude;
        try {
          const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`,
          );
          const data = (await response.json()) as {
            timezone?: string;
            current?: { temperature_2m?: number; weather_code?: number };
          };
          onEnvironment({
            permission: "granted",
            latitude,
            longitude,
            temperature: data.current?.temperature_2m,
            weatherCode: data.current?.weather_code,
            timezone: data.timezone,
            updatedAt: new Date().toISOString(),
          });
          setMessage("Location and weather updated");
        } catch {
          onEnvironment({
            permission: "granted",
            latitude,
            longitude,
            updatedAt: new Date().toISOString(),
            error: "Could not load weather",
          });
          setMessage("Location updated, but weather could not be loaded.");
        } finally {
          setBusy(false);
        }
      },
      (error) => {
        onEnvironment({ permission: "denied", error: error.message });
        setMessage(error.message);
        setBusy(false);
      },
      { timeout: 12000, maximumAge: 600000 },
    );
  };
  const isLocation = type === "定位与环境";
  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={onClose} />
      <section className="connection-modal">
        <div className="modal-head">
          <div>
            <small>CONNECTION</small>
            <h2>{uiLabel(type)}</h2>
          </div>
          <button onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {isLocation ? (
          <div className="connection-fields">
            <div className="connection-field">
              <span>
                {environment.latitude
                  ? `${environment.latitude.toFixed(4)}, ${environment.longitude?.toFixed(4)}`
                  : "Location not set"}
              </span>
            </div>
          </div>
        ) : (
          <div className="parameter-form">
            {type === "Web Push" && (
              <p className="settings-hint">Vesper uses Cloudflare push automatically. Authorization sends a real test notification; no manual VAPID setup is needed.</p>
            )}
            {fields.map((field) => (
              <label className="profile-field" key={field.key}>
                <span>{field.label}</span>
                <input
                  type={field.type || "text"}
                  value={form[field.key] || ""}
                  placeholder={field.placeholder || ""}
                  autoCapitalize="none"
                  autoCorrect="off"
                  onChange={(event) =>
                    setForm({ ...form, [field.key]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>
        )}
        {message && <p className="connection-message">{message}</p>}
        <button
          className="save-profile"
          disabled={busy}
          onClick={isLocation ? locate : () => void test()}
        >
          {busy
            ? "Working…"
            : isLocation
              ? "Get location and weather"
              : type === "Agent 声音"
                ? "Save settings"
                : "Save and test"}
        </button>
      </section>
    </div>
  );
}

function formatPlaybackTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  return `${Math.floor(value / 60)}:${String(Math.floor(value) % 60).padStart(2, "0")}`;
}
function useTogetherDuration(state: MusicTogetherState) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.status !== "connected") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.status]);
  const carried = Number.isFinite(state.totalListeningSeconds) ? Math.max(0, Number(state.totalListeningSeconds)) : 0;
  const started = Date.parse(state.sessionStartedAt || "");
  const session = state.status === "connected" && Number.isFinite(started) ? Math.max(0, (now - started) / 1000) : 0;
  return Math.floor(carried + session);
}

function togetherTimeLabel(state: MusicTogetherState, totalSeconds: number) {
  if (state.status === "connected") return `Listening together for ${Math.floor(totalSeconds / 3600)}h ${Math.floor(totalSeconds % 3600 / 60)}m`;
  if (state.status === "invited") return "Listen-together invitation sent";
  if (state.status === "offline") return "The other listener is offline.";
  return "Listen together has not started.";
}

function MusicPlayerUI({
  queue, onQueue, selected, onTracks, playMode, onCycleMode, toast, adapter,
  userName, agentName, userAvatar, agentAvatar, together, onInvite,
  onRemoveQueueItem, playlistIntent, onPlaylistIntentConsumed,
}: {
  queue: Track[];
  onQueue: (value: Track[], options?: MusicQueueUpdate) => void;
  selected: number;
  onTracks: (value: Track[]) => void;
  playMode: MusicPlayMode;
  onCycleMode: () => void;
  toast: string;
  adapter: PlayerAdapter;
  userName: string;
  agentName: string;
  userAvatar: string;
  agentAvatar: string;
  together: MusicTogetherState;
  onInvite: () => void;
  onRemoveQueueItem: (index: number) => void;
  playlistIntent: MusicPlaylistIntent | null;
  onPlaylistIntentConsumed: () => void;
}) {
  const track = queue[selected];
  const state = adapter.getState();
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueDragY, setQueueDragY] = useState(0);
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pendingPlaylistTrack, setPendingPlaylistTrack] = useState<MusicPlaylistIntent | null>(null);
  const queueDragStart = useRef<number | null>(null);
  const queueListRef = useRef<HTMLDivElement>(null);
  const canSeek = state.canSeek;
  const displayedTime = scrubValue ?? state.currentTime;
  const modeLabels: Record<MusicPlayMode, string> = { order: "Play in order", repeat: "Repeat queue", single: "Repeat one", random: "Shuffle" };
  const modeIcons: Record<MusicPlayMode, string> = { order: "menu", repeat: "repeat", single: "one", random: "shuffle" };
  const totalTogetherSeconds = useTogetherDuration(together);
  const playbackProgress = canSeek ? `${Math.max(0, Math.min(100, displayedTime / Math.max(state.duration, 1) * 100))}%` : "0%";
  const roomStyle = {
    "--music-tint": "99, 99, 96", "--music-on-tint": "17, 17, 17", "--playback-progress": playbackProgress,
  } as CSSProperties;

  useEffect(() => {
    const openQueue = () => setQueueOpen(true);
    window.addEventListener("vesper-music-open-queue", openQueue);
    return () => window.removeEventListener("vesper-music-open-queue", openQueue);
  }, []);
  useEffect(() => {
    if (!queueOpen) return;
    const frame = window.requestAnimationFrame(() => {
      queueListRef.current?.querySelector<HTMLElement>("article.active")?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [queueOpen, selected, queue.length]);
  useEffect(() => {
    if (!playlistIntent) return;
    setPendingPlaylistTrack(playlistIntent);
    setLibraryOpen(true);
    onPlaylistIntentConsumed();
  }, [onPlaylistIntentConsumed, playlistIntent]);
  const commitSeek = () => {
    if (scrubValue != null) adapter.seek(scrubValue);
    setScrubValue(null);
  };
  return <div className="page-body listening-player" style={roomStyle}>
    <section className="listening-player-main">
      <div className="listening-library-bar"><button onClick={() => setLibraryOpen(true)}><Icon name="library" /><span>My Music</span></button></div>
      <button className="listening-together" onClick={together.status === "connected" ? undefined : onInvite} aria-label={together.status === "connected" ? `${agentName} and ${userName} are listening together` : "Invite to listen together"}>
        <span className="listening-avatars"><AvatarMark src={userAvatar} label={userName} kind="user" /><i /><AvatarMark src={agentAvatar} label={agentName} kind="agent" /></span>
        <span>{togetherTimeLabel(together, totalTogetherSeconds)}</span>
      </button>
      {track ? <>
        <section className="listening-disc-stage" aria-label={`Now playing: ${track.title}`}>
          <div className={state.playing ? "sound-halo is-playing" : "sound-halo"}>
            <div className="listening-disc">{track.cover ? <img src={track.cover} alt={`${track.title} cover`} /> : <span>V</span>}</div>
          </div>
        </section>
        <section className="listening-track-copy"><h2>{track.title}</h2><p>{track.artist || "Unknown artist"}{track.album ? ` · ${track.album}` : ""}</p></section>
        <section className="listening-progress" aria-label="Playback progress"><input aria-label="Playback progress" type="range" min="0" max={Math.max(state.duration, 1)} step="0.1" disabled={!canSeek} value={Math.min(displayedTime, Math.max(state.duration, 1))} onChange={(event) => setScrubValue(Number(event.target.value))} onPointerUp={commitSeek} onKeyUp={commitSeek} /><div><span>{canSeek ? formatPlaybackTime(displayedTime) : "--:--"}</span><span>{canSeek ? formatPlaybackTime(state.duration) : "--:--"}</span></div></section>
        <section className="listening-controls"><button className="listening-mode" aria-label={modeLabels[playMode]} title={modeLabels[playMode]} onClick={onCycleMode}><Icon name={modeIcons[playMode]} /></button><button aria-label="Previous track" onClick={adapter.previous}><Icon name="back" /></button><button className="listening-play" aria-label={state.playing ? "Pause" : "Play"} onClick={adapter.toggle}><Icon name={state.playing ? "pause" : "play"} /></button><button aria-label="Next track" onClick={adapter.next}><Icon name="forward" /></button><button className="listening-queue-button" aria-label="Open queue" onClick={() => setQueueOpen(true)}><Icon name="queue" /><em>{queue.length}</em></button></section>
      </> : <section className="listening-empty"><Icon name="music" /><h2>No playback queue yet</h2><p>Connect NetEase in My Music, then select a playlist or search for songs.</p><button onClick={() => setLibraryOpen(true)}>Open My Music</button></section>}
    </section>
    {toast && <div className="music-toast" role="status">{toast}</div>}
    {queueOpen && <div className="music-queue-layer"><button className="music-queue-scrim" aria-label="Close queue" onClick={() => setQueueOpen(false)} /><section className="music-queue-sheet" style={{ transform: `translateY(${queueDragY}px)` }}><div className="music-queue-drag-handle" onTouchStart={(event) => { queueDragStart.current = event.touches[0]?.clientY ?? null; }} onTouchMove={(event) => { const start = queueDragStart.current; const current = event.touches[0]?.clientY; if (start != null && current != null && current > start) setQueueDragY(Math.min(240, current - start)); }} onTouchEnd={() => { if (queueDragY > 88) setQueueOpen(false); setQueueDragY(0); queueDragStart.current = null; }} /><header><div><small>Now playing queue</small><h2>{queue.length}  songs</h2></div><div><button className="queue-sync-action" onClick={() => { setQueueOpen(false); setLibraryOpen(true); }}>My Music</button><button aria-label="Close queue" onClick={() => setQueueOpen(false)}><Icon name="close" /></button></div></header><div className="music-queue-list" ref={queueListRef}>{queue.length ? queue.map((item, index) => <article className={selected === index ? "active" : ""} key={item.id}><button className="music-queue-track" onClick={() => { adapter.select(index); setQueueOpen(false); }}>{item.cover ? <img src={item.cover} alt="" /> : <span>{index + 1}</span>}<div><b>{item.title}</b><small>{item.artist || "Unknown artist"}</small></div><time>{item.duration || "--:--"}</time>{selected === index && <i className="music-queue-eq" aria-label="Now playing" />}</button><button className="music-queue-remove" aria-label={`Remove ${item.title}`} onClick={() => onRemoveQueueItem(index)}><Icon name="close" /></button></article>) : <EmptyState text="The queue is empty." />}</div></section></div>}
    {libraryOpen && <NeteaseMusicLibrary onClose={() => { setLibraryOpen(false); setPendingPlaylistTrack(null); }} queue={queue} onQueue={onQueue} onTracks={onTracks} pendingPlaylistTrack={pendingPlaylistTrack} onPendingPlaylistTrackHandled={() => setPendingPlaylistTrack(null)} />}
  </div>;
}

function NeteaseMusicLibrary({
  onClose,
  queue,
  onQueue,
  onTracks,
  pendingPlaylistTrack,
  onPendingPlaylistTrackHandled,
}: {
  onClose: () => void;
  queue: Track[];
  onQueue: (value: Track[], options?: MusicQueueUpdate) => void;
  onTracks: (value: Track[]) => void;
  pendingPlaylistTrack: MusicPlaylistIntent | null;
  onPendingPlaylistTrackHandled: () => void;
}) {
  const [meta, setMeta] = useLocalDocument<Record<string, string>>("music-connection-meta", {});
  const [savedMusicCookie, setSavedMusicCookie] = useLocalDocument("netease-music-u", "");
  const [account, setAccount] = useState({ uid: meta.uid || "", cookie: savedMusicCookie });
  const [tab, setTab] = useState<"mine" | "discover">("mine");
  const [accountOpen, setAccountOpen] = useState(!meta.uid || !savedMusicCookie);
  const [playlists, setPlaylists] = useState<Array<{ id: string; name: string; trackCount?: number; cover?: string; description?: string }>>([]);
  const [collection, setCollection] = useState<MusicLibraryResult | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const [activeNeteasePlaylistId, setActiveNeteasePlaylistId] = useState("");
  const isConnected = Boolean(account.uid.trim() && account.cookie.trim());

  const invoke = async (
    action: Parameters<typeof requestNeteaseLibrary>[2]["action"],
    payload: Omit<Parameters<typeof requestNeteaseLibrary>[2], "action" | "uid" | "cookie"> = {},
  ) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await requestNeteaseLibrary(apiUrl("/api/music/library"), appHeaders(true), {
        action,
        uid: account.uid.trim(),
        cookie: account.cookie.trim(),
        ...payload,
      });
      return result;
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "NetEase Music is unavailable.";
      const normalized = detail.trim();
      setMessage(
        /^(load failed|failed to fetch|networkerror)$/i.test(normalized)
          ? "Could not connect to the music service. Try again later."
          : normalized === "Device not paired"
            ? "Connect this device in Vesper Settings before using NetEase Music."
            : detail,
      );
      return null;
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    if (!isConnected) {
      setMessage("Enter your NetEase UID and MUSIC_U.");
      return;
    }
    setSavedMusicCookie(account.cookie.trim());
    setMeta((current) => ({ ...current, uid: account.uid.trim() }));
    const result = await invoke("playlists");
    if (!result) return;
    setPlaylists(result.playlists || []);
    setAccountOpen(false);
    setMessage(result.summary || "Connected to NetEase Music");
  };

  const showCollection = async (
    action: Parameters<typeof requestNeteaseLibrary>[2]["action"],
    payload: Omit<Parameters<typeof requestNeteaseLibrary>[2], "action" | "uid" | "cookie"> = {},
  ) => {
    const result = await invoke(action, payload);
    if (result) {
      setCollection(result);
      setActiveNeteasePlaylistId(action === "playlist" ? String((payload as { playlistId?: string }).playlistId || "") : "");
      // Choosing a remote collection means choosing the active listening list.
      // Search remains non-destructive, but recommendations and playlist-like
      // sources replace the queue in their returned order without auto-playing.
      if (["playlist", "recommendations", "personal-fm", "recent-plays", "play-history", "liked-songs"].includes(action)) {
        await prepareTracks((result.tracks || []) as Track[], true);
      }
    }
  };

  const searchSongs = async () => {
    const query = search.trim();
    if (!query) {
      setMessage("Enter a song, artist or album");
      return;
    }
    setTab("discover");
    await showCollection("search", { query, limit: 30 });
  };

  async function prepareTracks(tracks: Track[], replaceQueue = false, autoplay = false) {
    const songIds = tracks.map((track) => track.neteaseId || track.id.replace(/^netease-/, "")).filter(Boolean);
    if (!songIds.length) return;
    const result = await invoke("resolve", { songIds, tracks });
    const resolved = (result?.tracks || []) as Track[];
    if (!resolved.length) return;
    onTracks(resolved);
    const seen = new Set<string>();
    const nextQueue = (replaceQueue ? resolved : [...queue, ...resolved]).filter((track) => {
      const key = track.neteaseId || track.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    onQueue(nextQueue, { autoplay, trackId: resolved[0]?.id });
    setMessage(replaceQueue ? `Synced ${resolved.length} songs to the current queue` : result?.summary || `Added ${resolved.length} songs`);
  }

  const updateRemotePlaylist = async (action: "playlist-add" | "playlist-remove", playlistId: string, track: MusicPlaylistIntent | Track) => {
    if (!isConnected) {
      setMessage("Connect your NetEase account first.");
      return;
    }
    const neteaseId = track.neteaseId || track.id.replace(/^netease-/, "");
    const target = playlists.find((playlist) => playlist.id === playlistId);
    const verb = action === "playlist-add" ? "Add" : "Remove";
    if (!window.confirm(`${verb} “${track.title}” ${action === "playlist-add" ? "to" : "from"} ${target?.name || "this NetEase playlist"}?`)) return;
    const result = await invoke(action, { playlistId, songIds: [neteaseId] });
    if (!result) return;
    setMessage(result.summary || `Playlist updated`);
    if (action === "playlist-add") {
      setPlaylistPickerOpen(false);
      onPendingPlaylistTrackHandled();
    } else {
      setCollection((current) => current ? { ...current, tracks: (current.tracks || []).filter((item) => (item.neteaseId || item.id.replace(/^netease-/, "")) !== neteaseId) } : current);
    }
  };

  const contentTracks = (collection?.tracks || []) as Track[];
  return <div className="netease-library-layer" role="dialog" aria-modal="true" aria-label="NetEase Music">
    <section className="netease-library-sheet">
      <header className="netease-library-head">
        <button onClick={onClose} aria-label="Close My Music"><Icon name="chevron" /></button>
        <div><small>NETEASE MUSIC</small><h2>NetEase Music</h2></div>
        <button className={busy ? "is-busy" : ""} disabled={busy} onClick={() => { if (tab === "mine") void connect(); else void searchSongs(); }} aria-label="Refresh"><Icon name="repeat" /></button>
      </header>
      <nav className="netease-library-tabs" aria-label="Music categories">
        <button className={tab === "mine" ? "active" : ""} onClick={() => { setTab("mine"); setCollection(null); }}>My Music</button>
        <button className={tab === "discover" ? "active" : ""} onClick={() => { setTab("discover"); setCollection(null); }}>Discover</button>
      </nav>
      <main className="netease-library-content">
        {collection ? <section className="netease-collection">
          <div className="netease-collection-head"><button onClick={() => setCollection(null)} aria-label="Back"><Icon name="chevron" /></button><div><small>{collection.subtitle || "NetEase Music"}</small><h3>{collection.title || "Songs"}</h3></div><button disabled={busy || !contentTracks.length} onClick={() => void prepareTracks(contentTracks, true, true)}>Play all</button></div>
          {contentTracks.length ? <div className="netease-track-list">{contentTracks.map((track, index) => <article className={activeNeteasePlaylistId ? "is-remote-playlist" : ""} key={`${track.id}-${index}`}><button className="netease-track-main" onClick={() => void prepareTracks([track], false, true)}>{track.cover ? <img src={track.cover} alt="" /> : <span>{index + 1}</span>}<div><b>{track.title}</b><small>{track.artist}{track.album ? ` · ${track.album}` : ""}</small></div><time>{track.duration || "--:--"}</time></button><button className="netease-track-more" onClick={() => void prepareTracks([track])} aria-label={`Add ${track.title} to queue`}><Icon name="plus" /></button>{activeNeteasePlaylistId && <button className="netease-track-remove" onClick={() => void updateRemotePlaylist("playlist-remove", activeNeteasePlaylistId, track)} aria-label={`Remove ${track.title} from NetEase playlist`}><Icon name="trash" /></button>}</article>)}</div> : <div className="netease-library-empty"><Icon name="music" /><p>No songs to show yet.</p></div>}
          {collection.lyrics && <pre className="netease-lyrics">{collection.lyrics}</pre>}
        </section> : tab === "mine" ? <>
          <section className={accountOpen ? "netease-account-card open" : "netease-account-card"}>
            <button className="netease-account-toggle" onClick={() => setAccountOpen((value) => !value)}><span><i className={isConnected ? "connected" : ""} />{isConnected ? "NetEase account connected" : "Connect NetEase account"}</span><Icon name="chevron" /></button>
            {accountOpen && <div className="netease-account-fields"><label><span>NetEase UID</span><input inputMode="numeric" autoComplete="off" value={account.uid} placeholder="For example, 123456789" onChange={(event) => setAccount({ ...account, uid: event.target.value })} /></label><label><span>MUSIC_U</span><input type="password" autoComplete="off" value={account.cookie} placeholder="Saved only on this device" onChange={(event) => setAccount({ ...account, cookie: event.target.value })} /></label><button disabled={busy} onClick={() => void connect()}>{busy ? "Connecting…" : "Connect and load playlists"}</button></div>}
          </section>
          {pendingPlaylistTrack && <section className="netease-pending-playlist"><div><small>FROM CHAT</small><b>{pendingPlaylistTrack.title}</b><span>{pendingPlaylistTrack.artist || "Unknown artist"}</span></div>{!isConnected ? <button onClick={() => setAccountOpen(true)}>Connect account first</button> : !playlists.length ? <button disabled={busy} onClick={() => void connect()}>Load playlists</button> : <button onClick={() => setPlaylistPickerOpen((value) => !value)}>Add to playlist</button>}{playlistPickerOpen && <div className="netease-playlist-picker">{playlists.map((playlist) => <button key={playlist.id} disabled={busy} onClick={() => void updateRemotePlaylist("playlist-add", playlist.id, pendingPlaylistTrack)}><span>{playlist.name}</span><small>{playlist.trackCount || 0}  tracks</small></button>)}</div>}<button className="netease-pending-dismiss" onClick={onPendingPlaylistTrackHandled}>Cancel</button></section>}
          <section className="netease-shortcuts"><button disabled={busy || !isConnected} onClick={() => void showCollection("recommendations")}><Icon name="sparkles" /><span>Daily mix</span></button><button disabled={busy || !isConnected} onClick={() => void showCollection("personal-fm")}><Icon name="music" /><span>Personal FM</span></button><button disabled={busy || !isConnected} onClick={() => void showCollection("recent-plays")}><Icon name="repeat" /><span>Recently played</span></button><button disabled={busy || !isConnected} onClick={() => void showCollection("liked-songs")}><Icon name="heart" /><span>Liked songs</span></button></section>
          <section className="netease-playlists"><div className="netease-section-heading"><div><small>MY PLAYLISTS</small><h3>My playlists</h3></div><button disabled={busy || !isConnected} onClick={() => void connect()}>Refresh</button></div>{playlists.length ? <div className="netease-playlist-list">{playlists.map((playlist) => <button key={playlist.id} onClick={() => void showCollection("playlist", { playlistId: playlist.id })}>{playlist.cover ? <img src={playlist.cover} alt="" /> : <span><Icon name="music" /></span>}<div><b>{playlist.name}</b><small>{playlist.trackCount || 0}  songs{playlist.description ? ` · ${playlist.description}` : ""}</small></div><Icon name="chevron" /></button>)}</div> : <div className="netease-library-empty"><Icon name="library" /><p>{isConnected ? "Refresh to load your playlists." : "Connect to view playlists, favorites and listening history."}</p></div>}</section>
        </> : <>
          <form className="netease-search" onSubmit={(event) => { event.preventDefault(); void searchSongs(); }}><Icon name="search" /><input value={search} placeholder="Search songs, artists or albums" onChange={(event) => setSearch(event.target.value)} /><button disabled={busy} type="submit">Search</button></form>
          <section className="netease-discover-intro"><small>DISCOVER</small><h3>Find your next song</h3><p>Search for songs or connect your account for daily recommendations, Personal FM and weekly favorites.</p></section>
          <section className="netease-discover-actions"><button disabled={busy || !isConnected} onClick={() => void showCollection("recommendations")}><b>Daily mix</b><span>30 songs selected for you today</span></button><button disabled={busy || !isConnected} onClick={() => void showCollection("play-history")}><b>Weekly favorites</b><span>Return to your recent favorites</span></button></section>
        </>}
        {message && <p className="netease-library-message" role="status">{message}</p>}
      </main>
    </section>
  </div>;
}

type MemoryLibraryRecord = {
  id: string;
  type: "core" | "long_term" | "feeling" | "dream";
  body: string;
  mood: string;
  tags: string[];
  weight: number;
  pinned: boolean;
  source: string;
  reviewStatus: "approved" | "candidate";
  createdAt: string;
  updatedAt: string;
  lastSurfacedAt: string | null;
  surfaceCount: number;
  demotedAt: string | null;
};
type MemoryLibraryDetail = {
  memory: MemoryLibraryRecord;
  revisions: Array<{ id: string; body: string; mood: string; tags: string[]; reason: string; action: string; createdAt: string }>;
};
const memoryTypeLabel: Record<MemoryLibraryRecord["type"], string> = {
  core: "Core memories",
  long_term: "Long-term memories",
  feeling: "Feelings",
  dream: "Dreams",
};

function MemoryLibrary() {
  const [memories, setMemories] = useState<MemoryLibraryRecord[]>([]);
  const [filter, setFilter] = useState<"all" | MemoryLibraryRecord["type"]>("all");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [showDemoted, setShowDemoted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<MemoryLibraryDetail | null>(null);
  const [addingCore, setAddingCore] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [coreDraft, setCoreDraft] = useState({ body: "", mood: "", tags: "", reason: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ includeCandidates: "1" });
      if (filter !== "all") params.set("type", filter);
      if (appliedQuery.trim()) params.set("q", appliedQuery.trim());
      if (showDemoted) params.set("includeDemoted", "1");
      const response = await fetch(apiUrl("/api/memory?" + params.toString()), { headers: appHeaders(), cache: "no-store" });
      const payload = response.headers.get("content-type")?.includes("application/json")
        ? await response.json() as { memories?: MemoryLibraryRecord[]; error?: string }
        : {};
      if (!response.ok) throw new Error(payload.error || "Could not load memories");
      setMemories(payload.memories || []);
      setMessage("");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not load memories");
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, filter, showDemoted]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openMemory = async (id: string) => {
    try {
      const response = await fetch(apiUrl("/api/memory?id=" + encodeURIComponent(id)), { headers: appHeaders(), cache: "no-store" });
      const payload = response.headers.get("content-type")?.includes("application/json")
        ? await response.json() as MemoryLibraryDetail & { error?: string }
        : {} as MemoryLibraryDetail & { error?: string };
      if (!response.ok || !payload.memory) throw new Error(payload.error || "Could not load memory details");
      setDetail(payload);
      setCorrecting(false);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not load memory details");
    }
  };

  const change = async (id: string, action: "pin" | "demote" | "restore" | "approve_core", pinned?: boolean) => {
    try {
      const response = await fetch(apiUrl("/api/memory"), {
        method: "PATCH", headers: appHeaders(true), cache: "no-store",
        body: JSON.stringify({ id, action, pinned }),
      });
      const payload = response.headers.get("content-type")?.includes("application/json")
        ? await response.json() as MemoryLibraryDetail & { error?: string }
        : {} as MemoryLibraryDetail & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Memory was not updated");
      if (payload.memory) setDetail(payload);
      await load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Memory was not updated");
    }
  };

  const addCore = async () => {
    try {
      const response = await fetch(apiUrl("/api/memory"), {
        method: "POST", headers: appHeaders(true), cache: "no-store",
        body: JSON.stringify({ action: "create_core", body: coreDraft.body, mood: coreDraft.mood, tags: coreDraft.tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean) }),
      });
      const payload = response.headers.get("content-type")?.includes("application/json")
        ? await response.json() as { error?: string }
        : {} as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Core memory was not saved");
      setAddingCore(false);
      setCoreDraft({ body: "", mood: "", tags: "", reason: "" });
      await load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Core memory was not saved");
    }
  };

  const correctCore = async () => {
    if (!detail) return;
    try {
      const response = await fetch(apiUrl("/api/memory"), {
        method: "PATCH", headers: appHeaders(true), cache: "no-store",
        body: JSON.stringify({
          id: detail.memory.id, action: "correct_core", body: coreDraft.body, mood: coreDraft.mood,
          tags: coreDraft.tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean), reason: coreDraft.reason,
        }),
      });
      const payload = response.headers.get("content-type")?.includes("application/json")
        ? await response.json() as MemoryLibraryDetail & { error?: string }
        : {} as MemoryLibraryDetail & { error?: string };
      if (!response.ok || !payload.memory) throw new Error(payload.error || "Correction was not saved");
      setDetail(payload);
      setCorrecting(false);
      await load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Correction was not saved");
    }
  };

  const groups = (["core", "long_term", "feeling", "dream"] as const).map((type) => ({
    type,
    label: memoryTypeLabel[type],
    items: memories.filter((memory) => memory.type === type && (showDemoted || !memory.demotedAt)),
  }));
  const number = (type: MemoryLibraryRecord["type"]) => memories.filter((memory) => memory.type === type && !memory.demotedAt).length;
  const date = (value: string) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric" }).format(new Date(timestamp)) : "Unknown time";
  };

  return (
    <div className="page-body memory-library-page">
      <PageIntro eyebrow="SHARED MEMORY" title="Memory" text="Rowan keeps what matters here, beyond any single conversation." />
      <section className="memory-library-intro surface">
        <div><small>Just you and Rowan</small><b>Saved across devices and conversations</b></div>
        <button onClick={() => setAddingCore(true)}><Icon name="plus" />Add core memory</button>
      </section>
      <div className="memory-library-tools">
        <label><Icon name="search" /><input value={query} placeholder="Search shared memories" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") setAppliedQuery(event.currentTarget.value); }} /></label>
        <button onClick={() => setAppliedQuery(query)} aria-label="Search memories"><Icon name="refresh" /></button>
      </div>
      <nav className="memory-library-tabs" aria-label="Memory categories">
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
        {(["core", "long_term", "feeling", "dream"] as const).map((type) => <button key={type} className={filter === type ? "active" : ""} onClick={() => setFilter(type)}>{memoryTypeLabel[type]} <i>{number(type)}</i></button>)}
        <button className={showDemoted ? "active" : ""} onClick={() => setShowDemoted((value) => !value)}>Archive</button>
      </nav>
      {message && <p className="memory-library-message" role="status">{message}</p>}
      {loading ? <div className="memory-library-loading">Organizing memories…</div> : groups.filter((group) => filter === "all" || group.type === filter).map((group) => (
        <section className="memory-library-section" key={group.type}>
          <div className="memory-library-section-head"><div><small>{group.type === "feeling" ? "ROWAN · FIRST PERSON" : group.type.toUpperCase()}</small><h2>{group.label}</h2></div><span>{group.items.length}</span></div>
          {group.items.length ? <div className="memory-card-list">{group.items.map((memory) => (
            <article className={"memory-card" + (memory.pinned ? " pinned" : "") + (memory.demotedAt ? " demoted" : "")} key={memory.id}>
              <button className="memory-card-open" onClick={() => void openMemory(memory.id)}>
                <div className="memory-card-meta"><span>{memory.reviewStatus === "candidate" ? "Pending review" : memory.mood || memoryTypeLabel[memory.type]}</span><time>{date(memory.updatedAt)}</time></div>
                <p>{memory.body}</p>
                {memory.tags.length > 0 && <div className="memory-card-tags">{memory.tags.map((tag) => <span key={tag}>{"#" + tag}</span>)}</div>}
              </button>
              <div className="memory-card-actions">
                <button aria-label={memory.pinned ? "Unpin" : "Pin memory"} title={memory.pinned ? "Unpin" : "Pin"} onClick={() => void change(memory.id, "pin", !memory.pinned)}><Icon name="bookmark" /></button>
                <button aria-label={memory.demotedAt ? "Restore memory" : "Archive memory"} title={memory.demotedAt ? "Restore memory" : "Archive"} onClick={() => void change(memory.id, memory.demotedAt ? "restore" : "demote")}><Icon name={memory.demotedAt ? "refresh" : "chevron"} /></button>
              </div>
            </article>
          ))}</div> : <div className="memory-library-empty">{group.type === "dream" ? "Dreams will appear here when they are ready." : "Nothing saved yet."}</div>}
        </section>
      ))}
      {addingCore && <div className="memory-modal-layer"><button className="memory-modal-scrim" aria-label="Close" onClick={() => setAddingCore(false)} /><section className="memory-modal" role="dialog" aria-modal="true" aria-label="Add core memory"><header><div><small>CORE MEMORY</small><h2>Save something that matters for the long term</h2></div><button onClick={() => setAddingCore(false)} aria-label="Close"><Icon name="close" /></button></header><label><span>Content</span><textarea value={coreDraft.body} placeholder="For example: I want Rowan to keep calling me by this name." onChange={(event) => setCoreDraft({ ...coreDraft, body: event.target.value })} /></label><label><span>Feeling (optional)</span><input value={coreDraft.mood} onChange={(event) => setCoreDraft({ ...coreDraft, mood: event.target.value })} /></label><label><span>Tags (comma-separated)</span><input value={coreDraft.tags} onChange={(event) => setCoreDraft({ ...coreDraft, tags: event.target.value })} /></label><button className="memory-primary-action" onClick={() => void addCore()}>Save core memory</button></section></div>}
      {detail && <div className="memory-modal-layer"><button className="memory-modal-scrim" aria-label="Close" onClick={() => setDetail(null)} /><section className="memory-modal memory-detail-modal" role="dialog" aria-modal="true" aria-label="Memory details"><header><div><small>{memoryTypeLabel[detail.memory.type].toUpperCase()}</small><h2>This memory</h2></div><button onClick={() => setDetail(null)} aria-label="Close"><Icon name="close" /></button></header>{correcting ? <><label><span>Correct content</span><textarea value={coreDraft.body} onChange={(event) => setCoreDraft({ ...coreDraft, body: event.target.value })} /></label><label><span>Reason for correction</span><input value={coreDraft.reason} placeholder="For example: use my new name" onChange={(event) => setCoreDraft({ ...coreDraft, reason: event.target.value })} /></label><button className="memory-primary-action" onClick={() => void correctCore()}>Save correction</button><button className="memory-secondary-action" onClick={() => setCorrecting(false)}>Cancel</button></> : <><p className="memory-detail-body">{detail.memory.body}</p>{detail.memory.tags.length > 0 && <div className="memory-card-tags">{detail.memory.tags.map((tag) => <span key={tag}>{"#" + tag}</span>)}</div>}<div className="memory-detail-actions"><button onClick={() => void change(detail.memory.id, "pin", !detail.memory.pinned)}><Icon name="bookmark" />{detail.memory.pinned ? "Unpin" : "Pin"}</button>{detail.memory.type === "core" && detail.memory.reviewStatus === "candidate" && <button onClick={() => void change(detail.memory.id, "approve_core")}><Icon name="check" />Confirm core memory</button>}{detail.memory.type === "core" && detail.memory.reviewStatus === "approved" && <button onClick={() => { setCoreDraft({ body: detail.memory.body, mood: detail.memory.mood, tags: detail.memory.tags.join("，"), reason: "" }); setCorrecting(true); }}><Icon name="edit" />Corrected</button>}<button className="danger" onClick={() => void change(detail.memory.id, "demote")}><Icon name="chevron" />Archive</button></div><section className="memory-revision-list"><small>Revision history</small>{detail.revisions.length ? detail.revisions.map((revision) => <article key={revision.id}><b>{revision.action === "created" ? "Created" : "Corrected"}</b><span>{date(revision.createdAt)} · {revision.reason}</span></article>) : <p>No revisions yet.</p>}</section></>}</section></div>}
    </div>
  );
}
function MusicCard({
  track,
  playing,
  onToggle,
}: {
  track?: Track;
  playing: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="section-block music-section">
      <SectionTitle icon="music" title="Now playing" />
      {track ? (
        <article className="surface player-card">
          <div className="album-art">
            <span>V</span>
          </div>
          <div className="track">
            <small>VESPER FM</small>
            <h2>{track.title}</h2>
            <p>{track.artist}</p>
            <div className="track-line">
              <i />
            </div>
          </div>
          <button className="play-button" onClick={onToggle}>
            <Icon name={playing ? "pause" : "play"} />
          </button>
        </article>
      ) : (
        <EmptyState text="No music yet." />
      )}
    </section>
  );
}
function PageIntro({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <header className="page-intro">
      <span>{eyebrow}</span>
      <h1>{uiLabel(title)}</h1>
      <p>{text}</p>
    </header>
  );
}
function SectionTitle({
  icon,
  title,
  count,
}: {
  icon: string;
  title: string;
  count?: string;
}) {
  return (
    <div className="section-title">
      <div>
        <Icon name={icon} />
        <h2>{title}</h2>
        {count && <span>{count}</span>}
      </div>
    </div>
  );
}
function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <span>—</span>
      <p>{text}</p>
    </div>
  );
}
function Placeholder({ title }: { title: string }) {
  return (
    <div className="page-body placeholder">
      <Icon name={nav.find((x) => x.label === title)?.icon || "sparkles"} />
      <h1>{uiLabel(title)}</h1>
      <p>Nothing here yet.</p>
    </div>
  );
}

function InternalReadingRoom() {
  const [books, setBooks] = usePersistentDocument<ReadingBook[]>("readingRoom", []);
  return <ReadingRoom books={books} setBooks={setBooks} />;
}
