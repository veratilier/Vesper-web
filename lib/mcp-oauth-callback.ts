// Native callbacks carry only the OAuth response. The PKCE verifier stays in
// the initiating WebView and is never included in the browser redirect.
export const NATIVE_OAUTH_PREFIX = 'vesper-native-';
export const NATIVE_OAUTH_CALLBACK = 'com.rvera.vesper://mcp/oauth/callback';
export function oauthCallbackDestination(incoming: URL): URL {
  const state = incoming.searchParams.get('state') || '';
  const native = /^vesper-native-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state);
  const destination = new URL(native ? NATIVE_OAUTH_CALLBACK : '/', incoming.origin);
  if (!native) destination.searchParams.set('mcp-oauth', '1');
  for (const key of ['code', 'state', 'error', 'error_description', 'error_uri']) {
    const value = incoming.searchParams.get(key);
    if (value) destination.searchParams.set(key, value);
  }
  return destination;
}
export function nativeOAuthCode(callback: string, expectedState: string): string {
  const url = new URL(callback);
  const expected = new URL(NATIVE_OAUTH_CALLBACK);
  if (url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname || url.username || url.password) throw new Error('Unexpected OAuth callback URL');
  if (!expectedState || url.searchParams.get('state') !== expectedState) throw new Error('OAuth state mismatch');
  if (url.searchParams.has('error')) throw new Error(url.searchParams.get('error_description') || url.searchParams.get('error') || 'Authorization cancelled');
  const code = url.searchParams.get('code');
  if (!code) throw new Error('The OAuth callback is missing an authorization code.');
  return code;
}
