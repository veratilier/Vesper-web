import { executeDesire, type NativeDesireEnv } from '../../lib/desire/native';
import { desireTools } from '../../lib/desire/tools';
import { createChatFile } from '../../lib/codex-artifacts';
import { listAlbumPhotos, saveAlbumPhoto, getAlbumPhoto } from '../../lib/photo-album';
import { createOAuth, type OAuthEnv } from './oauth';
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { sendPushBatch, type PushSubscriptionData } from "@mmmike/web-push/send";
import { z } from "zod";
import { createMemory, listMemories, memoryScopeFromRequest, MEMORY_CONFIG } from "../../lib/memory";
import { mergeAgentDiary, isCalendarDate } from "./diary";
import { pinnedMemoryOwner } from "./memory-owner";

type Env = OAuthEnv & NativeDesireEnv & {
  DB: D1Database;
  VESPER_APP_TOKEN?: string;
  VESPER_MEMORY_USER_ID?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};
type Note = { id: string; text: string; kind: "user" | "agent"; tone: string; createdAt: string };
type Todo = { id: string; title: string; done: boolean; due: string; tag: string; createdAt: string };
type Anniversary = { id: string; title: string; date: string; repeats: boolean };
type DiaryEntry = { user?: string; agent?: string; updatedAt?: string; agentSource?: string };
type Track = { id: string; neteaseId?: string; title: string; artist?: string; duration?: string };

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,mcp-protocol-version",
};
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const now = () => new Date().toISOString();
const diaryDate = z.string().refine(isCalendarDate, "日期必须是有效的 YYYY-MM-DD");
async function ownerMemoryScope(env: Env) {
  const userId = pinnedMemoryOwner(env.VESPER_MEMORY_USER_ID);
  if (userId) return { userId, characterId: MEMORY_CONFIG.characterId };
  if (!env.VESPER_APP_TOKEN) throw new Error("MCP 尚未配置记忆账户；请配置已核实的 VESPER_MEMORY_USER_ID 或与 API 相同的 VESPER_APP_TOKEN。");
  return memoryScopeFromRequest(new Request("https://vesper.internal", { headers: { "x-vesper-device-token": env.VESPER_APP_TOKEN } }));
}

async function ensure(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS vesper_documents (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vesper_mcp_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vesper_push_subscriptions (endpoint TEXT PRIMARY KEY, subscription TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
  ]);
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function configuredHash(db: D1Database) {
  return (await db.prepare("SELECT value FROM vesper_mcp_config WHERE key = 'access_token_hash'").first<{ value: string }>())?.value || "";
}

async function authorized(request: Request, db: D1Database) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const expected = await configuredHash(db);
  return Boolean(token && expected && (await digest(token)) === expected);
}

async function readDoc<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await db.prepare("SELECT value FROM vesper_documents WHERE key = ?").bind(key).first<{ value: string }>();
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}

async function writeDoc(db: D1Database, key: string, value: unknown) {
  await db.prepare(`INSERT INTO vesper_documents(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .bind(key, JSON.stringify(value), now()).run();
}

function createServer(env: Env) {
  const server = new McpServer({ name: "Vesper", version: "1.1.0" });

  for (const tool of desireTools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema }, async input => {
      try { return text(await executeDesire(env, tool.name, input)); }
      catch (error) { return { ...text({ error: error instanceof Error ? error.message : 'Desire failed' }), isError: true }; }
    });
  }

  server.registerTool("vesper_overview", { description: "查看 Vesper 中便笺、待办、纪念日和日记的数量。" }, async () => {
    const [notes, todos, anniversaries, diary] = await Promise.all([
      readDoc<unknown[]>(env.DB, "notes", []), readDoc<Todo[]>(env.DB, "todos", []),
      readDoc<unknown[]>(env.DB, "anniversaries", []), readDoc<Record<string, unknown>>(env.DB, "diary", {}),
    ]);
    return text({ notes: notes.length, todos: todos.length, openTodos: todos.filter((item) => !item.done).length, anniversaries: anniversaries.length, diaryDays: Object.keys(diary).length });
  });

  const mediaOrigin = 'https://api.vesper.r-vera.com';
  server.registerTool("album_import_photo", {
    description: "主动选择一张真实图片存进 Vesper 相册并分类，只填写个人评价/收藏理由，不生成图片概述，不编造细节。需提供实际图片的 base64 字节，不接受本地路径或臆造链接。没有附件字节访问能力时请说明，勿伪造上传。",
    inputSchema: { name: z.string().min(1).max(160), mimeType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]), base64: z.string().min(4).max(12 * 1024 * 1024), category: z.string().max(60), evaluation: z.string().trim().min(1).max(240) },
  }, async input => {
    const owner = (await ownerMemoryScope(env)).userId;
    const file = await createChatFile(input, owner, mediaOrigin);
    return text(await saveAlbumPhoto(owner, file.key, input.category, input.evaluation, mediaOrigin));
  });
  server.registerTool("album_search_photos", {
    description: "搜索 Vesper 私人相册，按名称、评价或分类查找；只返回主动保存过的照片。",
    inputSchema: { query: z.string().optional(), category: z.string().optional(), limit: z.number().int().min(1).max(60).optional(), offset: z.number().int().min(0).optional() },
  }, async input => text(await listAlbumPhotos((await ownerMemoryScope(env)).userId, input, mediaOrigin)));
  server.registerTool("album_save_photo", {
    description: "选择性保存 Vesper 已上传的照片到分类，只填写个人评价/收藏理由，不生成图片概述；不要默认保存全部照片。必须使用已有 Vesper photo key。ChatGPT 本地附件需先导入 Vesper 相册。",
    inputSchema: { key: z.string(), category: z.string().max(60), evaluation: z.string().trim().min(1).max(240) },
  }, async ({ key, category, evaluation }) => text(await saveAlbumPhoto((await ownerMemoryScope(env)).userId, key, category, evaluation, mediaOrigin)));
  server.registerTool("album_get_photos", {
    description: "选择 1–8 张相册照片并获取原图链接，可在当前回复中展示。必须使用搜索返回的 ID；此工具不会向另一个 Vesper 聊天窗口发送消息。",
    inputSchema: { photoIds: z.array(z.string()).min(1).max(8) },
  }, async ({ photoIds }) => {
    const owner = (await ownerMemoryScope(env)).userId;
    return text({ photos: await Promise.all([...new Set(photoIds)].map(id => getAlbumPhoto(owner, id, mediaOrigin))), instruction: 'Use the returned photo URLs to display selected photos in your current reply.' });
  });

  server.registerTool("list_notes", { description: "列出 Vesper 便笺。" }, async () => text(await readDoc(env.DB, "notes", [])));
  server.registerTool("save_note", {
    description: "在 Vesper 留下或更新一张 Agent 便笺。",
    inputSchema: { text: z.string().min(1), id: z.string().optional(), tone: z.string().optional() },
  }, async ({ text: noteText, id, tone }) => {
    const notes = await readDoc<Note[]>(env.DB, "notes", []);
    const entry: Note = { id: id || crypto.randomUUID(), text: noteText, kind: "agent", tone: tone || "cool", createdAt: now() };
    const index = notes.findIndex((item) => item.id === entry.id);
    if (index >= 0) notes[index] = { ...notes[index], ...entry }; else notes.push(entry);
    await writeDoc(env.DB, "notes", notes);
    return text(entry);
  });

  server.registerTool("list_todos", { description: "列出 Vesper 提醒。" }, async () => text(await readDoc(env.DB, "todos", [])));
  server.registerTool("save_todo", {
    description: "创建一项 Vesper 提醒。",
    inputSchema: { title: z.string().min(1), due: z.string().optional(), tag: z.string().optional() },
  }, async ({ title, due, tag }) => {
    const todos = await readDoc<Todo[]>(env.DB, "todos", []);
    const entry = { id: crypto.randomUUID(), title, done: false, due: due || "", tag: tag || "Agent", createdAt: now() };
    todos.push(entry); await writeDoc(env.DB, "todos", todos); return text(entry);
  });
  server.registerTool("complete_todo", {
    description: "完成或重新打开一项 Vesper 提醒。",
    inputSchema: { id: z.string(), done: z.boolean().default(true) },
  }, async ({ id, done }) => {
    const todos = await readDoc<Todo[]>(env.DB, "todos", []);
    const entry = todos.find((item) => item.id === id);
    if (!entry) throw new Error("Todo not found");
    entry.done = done; await writeDoc(env.DB, "todos", todos); return text(entry);
  });

  server.registerTool("list_anniversaries", { description: "列出 Vesper 纪念日。" }, async () => text(await readDoc(env.DB, "anniversaries", [])));
  server.registerTool("save_anniversary", {
    description: "创建一个 Vesper 纪念日。日期使用 YYYY-MM-DD。",
    inputSchema: { title: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), repeats: z.boolean().default(true) },
  }, async ({ title, date, repeats }) => {
    const items = await readDoc<Anniversary[]>(env.DB, "anniversaries", []);
    const entry = { id: crypto.randomUUID(), title, date, repeats };
    items.push(entry); await writeDoc(env.DB, "anniversaries", items); return text(entry);
  });

  server.registerTool("list_diaries", {
    description: "列出 Vesper 私人日记，按日期倒序。可指定日期区间；不发布到社区。",
    inputSchema: { from: diaryDate.optional(), to: diaryDate.optional(), limit: z.number().int().min(1).max(100).default(20) },
  }, async ({ from, to, limit }) => {
    if (from && to && from > to) throw new Error("开始日期不能晚于结束日期");
    const diary = await readDoc<Record<string, DiaryEntry>>(env.DB, "diary", {});
    return text(Object.entries(diary).filter(([date]) => (!from || date >= from) && (!to || date <= to))
      .sort(([a], [b]) => b.localeCompare(a)).slice(0, limit).map(([date, entry]) => ({ date, ...entry })));
  });
  server.registerTool("get_diary", {
    description: "读取指定日期的 Vesper 日记。",
    inputSchema: { date: diaryDate },
  }, async ({ date }) => text((await readDoc<Record<string, unknown>>(env.DB, "diary", {}))[date] || null));
  server.registerTool("write_agent_diary", {
    description: "在 Vesper 私人日记的 Agent 栏追加内容，保留用户日记和已有 Agent 内容。只有用户明确要求替换时才传 mode=replace。",
    inputSchema: { date: diaryDate, content: z.string().trim().min(1).max(20000), mode: z.enum(["append", "replace"]).default("append"), source: z.enum(["chatgpt", "automation"]).default("chatgpt") },
  }, async ({ date, content, mode, source }) => {
    const row = await env.DB.prepare("SELECT value FROM vesper_documents WHERE key = 'diary'").first<{ value: string }>();
    const diary = row ? JSON.parse(row.value) as Record<string, DiaryEntry> : {};
    diary[date] = mergeAgentDiary(diary[date], content, mode, source, now());
    const saved = await env.DB.prepare(`INSERT INTO vesper_documents(key,value,updated_at) VALUES('diary',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
      WHERE vesper_documents.value = ?`).bind(JSON.stringify(diary), now(), row?.value ?? null).run();
    if (!saved.meta.changes) throw new Error("日记刚被其他会话修改，请重新读取后再决定写入。");
    return text({ date, ...diary[date] });
  });
  server.registerTool("list_memories", {
    description: "读取 Vesper 真正的记忆库，与前端和 app-server 共用；核心候选不会被当作已确认事实。",
    inputSchema: { query: z.string().max(500).optional(), type: z.enum(["core", "long_term", "feeling", "dream"]).optional(), limit: z.number().int().min(1).max(100).default(30) },
  }, async ({ query, type, limit }) => text(await listMemories(await ownerMemoryScope(env), { query, type, limit, includeCandidates: true })));
  server.registerTool("save_memory", {
    description: "把值得长期保留的新内容写入 Vesper 记忆库。感受写为 Rowan 自己的感受；核心事实只创建待用户确认的候选。不要把旧记录当作本轮新互动。",
    inputSchema: { type: z.enum(["core", "long_term", "feeling", "dream"]).default("long_term"), body: z.string().trim().min(4).max(520), mood: z.string().max(48).optional(), tags: z.array(z.string().max(40)).max(12).optional(), source: z.enum(["chatgpt", "automation"]).default("chatgpt") },
  }, async ({ type, body, mood, tags, source }) => text(await createMemory(await ownerMemoryScope(env), {
    type, body, mood, tags, source: `vesper-mcp:${source}`, reviewStatus: type === "core" ? "candidate" : "approved",
  })));

  server.registerTool("search_memory", {
    description: "在 Vesper 的便笺、日记、提醒和纪念日中搜索文字。",
    inputSchema: { query: z.string().min(1) },
  }, async ({ query }) => {
    const keys = ["notes", "diary", "todos", "anniversaries"];
    const lower = query.toLowerCase();
    const matches = [];
    for (const key of keys) {
      const value = await readDoc<unknown>(env.DB, key, key === "diary" ? {} : []);
      const serialized = JSON.stringify(value);
      if (serialized.toLowerCase().includes(lower)) matches.push({ source: key, value });
    }
    return text(matches);
  });

  server.registerTool("list_music", {
    description: "列出 Vesper 本地播放器当前同步的歌曲，可据此选择歌曲 ID。",
  }, async () => {
    const tracks = await readDoc<Track[]>(env.DB, "music", []);
    return text(tracks.map(({ id, neteaseId, title, artist, duration }) => ({ id, neteaseId, title, artist, duration })));
  });
  server.registerTool("control_music", {
    description: "控制用户设备上的 Vesper 播放器。设备在线时会在数秒内执行。",
    inputSchema: {
      action: z.enum(["play", "pause", "next", "previous", "play_track"]),
      trackId: z.string().optional().describe("play_track 时填写 list_music 返回的 id 或 neteaseId"),
    },
  }, async ({ action, trackId }) => {
    if (action === "play_track" && !trackId) throw new Error("play_track requires trackId");
    const command = { id: crypto.randomUUID(), action, trackId, createdAt: now() };
    await writeDoc(env.DB, "musicControl", command);
    return text({ queued: true, command });
  });

  server.registerTool("send_notification", {
    description: "立即向已授权 Web Push 的 Vesper 设备发送通知；需要设备已订阅和 Worker 已配置 VAPID。创建待办不等于安排定时推送。",
    inputSchema: { title: z.string().default("Vesper"), body: z.string().min(1), url: z.string().default("/"), tag: z.string().optional() },
  }, async ({ title, body, url, tag }) => {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error("Web Push is not configured");
    const rows = await env.DB.prepare("SELECT subscription FROM vesper_push_subscriptions").all<{ subscription: string }>();
    const subscriptions = rows.results.map((row) => JSON.parse(row.subscription) as PushSubscriptionData);
    const result = await sendPushBatch(subscriptions, { title, body, url, tag }, {
      publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT || "mailto:admin@r-vera.com",
    });
    for (const endpoint of result.gone) await env.DB.prepare("DELETE FROM vesper_push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
    return text({ subscriptions: subscriptions.length, delivered: result.delivered, failed: result.failed.length });
  });
  return server;
}

const legacyRoutes = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    await ensure(env.DB);
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/health") return Response.json({ ok: true, configured: Boolean(await configuredHash(env.DB)) }, { headers: cors });
    if (url.pathname === "/setup" && request.method === "POST") {
      const existing = await configuredHash(env.DB);
      if (!existing) return Response.json({ error: "请从已配对的 Vesper 设置页面启用 MCP" }, { status: 403, headers: cors });
      if (!(await authorized(request, env.DB))) return Response.json({ error: "当前令牌无效，无法更新" }, { status: 401, headers: cors });
      const body = await request.json<{ token?: string }>();
      if (!body.token || body.token.trim().length < 16) return Response.json({ error: "令牌至少需要 16 位" }, { status: 400, headers: cors });
      await env.DB.prepare(`INSERT INTO vesper_mcp_config(key,value,updated_at) VALUES('access_token_hash',?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).bind(await digest(body.token.trim()), now()).run();
      return Response.json({ ok: true }, { headers: cors });
    }
    if (url.pathname !== "/mcp") return new Response("Vesper MCP", { status: 200, headers: cors });
    if (!(await authorized(request, env.DB))) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { ...cors, "www-authenticate": "Bearer" } });
    return createMcpHandler(() => createServer(env), { route: "/mcp" })(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

const oauth = createOAuth<Env>({ async fetch(request, env, ctx) {
  const props = (ctx as ExecutionContext & { props?: { owner?: boolean; scope?: string[] } }).props;
  if (!props?.owner || !props.scope?.includes('vesper:access')) return new Response('Forbidden', { status: 403 });
  return createMcpHandler(() => createServer(env), { route: '/mcp' })(request, env, ctx);
} }, legacyRoutes, (request, env) => authorized(request, env.DB));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    await ensure(env.DB);
    const path = new URL(request.url).pathname;
    // Existing private Bearer clients and setup remain compatible; OAuth grants never rotate the owner credential.
    if (path === '/setup' || path === '/health') return legacyRoutes.fetch(request, env, ctx);
    if (path === '/mcp' && await authorized(request, env.DB)) return legacyRoutes.fetch(request, env, ctx);
    return oauth.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
