import { authorizeApp } from "@/lib/bridge-auth";
import { corsHeaders, optionsResponse } from "@/lib/cors";
import { createStickerCategory, listStickerCategories } from "@/lib/stickers";
import { memoryScopeFromRequest } from "@/lib/memory";
export const OPTIONS = optionsResponse;
function json(request: Request, value: unknown, status = 200) { const headers = corsHeaders(request); headers.set("cache-control", "no-store"); return Response.json(value, { status, headers }); }
export async function GET(request: Request) { if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401); return json(request, { categories: await listStickerCategories(await memoryScopeFromRequest(request)) }); }
export async function POST(request: Request) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try { const body = await request.json() as Record<string, unknown>; return json(request, { category: await createStickerCategory(await memoryScopeFromRequest(request), body) }, 201); }
  catch (error) { return json(request, { error: error instanceof Error ? error.message : "Could not create category" }, 400); }
}
