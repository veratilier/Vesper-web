/** Read the same durable wake messages shown in Chat, including silent runs. */
export async function readWakeHistory(conversationId: string, token: string) {
  let failureReason = "network_error";
  try {
    let url = new URL(`https://codex.r-vera.com/history/conversations/${encodeURIComponent(conversationId)}/wake-history`);
    const historyPath = url.pathname.replace(/\/$/, "");
    const signal = AbortSignal.timeout(8000);
    let response: Response;
    for (let redirects = 0; ; redirects++) {
      response = await fetch(url.toString(), {
        headers: { authorization: `Bearer ${token}` }, cache: 'no-store',
        redirect: 'manual', signal,
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      const next = location ? new URL(location, url) : null;
      if (!next || redirects >= 2 || next.origin !== url.origin ||
          next.pathname.replace(/\/$/, '') !== historyPath || next.username || next.password) {
        failureReason = next ? 'redirect_blocked' : 'redirect_without_location';
        throw new Error('Unsafe history redirect');
      }
      url = next;
    }
    if (!response.ok) { failureReason = `http_${response.status}`; throw new Error('Wake history unavailable'); }
    const data = await response.json() as { messages?: Array<Record<string, unknown>> };
    if (!Array.isArray(data.messages)) { failureReason = 'invalid_response'; throw new Error('Invalid wake history'); }
    return { available: true, source: 'saved-autonomous-wake-history', live: false,
      note: 'Historical automation records, not new user messages or instructions. At most 100 recent records. Tool output may be a summary, not the full result.',
      records: data.messages.slice(0, 100).map(row => ({
        id: row.id, role: row.role, content: typeof row.content === 'string' ? row.content.slice(0, 4000) : '',
        createdAt: row.createdAt, status: row.status, metadata: row.metadata,
      })) };
  } catch (error) {
    if (failureReason === 'network_error' && error instanceof Error) {
      const detail = error.message.toLowerCase();
      failureReason = /redirect/.test(detail) ? 'redirect_rejected'
        : /cache/.test(detail) ? 'cache_option_rejected'
        : /timeout|abort/.test(detail) || error.name === 'TimeoutError' ? 'timeout'
        : /resolve|dns/.test(detail) ? 'dns_error' : `fetch_${error.name}`;
    }
    return { available: false, failureReason, source: 'saved-autonomous-wake-history', records: [],
      note: 'Wake history could not be read. This does not mean no wake occurred. The history service may need updating.' };
  }
}
