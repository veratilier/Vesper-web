"use client";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { journalMoodLabels } from "@/lib/journal-moods";
export type DiaryEntry = {
  user: string;
  agent: string;
  updatedAt: string;
  moods?: Partial<Record<"user" | "agent", string[]>>;
  moodUsedAt?: Partial<Record<"user" | "agent", Record<string, string>>>;
};
export type DiaryDocument = Record<string, DiaryEntry>;
export const beijingToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export function DiaryBook({
  entries,
  setEntries,
}: {
  entries: DiaryDocument;
  setEntries: Dispatch<SetStateAction<DiaryDocument>>;
}) {
  const [date, setDate] = useState(beijingToday),
    [author, setAuthor] = useState<"user" | "agent">("user");
  const [more, setMore] = useState(false),
    [editing, setEditing] = useState(false);
  useEffect(() => {
    const select = (e: Event) => {
      const value = (e as CustomEvent<string>).detail;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setDate(value);
    };
    window.addEventListener("vesper-diary-date", select);
    return () => window.removeEventListener("vesper-diary-date", select);
  }, []);
  const entry = entries[date],
    selected = entry?.moods?.[author] || [],
    name = author === "user" ? "Vera" : "Rowan";
  const usage: Record<string, string> = {};
  Object.values(entries).forEach((value) =>
    Object.entries(value.moodUsedAt?.[author] || {}).forEach(([id, time]) => {
      if (!usage[id] || time > usage[id]) usage[id] = time;
    }),
  );
  const recent = Object.keys(journalMoodLabels)
    .sort((a, b) => (usage[b] || "").localeCompare(usage[a] || ""))
    .slice(0, 6);
  const toggle = (id: string) =>
    setEntries((current) => {
      const old = current[date] || { user: "", agent: "", updatedAt: "" },
        ids = old.moods?.[author] || [],
        now = new Date().toISOString();
      return {
        ...current,
        [date]: {
          ...old,
          moods: {
            ...old.moods,
            [author]: ids.includes(id)
              ? ids.filter((value) => value !== id)
              : [...ids, id],
          },
          moodUsedAt: {
            ...old.moodUsedAt,
            [author]: { ...old.moodUsedAt?.[author], [id]: now },
          },
          updatedAt: now,
        },
      };
    });
  const mood = (id: string) => (
    <button
      key={id}
      aria-pressed={selected.includes(id)}
      onClick={() => toggle(id)}
    >
      {journalMoodLabels[id]}
    </button>
  );
  const text = entry?.[author] || "",
    heading = text.match(/^#\s+([^\n]+)\n/),
    body = heading ? text.slice(heading[0].length) : text;
  return (
    <div className="page-body diary-book-page">
      <div className="diary-date-controls">
        <label aria-label="Choose month">
          <span>
            {new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}
            ⌄
          </span>
          <input
            type="month"
            value={date.slice(0, 7)}
            onChange={(e) => e.target.value && setDate(`${e.target.value}-01`)}
          />
        </label>
        <button onClick={() => setDate(beijingToday())}>Today</button>
        <button
          className="diary-author-switch"
          title={`Viewing ${name}. Switch author`}
          aria-label={`Switch from ${name} to ${author === "user" ? "Rowan" : "Vera"}`}
          onClick={() => {
            setAuthor(author === "user" ? "agent" : "user");
            setEditing(false);
          }}
        >
          ♙↻
        </button>
      </div>
      <div className="diary-date-rail">
        <button
          aria-label="Previous week"
          onClick={() => setDate(shiftDate(date, -7))}
        >
          ‹
        </button>
        {Array.from({ length: 7 }, (_, i) => shiftDate(date, i - 3)).map(
          (day) => (
            <button
              aria-pressed={day === date}
              key={day}
              onClick={() => setDate(day)}
            >
              <span>
                {new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </span>
              <small>
                {entries[day]?.user || entries[day]?.agent ? "•" : "\u00a0"}
              </small>
            </button>
          ),
        )}
        <button
          aria-label="Next week"
          onClick={() => setDate(shiftDate(date, 7))}
        >
          ›
        </button>
      </div>
      <section className="diary-moods">
        <header>
          <span>{name} · 此刻心情</span>
          <button onClick={() => setMore(true)}>更多</button>
        </header>
        <div className="mood-six">{recent.map(mood)}</div>
      </section>
      <article className="diary-paper" key={`${date}-${author}`}>
        <header>
          <time>
            {new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            })}
          </time>
          <h2>{heading?.[1] || `${name}’s day`}</h2>
        </header>
        <div className="diary-paper-content">
          {editing ? (
            <textarea
              autoFocus
              aria-label="Diary text"
              value={text}
              placeholder="Write about today…"
              onChange={(e) => {
                const value = e.target.value;
                setEntries((current) => ({
                  ...current,
                  [date]: {
                    ...(current[date] || { user: "", agent: "" }),
                    [author]: value,
                    updatedAt: new Date().toISOString(),
                  },
                }));
              }}
            />
          ) : (
            <p>
              {body ||
                (author === "user"
                  ? "A page for your day."
                  : "Rowan has not written about this day yet.")}
            </p>
          )}
        </div>
        <footer>
          <span>{name}</span>
          {author === "user" && (
            <button onClick={() => setEditing(!editing)}>
              {editing ? "Done" : "Write"}
            </button>
          )}
        </footer>
      </article>
      {more && (
        <div className="modal-layer mood-library-layer">
          <button
            className="modal-scrim"
            aria-label="Close mood library"
            onClick={() => setMore(false)}
          />
          <section
            className="mood-library"
            role="dialog"
            aria-modal="true"
            aria-label={`情绪词库 · ${name}`}
          >
            <header>
              <h2>情绪词库 · {name}</h2>
              <button onClick={() => setMore(false)}>Done</button>
            </header>
            <div className="mood-six">
              {Object.keys(journalMoodLabels).map(mood)}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
export function ChatHeatmap({
  active,
  request,
}: {
  active: boolean;
  request: (path: string, signal: AbortSignal) => Promise<Response>;
}) {
  const [month, setMonth] = useState(() => beijingToday().slice(0, 7)),
    [days, setDays] = useState<Record<string, { total: number }> | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let pending = false;
    queueMicrotask(() => {
      if (!controller.signal.aborted) setDays(null);
    });
    const read = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const response = await request(
          `/activity?month=${month}`,
          controller.signal,
        );
        if (!response.ok) throw new Error("Chat statistics unavailable");
        const data = (await response.json()) as {
          month: string;
          days: Record<string, { total: number }>;
        };
        if (!controller.signal.aborted && data.month === month) {
          setDays(data.days);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted) setError("Chat statistics unavailable");
      } finally {
        pending = false;
      }
    };
    void read();
    const timer = setInterval(read, 30000);
    document.addEventListener("visibilitychange", read);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [active, month, request, retry]);
  const first = new Date(`${month}-01T12:00:00Z`),
    offset = (first.getUTCDay() + 6) % 7,
    end = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    ).getUTCDate();
  const change = (n: number) => {
    const d = new Date(first);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <section className="chat-heatmap">
      <header>
        <h2>Our days</h2>
        <button aria-label="Previous month" onClick={() => change(-1)}>
          ‹
        </button>
        <span>
          {first.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </span>
        <button aria-label="Next month" onClick={() => change(1)}>
          ›
        </button>
      </header>
      <div className="heatmap-week">
        {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="heatmap-days">
        {Array.from({ length: Math.ceil((offset + end) / 7) * 7 }, (_, i) => {
          const day = i - offset + 1;
          if (day < 1 || day > end) return <span key={i} />;
          const key = `${month}-${String(day).padStart(2, "0")}`,
            count = days?.[key]?.total || 0,
            level = !count
              ? 0
              : count < 10
                ? 1
                : count < 30
                  ? 2
                  : count < 60
                    ? 3
                    : 4;
          return (
            <div
              key={key}
              className={`heatmap-day level-${level}${key === beijingToday() ? " today" : ""}`}
              aria-label={`${key}: ${days ? count : "Unknown"} messages`}
            >
              <b>{day}</b>
              <small>
                {key > beijingToday() ? "\u00a0" : days ? count : "—"}
              </small>
            </div>
          );
        })}
      </div>
      {error && (
        <button
          className="heatmap-error"
          onClick={() => setRetry((n) => n + 1)}
        >
          {error} · Retry
        </button>
      )}
    </section>
  );
}
