import { authorizeApp } from "@/lib/bridge-auth";
import { corsHeaders, optionsResponse } from "@/lib/cors";
import { memoryScopeFromRequest } from "@/lib/memory";
import { listMcpConnections, removeMcpConnection, syncMcpConnection, type McpConnectionInput } from "@/lib/mcp-connections";

function json(request: Request, value: unknown, status = 200) {
  const headers = corsHeaders(request);
  headers.set("cache-control", "no-store");
  return Response.json(value, { status, headers });
}

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : "MCP connection unavailable";
}

export const OPTIONS = optionsResponse;

export async function GET(request: Request) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try {
    return json(request, { connections: await listMcpConnections(await memoryScopeFromRequest(request)) });
  } catch (reason) {
    return json(request, { error: message(reason) }, 400);
  }
}

export async function PUT(request: Request) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try {
    const input = await request.json() as McpConnectionInput;
    return json(request, await syncMcpConnection(await memoryScopeFromRequest(request), input), 200);
  } catch (reason) {
    return json(request, { error: message(reason) }, 400);
  }
}

export async function DELETE(request: Request) {
  if (!(await authorizeApp(request))) return json(request, { error: "Device not paired" }, 401);
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    return json(request, await removeMcpConnection(await memoryScopeFromRequest(request), id));
  } catch (reason) {
    return json(request, { error: message(reason) }, 400);
  }
}
