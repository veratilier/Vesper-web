import { createChatFile } from './codex-artifacts';
import { historyRead } from './chat-keeps';

type Context = { conversationId?: string; threadId?: string; origin?: string };
export async function deliverChatFiles(input: Record<string, unknown>, owner: string, context: Context) {
  if (!context.conversationId || !context.origin) throw new Error('Conversation context required');
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > 8) throw new Error('Send between 1 and 8 files');
  if (JSON.stringify(input.files).length > 12 * 1024 * 1024) throw new Error('Attachment batch too large');
  const attachments = [];
  for (const value of input.files) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid file');
    let file = value as Record<string, unknown>;
    if (file.path !== undefined) {
      if (typeof file.path !== 'string' || !file.path || !context.threadId || file.text !== undefined || file.base64 !== undefined) throw new Error('Supply a generated image path OR text/base64, with the current chat context');
      const image = await historyRead(`/conversations/${encodeURIComponent(context.conversationId)}/generated-image`, { threadId: context.threadId, path: file.path });
      if (typeof image.base64 !== 'string' || !image.base64 || !/^image\/(png|jpeg|gif|webp)$/.test(image.mimeType || '') || !/^[a-f0-9]{64}$/.test(image.digest || '')) throw new Error('Generated image transfer was not confirmed');
      // MIME comes from real file bytes, never from an invented extension.
      file = { name: file.name, mimeType: image.mimeType, base64: image.base64 };
    }
    attachments.push(await createChatFile(file, owner, context.origin));
  }
  return { attachments, message: String(input.message || '').slice(0, 2000) };
}
