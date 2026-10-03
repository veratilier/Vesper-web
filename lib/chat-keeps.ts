import { env } from 'cloudflare:workers';
import { createChatFile } from './codex-artifacts';
import { linkPhotoSource, saveAlbumPhoto } from './photo-album';

// Only the configured private history service can supply original messages.
export async function historyRead(path: string, body?: unknown) {
  const token = (env as unknown as { VESPER_APP_TOKEN?: string }).VESPER_APP_TOKEN;
  if (!token) throw new Error('History access is unavailable');
  const response = await fetch('https://codex.r-vera.com/history' + path, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000),
  });
  if (response.status >= 300 && response.status < 400) throw new Error('History redirect blocked; screenshot access was not confirmed');
  const data = await response.json() as { error?: string; mimeType?: string; base64?: string; digest?: string; messageIds?: string[]; results?: Record<string, unknown>[]; hasMore?: boolean; messages?: { id: string; metadata?: { attachments?: { key?: string }[] } }[] };
  if (!response.ok) throw new Error(data.error || 'History request failed');
  return data;
}

export async function createChatKeep(owner: string, input: Record<string, unknown>, origin: string) {
  const conversationId = String(input.conversationId || '');
  const messageIds = input.messageIds;
  if (!conversationId || !Array.isArray(messageIds) || !messageIds.length || messageIds.length > 12 || messageIds.some(id => typeof id !== 'string' || !id || id.length > 256)) throw new Error('Choose 1–12 exact message IDs from one real conversation');
  if (input.save === true && (typeof input.evaluation !== 'string' || !input.evaluation.trim())) throw new Error('Write a personal reason for keeping this screenshot');
  const rendered = await historyRead(`/conversations/${encodeURIComponent(conversationId)}/screenshot`, { messageIds, perspective: 'agent' });
  if (rendered.mimeType !== 'image/jpeg' || typeof rendered.base64 !== 'string' || !/^[a-f0-9]{24}$/.test(rendered.digest || '') || !Array.isArray(rendered.messageIds) || rendered.messageIds.join('\0') !== messageIds.join('\0')) throw new Error('Screenshot provenance was not confirmed');
  const file = await createChatFile({ name: `chat-${rendered.digest}.jpg`, mimeType: 'image/jpeg', base64: rendered.base64 }, owner, origin);
  const source = { conversationId, messageId: messageIds[0], messageIds: messageIds as string[] };
  await linkPhotoSource(owner, file.key, source);
  const photo = input.save === true ? await saveAlbumPhoto(owner, file.key, input.category, input.evaluation, origin) : undefined;
  return { attachments: [{ ...file, sourceConversationId: conversationId, sourceMessageId: source.messageId }], source, photo, message: String(input.message || '').slice(0, 2000) };
}

export async function verifyPhotoSource(owner: string, key: string, conversationId: string, messageId: string) {
  const record = await historyRead(`/conversations/${encodeURIComponent(conversationId)}?around=${encodeURIComponent(messageId)}&limit=1`);
  const message = record.messages?.find(row => row.id === messageId);
  if (!message?.metadata?.attachments?.some(item => item.key === key)) throw new Error('Original message does not contain this photo');
  await linkPhotoSource(owner, key, { conversationId, messageId, messageIds: [messageId] });
}
