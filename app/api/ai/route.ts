import { ensureSchema, getDb } from "@/lib/db";
import { authorizeApp } from "@/lib/bridge-auth";

type Message = { role: "user" | "assistant" | "system"; content: string };
type ToolCall = { id: string; function: { name: string; arguments: string } };
const json = (value: unknown, status = 200) => Response.json(value, { status });
const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : "AI connection request failed";

function parseMcpText(value: unknown): string {
  const result = value as { result?: { content?: Array<{ type?: string; text?: string }> }; error?: { message?: string } };
  if (result.error?.message) throw new Error(result.error.message);
  return result.result?.content?.filter((item) => item.type === "text" && item.text)
    .map((item) => item.text).join("\n") || "The MCP tool returned no text.";
}

const toolDefinitions = [
  ["list_notes", "读取 Vesper 便笺", {}],
  ["save_note", "给用户保存一张 Agent 便笺", { text: { type: "string" }, tone: { type: "string" } }],
  ["list_todos", "读取 Vesper 提醒", {}],
  ["save_todo", "创建 Vesper 提醒", { title: { type: "string" }, due: { type: "string" }, tag: { type: "string" } }],
  ["complete_todo", "完成或重新打开提醒", { id: { type: "string" }, done: { type: "boolean" } }],
  ["list_anniversaries", "读取 Vesper 纪念日", {}],
  ["save_anniversary", "创建 Vesper 纪念日，date 使用 YYYY-MM-DD", { title: { type: "string" }, date: { type: "string" }, repeats: { type: "boolean" } }],
  ["get_diary", "读取指定日期的 Vesper 日记", { date: { type: "string" } }],
  ["write_agent_diary", "写入指定日期的 Agent 日记", { date: { type: "string" }, content: { type: "string" } }],
  ["search_memory", "搜索 Vesper 的便笺、日记、提醒和纪念日", { query: { type: "string" } }],
  ["list_music", "读取 Vesper 播放器的歌曲", {}],
  ["control_music", "控制 Vesper 播放器", { action: { type: "string", enum: ["play", "pause", "next", "previous", "play_track"] }, trackId: { type: "string" } }],
] as const;

const required: Record<string, string[]> = {
  save_note: ["text"], save_todo: ["title"], complete_todo: ["id"],
  save_anniversary: ["title", "date"], get_diary: ["date"],
  write_agent_diary: ["date", "content"], search_memory: ["query"], control_music: ["action"],
};
const openAiTools = toolDefinitions.map(([name, description, properties]) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required: required[name] || [] } },
}));

async function readDoc<T>(key: string, fallback: T): Promise<T> {
  const row = await getDb().prepare("SELECT value FROM vesper_documents WHERE key = ?")
    .bind(key).first<{ value: string }>();
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}
async function writeDoc(key: string, value: unknown) {
  await getDb().prepare(`INSERT INTO vesper_documents(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .bind(key, JSON.stringify(value), new Date().toISOString()).run();
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  changed: Record<string, unknown>,
  localDocuments: Record<string, unknown>,
  persist: boolean,
) {
  const now = new Date().toISOString();
  const read = async <T,>(key: string, fallback: T) =>
    key in changed ? changed[key] as T
      : key in localDocuments ? localDocuments[key] as T
      : persist ? readDoc(key, fallback) : fallback;
  const write = async (key: string, value: unknown) => {
    changed[key] = value;
    if (persist) await writeDoc(key, value);
  };
  if (name === "list_notes") return read("notes", []);
  if (name === "save_note") {
    const items = [...await read<Array<Record<string, unknown>>>("notes", [])];
    const entry = { id: crypto.randomUUID(), text: String(input.text || ""), kind: "agent", tone: String(input.tone || "cool"), createdAt: now };
    if (!entry.text) throw new Error("Note content is required.");
    items.push(entry); await write("notes", items); return entry;
  }
  if (name === "list_todos") return read("todos", []);
  if (name === "save_todo") {
    const items = [...await read<Array<Record<string, unknown>>>("todos", [])];
    const entry = { id: crypto.randomUUID(), title: String(input.title || ""), done: false, due: String(input.due || ""), tag: String(input.tag || "Agent"), createdAt: now };
    if (!entry.title) throw new Error("A reminder title is required.");
    items.push(entry); await write("todos", items); return entry;
  }
  if (name === "complete_todo") {
    const items = (await read<Array<Record<string, unknown>>>("todos", [])).map((item) => ({ ...item }));
    const entry = items.find((item) => item.id === input.id);
    if (!entry) throw new Error("Reminder not found");
    entry.done = input.done !== false; await write("todos", items); return entry;
  }
  if (name === "list_anniversaries") return read("anniversaries", []);
  if (name === "save_anniversary") {
    const items = [...await read<Array<Record<string, unknown>>>("anniversaries", [])];
    const entry = { id: crypto.randomUUID(), title: String(input.title || ""), date: String(input.date || ""), repeats: input.repeats !== false };
    if (!entry.title || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) throw new Error("Invalid anniversary title or date");
    items.push(entry); await write("anniversaries", items); return entry;
  }
  if (name === "get_diary") return (await read<Record<string, unknown>>("diary", {}))[String(input.date || "")] || null;
  if (name === "write_agent_diary") {
    const diary = { ...await read<Record<string, Record<string, unknown>>>("diary", {}) };
    const date = String(input.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid journal date");
    diary[date] = { ...(diary[date] || {}), agent: String(input.content || ""), updatedAt: now };
    await write("diary", diary); return diary[date];
  }
  if (name === "search_memory") {
    const query = String(input.query || "").toLowerCase();
    const result: Array<{ source: string; value: unknown }> = [];
    for (const key of ["notes", "diary", "todos", "anniversaries"]) {
      const value = await read<unknown>(key, key === "diary" ? {} : []);
      if (JSON.stringify(value).toLowerCase().includes(query)) result.push({ source: key, value });
    }
    return result;
  }
  if (name === "list_music") return read("music", []);
  if (name === "control_music") {
    const command = { id: crypto.randomUUID(), action: String(input.action || ""), trackId: input.trackId ? String(input.trackId) : undefined, createdAt: now };
    await write("musicControl", command); return { queued: true, command };
  }
  throw new Error(`Unknown tool: ${name}`);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mode?: "api" | "mcp"; connection?: Record<string, string>; conversationId?: string;
      messages?: Message[]; attachments?: Array<{ name?: string; url?: string; type?: string }>;
      documents?: Record<string, unknown>;
    };
    const connection = body.connection || {};
    const messages = Array.isArray(body.messages) ? body.messages.slice(-80) : [];
    if (!messages.length) return json({ error: "Message content is required." }, 400);
    if (body.mode === "api") {
      const baseUrl = connection.baseUrl?.replace(/\/$/, "");
      if (!baseUrl || !connection.apiKey || !connection.model)
        return json({ error: "Enter an API Base URL, model and API Key first." }, 400);
      const isAnthropic = /anthropic/i.test(connection.provider || "") || /api\.anthropic\.com/i.test(baseUrl);
      const endpoint = isAnthropic ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`;
      const canPersistTools = await authorizeApp(request);
      if (canPersistTools) await ensureSchema();
      const localDocuments = body.documents || {};
      const changedDocuments: Record<string, unknown> = {};
      if (isAnthropic) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: connection.model, max_tokens: 4096, messages: messages.filter((item) => item.role !== "system") }),
        });
        const result = await response.json() as { error?: { message?: string }; content?: Array<{ type?: string; text?: string; summary?: string }> };
        if (!response.ok) return json({ error: result.error?.message || `API returned ${response.status}` }, 502);
        const content = result.content?.filter((item) => item.type === "text").map((item) => item.text || "").join("\n");
        const reasoningSummary = result.content?.filter((item) => item.type === "thinking_summary").map((item) => item.summary || item.text || "").join("\n");
        return json({ content: content || "The AI returned no text.", reasoningSummary: reasoningSummary || undefined });
      }
      const thread: Array<Record<string, unknown>> = messages.map((item) => ({ role: item.role, content: item.content }));
      let finalContent = "", reasoningSummary = "";
      for (let round = 0; round < 5; round += 1) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${connection.apiKey}` },
          body: JSON.stringify({ model: connection.model, messages: thread, tools: openAiTools, tool_choice: "auto" }),
        });
        const result = await response.json() as { error?: { message?: string }; choices?: Array<{ message?: { content?: string; reasoning_summary?: string; tool_calls?: ToolCall[] } }> };
        if (!response.ok) return json({ error: result.error?.message || `API returned ${response.status}` }, 502);
        const message = result.choices?.[0]?.message;
        if (!message) break;
        if (message.reasoning_summary) reasoningSummary = message.reasoning_summary;
        const calls = message.tool_calls || [];
        thread.push({ role: "assistant", content: message.content || "", ...(calls.length ? { tool_calls: calls } : {}) });
        if (!calls.length) { finalContent = message.content || ""; break; }
        for (const call of calls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>; } catch {}
          const output = await executeTool(call.function.name, args, changedDocuments, localDocuments, canPersistTools);
          thread.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
        }
      }
      return json({ content: finalContent || "The AI returned no text.", reasoningSummary: reasoningSummary || undefined, changedDocuments });
    }
    if (body.mode === "mcp") {
      if (!connection.url) return json({ error: "Enter the MCP server URL first." }, 400);
      const latest = messages[messages.length - 1]?.content || "";
      const response = await fetch(connection.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(connection.token ? { authorization: `Bearer ${connection.token}` } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name: connection.toolName || "chat", arguments: { message: latest, conversationId: body.conversationId || "main", history: messages, attachments: body.attachments || [] } } }),
      });
      const raw = await response.text();
      if (!response.ok) return json({ error: `MCP returned ${response.status}` }, 502);
      const payload = raw.includes("data:") ? raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter((line) => line && line !== "[DONE]").map((line) => JSON.parse(line)).pop() : JSON.parse(raw);
      return json({ content: parseMcpText(payload) });
    }
    return json({ error: "Unsupported AI connection type" }, 400);
  } catch (reason) {
    return json({ error: errorMessage(reason) }, 502);
  }
}
