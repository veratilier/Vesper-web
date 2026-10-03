export type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
export type SpeechSession = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

// Each listening period owns one recognizer. A stopped recognizer can still emit
// callbacks; identity checks and detached handlers keep those out of later turns.
export function createVoiceRecognition(options: {
  create: () => SpeechSession;
  canListen: () => boolean;
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onError: (message: string) => void;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let current: SpeechSession | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let failures = 0;
  const clearTimer = () => { if (timer !== null) cancel(timer); timer = null; };
  const release = () => {
    const session = current;
    current = null;
    if (!session) return;
    session.onresult = null; session.onend = null; session.onerror = null;
    try { if (session.abort) session.abort(); else session.stop(); } catch { /* already ended */ }
  };
  const fail = (message: string) => {
    clearTimer(); release(); options.onError(message);
  };
  const resume = () => {
    if (closed || !options.canListen() || current || timer !== null) return;
    timer = schedule(() => {
      timer = null;
      if (closed || !options.canListen() || current) return;
      let session: SpeechSession;
      try { session = options.create(); } catch { fail('Could not initialize speech recognition.'); return; }
      current = session;
      session.lang = 'en-US'; session.continuous = false; session.interimResults = true;
      session.onresult = event => {
        if (closed || current !== session || !options.canListen()) return;
        let final = '', interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) final += result[0].transcript; else interim += result[0].transcript;
        }
        if (final.trim()) {
          failures = 0; clearTimer(); release(); options.onFinal(final.trim());
        } else if (interim) { failures = 0; options.onInterim(interim); }
      };
      session.onend = () => {
        if (current !== session) return;
        release(); resume();
      };
      session.onerror = event => {
        if (current !== session) return;
        release();
        if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error || '')) {
          fail('Speech recognition needs microphone permission. Check browser permissions, then restart the call.');
        } else if (event.error === 'no-speech' || event.error === 'aborted') {
          resume();
        } else if (++failures <= 5) { resume(); }
        else { fail('Speech recognition could not reconnect. Please restart the call.'); }
      };
      try { session.start(); }
      catch {
        release();
        if (++failures <= 5) resume();
        else fail('Speech recognition could not restart. Please restart the call.');
      }
    }, 200);
  };
  return {
    resume,
    suspend() { clearTimer(); release(); },
    close() { closed = true; clearTimer(); release(); },
  };
}
