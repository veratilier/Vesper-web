import { authorizeApp } from "@/lib/bridge-auth";
import { corsHeaders, optionsResponse } from "@/lib/cors";
import { updateStickerCategory } from "@/lib/stickers";
import { memoryScopeFromRequest } from "@/lib/memory";
export const OPTIONS = optionsResponse;
function json(request: Request, value: unknown, status = 200) { const headers = corsHeaders(request); headers.set("cache-control", "no-store"); return Response.json(value, { status, headers }); }
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try { const { id } = await context.params; return json(request, { category: await updateStickerCategory(await memoryScopeFromRequest(request), id, await request.json() as Record<string, unknown>) }); }
  catch (error) { return json(request, { error: error instanceof Error ? error.message : "Could not update category" }, 400); }
}
