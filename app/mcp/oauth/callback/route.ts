export async function GET(request: Request) {
  const incoming = new URL(request.url);
  // Fixed native destination: never accept a caller-supplied redirect target.
  const native = incoming.searchParams.get("native") === "1";
  const destination = native ? new URL("vesper://oauth/callback") : new URL("/", incoming.origin);
  if (!native) destination.searchParams.set("mcp-oauth", "1");

  for (const key of ["code", "state", "error", "error_description", "error_uri"]) {
    const value = incoming.searchParams.get(key);
    if (value) destination.searchParams.set(key, value);
  }

  return new Response(null, {
    status: 302,
    headers: {
      location: destination.toString(),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
