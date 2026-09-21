import { authorizeApp } from "@/lib/bridge-auth";
import { corsHeaders, optionsResponse } from "@/lib/cors";
import { importAttachmentAsSticker } from "@/lib/stickers";
import { memoryScopeFromRequest } from "@/lib/memory";
export const OPTIONS = optionsResponse;
function json(request: Request, value: unknown, status = 200) { const headers = corsHeaders(request); headers.set("cache-control", "no-store"); return Response.json(value, { status, headers }); }
export async function POST(request: Request) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try { const body = await request.json() as Record<string, unknown>; const result = await importAttachmentAsSticker(await memoryScopeFromRequest(request), new URL(request.url).origin, body); return json(request, result, result.created ? 201 : 200); }
  catch (error) { return json(request, { error: error instanceof Error ? error.message : "Could not save as sticker" }, 400); }
}
