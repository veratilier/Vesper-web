import { authorizeApp } from "@/lib/bridge-auth";
import { corsHeaders, optionsResponse } from "@/lib/cors";
import { readStickerSettings, updateStickerSettings } from "@/lib/stickers";
import { memoryScopeFromRequest } from "@/lib/memory";
export const OPTIONS = optionsResponse;
function json(request: Request, value: unknown, status = 200) { const headers = corsHeaders(request); headers.set("cache-control", "no-store"); return Response.json(value, { status, headers }); }
export async function GET(request: Request) { if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401); return json(request, { settings: await readStickerSettings(await memoryScopeFromRequest(request)) }); }
export async function PATCH(request: Request) { if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401); try { return json(request, { settings: await updateStickerSettings(await memoryScopeFromRequest(request), await request.json() as Record<string, unknown>) }); } catch (error) { return json(request, { error: error instanceof Error ? error.message : "Could not update settings" }, 400); } }
