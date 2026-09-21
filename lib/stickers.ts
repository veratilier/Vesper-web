import { env } from "cloudflare:workers";
import { ensureSchema, getDb } from "@/lib/db";
import { type MemoryScope } from "@/lib/memory";
import { inspectStickerImage, STICKER_IMAGE_TYPES, validateStickerImage, type StickerImageInfo } from "@/lib/sticker-validation";

export const STICKER_CONFIG = {
  allowedTypes: STICKER_IMAGE_TYPES,
  maxBytes: 12 * 1024 * 1024,
  maxPixels: 24_000_000,
  maxSearchResults: 48,
  maxDescriptionLength: 280,
  maxNameLength: 80,
  maxAgentStickersPerTurn: 1,
  agentCooldownSeconds: 90,
  maxAutoCollectBytes: 3 * 1024 * 1024,
  characterId: "rowan",
} as const;

export type StickerCategory = { id: string; name: string; description: string; sortOrder: number };
export type StickerAsset = {
  id: string; assetId: string; url: string; width: number; height: number; mimeType: string; name: string; alt: string;
  categoryId: string | null; category: string; description: string; favorite: boolean;
  source: string; createdAt: string; lastUsedAt: string | null; useCount: number; status: string;
};
type AssetRow = {
  id: string; r2_key: string; url: string; sha256: string; width: number; height: number; mime_type: string;
  file_name: string; category_id: string | null; category_name: string | null; description: string;
  favorite: number; source: string; status: string; created_at: string; last_used_at: string | null; use_count: number;
};

function bucket(): R2Bucket { return (env as unknown as { MEDIA: R2Bucket }).MEDIA; }
function now() { return new Date().toISOString(); }
function text(value: unknown, max: number) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }

function assetFromRow(row: AssetRow): StickerAsset {
  return {
    id: row.id, assetId: row.id, url: row.url, width: Number(row.width), height: Number(row.height), mimeType: row.mime_type,
    name: row.file_name, alt: row.description || row.file_name, categoryId: row.category_id, category: row.category_name || "未分类",
    description: row.description, favorite: Boolean(row.favorite), source: row.source, status: row.status,
    createdAt: row.created_at, lastUsedAt: row.last_used_at || null, useCount: Number(row.use_count) || 0,
  };
}

async function bytesHash(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateImage(info: StickerImageInfo) { validateStickerImage(info, STICKER_CONFIG.maxPixels); }

async function categoryExists(scope: MemoryScope, id: string | null) {
  if (!id) return null;
  const row = await getDb().prepare("SELECT id FROM vesper_sticker_categories WHERE id=? AND user_id=? AND character_id=?")
    .bind(id, scope.userId, scope.characterId).first<{ id: string }>();
  if (!row) throw new Error("Selected category not found");
  return id;
}

async function findAsset(scope: MemoryScope, id: string, includeInactive = false) {
  const row = await getDb().prepare(`SELECT a.*, c.name AS category_name FROM vesper_sticker_assets a
    LEFT JOIN vesper_sticker_categories c ON c.id=a.category_id
    WHERE a.id=? AND a.user_id=? AND a.character_id=? ${includeInactive ? "" : "AND a.status='active'"}`)
    .bind(id, scope.userId, scope.characterId).first<AssetRow>();
  return row || null;
}

export async function listStickerCategories(scope: MemoryScope) {
  await ensureSchema();
  const rows = await getDb().prepare("SELECT id,name,description,sort_order FROM vesper_sticker_categories WHERE user_id=? AND character_id=? ORDER BY sort_order,name")
    .bind(scope.userId, scope.characterId).all<{ id: string; name: string; description: string; sort_order: number }>();
  return rows.results.map((row) => ({ id: row.id, name: row.name, description: row.description, sortOrder: Number(row.sort_order) || 0 }));
}

export async function listStickers(scope: MemoryScope, options: { query?: string; categoryId?: string; favorite?: boolean; recent?: boolean; includeInactive?: boolean; limit?: number } = {}) {
  await ensureSchema();
  const query = text(options.query, 120).toLowerCase();
  const clauses = ["a.user_id=?", "a.character_id=?"];
  const values: unknown[] = [scope.userId, scope.characterId];
  if (!options.includeInactive) clauses.push("a.status='active'");
  if (options.categoryId) { clauses.push("a.category_id=?"); values.push(options.categoryId); }
  if (options.favorite) clauses.push("a.favorite=1");
  if (query) { clauses.push("(lower(a.file_name) LIKE ? OR lower(a.description) LIKE ? OR lower(COALESCE(c.name,'')) LIKE ?)"); values.push(`%${query}%`, `%${query}%`, `%${query}%`); }
  const sort = options.recent ? "CASE WHEN a.last_used_at IS NULL THEN 1 ELSE 0 END, a.last_used_at DESC, a.created_at DESC" : "a.favorite DESC, a.created_at DESC";
  const limit = Math.min(STICKER_CONFIG.maxSearchResults, Math.max(1, Number(options.limit || STICKER_CONFIG.maxSearchResults)));
  values.push(limit);
  const rows = await getDb().prepare(`SELECT a.*,c.name AS category_name FROM vesper_sticker_assets a LEFT JOIN vesper_sticker_categories c ON c.id=a.category_id WHERE ${clauses.join(" AND ")} ORDER BY ${sort} LIMIT ?`)
    .bind(...values).all<AssetRow>();
  return rows.results.map(assetFromRow);
}

export async function createStickerCategory(scope: MemoryScope, input: { name?: unknown; description?: unknown; sortOrder?: unknown }) {
  await ensureSchema();
  const name = text(input.name, 48); if (!name) throw new Error("Category name is required.");
  const timestamp = now(); const id = crypto.randomUUID();
  await getDb().prepare(`INSERT INTO vesper_sticker_categories(id,user_id,character_id,name,description,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(id, scope.userId, scope.characterId, name, text(input.description, 180), Number(input.sortOrder) || 0, timestamp, timestamp).run();
  return { id, name, description: text(input.description, 180), sortOrder: Number(input.sortOrder) || 0 };
}

export async function updateStickerCategory(scope: MemoryScope, id: string, input: { name?: unknown; description?: unknown; sortOrder?: unknown }) {
  const current = (await listStickerCategories(scope)).find((category) => category.id === id);
  if (!current) throw new Error("Category not found");
  const name = input.name === undefined ? current.name : text(input.name, 48);
  if (!name) throw new Error("Category name is required.");
  const description = input.description === undefined ? current.description : text(input.description, 180);
  const sortOrder = input.sortOrder === undefined ? current.sortOrder : Number(input.sortOrder) || 0;
  await getDb().prepare("UPDATE vesper_sticker_categories SET name=?,description=?,sort_order=?,updated_at=? WHERE id=? AND user_id=? AND character_id=?")
    .bind(name, description, sortOrder, now(), id, scope.userId, scope.characterId).run();
  return { id, name, description, sortOrder };
}

export async function uploadSticker(scope: MemoryScope, requestOrigin: string, file: File, input: { categoryId?: unknown; description?: unknown; favorite?: unknown; source?: string; sourceConversationId?: string; sourceMessageId?: string } = {}) {
  await ensureSchema();
  if (file.size <= 0 || file.size > STICKER_CONFIG.maxBytes) throw new Error("Sticker size must be between 1 B and 12 MB.");
  const bytes = await file.arrayBuffer(); const image = inspectStickerImage(bytes); validateImage(image);
  const sha256 = await bytesHash(bytes);
  const categoryId = await categoryExists(scope, text(input.categoryId, 80) || null);
  const name = text(file.name, STICKER_CONFIG.maxNameLength) || `sticker.${image.extension}`;
  const description = text(input.description, STICKER_CONFIG.maxDescriptionLength);
  const favorite = input.favorite === true ? 1 : 0;
  const source = text(input.source, 32) || "upload";
  const timestamp = now();
  const existing = await getDb().prepare("SELECT a.*,c.name AS category_name FROM vesper_sticker_assets a LEFT JOIN vesper_sticker_categories c ON c.id=a.category_id WHERE a.user_id=? AND a.character_id=? AND a.sha256=?")
    .bind(scope.userId, scope.characterId, sha256).first<AssetRow>();
  if (existing?.status === "active") return { created: false, duplicate: true, sticker: assetFromRow(existing) };
  if (existing?.status === "deleting") throw new Error("This sticker is being deleted. Try again later.");
  if (existing?.status === "deleted") {
    // The unique hash is intentionally retained for deduplication. A deliberate
    // re-upload of the exact same image is the user's explicit request to restore
    // it, not an invisible duplicate.
    await bucket().put(existing.r2_key, bytes, { httpMetadata: { contentType: image.mimeType, cacheControl: "private, max-age=86400" } });
    await getDb().prepare(`UPDATE vesper_sticker_assets SET url=?,width=?,height=?,mime_type=?,file_name=?,category_id=?,description=?,favorite=?,source=?,source_conversation_id=?,source_message_id=?,status='active',deleted_at=NULL,updated_at=? WHERE id=? AND user_id=? AND character_id=?`).bind(
      `${requestOrigin}/api/stickers/assets/${existing.id}`, image.width, image.height, image.mimeType, name, categoryId, description, favorite, source,
      input.sourceConversationId || null, input.sourceMessageId || null, timestamp, existing.id, scope.userId, scope.characterId,
    ).run();
    const restored = await findAsset(scope, existing.id, true); if (!restored) throw new Error("Could not restore sticker");
    return { created: true, duplicate: false, sticker: assetFromRow(restored) };
  }
  const id = crypto.randomUUID();
  const key = `stickers/${id}.${image.extension}`;
  const url = `${requestOrigin}/api/stickers/assets/${id}`;
  await bucket().put(key, bytes, { httpMetadata: { contentType: image.mimeType, cacheControl: "private, max-age=86400" } });
  try {
    await getDb().prepare(`INSERT INTO vesper_sticker_assets(id,user_id,character_id,r2_key,url,sha256,width,height,mime_type,file_name,category_id,description,favorite,source,source_conversation_id,source_message_id,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      id, scope.userId, scope.characterId, key, url, sha256, image.width, image.height, image.mimeType, name, categoryId,
      description, favorite, source,
      input.sourceConversationId || null, input.sourceMessageId || null, "active", timestamp, timestamp,
    ).run();
  } catch (error) { await bucket().delete(key); throw error; }
  const sticker = await findAsset(scope, id, true); if (!sticker) throw new Error("Could not save sticker");
  return { created: true, duplicate: false, sticker: assetFromRow(sticker) };
}

export async function updateSticker(scope: MemoryScope, id: string, input: { description?: unknown; categoryId?: unknown; favorite?: unknown; name?: unknown }) {
  const current = await findAsset(scope, id, true); if (!current || current.status === "deleted") throw new Error("Sticker not found");
  const categoryId = input.categoryId === undefined ? current.category_id : await categoryExists(scope, text(input.categoryId, 80) || null);
  const name = input.name === undefined ? current.file_name : text(input.name, STICKER_CONFIG.maxNameLength);
  if (!name) throw new Error("Sticker name is required.");
  const description = input.description === undefined ? current.description : text(input.description, STICKER_CONFIG.maxDescriptionLength);
  const favorite = input.favorite === undefined ? current.favorite : input.favorite === true ? 1 : 0;
  await getDb().prepare("UPDATE vesper_sticker_assets SET file_name=?,description=?,category_id=?,favorite=?,updated_at=? WHERE id=? AND user_id=? AND character_id=?")
    .bind(name, description, categoryId, favorite, now(), id, scope.userId, scope.characterId).run();
  const row = await findAsset(scope, id, true); if (!row) throw new Error("Could not update sticker"); return assetFromRow(row);
}

export async function deleteSticker(scope: MemoryScope, id: string) {
  const current = await findAsset(scope, id, true); if (!current || current.status === "deleted") throw new Error("Sticker not found");
  const timestamp = now();
  await getDb().prepare("UPDATE vesper_sticker_assets SET status='deleting',updated_at=? WHERE id=? AND user_id=? AND character_id=?")
    .bind(timestamp, id, scope.userId, scope.characterId).run();
  try { await bucket().delete(current.r2_key); }
  catch (error) { await getDb().prepare("UPDATE vesper_sticker_assets SET status='active',updated_at=? WHERE id=?").bind(now(), id).run(); throw error; }
  await getDb().prepare("UPDATE vesper_sticker_assets SET status='deleted',deleted_at=?,updated_at=? WHERE id=? AND user_id=? AND character_id=?")
    .bind(timestamp, timestamp, id, scope.userId, scope.characterId).run();
  return { deleted: true };
}

export async function stickerForUse(scope: MemoryScope, id: string, recordUse = true) {
  const row = await findAsset(scope, id); if (!row) throw new Error("This sticker is unavailable or you do not have access.");
  if (!recordUse) return assetFromRow(row);
  const timestamp = now();
  await getDb().prepare("UPDATE vesper_sticker_assets SET use_count=use_count+1,last_used_at=?,updated_at=? WHERE id=? AND user_id=? AND character_id=?")
    .bind(timestamp, timestamp, id, scope.userId, scope.characterId).run();
  return { ...assetFromRow(row), lastUsedAt: timestamp, useCount: (Number(row.use_count) || 0) + 1 };
}

export async function assetObject(id: string) {
  await ensureSchema();
  const row = await getDb().prepare("SELECT r2_key,mime_type FROM vesper_sticker_assets WHERE id=? AND status='active'").bind(id).first<{ r2_key: string; mime_type: string }>();
  if (!row) return null;
  const object = await bucket().get(row.r2_key); if (!object) return null;
  return { object, mimeType: row.mime_type };
}

export async function importAttachmentAsSticker(scope: MemoryScope, requestOrigin: string, input: { key?: unknown; name?: unknown; type?: unknown; conversationId?: unknown; messageId?: unknown; categoryId?: unknown; description?: unknown }) {
  const key = text(input.key, 160);
  if (!/^[a-z0-9-]+\.[a-z0-9]+$/i.test(key)) throw new Error("Only images uploaded to Vesper can be saved.");
  const source = await bucket().get(key); if (!source || !source.body) throw new Error("The original image is no longer available.");
  const mimeType = text(input.type, 80) || source.httpMetadata?.contentType || "application/octet-stream";
  const file = new File([await new Response(source.body).arrayBuffer()], text(input.name, STICKER_CONFIG.maxNameLength) || "chat-image", { type: mimeType });
  return uploadSticker(scope, requestOrigin, file, { categoryId: input.categoryId, description: input.description, source: "chat_manual", sourceConversationId: text(input.conversationId, 120), sourceMessageId: text(input.messageId, 120) });
}

export async function readStickerSettings(scope: MemoryScope) {
  await ensureSchema();
  const row = await getDb().prepare("SELECT enabled,max_per_day,cooldown_seconds,min_confidence FROM vesper_sticker_collect_settings WHERE user_id=? AND character_id=?")
    .bind(scope.userId, scope.characterId).first<{ enabled: number; max_per_day: number; cooldown_seconds: number; min_confidence: number }>();
  return { enabled: Boolean(row?.enabled), maxPerDay: Number(row?.max_per_day || 8), cooldownSeconds: Number(row?.cooldown_seconds || 120), minConfidence: Number(row?.min_confidence || .88), visionAvailable: Boolean((env as unknown as Record<string, string | undefined>).STICKER_VISION_URL && (env as unknown as Record<string, string | undefined>).STICKER_VISION_KEY) };
}

export async function updateStickerSettings(scope: MemoryScope, input: { enabled?: unknown }) {
  const current = await readStickerSettings(scope); const enabled = input.enabled === undefined ? current.enabled : input.enabled === true;
  await getDb().prepare(`INSERT INTO vesper_sticker_collect_settings(user_id,character_id,enabled,max_per_day,cooldown_seconds,min_confidence,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(user_id,character_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`)
    .bind(scope.userId, scope.characterId, enabled ? 1 : 0, current.maxPerDay, current.cooldownSeconds, current.minConfidence, now()).run();
  return { ...current, enabled };
}

export async function queueStickerCollection(scope: MemoryScope, input: { key?: unknown; messageId?: unknown; conversationId?: unknown; sha256?: unknown }) {
  const settings = await readStickerSettings(scope); if (!settings.enabled) return { queued: false, reason: "disabled" };
  if (!settings.visionAvailable) return { queued: false, reason: "vision_unavailable" };
  const key = text(input.key, 160); const messageId = text(input.messageId, 120); const conversationId = text(input.conversationId, 120); const sha256 = text(input.sha256, 64);
  if (!/^[a-z0-9-]+\.[a-z0-9]+$/i.test(key) || !messageId || !conversationId || !/^[a-f0-9]{64}$/i.test(sha256)) throw new Error("Invalid automatic collection source");
  const timestamp = now();
  await getDb().prepare(`INSERT INTO vesper_sticker_collection_jobs(id,user_id,character_id,source_attachment_key,source_message_id,source_conversation_id,sha256,status,next_attempt_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,character_id,source_attachment_key,sha256) DO NOTHING`).bind(crypto.randomUUID(), scope.userId, scope.characterId, key, messageId, conversationId, sha256, "queued", timestamp, timestamp, timestamp).run();
  // This is intentionally best-effort. Sending a normal chat image must never wait on
  // a vision provider; the queue can be retried by the next catalog request.
  void processOneStickerCollection(scope);
  return { queued: true };
}

function base64(bytes: Uint8Array) {
  let value = "";
  for (let index = 0; index < bytes.length; index += 0x8000) value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(value);
}

async function classifyImage(bytes: ArrayBuffer, mimeType: string) {
  const secrets = env as unknown as Record<string, string | undefined>;
  if (!secrets.STICKER_VISION_URL || !secrets.STICKER_VISION_KEY) throw new Error("Sticker visual recognition is not configured.");
  const response = await fetch(secrets.STICKER_VISION_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secrets.STICKER_VISION_KEY}` },
    body: JSON.stringify({
      model: secrets.STICKER_VISION_MODEL || "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: "Decide whether this image is a reusable chat sticker, not a personal photo, document, screenshot, or arbitrary image. Return strict JSON: {isSticker:boolean,confidence:number,description:string,category:string}. Description must be a short Chinese usage scene, max 40 characters." }, { role: "user", content: [{ type: "image_url", image_url: { url: `data:${mimeType};base64,${base64(new Uint8Array(bytes))}` } }] }],
      max_tokens: 150,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Visual recognition service returned ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content) as { isSticker?: unknown; confidence?: unknown; description?: unknown; category?: unknown };
  return { isSticker: parsed.isSticker === true, confidence: Number(parsed.confidence) || 0, description: text(parsed.description, 80), category: text(parsed.category, 48) };
}

async function categoryForAutoCollect(scope: MemoryScope, categoryName: string) {
  const categories = await listStickerCategories(scope);
  const matching = categories.find((item) => item.name.toLowerCase() === categoryName.toLowerCase());
  if (matching) return matching.id;
  if (!categoryName) return null;
  return (await createStickerCategory(scope, { name: categoryName, description: "Automatic collection" })).id;
}

/** Processes at most one job, so a picker load cannot turn into an expensive worker loop. */
export async function processOneStickerCollection(scope: MemoryScope) {
  const settings = await readStickerSettings(scope);
  if (!settings.enabled || !settings.visionAvailable) return { processed: false };
  const job = await getDb().prepare(`SELECT * FROM vesper_sticker_collection_jobs WHERE user_id=? AND character_id=? AND status IN ('queued','retry') AND next_attempt_at<=? ORDER BY created_at LIMIT 1`)
    .bind(scope.userId, scope.characterId, now()).first<{ id: string; source_attachment_key: string; source_message_id: string; source_conversation_id: string; attempts: number }>();
  if (!job) return { processed: false };
  const timestamp = now();
  try {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const recent = await getDb().prepare("SELECT COUNT(*) AS count FROM vesper_sticker_assets WHERE user_id=? AND character_id=? AND source='chat_auto' AND created_at>=?")
      .bind(scope.userId, scope.characterId, since).first<{ count: number }>();
    if (Number(recent?.count || 0) >= settings.maxPerDay) throw new Error("Today’s automatic collection limit has been reached.");
    const source = await bucket().get(job.source_attachment_key);
    if (!source || !source.body) throw new Error("Original image unavailable");
    const bytes = await new Response(source.body).arrayBuffer();
    if (bytes.byteLength > STICKER_CONFIG.maxAutoCollectBytes) throw new Error("Image exceeds the recognition size limit.");
    const image = inspectStickerImage(bytes); validateImage(image);
    const decision = await classifyImage(bytes, image.mimeType);
    if (!decision.isSticker || decision.confidence < settings.minConfidence) {
      await getDb().prepare("UPDATE vesper_sticker_collection_jobs SET status='ignored',decision_json=?,updated_at=? WHERE id=?")
        .bind(JSON.stringify(decision), timestamp, job.id).run();
      return { processed: true, collected: false };
    }
    const categoryId = await categoryForAutoCollect(scope, decision.category);
    const publicOrigin = (env as unknown as Record<string, string | undefined>).STICKER_PUBLIC_ORIGIN || "https://vesper.r-vera.com";
    await uploadSticker(scope, publicOrigin, new File([bytes], `auto.${image.extension}`, { type: image.mimeType }), { categoryId, description: decision.description, source: "chat_auto", sourceConversationId: job.source_conversation_id, sourceMessageId: job.source_message_id });
    await getDb().prepare("UPDATE vesper_sticker_collection_jobs SET status='completed',decision_json=?,updated_at=? WHERE id=?")
      .bind(JSON.stringify(decision), timestamp, job.id).run();
    return { processed: true, collected: true };
  } catch (error) {
    const attempts = Number(job.attempts || 0) + 1; const terminal = attempts >= 3;
    await getDb().prepare("UPDATE vesper_sticker_collection_jobs SET status=?,attempts=?,next_attempt_at=?,last_error=?,updated_at=? WHERE id=?")
      .bind(terminal ? "failed" : "retry", attempts, new Date(Date.now() + attempts * 60_000).toISOString(), error instanceof Error ? error.message.slice(0, 240) : "Automatic collection failed", timestamp, job.id).run();
    return { processed: true, collected: false, retry: !terminal };
  }
}

export async function claimAgentSticker(scope: MemoryScope, conversationId: string, turnId: string) {
  const conversation = text(conversationId, 120); const turn = text(turnId, 120);
  if (!conversation || !turn) throw new Error("The sticker must belong to the current conversation turn.");
  const current = await getDb().prepare("SELECT last_turn_id,last_sent_at FROM vesper_sticker_agent_usage WHERE user_id=? AND character_id=? AND conversation_id=?")
    .bind(scope.userId, scope.characterId, conversation).first<{ last_turn_id: string; last_sent_at: string }>();
  const timestamp = now();
  if (current?.last_turn_id === turn) throw new Error("A sticker has already been sent this turn.");
  if (current?.last_sent_at && Date.now() - Date.parse(current.last_sent_at) < STICKER_CONFIG.agentCooldownSeconds * 1000) throw new Error("A sticker was just sent. Wait a little before sending another.");
  await getDb().prepare(`INSERT INTO vesper_sticker_agent_usage(user_id,character_id,conversation_id,last_turn_id,last_sent_at,sent_count,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(user_id,character_id,conversation_id) DO UPDATE SET last_turn_id=excluded.last_turn_id,last_sent_at=excluded.last_sent_at,sent_count=vesper_sticker_agent_usage.sent_count+1,updated_at=excluded.updated_at`)
    .bind(scope.userId, scope.characterId, conversation, turn, timestamp, 1, timestamp).run();
}
