import { recordEvidence } from "@/lib/memory-vault";
import { authorizeApp } from "@/lib/bridge-auth";
import { memoryScopeFromRequest, recordMemoryMessage } from "@/lib/memory";
import { corsHeaders, optionsResponse } from "@/lib/cors";

function json(request: Request, value: unknown, status = 200) {
  const headers = corsHeaders(request);
  headers.set("cache-control", "no-store");
  return Response.json(value, { status, headers });
}

export const OPTIONS = optionsResponse;

export async function POST(request: Request) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try {
    const body = await request.json() as { conversationId?: string; messageId?: string; role?: "user" | "agent"; content?: string; createdAt?: string; turnId?: string; attachments?: unknown };
    if (body.role !== "user" && body.role !== "agent") return json(request, { error: "Invalid message role" }, 400);
    const result = body.content?.trim() ? await recordMemoryMessage(await memoryScopeFromRequest(request), {
      conversationId: body.conversationId || "", messageId: body.messageId || "", role: body.role,
      content: body.content || "", createdAt: body.createdAt, turnId: body.turnId,
    }) : { ok: true };
    const evidenceId = await recordEvidence(await memoryScopeFromRequest(request), { conversationId: body.conversationId || "", messageId: body.messageId || "", role: body.role, content: body.content || "", createdAt: body.createdAt, attachments: body.attachments });
    return json(request, { ...result, evidenceId }, 201);
  } catch (reason) {
    return json(request, { error: reason instanceof Error ? reason.message : "Could not save memory context" }, 400);
  }
}
