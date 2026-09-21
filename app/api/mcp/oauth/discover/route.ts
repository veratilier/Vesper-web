import { corsHeaders, optionsResponse } from "@/lib/cors";

export const OPTIONS = optionsResponse;

type JsonRecord = Record<string, unknown>;

function json(request: Request, value: unknown, status = 200) {
  const headers = corsHeaders(request);
  headers.set("cache-control", "no-store");
  return Response.json(value, { status, headers });
}

function safeHttpsUrl(value: unknown) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") throw new Error("MCP and OAuth URLs must use HTTPS.");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error("Local and private OAuth addresses are not allowed.");
  return url;
}

async function readJson(url: URL) {
  const response = await globalThis.fetch(url.toString(), {
    headers: {
      accept: "application/json",
      "ngrok-skip-browser-warning": "true",
      "user-agent": "Vesper MCP OAuth discovery",
    },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`metadata HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 1_000_000) throw new Error("OAuth metadata is too large.");
  return (await response.json()) as JsonRecord;
}

function metadataCandidates(resource: URL, challenge?: string | null) {
  const fromHeader = challenge?.match(/resource_metadata="([^"]+)"/i)?.[1];
  const path = resource.pathname === "/" ? "" : resource.pathname;
  return [
    fromHeader,
    `${resource.origin}/.well-known/oauth-protected-resource${path}`,
    `${resource.origin}/.well-known/oauth-protected-resource`,
    `${resource.origin}${path}/.well-known/oauth-protected-resource`,
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
}

async function discoverResource(resource: URL) {
  let challenge = "";
  const diagnostics: string[] = [];
  try {
    const probe = await globalThis.fetch(resource.toString(), {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Vesper", version: "1.0" } },
      }),
      redirect: "manual",
    signal: AbortSignal.timeout(10000),
    });
    challenge = probe.headers.get("www-authenticate") || "";
  } catch (reason) {
    diagnostics.push(reason instanceof Error ? reason.message.slice(0, 80) : "resource probe failed");
  }
  for (const candidate of metadataCandidates(resource, challenge)) {
    try {
      const value = await readJson(safeHttpsUrl(candidate));
      if (value) return { value, challenge };
    } catch (reason) {
      diagnostics.push(reason instanceof Error ? reason.message.slice(0, 80) : "metadata request failed");
    }
  }
  console.warn("MCP OAuth protected-resource discovery failed", {
    resource: resource.toString(),
    diagnostics,
  });
  throw new Error("Could not read MCP OAuth metadata");
}

async function discoverAuthorizationServer(issuer: URL) {
  const issuerPath = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  const candidates = [
    `${issuer.origin}/.well-known/oauth-authorization-server${issuerPath}`,
    `${issuer.origin}${issuerPath}/.well-known/openid-configuration`,
    `${issuer.origin}/.well-known/openid-configuration${issuerPath}`,
  ];
  for (const candidate of candidates) {
    try {
      const value = await readJson(safeHttpsUrl(candidate));
      if (value?.authorization_endpoint && value?.token_endpoint) return value;
    } catch {}
  }
  throw new Error("Could not discover the authorization endpoint");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      url?: string;
      redirectUri?: string;
      clientId?: string;
    };
    const resource = safeHttpsUrl(body.url);
    const redirectUri = safeHttpsUrl(body.redirectUri).toString();
    const { value: protectedResource, challenge } = await discoverResource(resource);
    const authorizationServers = protectedResource.authorization_servers;
    if (!Array.isArray(authorizationServers) || !authorizationServers.length)
      throw new Error("MCP metadata does not specify an authorization server.");
    const issuer = safeHttpsUrl(authorizationServers[0]);
    const metadata = await discoverAuthorizationServer(issuer);
    const methods = Array.isArray(metadata.code_challenge_methods_supported)
      ? metadata.code_challenge_methods_supported.map(String)
      : [];
    if (!methods.includes("S256")) throw new Error("The authorization server does not declare PKCE S256 support.");

    let clientId = body.clientId?.trim() || "";
    let clientSecret = "";
    const registrationEndpoint = metadata.registration_endpoint;
    if (!clientId && typeof registrationEndpoint === "string") {
      const registration = await globalThis.fetch(safeHttpsUrl(registrationEndpoint).toString(), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          client_name: "Vesper",
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code"],
          response_types: ["code"],
        }),
        redirect: "manual",
    signal: AbortSignal.timeout(10000),
      });
      const registered = (await registration.json()) as { client_id?: string; client_secret?: string; error_description?: string };
      if (!registration.ok || !registered.client_id)
        throw new Error(registered.error_description || "OAuth client registration failed");
      clientId = registered.client_id;
      clientSecret = registered.client_secret || "";
    }

    const challengedScope = challenge.match(/scope="([^"]+)"/i)?.[1];
    const scopes = challengedScope ||
      (Array.isArray(protectedResource.scopes_supported)
        ? protectedResource.scopes_supported.map(String).join(" ")
        : Array.isArray(metadata.scopes_supported)
          ? metadata.scopes_supported.map(String).join(" ")
          : "");
    return json(request, {
      authorizationUrl: String(metadata.authorization_endpoint),
      tokenUrl: String(metadata.token_endpoint),
      clientId,
      clientSecret,
      scopes,
      resource: String(protectedResource.resource || resource),
      needsClientId: !clientId,
    });
  } catch (reason) {
    return json(request, { error: reason instanceof Error ? reason.message : "OAuth discovery failed" }, 400);
  }
}
