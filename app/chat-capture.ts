/** A read-only view of the real chat page, used by the VPS browser. */
export function chatCaptureRequest() {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  if (query.get('capture') !== 'agent') return null;
  const conversationId = query.get('conversation') || '';
  const messageIds = query.getAll('message');
  if (!conversationId || conversationId.length > 256 || !messageIds.length || messageIds.length > 12 ||
      messageIds.some(id => !id || id.length > 256) || new Set(messageIds).size !== messageIds.length) return null;
  return { conversationId, messageIds };
}
