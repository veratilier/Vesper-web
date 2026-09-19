import { evidenceIdsForMessages, linkEvidence } from "@/lib/memory-vault";
import { env } from "cloudflare:workers";
import { ensureSchema, getDb } from "@/lib/db";

export const MEMORY_TYPES = ["core", "long_term", "feeling", "dream"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];
export type MemoryScope = { userId: string; characterId: string };

type MemoryRow = {
  corrected_at?: string | null;
  id: string;
  user_id: string;
  character_id: string;
  type: MemoryType;
  body: string;
  mood: string;
  tags: string;
  weight: number;
  pinned: number;
  source: string;
  review_status: "approved" | "candidate";
  created_at: string;
  updated_at: string;
  last_surfaced_at: string | null;
  surface_count: number;
  embedding: string;
  fingerprint: string;
  demoted_at: string | null;
};

type MemoryRevisionRow = {
  id: string;
  memory_id: string;
  body: string;
  mood: string;
  tags: string;
  reason: string;
  action: string;
  created_at: string;
};

export type MemoryRecord = {
  correctedAt?: string | null;
  id: string;
  userId: string;
  characterId: string;
  type: MemoryType;
  body: string;
  mood: string;
  tags: string[];
  weight: number;
  pinned: boolean;
  source: string;
  reviewStatus: "approved" | "candidate";
  createdAt: string;
  updatedAt: string;
  lastSurfacedAt: string | null;
  surfaceCount: number;
  embedding: number[];
  demotedAt: string | null;
};

export type MemoryRevision = {
  id: string;
  memoryId: string;
  body: string;
  mood: string;
  tags: string[];
  reason: string;
  action: string;
  createdAt: string;
};

export const MEMORY_CONFIG = Object.freeze({
  characterId: "rowan",
  embeddingDimensions: 96,
  coreRecallLimit: 8,
  longRecallLimit: 6,
  maxMemoryLength: 520,
  maxContextCharacters: 1600,
  recentMessageLimit: 18,
  semanticDedupeThreshold: 0.9,
  longTermDecayHalfLifeDays: 180,
  surfaceWeightBoost: 0.015,
  jobRetryMinutes: 30,
});

type SecretEnv = {
  MEMORY_EMBEDDING_URL?: string;
  MEMORY_EMBEDDING_KEY?: string;
  MEMORY_EMBEDDING_MODEL?: string;
  MEMORY_MODEL_URL?: string;
  MEMORY_MODEL_KEY?: string;
  MEMORY_MODEL?: string;
};

const now = () => new Date().toISOString();
const secretEnv = () => env as unknown as SecretEnv;

function cleanText(value: unknown, limit: number = MEMORY_CONFIG.maxMemoryLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanTags(value: unknown) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[，,]/) : [];
  return [...new Set(raw.map((item) => cleanText(item, 24).toLowerCase()).filter(Boolean))].slice(0, 8);
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").replace(/[^\p{L}\p{N}\s]/gu, "").trim();
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function rowToMemory(row: MemoryRow): MemoryRecord {
  const vector = parseJson<number[]>(row.embedding, []);
  return {
    id: row.id,
    correctedAt: row.corrected_at || null,
    userId: row.user_id,
    characterId: row.character_id,
    type: row.type,
    body: row.body,
    mood: row.mood,
    tags: cleanTags(parseJson<unknown>(row.tags, [])),
    weight: Number(row.weight) || 0,
    pinned: Number(row.pinned) === 1,
    source: row.source,
    reviewStatus: row.review_status === "candidate" ? "candidate" : "approved",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSurfacedAt: row.last_surfaced_at || null,
    surfaceCount: Number(row.surface_count) || 0,
    embedding: Array.isArray(vector) ? vector.filter(Number.isFinite) : [],
    demotedAt: row.demoted_at || null,
  };
}

function rowToRevision(row: MemoryRevisionRow): MemoryRevision {
  return {
    id: row.id,
    memoryId: row.memory_id,
    body: row.body,
    mood: row.mood,
    tags: cleanTags(parseJson<unknown>(row.tags, [])),
    reason: row.reason,
    action: row.action,
    createdAt: row.created_at,
  };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

/** The paired device credential is validated before this is called. Only its hash reaches D1. */
export async function memoryScopeFromRequest(request: Request): Promise<MemoryScope> {
  const token = request.headers.get("x-vesper-device-token")?.trim();
  if (!token) throw new Error("No paired account found");
  const digest = await sha256(`vesper-memory-user-v1:${token}`);
  return { userId: `usr_${digest.slice(0, 32)}`, characterId: MEMORY_CONFIG.characterId };
}

function fnv(value: string, seed = 2166136261) {
  let hash = seed >>> 0;
  for (const char of value) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

/**
 * The configured embedding provider is preferred. The deterministic fallback keeps
 * recall and dedupe available without moving private text or keys to the browser.
 */
function localEmbedding(text: string) {
  const vector = Array.from({ length: MEMORY_CONFIG.embeddingDimensions }, () => 0);
  const normalized = normalizeText(text);
  const words = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  const characters = [...normalized.replace(/\s/g, "")];
  const features = [...words, ...characters.flatMap((_, index) => {
    const pair = characters.slice(index, index + 2).join("");
    const triple = characters.slice(index, index + 3).join("");
    return [pair, triple].filter((item) => item.length > 1);
  })];
  for (const feature of features) {
    const hash = fnv(feature);
    const index = hash % vector.length;
    vector[index] += hash & 1 ? 1 : -1;
  }
  return normalizeVector(vector);
}

async function embeddingFor(text: string) {
  const config = secretEnv();
  const url = config.MEMORY_EMBEDDING_URL?.trim();
  if (!url || !config.MEMORY_EMBEDDING_KEY?.trim() || !config.MEMORY_EMBEDDING_MODEL?.trim()) return localEmbedding(text);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.MEMORY_EMBEDDING_KEY}` },
      body: JSON.stringify({ model: config.MEMORY_EMBEDDING_MODEL, input: text }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json() as { data?: Array<{ embedding?: unknown }> };
    const vector = payload.data?.[0]?.embedding;
    if (response.ok && Array.isArray(vector) && vector.length && vector.every((item) => typeof item === "number" && Number.isFinite(item)))
      return normalizeVector(vector as number[]);
  } catch {
    // The local representation is a safe degraded mode, never a client-side fallback.
  }
  return localEmbedding(text);
}

function cosine(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function decayWeight(memory: MemoryRecord, timestamp = Date.now()) {
  if (memory.type === "core") return memory.weight;
  const reference = Date.parse(memory.lastSurfacedAt || memory.updatedAt || memory.createdAt);
  if (!Number.isFinite(reference)) return memory.weight;
  const ageDays = Math.max(0, timestamp - reference) / 86_400_000;
  return memory.weight * Math.pow(0.5, ageDays / MEMORY_CONFIG.longTermDecayHalfLifeDays);
}

async function updateFts(memory: MemoryRecord) {
  const db = getDb();
  await db.batch([
    db.prepare("DELETE FROM vesper_memory_fts WHERE memory_id = ?").bind(memory.id),
    db.prepare("INSERT INTO vesper_memory_fts(memory_id, body, tags) VALUES (?, ?, ?)")
      .bind(memory.id, memory.body, memory.tags.join(" ")),
  ]);
}

async function scopedRows(scope: MemoryScope, options: { type?: MemoryType; includeDemoted?: boolean; includeCandidates?: boolean; limit?: number } = {}) {
  await ensureSchema();
  const conditions = ["user_id = ?", "character_id = ?"];
  const bindings: Array<string | number> = [scope.userId, scope.characterId];
  if (options.type) { conditions.push("type = ?"); bindings.push(options.type); }
  if (!options.includeDemoted) conditions.push("demoted_at IS NULL");
  if (!options.includeCandidates) conditions.push("review_status = 'approved'");
  const limit = Math.min(250, Math.max(1, options.limit || 120));
  const result = await getDb().prepare(`SELECT *, (SELECT MAX(r.created_at) FROM vesper_memory_revisions r WHERE r.memory_id=vesper_memories.id AND r.action IN ('corrected','edited')) AS corrected_at FROM vesper_memories WHERE ${conditions.join(" AND ")}
    ORDER BY pinned DESC, updated_at DESC LIMIT ?`).bind(...bindings, limit).all<MemoryRow>();
  return result.results.map(rowToMemory);
}

function ftsQuery(value: string) {
  const terms = cleanText(value, 180).match(/[\p{L}\p{N}]{1,32}/gu) || [];
  return terms.slice(0, 12).map((term) => `"${term.replace(/"/g, "")}"`).join(" OR ");
}

async function ftsScores(scope: MemoryScope, query: string) {
  const match = ftsQuery(query);
  if (!match) return new Map<string, number>();
  try {
    const result = await getDb().prepare(`SELECT f.memory_id AS id, bm25(vesper_memory_fts) AS rank
      FROM vesper_memory_fts f JOIN vesper_memories m ON m.id = f.memory_id
      WHERE vesper_memory_fts MATCH ? AND m.user_id = ? AND m.character_id = ? AND m.demoted_at IS NULL
      LIMIT 80`).bind(match, scope.userId, scope.characterId).all<{ id: string; rank: number }>();
    const raw = result.results.map((row) => Math.max(0, -Number(row.rank) || 0));
    const maximum = Math.max(...raw, 0.0001);
    return new Map(result.results.map((row, index) => [row.id, raw[index] / maximum]));
  } catch {
    return new Map<string, number>();
  }
}

export async function listMemories(scope: MemoryScope, options: { type?: MemoryType; query?: string; includeDemoted?: boolean; includeCandidates?: boolean; limit?: number } = {}) {
  const values = await scopedRows(scope, options);
  const query = cleanText(options.query, 180);
  if (!query) return values;
  const lower = query.toLocaleLowerCase("zh-CN");
  const scores = await ftsScores(scope, query);
  const vector = await embeddingFor(query);
  const ranked = values.map(memory => {
    const semantic = Math.max(0, cosine(vector, memory.embedding));
    const literal = `${memory.body} ${memory.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(lower);
    return { memory, score: semantic * 0.6 + (scores.get(memory.id) || 0) * 0.3 + (literal ? 0.5 : 0), matched: literal || scores.has(memory.id) || semantic >= 0.45 };
  });
  return ranked.filter(item => item.matched).sort((a,b) => b.score-a.score || Date.parse(b.memory.updatedAt)-Date.parse(a.memory.updatedAt)).map(item => item.memory);
}

export async function memoryDetail(scope: MemoryScope, id: string) {
  await ensureSchema();
  const row = await getDb().prepare("SELECT * FROM vesper_memories WHERE id = ? AND user_id = ? AND character_id = ?")
    .bind(id, scope.userId, scope.characterId).first<MemoryRow>();
  if (!row) return null;
  const revisions = await getDb().prepare("SELECT * FROM vesper_memory_revisions WHERE memory_id = ? ORDER BY created_at DESC")
    .bind(id).all<MemoryRevisionRow>();
  return { memory: rowToMemory(row), revisions: revisions.results.map(rowToRevision) };
}

type CreateMemoryInput = {
  type: MemoryType;
  body: string;
  mood?: string;
  tags?: unknown;
  source: string;
  reviewStatus?: "approved" | "candidate";
};

export async function createMemory(scope: MemoryScope, input: CreateMemoryInput) {
  await ensureSchema();
  const type = MEMORY_TYPES.includes(input.type) ? input.type : "long_term";
  const body = cleanText(input.body);
  if (body.length < 4) throw new Error("Add more detail to this memory.");
  const mood = cleanText(input.mood, 48);
  const tags = cleanTags(input.tags);
  const fingerprint = await sha256(`${type}:${normalizeText(body)}`);
  const db = getDb();
  const exact = await db.prepare(`SELECT * FROM vesper_memories WHERE user_id = ? AND character_id = ?
    AND fingerprint = ? AND demoted_at IS NULL LIMIT 1`).bind(scope.userId, scope.characterId, fingerprint).first<MemoryRow>();
  if (exact) return { memory: rowToMemory(exact), created: false, duplicate: "exact" as const };

  const embedding = await embeddingFor(`${body}\n${tags.join(" ")}`);
  const candidates = await scopedRows(scope, { type, includeCandidates: true, limit: 80 });
  const semantic = candidates.find((candidate) => cosine(embedding, candidate.embedding) >= MEMORY_CONFIG.semanticDedupeThreshold);
  if (semantic) {
    await db.prepare("UPDATE vesper_memories SET weight = MIN(1, weight + 0.02), updated_at = ? WHERE id = ?")
      .bind(now(), semantic.id).run();
    return { memory: { ...semantic, weight: Math.min(1, semantic.weight + 0.02) }, created: false, duplicate: "semantic" as const };
  }

  const createdAt = now();
  const memory: MemoryRecord = {
    id: crypto.randomUUID(), userId: scope.userId, characterId: scope.characterId, type, body, mood, tags,
    weight: type === "core" ? 1 : 0.65, pinned: type === "core", source: cleanText(input.source, 64) || "conversation",
    reviewStatus: input.reviewStatus === "candidate" ? "candidate" : "approved", createdAt, updatedAt: createdAt,
    lastSurfacedAt: null, surfaceCount: 0, embedding, demotedAt: null,
  };
  await db.prepare(`INSERT INTO vesper_memories
    (id, user_id, character_id, type, body, mood, tags, weight, pinned, source, review_status, created_at, updated_at, last_surfaced_at, surface_count, embedding, fingerprint, demoted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, NULL)`).bind(
    memory.id, memory.userId, memory.characterId, memory.type, memory.body, memory.mood, JSON.stringify(memory.tags), memory.weight,
    memory.pinned ? 1 : 0, memory.source, memory.reviewStatus, memory.createdAt, memory.updatedAt, JSON.stringify(memory.embedding), fingerprint,
  ).run();
  {
    await db.prepare(`INSERT INTO vesper_memory_revisions(id, memory_id, body, mood, tags, reason, action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'created', ?)`).bind(crypto.randomUUID(), memory.id, memory.body, memory.mood, JSON.stringify(memory.tags), "明确新增核心记忆", createdAt).run();
  }
  await updateFts(memory);
  return { memory, created: true, duplicate: null };
}

export async function updateMemoryState(scope: MemoryScope, id: string, action: "pin" | "demote" | "restore" | "approve_core", value?: boolean) {
  const detail = await memoryDetail(scope, id);
  if (!detail) throw new Error("Memory not found");
  const db = getDb();
  if (action === "pin") {
    const pinned = value === true ? 1 : 0;
    await db.prepare("UPDATE vesper_memories SET pinned = ?, updated_at = ? WHERE id = ?").bind(pinned, now(), id).run();
  } else if (action === "demote") {
    await db.prepare("UPDATE vesper_memories SET pinned = 0, demoted_at = ?, updated_at = ? WHERE id = ?").bind(now(), now(), id).run();
  } else if (action === "restore") {
    await db.prepare("UPDATE vesper_memories SET demoted_at = NULL, updated_at = ? WHERE id = ?").bind(now(), id).run();
  } else if (action === "approve_core") {
    if (detail.memory.type !== "core") throw new Error("Only core memory candidates can be confirmed.");
    await db.prepare("UPDATE vesper_memories SET review_status = 'approved', pinned = 1, weight = 1, updated_at = ? WHERE id = ?")
      .bind(now(), id).run();
  }
  return memoryDetail(scope, id);
}

export async function correctCoreMemory(scope: MemoryScope, id: string, input: { body: string; mood?: string; tags?: unknown; reason?: string }) {
  const detail = await memoryDetail(scope, id);
  if (!detail || detail.memory.type !== "core") throw new Error("Only core memories can use this correction flow.");
  const body = cleanText(input.body);
  if (body.length < 4) throw new Error("Add more detail to the corrected memory.");
  const mood = cleanText(input.mood, 48);
  const tags = cleanTags(input.tags);
  const embedding = await embeddingFor(`${body}\n${tags.join(" ")}`);
  const changedAt = now();
  await getDb().batch([
    getDb().prepare(`INSERT INTO vesper_memory_revisions(id, memory_id, body, mood, tags, reason, action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'previous', ?)`).bind(crypto.randomUUID(), id, detail.memory.body, detail.memory.mood,
        JSON.stringify(detail.memory.tags), "修正前的版本", detail.memory.updatedAt),
    getDb().prepare(`INSERT INTO vesper_memory_revisions(id, memory_id, body, mood, tags, reason, action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'corrected', ?)`)
      .bind(crypto.randomUUID(), id, body, mood, JSON.stringify(tags), cleanText(input.reason, 180) || "用户修正", changedAt),
    getDb().prepare(`UPDATE vesper_memories SET body = ?, mood = ?, tags = ?, embedding = ?, fingerprint = ?,
      updated_at = ?, review_status = 'approved', pinned = 1, weight = 1 WHERE id = ?`)
      .bind(body, mood, JSON.stringify(tags), JSON.stringify(embedding), await sha256(`core:${normalizeText(body)}`), changedAt, id),
  ]);
  const updated = await memoryDetail(scope, id);
  if (updated) await updateFts(updated.memory);
  return updated;
}

/**
 * Non-core memories can be corrected when the user has explicitly asked Codex
 * to do so. Core facts deliberately use correctCoreMemory instead, so they
 * always keep their stricter revision and confirmation flow.
 */
export async function editMemory(scope: MemoryScope, id: string, input: { body: string; mood?: string; tags?: unknown; reason?: string }) {
  const detail = await memoryDetail(scope, id);
  if (!detail) throw new Error("Memory not found");
  if (detail.memory.type === "core") throw new Error("Core memories require the correction flow.");
  const body = cleanText(input.body);
  if (body.length < 4) throw new Error("Add more detail to the corrected memory.");
  const mood = cleanText(input.mood, 48);
  const tags = cleanTags(input.tags);
  const embedding = await embeddingFor(`${body}\n${tags.join(" ")}`);
  const changedAt = now();
  await getDb().batch([
    getDb().prepare(`INSERT INTO vesper_memory_revisions(id, memory_id, body, mood, tags, reason, action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'previous', ?)`).bind(crypto.randomUUID(), id, detail.memory.body, detail.memory.mood,
        JSON.stringify(detail.memory.tags), "修正前的版本", detail.memory.updatedAt),
    getDb().prepare(`INSERT INTO vesper_memory_revisions(id, memory_id, body, mood, tags, reason, action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'edited', ?)`)
      .bind(crypto.randomUUID(), id, body, mood, JSON.stringify(tags), cleanText(input.reason, 180) || "用户通过 Codex 修正", changedAt),
    getDb().prepare(`UPDATE vesper_memories SET body = ?, mood = ?, tags = ?, embedding = ?, fingerprint = ?,
      updated_at = ? WHERE id = ? AND user_id = ? AND character_id = ?`)
      .bind(body, mood, JSON.stringify(tags), JSON.stringify(embedding), await sha256(`${detail.memory.type}:${normalizeText(body)}`), changedAt, id, scope.userId, scope.characterId),
  ]);
  const updated = await memoryDetail(scope, id);
  if (updated) await updateFts(updated.memory);
  return updated;
}

async function markSurfaced(scope: MemoryScope, ids: string[]) {
  if (!ids.length) return;
  const db = getDb();
  const timestamp = now();
  await db.batch(ids.map((id) => db.prepare(`UPDATE vesper_memories SET last_surfaced_at = ?, surface_count = surface_count + 1,
    weight = CASE WHEN type = 'core' THEN weight ELSE MIN(1, weight + ?) END WHERE id = ? AND user_id = ? AND character_id = ?`)
    .bind(timestamp, MEMORY_CONFIG.surfaceWeightBoost, id, scope.userId, scope.characterId)));
}

export async function recallMemory(scope: MemoryScope, query: string) {
  await runDueMemoryJobs(scope);
  const all = await scopedRows(scope, { includeCandidates: false, limit: 160 });
  const core = all.filter((memory) => memory.type === "core").sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.weight - left.weight).slice(0, MEMORY_CONFIG.coreRecallLimit);
  const queryEmbedding = cleanText(query) ? await embeddingFor(query) : [];
  const keyword = await ftsScores(scope, query);
  const candidates = all.filter((memory) => memory.type !== "core" && !memory.demotedAt);
  const ranked = candidates.map((memory) => {
    const semantic = queryEmbedding.length ? Math.max(0, cosine(queryEmbedding, memory.embedding)) : 0;
    const keywordScore = keyword.get(memory.id) || (cleanText(query) && `${memory.body} ${memory.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(cleanText(query).toLocaleLowerCase("zh-CN")) ? 0.25 : 0);
    const forgotten = memory.lastSurfacedAt ? Math.min(1, Math.max(0, (Date.now() - Date.parse(memory.lastSurfacedAt)) / (90 * 86_400_000))) : 0.35;
    return { memory, score: semantic * 0.52 + keywordScore * 0.3 + decayWeight(memory) * 0.12 + forgotten * 0.06 };
  }).filter((item) => item.score >= 0.17 || item.memory.pinned).sort((left, right) => right.score - left.score)
    .slice(0, MEMORY_CONFIG.longRecallLimit).map((item) => item.memory);
  const memories = [...core, ...ranked.filter((memory) => !core.some((item) => item.id === memory.id))];
  await markSurfaced(scope, memories.map((memory) => memory.id));
  const lines = memories.map((memory) => `- [${memory.id}; ${memory.updatedAt}; ${memory.type === "core" ? "当前已确认" : "历史背景"}] ${memory.type === "feeling" ? "Rowan 的感受" : memory.type === "core" ? "核心" : "旧记忆"}：${memory.body}`);
  const context = lines.join("\n").slice(0, MEMORY_CONFIG.maxContextCharacters);
  return {
    memories: memories.map((memory) => ({ ...memory, surfaceCount: memory.surfaceCount + 1 })),
    context: context ? `旧记忆背景（只作为长期背景，不是用户刚刚说的话；不要把它逐条复述给用户）：\n${context}` : "",
  };
}

export async function recordMemoryMessage(scope: MemoryScope, input: { conversationId: string; messageId: string; role: "user" | "agent"; content: string; createdAt?: string; turnId?: string }) {
  await ensureSchema();
  const conversationId = cleanText(input.conversationId, 160);
  const messageId = cleanText(input.messageId, 160);
  const content = cleanText(input.content, 20_000);
  if (!conversationId || !messageId || !content) throw new Error("No conversation content to remember.");
  const parsedTime = Date.parse(input.createdAt || "");
  const createdAt = Number.isFinite(parsedTime) ? new Date(parsedTime).toISOString() : now();
  await getDb().prepare(`INSERT INTO vesper_memory_messages
    (id, user_id, character_id, conversation_id, message_id, turn_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, character_id, conversation_id, message_id) DO UPDATE SET content = excluded.content, turn_id = excluded.turn_id, created_at = excluded.created_at`)
    .bind(crypto.randomUUID(), scope.userId, scope.characterId, conversationId, messageId, cleanText(input.turnId, 160) || null, input.role, content, createdAt).run();
  return { ok: true };
}

async function messageWindow(scope: MemoryScope, conversationId: string) {
  const rows = await getDb().prepare(`SELECT message_id, role, content, created_at FROM vesper_memory_messages
    WHERE user_id = ? AND character_id = ? AND conversation_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(scope.userId, scope.characterId, conversationId, MEMORY_CONFIG.recentMessageLimit).all<{ message_id: string; role: "user" | "agent"; content: string; created_at: string }>();
  return rows.results.reverse();
}

async function callDistillationModel(messages: Array<{ role: "user" | "agent"; content: string }>) {
  const config = secretEnv();
  if (!config.MEMORY_MODEL_URL?.trim() || !config.MEMORY_MODEL_KEY?.trim() || !config.MEMORY_MODEL?.trim()) return null;
  const system = `You distill a private relationship memory for Rowan. Return JSON only: {"memories":[{"type":"long_term"|"feeling"|"core","body":"first-person, concise and specific","mood":"optional","tags":["optional"]}]}. Keep only durable facts, meaningful shared events, commitments, boundaries, or Rowan's first-person feeling. Do not infer, invent, store transient jokes, or overwrite facts. A core item is only a candidate for the user to confirm.`;
  const transcript = messages.map((message) => `${message.role === "user" ? "User" : "Rowan"}: ${message.content}`).join("\n");
  const response = await fetch(config.MEMORY_MODEL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.MEMORY_MODEL_KEY}` },
    body: JSON.stringify({ model: config.MEMORY_MODEL, temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: transcript }] }),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || "The memory model is unavailable.");
  const raw = payload.choices?.[0]?.message?.content || "{}";
  const parsed = parseJson<{ memories?: Array<{ type?: unknown; body?: unknown; mood?: unknown; tags?: unknown }> }>(raw.replace(/^```json\s*|\s*```$/g, ""), {});
  return Array.isArray(parsed.memories) ? parsed.memories.slice(0, 4) : [];
}

export async function scheduleDistillation(scope: MemoryScope, conversationId: string) {
  await ensureSchema();
  const messages = await messageWindow(scope, conversationId);
  if (messages.length < 2) return { queued: false, reason: "not_enough_messages" };
  const dedupeKey = await sha256(messages.map((message) => `${message.message_id}:${message.content}`).join("\n"));
  const id = crypto.randomUUID();
  const createdAt = now();
  await getDb().prepare(`INSERT INTO vesper_memory_jobs
    (id, user_id, character_id, conversation_id, dedupe_key, status, attempts, next_attempt_at, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, '', ?, ?)
    ON CONFLICT(user_id, character_id, dedupe_key) DO NOTHING`)
    .bind(id, scope.userId, scope.characterId, conversationId, dedupeKey, createdAt, createdAt, createdAt).run();
  const result = await runDueMemoryJobs(scope);
  return { queued: true, ...result };
}

export async function runDueMemoryJobs(scope: MemoryScope) {
  await ensureSchema();
  const db = getDb();
  const job = await db.prepare(`SELECT id, conversation_id, attempts FROM vesper_memory_jobs
    WHERE user_id = ? AND character_id = ? AND status IN ('queued', 'retry') AND next_attempt_at <= ?
    ORDER BY created_at ASC LIMIT 1`).bind(scope.userId, scope.characterId, now()).first<{ id: string; conversation_id: string; attempts: number }>();
  if (!job) return { processed: false };
  const messages = await messageWindow(scope, job.conversation_id);
  if (messages.length < 2) {
    await db.prepare("UPDATE vesper_memory_jobs SET status = 'completed', updated_at = ? WHERE id = ?").bind(now(), job.id).run();
    return { processed: true, stored: 0 };
  }
  try {
    const distilled = await callDistillationModel(messages);
    if (distilled === null) {
      await db.prepare("UPDATE vesper_memory_jobs SET status = 'retry', attempts = attempts + 1, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?")
        .bind(new Date(Date.now() + MEMORY_CONFIG.jobRetryMinutes * 60_000).toISOString(), "Waiting for the server memory model", now(), job.id).run();
      return { processed: false, pendingModel: true };
    }
    let stored = 0;
    for (const candidate of distilled) {
      const requested = String(candidate.type || "long_term");
      const type: MemoryType = requested === "core" ? "core" : requested === "feeling" ? "feeling" : requested === "dream" ? "dream" : "long_term";
      const result = await createMemory(scope, {
        type, body: cleanText(candidate.body), mood: cleanText(candidate.mood, 48), tags: candidate.tags,
        source: requested === "core" ? "model-core-candidate" : "model-distillation", reviewStatus: requested === "core" ? "candidate" : "approved",
      });
      const evidenceIds = await evidenceIdsForMessages(scope, job.conversation_id, messages.map(message => message.message_id));
      await linkEvidence(scope, result.memory.id, evidenceIds);
      if (result.created) stored += 1;
    }
    await db.prepare("UPDATE vesper_memory_jobs SET status = 'completed', last_error = '', updated_at = ? WHERE id = ?").bind(now(), job.id).run();
    return { processed: true, stored };
  } catch (reason) {
    const attempts = Number(job.attempts || 0) + 1;
    await db.prepare("UPDATE vesper_memory_jobs SET status = 'retry', attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .bind(attempts, new Date(Date.now() + MEMORY_CONFIG.jobRetryMinutes * 60_000).toISOString(), cleanText(reason instanceof Error ? reason.message : "Memory distillation failed", 300), now(), job.id).run();
    return { processed: false, retry: true };
  }
}

export async function captureMemoryCandidate(scope: MemoryScope, input: { type?: unknown; body?: unknown; mood?: unknown; tags?: unknown }) {
  const requested = String(input.type || "long_term");
  const type: MemoryType = requested === "core" ? "core" : requested === "feeling" ? "feeling" : requested === "dream" ? "dream" : "long_term";
  return createMemory(scope, {
    type,
    body: cleanText(input.body),
    mood: cleanText(input.mood, 48),
    tags: input.tags,
    source: type === "core" ? "codex-core-candidate" : "codex-distillation",
    reviewStatus: type === "core" ? "candidate" : "approved",
  });
}
