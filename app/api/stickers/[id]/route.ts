import { authorizeApp } from "@/lib/bridge-auth";
import { corsHeaders, optionsResponse } from "@/lib/cors";
import { deleteSticker, stickerForUse, updateSticker } from "@/lib/stickers";
import { memoryScopeFromRequest } from "@/lib/memory";
export const OPTIONS = optionsResponse;
function json(request: Request, value: unknown, status = 200) { const headers = corsHeaders(request); headers.set("cache-control", "no-store"); return Response.json(value, { status, headers }); }
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try { const { id } = await context.params; const body = await request.json() as Record<string, unknown>; return json(request, { sticker: await updateSticker(await memoryScopeFromRequest(request), id, body) }); }
  catch (error) { return json(request, { error: error instanceof Error ? error.message : "Could not update sticker" }, 400); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try { const { id } = await context.params; const body = await request.json().catch(() => ({})) as { action?: unknown }; if (body.action !== "use") return json(request, { error: "Unsupported action" }, 400); return json(request, { sticker: await stickerForUse(await memoryScopeFromRequest(request), id) }); }
  catch (error) { return json(request, { error: error instanceof Error ? error.message : "Could not record sticker" }, 400); }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try { const { id } = await context.params; return json(request, await deleteSticker(await memoryScopeFromRequest(request), id)); }
  catch (error) { return json(request, { error: error instanceof Error ? error.message : "Could not delete sticker" }, 400); }
}
