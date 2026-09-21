function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}

function safeRemoteUrl(value: unknown) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") throw new Error("External memory storage must use HTTPS.");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" || host === "127.0.0.1" || host === "::1" ||
    /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error("Local and private network addresses are not allowed.");
  return url.toString();
}

async function boundedText(response: Response, limit = 2_000_000) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("External memory data exceeds 2 MB. Reduce the sync scope.");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

function parsePayload(raw: string) {
  if (!raw.includes("data:")) return JSON.parse(raw);
  const line = raw.split("\n").filter((item) => item.startsWith("data:"))
    .map((item) => item.slice(5).trim()).filter((item) => item && item !== "[DONE]").at(-1);
  return JSON.parse(line || "{}");
}

function findItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["memories", "items", "data", "results", "records"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  const content = (record.result as { content?: Array<{ text?: string }> } | undefined)?.content;
  const text = content?.find((entry) => entry.text)?.text;
  if (text) {
    try { return findItems(JSON.parse(text)); } catch { return [{ text }]; }
  }
  return [];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string; token?: string; toolName?: string };
    const url = safeRemoteUrl(body.url);
    const headers: Record<string, string> = { accept: "application/json, text/event-stream" };
    if (body.token) headers.authorization = `Bearer ${body.token}`;
    let response = await fetch(url, { headers, redirect: "error" });
    if (!response.ok || !/json|event-stream/i.test(response.headers.get("content-type") || "")) {
      response = await fetch(url, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: crypto.randomUUID(),
          method: "tools/call",
          params: { name: body.toolName || "memory.list", arguments: { limit: 500 } },
        }),
        redirect: "error",
      });
    }
    if (!response.ok) throw new Error(`External memory service returned ${response.status}`);
    const items = findItems(parsePayload(await boundedText(response))).slice(0, 500).map((item, index) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : { text: String(item) };
      return {
        id: String(record.id || record.key || `external-${index}`),
        title: String(record.title || record.name || record.summary || record.text || `External memory ${index + 1}`).slice(0, 160),
        kind: String(record.kind || record.type || "external"),
        source: String(record.source || new URL(url).hostname),
        updatedAt: String(record.updatedAt || record.updated_at || record.createdAt || new Date().toISOString()),
      };
    });
    return json({ ok: true, items, count: items.length, syncedAt: new Date().toISOString() });
  } catch (reason) {
    return json({ error: reason instanceof Error ? reason.message : "External memory sync failed" }, 400);
  }
}
