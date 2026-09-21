function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}

function publicHttps(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid Base URL");
  }
  if (url.protocol !== "https:") throw new Error("The Base URL must use HTTPS.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host))
    throw new Error("Local and private network addresses are not allowed.");
  return url.toString().replace(/\/$/, "");
}

export async function POST(request: Request) {
  try {
    const body = await request.json<{ baseUrl?: string; apiKey?: string }>();
    if (!body.baseUrl || !body.apiKey) return json({ error: "Enter a Base URL and API Key first." }, 400);
    const response = await fetch(`${publicHttps(body.baseUrl)}/models`, {
      headers: { authorization: `Bearer ${body.apiKey}` },
      redirect: "error",
    });
    const raw = await response.json().catch(() => null) as unknown;
    if (!response.ok) return json({ error: `Model API returned ${response.status}` }, 502);
    const payload = raw as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; name?: string }> };
    const models = [
      ...(payload.data || []).map((item) => item.id || ""),
      ...(payload.models || []).map((item) => item.id || item.name || ""),
    ]
      .filter(Boolean)
      .filter((item, index, all) => all.indexOf(item) === index)
      .sort();
    return json({ models });
  } catch (reason) {
    return json({ error: reason instanceof Error ? reason.message : "Could not load models" }, 400);
  }
}
