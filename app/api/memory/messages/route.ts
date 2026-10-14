import { recordEvidence } from '@/lib/memory-vault';
import { recordMemoryMessage } from '@/lib/memory';
import { optionsResponse } from '@/lib/cors';
import { appRoute, APIError } from '@/lib/backend/http';
export const OPTIONS = optionsResponse;
export const POST = appRoute({ service: 'memory', methods: ['POST'], errorMessage: 'Could not save memory context' }, async context => {
  const body = await context.request.json() as { conversationId?: string; messageId?: string; role?: "user" | "agent"; content?: string; createdAt?: string; turnId?: string; attachments?: unknown };
  if (body?.role !== 'user' && body?.role !== 'agent') throw new APIError('Invalid message role');
  const scope = await context.scope();
  const message = { conversationId: body.conversationId || '', messageId: body.messageId || '', role: body.role, content: body.content || '', createdAt: body.createdAt, turnId: body.turnId };
  const result = body.content?.trim() ? await recordMemoryMessage(scope, message) : { ok: true };
  const evidenceId = await recordEvidence(scope, { ...message, attachments: body.attachments });
  return context.json({ ...result, evidenceId }, 201);
});
