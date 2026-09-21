function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}

function safeRemoteUrl(value: unknown) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") throw new Error("The MCP URL must use HTTPS.");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error("Local and private network addresses cannot be tested.");
  return url.toString();
}

function parsePayload(raw: string) {
  if (!raw.includes("data:")) return JSON.parse(raw);
  const lines = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  return JSON.parse(lines.at(-1) || "{}");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string; token?: string };
    const url = safeRemoteUrl(body.url);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (body.token) headers.authorization = `Bearer ${body.token}`;
    const initialize = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "Vesper", version: "0.5" },
        },
      }),
    });
    if (!initialize.ok) {
      if (initialize.status === 401)
        return json({ error: "MCP authorization required. Configure a Bearer Token or OAuth." }, 401);
      return json({ error: `MCP initialization returned ${initialize.status}` }, 502);
    }
    const initialized = parsePayload(await initialize.text()) as {
      result?: { serverInfo?: { name?: string } };
      error?: { message?: string };
    };
    if (initialized.error?.message) throw new Error(initialized.error.message);
    const sessionId = initialize.headers.get("mcp-session-id");
    let toolCount: number | undefined;
    const sessionHeaders = sessionId ? { ...headers, "mcp-session-id": sessionId } : headers;
    await fetch(url, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    }).catch(() => undefined);
    const tools = await fetch(url, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tools/list",
        params: {},
      }),
    });
    if (tools.ok) {
      const listed = parsePayload(await tools.text()) as { result?: { tools?: unknown[] } };
      toolCount = listed.result?.tools?.length;
    }
    return json({
      ok: true,
      serverName: initialized.result?.serverInfo?.name,
      toolCount,
    });
  } catch (reason) {
    return json({ error: reason instanceof Error ? reason.message : "MCP connection failed" }, 400);
  }
}
