import { isDesireTool } from './desire/routing.js';
import { env } from "cloudflare:workers";
import { ensureSchema, getDb } from "@/lib/db";
import type { MemoryScope } from "@/lib/memory";

type ConnectionRow = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  auth_mode: "none" | "oauth" | "bearer";
  token_ciphertext: string;
  enabled: number;
  tool_catalog: string;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type SecretEnv = { MCP_CREDENTIALS_KEY?: string };

export type PublicMcpConnection = {
  id: string;
  name: string;
  url: string;
  authMode: "none" | "oauth" | "bearer";
  enabled: boolean;
  authorized: boolean;
  tools: McpTool[];
  lastTestedAt: string | null;
  updatedAt: string;
};

export type McpConnectionInput = {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  authMode?: unknown;
  token?: unknown;
  enabled?: unknown;
  clearToken?: unknown;
};

const now = () => new Date().toISOString();
const toolNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;

function cleanText(value: unknown, limit: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function bytesToBase64(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}

function base64ToBytes(value: string) {
  const raw = atob(value);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function credentialKey() {
  const secret = (env as unknown as SecretEnv).MCP_CREDENTIALS_KEY?.trim();
  if (!secret) throw new Error("MCP credential storage is not configured.");
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`vesper-mcp-credentials:v1:${secret}`));
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptCredential(value: string) {
  if (!value) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await credentialKey(), new TextEncoder().encode(value));
  return `${bytesToBase64(iv)}.${bytesToBase64(encrypted)}`;
}

async function decryptCredential(value: string) {
  if (!value) return "";
  const [encodedIv, encodedPayload, extra] = value.split(".");
  if (!encodedIv || !encodedPayload || extra) throw new Error("Saved MCP credentials are invalid. Authorize again.");
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(encodedIv) },
      await credentialKey(),
      base64ToBytes(encodedPayload),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error("Could not read MCP credentials. Authorize again.");
  }
}

function safeMcpUrl(value: unknown) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("The MCP URL must be a public HTTPS address.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" || host === "::1" || host === "0.0.0.0" ||
    host === "127.0.0.1" || /^127\./.test(host) || /^10\./.test(host) ||
    /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) || /^(fc|fd|fe8|fe9|fea|feb)/.test(host) ||
    host.endsWith(".local") || host.endsWith(".internal")
  ) throw new Error("Local and private MCP addresses are not allowed.");
  return url;
}

function parseMcpPayload(raw: string): Record<string, unknown> {
  const data = raw.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]")
    .at(-1);
  const value = data || raw.trim();
  const parsed = parseJson<unknown>(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function compactSchema(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { type: "object", additionalProperties: true };
  const encoded = JSON.stringify(value);
  if (encoded.length > 12_000) return { type: "object", additionalProperties: true };
  return value as Record<string, unknown>;
}

function parseTools(value: unknown): McpTool[] {
  if (!Array.isArray(value)) return [];
  const names = new Set<string>();
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const name = cleanText(item.name, 128);
    if (!toolNamePattern.test(name) || names.has(name)) return [];
    names.add(name);
    return [{ name, description: cleanText(item.description, 700), inputSchema: compactSchema(item.inputSchema) }];
  });
}

function rowTools(row: ConnectionRow) {
  return parseTools(parseJson<unknown>(row.tool_catalog, []));
}

function publicConnection(row: ConnectionRow): PublicMcpConnection {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    authMode: row.auth_mode,
    enabled: Number(row.enabled) === 1,
    authorized: Boolean(row.token_ciphertext),
    tools: rowTools(row),
    lastTestedAt: row.last_tested_at || null,
    updatedAt: row.updated_at,
  };
}

function headersFor(token: string) {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-06-18",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function beginMcpSession(url: URL, token: string) {
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: headersFor(token),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Vesper", version: "1.0" } },
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("MCP authorization expired. Authorize again in Vesper Settings.");
    throw new Error(`MCP initialization failed (HTTP ${response.status})`);
  }
  const payload = parseMcpPayload(await response.text());
  const error = payload.error as { message?: unknown } | undefined;
  if (error?.message) throw new Error(cleanText(error.message, 240));
  const sessionId = response.headers.get("mcp-session-id") || "";
  const headers = headersFor(token);
  if (sessionId) headers["mcp-session-id"] = sessionId;
  await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  return {
    headers,
    serverName: cleanText(((payload.result as { serverInfo?: { name?: unknown } } | undefined)?.serverInfo?.name), 120),
  };
}

async function inspectMcp(url: URL, token: string) {
  const session = await beginMcpSession(url, token);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: session.headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/list", params: {} }),
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Could not load MCP tool catalog (HTTP ${response.status})`);
  const payload = parseMcpPayload(await response.text());
  const error = payload.error as { message?: unknown } | undefined;
  if (error?.message) throw new Error(cleanText(error.message, 240));
  const tools = parseTools((payload.result as { tools?: unknown } | undefined)?.tools);
  return { tools, serverName: session.serverName };
}

async function scopedConnection(scope: MemoryScope, id: string) {
  await ensureSchema();
  return getDb().prepare("SELECT * FROM vesper_mcp_connections WHERE user_id = ? AND id = ?")
    .bind(scope.userId, id).first<ConnectionRow>();
}

export async function listMcpConnections(scope: MemoryScope) {
  await ensureSchema();
  const rows = await getDb().prepare("SELECT * FROM vesper_mcp_connections WHERE user_id = ? ORDER BY updated_at DESC")
    .bind(scope.userId).all<ConnectionRow>();
  return rows.results.map(publicConnection);
}

export async function syncMcpConnection(scope: MemoryScope, input: McpConnectionInput) {
  await ensureSchema();
  const id = cleanText(input.id, 160);
  if (!id || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error("Invalid MCP connection ID");
  const url = safeMcpUrl(input.url);
  const name = cleanText(input.name, 120) || url.hostname;
  const authMode = input.authMode === "oauth" ? "oauth" : input.authMode === "bearer" ? "bearer" : "none";
  const existing = await scopedConnection(scope, id);
  const tokenProvided = typeof input.token === "string";
  const rawToken = tokenProvided ? String(input.token).trim() : "";
  const clearToken = input.clearToken === true;
  const tokenCiphertext = authMode === "none" || clearToken ? ""
    : rawToken ? await encryptCredential(rawToken)
      : existing?.token_ciphertext || "";
  const enabled = input.enabled !== false;
  if (authMode !== "none" && !tokenCiphertext) throw new Error("Complete MCP authorization before syncing to Codex.");
  const inspected = await inspectMcp(url, tokenCiphertext ? await decryptCredential(tokenCiphertext) : "");
  const timestamp = now();
  await getDb().prepare(`INSERT INTO vesper_mcp_connections
    (id, user_id, name, url, auth_mode, token_ciphertext, enabled, tool_catalog, last_tested_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, id) DO UPDATE SET
      name = excluded.name, url = excluded.url, auth_mode = excluded.auth_mode,
      token_ciphertext = excluded.token_ciphertext, enabled = excluded.enabled,
      tool_catalog = excluded.tool_catalog, last_tested_at = excluded.last_tested_at,
      updated_at = excluded.updated_at`)
    .bind(id, scope.userId, name, url.toString(), authMode, tokenCiphertext, enabled ? 1 : 0,
      JSON.stringify(inspected.tools), timestamp, existing?.created_at || timestamp, timestamp).run();
  const saved = await scopedConnection(scope, id);
  if (!saved) throw new Error("Could not save MCP connection");
  return { connection: publicConnection(saved), serverName: inspected.serverName, toolCount: inspected.tools.length };
}

export async function removeMcpConnection(scope: MemoryScope, id: string) {
  const connectionId = cleanText(id, 160);
  const connection = await scopedConnection(scope, connectionId);
  if (!connection) return { removed: false, id: connectionId };
  await getDb().prepare("DELETE FROM vesper_mcp_connections WHERE user_id = ? AND id = ?")
    .bind(scope.userId, connection.id).run();
  return { removed: true, id: connection.id };
}

export async function configuredMcpTools(scope: MemoryScope) {
  const connections = await listMcpConnections(scope);
  return connections.filter((connection) => connection.enabled).map((connection) => ({
    connectionId: connection.id,
    connectionName: connection.name,
    authorized: connection.authorized,
    tools: connection.tools.filter((tool) => !isDesireTool(tool.name)).map((tool) => ({ ...tool })),
  })).filter((connection) => connection.tools.length > 0);
}

function boundedResult(value: unknown) {
  const raw = JSON.stringify(value ?? null);
  if (raw.length <= 30_000) return value;
  return { truncated: true, preview: raw.slice(0, 30_000) };
}

export async function callConfiguredMcpTool(scope: MemoryScope, input: { connectionId?: unknown; toolName?: unknown; arguments?: unknown }) {
  const id = cleanText(input.connectionId, 160);
  const toolName = cleanText(input.toolName, 128);
  if (isDesireTool(toolName)) throw new Error("External Desire tools are disabled in Vesper; use the native Desire tools.");
  const connection = await scopedConnection(scope, id);
  if (!connection || Number(connection.enabled) !== 1) throw new Error("This MCP connection does not exist or is disabled.");
  const tool = rowTools(connection).find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error("This tool is not in the synced MCP catalog. Test the MCP connection in Settings first.");
  const argumentsValue = input.arguments && typeof input.arguments === "object" && !Array.isArray(input.arguments)
    ? input.arguments as Record<string, unknown> : {};
  if (JSON.stringify(argumentsValue).length > 30_000) throw new Error("MCP tool arguments are too large.");
  const url = safeMcpUrl(connection.url);
  const token = await decryptCredential(connection.token_ciphertext);
  if (connection.auth_mode !== "none" && !token) throw new Error("MCP is not authorized. Authorize it in Vesper Settings.");
  const session = await beginMcpSession(url, token);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: session.headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name: tool.name, arguments: argumentsValue } }),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("MCP authorization expired. Authorize again in Settings.");
    throw new Error(`MCP tool call failed (HTTP ${response.status})`);
  }
  const payload = parseMcpPayload(await response.text());
  const error = payload.error as { message?: unknown } | undefined;
  if (error?.message) throw new Error(cleanText(error.message, 500));
  return {
    connection: { id: connection.id, name: connection.name },
    tool: tool.name,
    result: boundedResult(payload.result ?? payload),
  };
}
