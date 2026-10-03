import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'vesper-voice-http-'));
const originalFetch = globalThis.fetch;
try {
  const routes = {};
  for (const name of ['ai', 'tts']) {
    const file = join(dir, `${name}.mjs`);
    await build({ entryPoints: [`app/api/${name}/route.ts`], outfile: file, bundle: true, platform: 'node', format: 'esm',
      plugins: [{ name: 'isolated-worker-env', setup(builder) {
        builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'env', namespace: 'test-env' }));
        builder.onLoad({ filter: /.*/, namespace: 'test-env' }, () => ({ contents: 'export const env = {};', loader: 'js' }));
      } }],
    });
    routes[name] = await import(pathToFileURL(file).href);
  }
  const origin = 'https://vesper.r-vera.com';
  const request = (name, body, source = origin) => new Request(`https://api.vesper.r-vera.com/api/${name}`, {
    method: 'POST', headers: { origin: source, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  for (const name of ['ai', 'tts']) {
    const preflight = routes[name].OPTIONS(new Request(`https://api.vesper.r-vera.com/api/${name}`, { method: 'OPTIONS', headers: { origin } }));
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.match(preflight.headers.get('access-control-allow-headers'), /x-vesper-device-token/);
    const invalid = await routes[name].POST(request(name, {}));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get('access-control-allow-origin'), origin);
    const foreign = await routes[name].POST(request(name, {}, 'https://untrusted.example'));
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  }
  const voice = { text: 'synthetic fixture', connection: { baseUrl: 'https://voice.example/v1', apiKey: 'test-only', provider: 'openai' } };
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
  const audio = await routes.tts.POST(request('tts', voice));
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get('access-control-allow-origin'), origin);
  assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())], [1, 2, 3]);
  globalThis.fetch = async () => new Response('provider error', { status: 502 });
  const failure = await routes.tts.POST(request('tts', voice));
  assert.equal(failure.status, 502);
  assert.equal(failure.headers.get('access-control-allow-origin'), origin);
  console.log('Voice HTTP: allowed-origin preflight, validation errors, audio and provider failures passed; foreign origins remain blocked.');
} finally { globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true }); }
