import { OAuthProvider, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
export type OAuthEnv = { OAUTH_KV: KVNamespace; OAUTH_PROVIDER: OAuthHelpers };
export const OAUTH_ORIGIN = 'https://mcp.vesper.r-vera.com';
const scope = 'vesper:access';
const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function allowedChatGPTRedirect(value: string) {
  try { const u = new URL(value); return u.origin === 'https://chatgpt.com' && !u.search && !u.hash && (u.pathname === '/connector_platform_oauth_redirect' || /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(u.pathname)); } catch { return false; }
}
function page(body: string, cookie?: string, status = 200) {
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接 Vesper</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:linear-gradient(130deg,#edf4f8,#dce5ef);color:#263947;font:16px/1.65 system-ui}main{max-width:420px;margin:24px;padding:28px;border:1px solid #cbd9e3;border-radius:24px;background:#ffffffd9}h1{font:italic 32px Georgia}input,button{box-sizing:border-box;width:100%;padding:14px;margin-top:12px;border:1px solid #b8cbd8;border-radius:12px;font:inherit}button{background:#304b60;color:white}small{display:block;color:#536b7d}a{color:inherit}</style><main>${body}</main></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'", ...(cookie ? { 'set-cookie': cookie } : {}) } });
}
export function createOAuth<Env extends OAuthEnv>(api: ExportedHandler<Env>, fallback: ExportedHandler<Env>, verifyOwner: (request: Request, env: Env) => Promise<boolean>) {
  const provider = new OAuthProvider<Env>({
    apiRoute: '/mcp', apiHandler: api as ExportedHandler<Env> & Required<Pick<ExportedHandler<Env>, 'fetch'>>,
    authorizeEndpoint: '/authorize', tokenEndpoint: '/oauth/token', clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true, allowImplicitFlow: false, allowPlainPKCE: false,
    accessTokenTTL: 3600, refreshTokenTTL: 30 * 86400, scopesSupported: [scope],
    resourceMetadata: { resource: `${OAUTH_ORIGIN}/mcp`, authorization_servers: [OAUTH_ORIGIN], scopes_supported: [scope], resource_name: 'Vesper private space' },
    defaultHandler: { async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname !== '/authorize') return fallback.fetch!(request, env, ctx);
      if (!env.OAUTH_KV) return page('OAuth 存储尚未配置，请完成部署后重试。', undefined, 503);
      try {
        if (request.method === 'GET') {
          const auth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
          if (!allowedChatGPTRedirect(auth.redirectUri)) return page('此连接的回调地址尚未允许。', undefined, 400);
          if (auth.scope.some(s => s !== scope)) return page('请求了不支持的权限。', undefined, 400);
          const nonce = crypto.randomUUID() + crypto.randomUUID();
          await env.OAUTH_KV.put(`consent:${nonce}`, request.url, { expirationTtl: 600 });
          const client = await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
          return page(`<h1>Connect Vesper</h1><p>允许 ${escape(client?.clientName || 'ChatGPT')} 访问你的小窝？</p><p>可读取和写入便笺、日记、提醒、记忆、相册与 Desire 状态及小记，并发送通知。</p><form method="post" action="/authorize"><input type="hidden" name="csrf" value="${nonce}"><label>Vesper MCP 访问令牌<input type="password" name="token" autocomplete="off" required minlength="16"></label><small>使用 Vesper 设置中已有的访问令牌；不需要发到聊天里。</small><button name="decision" value="allow">确认并连接</button><button name="decision" value="deny" formnovalidate>取消</button></form>`, `__Host-vesper-oauth=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
        }
        if (request.method !== 'POST') return page('Method not allowed', undefined, 405);
        if (request.headers.get('origin') !== OAUTH_ORIGIN) return page('授权请求来源无效。', undefined, 403);
        const raw = await request.text(); if (raw.length > 12000) return page('请求过大。', undefined, 400);
        const form = new URLSearchParams(raw);
        const nonce = form.get('csrf') || '';
        const cookie = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('__Host-vesper-oauth='))?.slice('__Host-vesper-oauth='.length);
        if (!/^[a-f0-9-]{72}$/.test(nonce) || nonce !== cookie) return page('授权页面已失效，请重新连接。', undefined, 403);
        const original = await env.OAUTH_KV.get(`consent:${nonce}`);
        if (!original) return page('授权页面已过期，请重新连接。', undefined, 403);
        // Re-validate trusted server-stored parameters; never deserialize a client-supplied auth request.
        const auth = await env.OAUTH_PROVIDER.parseAuthRequest(new Request(original));
        if (!allowedChatGPTRedirect(auth.redirectUri)) return page('回调地址无效。', undefined, 400);
        if (form.get('decision') === 'deny') {
          await env.OAUTH_KV.delete(`consent:${nonce}`);
          const denied = new URL(auth.redirectUri); denied.searchParams.set('error', 'access_denied'); denied.searchParams.set('state', auth.state || ''); denied.searchParams.set('iss', OAUTH_ORIGIN);
          return Response.redirect(denied, 303);
        }
        const check = new Request(`${OAUTH_ORIGIN}/mcp`, { headers: { authorization: `Bearer ${(form.get('token') || '').trim()}` } });
        if (form.get('decision') !== 'allow' || !await verifyOwner(check, env)) return page('访问令牌无效；请返回重新连接。', undefined, 401);
        await env.OAUTH_KV.delete(`consent:${nonce}`);
        const granted = await env.OAUTH_PROVIDER.completeAuthorization({ request: auth, userId: 'vesper-owner', metadata: { clientName: 'ChatGPT' }, scope: [scope], props: { owner: true, scope: [scope] } });
        const response = new Response(null, { status: 303, headers: { location: granted.redirectTo, 'cache-control': 'no-store', 'set-cookie': '__Host-vesper-oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } });
        return response;
      } catch { return page('无法完成授权。请从 ChatGPT 重新发起连接，检查访问令牌和部署配置。', undefined, 400); }
    } },
  });
  return provider;
}
