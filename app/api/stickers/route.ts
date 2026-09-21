import { authorizeApp } from "@/lib/bridge-auth";
import { corsHeaders, optionsResponse } from "@/lib/cors";
import { listStickerCategories, listStickers, processOneStickerCollection, uploadSticker } from "@/lib/stickers";
import { memoryScopeFromRequest } from "@/lib/memory";

export const OPTIONS = optionsResponse;
function response(request: Request, value: unknown, status = 200) {
  const headers = corsHeaders(request); headers.set("cache-control", "no-store");
  return Response.json(value, { status, headers });
}

export async function GET(request: Request) {
  if (!(await authorizeApp(request))) return response(request, { error: "Device not paired" }, 401);
  try {
    const url = new URL(request.url); const scope = await memoryScopeFromRequest(request);
    await processOneStickerCollection(scope);
    const [stickers, categories] = await Promise.all([
      listStickers(scope, { query: url.searchParams.get("q") || "", categoryId: url.searchParams.get("category") || undefined, favorite: url.searchParams.get("view") === "favorites", recent: url.searchParams.get("view") === "recent", limit: Number(url.searchParams.get("limit") || 48) }),
      listStickerCategories(scope),
    ]);
    return response(request, { stickers, categories });
  } catch (error) { return response(request, { error: error instanceof Error ? error.message : "Could not load stickers" }, 400); }
}

export async function POST(request: Request) {
  if (!(await authorizeApp(request))) return response(request, { error: "Device not paired" }, 401);
  try {
    const data = await request.formData(); const file = data.get("file");
    if (!(file instanceof File)) return response(request, { error: "Choose an image file." }, 400);
    const result = await uploadSticker(await memoryScopeFromRequest(request), new URL(request.url).origin, file, {
      categoryId: data.get("categoryId"), description: data.get("description"), favorite: data.get("favorite") === "true",
    });
    return response(request, result, result.created ? 201 : 200);
  } catch (error) { return response(request, { error: error instanceof Error ? error.message : "Sticker upload failed" }, 400); }
}
