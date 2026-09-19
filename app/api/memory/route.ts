import { evidenceFor, linkEvidence, recordEvidence } from "@/lib/memory-vault";
import { authorizeApp } from "@/lib/bridge-auth";
import {
  correctCoreMemory,
  editMemory,
  createMemory,
  listMemories,
  memoryDetail,
  memoryScopeFromRequest,
  type MemoryType,
  updateMemoryState,
} from "@/lib/memory";
import { corsHeaders, optionsResponse } from "@/lib/cors";

function json(request: Request, value: unknown, status = 200) {
  const headers = corsHeaders(request);
  headers.set("cache-control", "no-store");
  return Response.json(value, { status, headers });
}

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : "The memory service is unavailable.";
}

export const OPTIONS = optionsResponse;

export async function GET(request: Request) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try {
    const scope = await memoryScopeFromRequest(request);
    const url = new URL(request.url);
    if (url.searchParams.get("view") === "vault") return json(request, { evidence: await evidenceFor(scope) });
    const id = url.searchParams.get("id")?.trim();
    if (id) {
      const detail = await memoryDetail(scope, id);
      return detail ? json(request, { ...detail, evidence: await evidenceFor(scope, id) }) : json(request, { error: "Memory not found" }, 404);
    }
    const type = url.searchParams.get("type")?.trim() as MemoryType | undefined;
    const validType = ["core", "long_term", "feeling", "dream"].includes(type || "") ? type : undefined;
    const memories = await listMemories(scope, {
      type: validType,
      query: url.searchParams.get("q") || "",
      includeDemoted: url.searchParams.get("includeDemoted") === "1",
      includeCandidates: url.searchParams.get("includeCandidates") === "1",
      limit: Number(url.searchParams.get("limit") || 120),
    });
    return json(request, { memories, scope: { characterId: scope.characterId } });
  } catch (reason) {
    return json(request, { error: errorText(reason) }, 500);
  }
}

export async function POST(request: Request) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try {
    const body = await request.json() as { action?: string; body?: string; mood?: string; tags?: unknown; evidenceIds?: string[] };
    if (body.action !== "create_core") return json(request, { error: "Unsupported memory action" }, 400);
    const result = await createMemory(await memoryScopeFromRequest(request), {
      type: "core", body: body.body || "", mood: body.mood || "", tags: body.tags,
      source: "user-core-entry", reviewStatus: "approved",
    });
    if (!body.evidenceIds?.length) {
      const scope = await memoryScopeFromRequest(request);
      const original = await recordEvidence(scope, { conversationId: "manual-memory", messageId: result.memory.id,
        role: "user", content: body.body || "", createdAt: new Date().toISOString() });
      await linkEvidence(scope, result.memory.id, [original]);
    }
    if (Array.isArray(body.evidenceIds)) await linkEvidence(await memoryScopeFromRequest(request), result.memory.id, body.evidenceIds.filter(x => typeof x === "string"));
    return json(request, result, result.created ? 201 : 200);
  } catch (reason) {
    return json(request, { error: errorText(reason) }, 400);
  }
}

export async function PATCH(request: Request) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try {
    const body = await request.json() as {
      id?: string; action?: "pin" | "demote" | "restore" | "approve_core" | "correct_core" | "correct";
      pinned?: boolean; body?: string; mood?: string; tags?: unknown; reason?: string;
    };
    if (!body.id || !body.action) return json(request, { error: "Missing memory action" }, 400);
    const scope = await memoryScopeFromRequest(request);
    if (body.action === "correct_core" || body.action === "correct") {
      const operation = body.action === "correct_core" ? correctCoreMemory : editMemory;
      const detail = await operation(scope, body.id, { body: body.body || "", mood: body.mood, tags: body.tags, reason: body.reason });
      return json(request, detail);
    }
    const detail = await updateMemoryState(scope, body.id, body.action, body.pinned);
    return json(request, detail);
  } catch (reason) {
    return json(request, { error: errorText(reason) }, 400);
  }
}
