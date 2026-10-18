"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
export type MessageAction = {
  label: string;
  run: () => void;
  disabled?: boolean;
};
export function MessagePopover({
  children,
  actions,
  className = "",
}: {
  children: ReactNode;
  actions: MessageAction[];
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    origin = useRef({ x: 0, y: 0 }),
    held = useRef(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const open = () => {
    cancel();
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    held.current = true;
    setPosition({
      left: Math.max(
        12,
        Math.min(
          rect.left,
          window.innerWidth - Math.min(420, window.innerWidth - 24) - 12,
        ),
      ),
      top: rect.top >= 70 ? rect.top - 60 : rect.bottom + 8,
    });
  };
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null),
      key = (e: KeyboardEvent) => {
        if (e.key === "Escape") close();
      };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", key);
    };
  }, [position]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div
      ref={root}
      className={`message-popover-target ${className}${position ? " message-lifted" : ""}`}
      tabIndex={0}
      aria-haspopup="menu"
      onContextMenu={(e) => {
        e.preventDefault();
        open();
      }}
      onKeyDown={(e) => {
        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          e.preventDefault();
          open();
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        held.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        cancel();
        timer.current = setTimeout(open, 420);
      }}
      onPointerMove={(e) => {
        if (
          Math.hypot(
            e.clientX - origin.current.x,
            e.clientY - origin.current.y,
          ) > 12
        )
          cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onClickCapture={(e) => {
        if (
          held.current &&
          !(e.target as HTMLElement).closest(".message-menu-layer")
        ) {
          e.preventDefault();
          e.stopPropagation();
          held.current = false;
        }
      }}
    >
      {children}
      {position &&
        createPortal(
          <div className="message-menu-layer">
            <button
              className="message-menu-scrim"
              aria-label="Dismiss message actions"
              onClick={() => setPosition(null)}
            />
            <div
              className="message-floating-menu"
              role="menu"
              aria-label="Message actions"
              style={position}
            >
              {actions.map((action) => (
                <button
                  key={action.label}
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => {
                    setPosition(null);
                    held.current = false;
                    action.run();
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
export function VoiceMessageBar({
  item,
  actions,
}: {
  item: {
    url: string;
    name: string;
    duration?: number;
    transcript?: string;
    translation?: { sourceText?: string; target?: string; text?: string };
  };
  actions?: MessageAction[];
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false),
    [duration, setDuration] = useState(item.duration || 0),
    [expanded, setExpanded] = useState(false),
    [translationOpen, setTranslationOpen] = useState(false),
    [localTranslation, setLocalTranslation] = useState({
      source: "",
      text: "",
    }),
    [error, setError] = useState(""),
    [translating, setTranslating] = useState(false);
  const cached =
    item.translation?.sourceText === item.transcript &&
    item.translation?.target === "zh-Hans"
      ? item.translation.text || ""
      : "";
  const translated =
    localTranslation.source === item.transcript
      ? localTranslation.text || cached
      : cached;
  const setTranslated = (text: string) =>
    setLocalTranslation({ source: item.transcript || "", text });
  const translate = async () => {
    setTranslationOpen(!translationOpen);
    if (translated || translationOpen) return;
    if (!item.transcript) {
      setError(
        "这条语音还没有文字稿。网页版暂时无法转录此音频，请在手机端转文字后同步。",
      );
      return;
    }
    if (/^[\p{Script=Han}\p{P}\p{N}\s]+$/u.test(item.transcript)) {
      setTranslated(item.transcript);
      return;
    }
    // Browsers may offer local language identification/translation. Never upload audio implicitly.
    type Translator = {
      translate: (s: string) => Promise<string>;
      destroy: () => void;
    };
    const apis = globalThis as unknown as {
      LanguageDetector?: {
        create: () => Promise<{
          detect: (s: string) => Promise<{ detectedLanguage: string }[]>;
          destroy: () => void;
        }>;
      };
      Translator?: {
        create: (o: {
          sourceLanguage: string;
          targetLanguage: string;
        }) => Promise<Translator>;
      };
    };
    if (!apis.LanguageDetector || !apis.Translator) {
      setError("此浏览器不支持本地翻译。手机端保存的译文可以在这里查看。");
      return;
    }
    setTranslating(true);
    setError("");
    let translator: Translator | undefined;
    try {
      const detector = await apis.LanguageDetector.create();
      let language: string;
      try {
        language = (await detector.detect(item.transcript))[0].detectedLanguage;
      } finally {
        detector.destroy();
      }
      if (language.startsWith("zh")) setTranslated(item.transcript);
      else {
        translator = await apis.Translator.create({
          sourceLanguage: language,
          targetLanguage: "zh",
        });
        setTranslated(await translator.translate(item.transcript));
      }
    } catch {
      setError("翻译暂时不可用，请重试。");
    } finally {
      translator?.destroy();
      setTranslating(false);
    }
  };
  return (
    <div className="voice-message-wrap">
      <MessagePopover
        actions={[
          ...(actions || []),
          {
            label: expanded ? "收起文字" : "转文字",
            run: () => setExpanded(!expanded),
          },
          {
            label: translationOpen ? "收起翻译" : "翻译",
            run: () => void translate(),
          },
        ]}
      >
        <button
          className="voice-message-bar"
          aria-label={playing ? "Pause voice message" : "Play voice message"}
          onClick={() => {
            if (playing) audio.current?.pause();
            else
              void audio.current
                ?.play()
                .catch(() => setError("音频无法播放，请重试。"));
          }}
        >
          <span>{playing ? "Ⅱ" : "▶"}</span>
          <span className="voice-wave" aria-hidden="true">
            ▂▅▃▇▅▂▆▄▇▃▅▂
          </span>
          <span>{duration ? `${Math.round(duration)}″` : "Voice"}</span>
        </button>
      </MessagePopover>
      <audio
        ref={audio}
        src={item.url}
        preload="metadata"
        onLoadedMetadata={(e) =>
          setDuration(
            Number.isFinite(e.currentTarget.duration)
              ? e.currentTarget.duration
              : 0,
          )
        }
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      {expanded && (
        <div className="voice-transcript">
          <b>原文</b>
          <p>
            {item.transcript || "尚无文字稿。可在手机端转文字后同步到网页。"}
          </p>
        </div>
      )}
      {translationOpen && (
        <div className="voice-transcript">
          <b>中文翻译</b>
          <p>{translating ? "正在翻译…" : translated || error}</p>
        </div>
      )}
      {error && !translationOpen && (
        <details className="voice-error">
          <summary aria-label="Voice message details">ⓘ</summary>
          {error}
        </details>
      )}
    </div>
  );
}
