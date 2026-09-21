import assert from 'node:assert/strict';
import * as discovery from '../app/api/mcp/oauth/discover/route';
import * as exchange from '../app/api/mcp/oauth/route';
for (const route of [discovery, exchange]) {
  const request = new Request('https://api.vesper.r-vera.com/api/mcp/oauth', {
    method: 'POST', headers: { origin: 'https://vesper.r-vera.com', 'content-type': 'application/json' }, body: '{}',
  });
  const preflight = route.OPTIONS(request);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://vesper.r-vera.com');
  assert.match(preflight.headers.get('access-control-allow-headers')!, /content-type/);
  const response = await route.POST(request);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://vesper.r-vera.com');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const denied = route.OPTIONS(new Request('https://api.vesper.r-vera.com', {headers:{origin:'https://untrusted.example'}}));
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
}
console.log('OAuth CORS: both preflights, readable errors, no-store, and untrusted origin checks passed');
