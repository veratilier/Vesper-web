import { corsHeaders, optionsResponse } from "@/lib/cors";

export const OPTIONS = optionsResponse;

function json(request: Request, value: unknown, status = 200) {
  const headers = corsHeaders(request);
  headers.set("cache-control", "no-store");
  return Response.json(value, { status, headers });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      tokenUrl?: string;
      code?: string;
      verifier?: string;
      clientId?: string;
      clientSecret?: string;
      redirectUri?: string;
      resource?: string;
    };
    const tokenUrl = new URL(body.tokenUrl || "");
    if (tokenUrl.protocol !== "https:")
      return json(request, { error: "The Token URL must use HTTPS." }, 400);
    if (!body.code || !body.verifier || !body.clientId || !body.redirectUri)
      return json(request, { error: "Incomplete OAuth callback parameters" }, 400);
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: body.code,
      client_id: body.clientId,
      redirect_uri: body.redirectUri,
      code_verifier: body.verifier,
    });
    if (body.clientSecret) form.set("client_secret", body.clientSecret);
    if (body.resource) form.set("resource", body.resource);
    const response = await globalThis.fetch(tokenUrl.toString(), {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: form,
    });
    const result = (await response.json()) as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !result.access_token)
      return json(request,
        { error: result.error_description || result.error || `Token service returned ${response.status}` },
        502,
      );
    return json(request, {
      accessToken: result.access_token,
      tokenType: result.token_type || "Bearer",
      expiresIn: result.expires_in,
    });
  } catch (reason) {
    return json(request, { error: reason instanceof Error ? reason.message : "OAuth authorization failed" }, 400);
  }
}
