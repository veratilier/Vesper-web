/** One authenticated, rate-limited catalog origin; no client-supplied target URLs. */
export function appleSearchTransport(token: string, request: typeof fetch = fetch): typeof fetch {
  return async input => {
    const url = new URL(String(input));
    if (!token || url.origin !== 'https://itunes.apple.com' || url.pathname !== '/search') {
      throw new Error('Apple Music search transport is unavailable');
    }
    const response = await request('https://codex.r-vera.com/history/music/search', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(12000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: url.searchParams.get('term'), country: url.searchParams.get('country'), limit: Number(url.searchParams.get('limit')) }),
    });
    if (response.status >= 300 && response.status < 400) throw new Error('Apple Music search redirect rejected');
    return response;
  };
}
