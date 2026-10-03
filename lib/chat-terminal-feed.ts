export type TerminalFrame = { conversationId?: string; screen?: string; running?: boolean; error?: string };
type FeedOptions = {
  conversationId: string;
  request: (signal: AbortSignal) => Promise<Response>;
  onFrame: (frame: TerminalFrame) => void;
  onError: (error: string) => void;
  onHidden: () => void;
  visibility?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  interval?: number;
};
// Serial foreground polling of a live pane; never replay archived command logs.
export function startTerminalFeed({ conversationId, request, onFrame, onError, onHidden, visibility = document, interval = 500 }: FeedOptions) {
  const controller = new AbortController();
  const hidden = () => visibility.visibilityState === 'hidden';
  let timer: ReturnType<typeof setTimeout> | undefined, loading = false;
  const poll = async () => {
    if (loading || controller.signal.aborted || hidden()) return;
    loading = true;
    let delay = interval;
    try {
      const response = await request(AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
      const payload = await response.json() as TerminalFrame;
      if (!response.ok) throw new Error(payload.error || `Terminal unavailable (${response.status}).`);
      if (payload.conversationId !== conversationId) throw new Error('The server returned another conversation’s terminal.');
      if (!controller.signal.aborted && !hidden()) onFrame(payload);
    } catch (reason) {
      delay = Math.max(interval, 2000);
      if (!controller.signal.aborted) onError(reason instanceof Error ? reason.message : 'Terminal disconnected.');
    } finally {
      loading = false;
      if (!controller.signal.aborted) timer = setTimeout(poll, delay);
    }
  };
  const wake = () => { clearTimeout(timer); if (hidden()) onHidden(); else void poll(); };
  void poll(); visibility.addEventListener('visibilitychange', wake);
  return () => { controller.abort(); clearTimeout(timer); visibility.removeEventListener('visibilitychange', wake); };
}
