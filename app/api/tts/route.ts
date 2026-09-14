function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}

function safeHttpsUrl(value: unknown) {
  let url: URL;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Invalid TTS URL. Enter a full HTTPS URL.");
  }
  if (url.protocol !== "https:") throw new Error("The TTS URL must use HTTPS.");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" || host === "127.0.0.1" || host === "::1" ||
    /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error("Local or private TTS addresses are not allowed.");
  return url;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: string; connection?: Record<string, string> };
    const text = String(body.text || "").trim().slice(0, 4_000);
    const connection = body.connection || {};
    if (!text) return json({ error: "Text to speak is required." }, 400);
    if (!connection.baseUrl || !connection.apiKey)
      return json({ error: "Enter the TTS URL and API Key in Settings first." }, 400);
    const provider = (connection.provider || "").toLowerCase();
    const base = safeHttpsUrl(connection.baseUrl.replace(/\/$/, ""));
    const isElevenLabs = provider.includes("eleven") || base.hostname.includes("elevenlabs");
    const isMiniMax = provider.includes("minimax") || base.hostname.includes("minimax");
    const baseString = base.toString().replace(/\/$/, "");
    const endpoint = connection.endpoint
      ? safeHttpsUrl(connection.endpoint)
      : isElevenLabs
        ? safeHttpsUrl(`${baseString}/v1/text-to-speech/${encodeURIComponent(connection.voiceId || "")}`)
        : isMiniMax
          ? safeHttpsUrl(`${baseString}/v1/t2a_v2${connection.groupId ? `?GroupId=${encodeURIComponent(connection.groupId)}` : ""}`)
        : safeHttpsUrl(/\/audio\/speech$/i.test(base.pathname) ? baseString : `${baseString}/audio/speech`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: isElevenLabs
        ? { "content-type": "application/json", accept: "audio/mpeg", "xi-api-key": connection.apiKey }
        : { "content-type": "application/json", accept: "audio/mpeg, audio/*", authorization: `Bearer ${connection.apiKey}` },
      body: JSON.stringify(isElevenLabs
        ? { text, model_id: connection.model || "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 }, speed: Number(connection.speed || 1) }
        : isMiniMax
          ? { model: connection.model || "speech-2.6-hd", text, stream: false, voice_setting: { voice_id: connection.voiceId || "male-qn-qingse", speed: Number(connection.speed || 1), vol: 1, pitch: 0 }, audio_setting: { audio_sample_rate: 32000, bitrate: 128000, format: "mp3" } }
        : { model: connection.model || "gpt-4o-mini-tts", voice: connection.voiceId || "alloy", input: text, response_format: "mp3", speed: Number(connection.speed || 1) }),
      redirect: "manual",
    });
    // Workers supports manual/follow only. Do not forward provider credentials
    // to a redirected destination.
    if (response.status >= 300 && response.status < 400) {
      return json({ error: `TTS endpoint returned a redirect (${response.status}). Enter the provider\'s final HTTPS endpoint in Voice settings.` }, 502);
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      return json({ error: detail || `TTS returned ${response.status}` }, 502);
    }
    if (isMiniMax) {
      const payload = await response.json() as { data?: { audio?: string }; audio?: string; base_resp?: { status_code?: number; status_msg?: string } };
      const encoded = payload.data?.audio || payload.audio;
      if (!encoded) return json({ error: payload.base_resp?.status_msg || "MiniMax returned no audio." }, 502);
      const bytes = /^[0-9a-f]+$/i.test(encoded) ? Uint8Array.from(encoded.match(/.{1,2}/g) || [], (pair) => parseInt(pair, 16)) : Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      return new Response(bytes, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
    }
    return new Response(response.body, { headers: { "content-type": response.headers.get("content-type") || "audio/mpeg", "cache-control": "no-store" } });
  } catch (reason) {
    return json({ error: reason instanceof Error ? reason.message : "TTS request failed" }, 400);
  }
}
