import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sqlite = new DatabaseSync(':memory:');
const db = {
  prepare(sql) {
    const stmt = (args = []) => ({
      bind: (...values) => stmt(values),
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
    });
    return stmt();
  },
  async batch(statements) { for (const statement of statements) await statement.run(); },
};
globalThis.__quoteFixture = { DB: db, VESPER_APP_TOKEN: 'fixture-token' };
const originalFetch = globalThis.fetch;
const commonsCalls = [];
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, 'commons.wikimedia.org');
  assert.ok(options.headers['User-Agent'].includes('VesperQuote'));
  commonsCalls.push(url);
  return Response.json({ query: { pages: { 1: {
    title: 'File:Mist in the trees - Public Domain.jpg', imageinfo: [{
      mime: 'image/jpeg', thumburl: 'https://upload.wikimedia.org/example.jpg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Mist_in_the_trees_-_Public_Domain.jpg',
      extmetadata: { LicenseShortName: { value: 'CC0' } },
    }],
  } } } });
};
const directory = await mkdtemp(join(tmpdir(), 'vesper-quote-tests-'));
try {
  const modules = {};
  for (const [name, entry] of Object.entries({ route: 'app/api/daily-quotes/route.ts', tools: 'app/api/codex/tools/route.ts', store: 'lib/daily-quotes.ts' })) {
    const outfile = join(directory, name + '.mjs');
    await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'fixture', setup(build) {
      build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'env', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export function waitUntil(p){return p;} export const env=globalThis.__quoteFixture;', loader: 'js' }));
    } }] });
    modules[name] = await import(pathToFileURL(outfile));
  }
  const request = (method, path, body, auth = true) => new Request('https://vesper.test' + path, {
    method, headers: { 'content-type': 'application/json', ...(auth ? { 'x-vesper-device-token': 'fixture-token' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const tool = async (name, arguments_) => {
    const response = await modules.tools.POST(request('POST', '/api/codex/tools', { name, arguments: arguments_ }));
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await modules.route.GET(request('GET', '/api/daily-quotes', null, false))).status, 401);
  const first = await (await modules.route.GET(request('GET', '/api/daily-quotes'))).json();
  assert.equal(first.cards.length, 0, 'opening the page must not fabricate cards or images');
  const candidates = await tool('daily_quote_candidates', {});
  assert.equal(candidates.status, 200);
  const found = await tool('daily_quote_image_search', { query: 'mountain mist' });
  assert.equal(found.status, 200, JSON.stringify(found.body));
  assert.equal(found.body.result.images.length, 1);
  assert.ok(commonsCalls[0].searchParams.get('gsrsearch').includes('public domain'));
  const input = { day: first.today, slot: 0, candidateId: candidates.body.result.candidates[0].candidateId,
    fileTitle: found.body.result.images[0].fileTitle, searchProof: found.body.result.images[0].searchProof };
  const published = await tool('daily_quote_publish', input);
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(commonsCalls.length, 2, 'publishing must independently verify the chosen Commons file');
  const repeated = await tool('daily_quote_publish', input);
  assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
  const card = (await (await modules.route.GET(request('GET', '/api/daily-quotes'))).json()).cards[0];
  assert.equal(card.imagePageURL, 'https://commons.wikimedia.org/wiki/File:Mist_in_the_trees_-_Public_Domain.jpg');
  assert.equal(card.licence, 'CC0');
  assert.equal((await tool('daily_quote_publish', { ...input, slot: 1, searchProof: 'a'.repeat(64) })).status, 400);
  assert.equal((await tool('daily_quote_publish', { ...input, fileTitle: 'https://invented.test/photo.jpg' })).status, 400);
  assert.equal((await modules.route.POST(request('POST', '/api/daily-quotes', { action: 'keep', cardId: card.id, kept: true }))).status, 200);
  assert.equal((await modules.route.POST(request('POST', '/api/daily-quotes', { action: 'comment', id: 'private-1', cardId: card.id, body: 'Only for Ash' }))).status, 200);
  assert.equal((await modules.route.POST(request('POST', '/api/daily-quotes', { action: 'comment', id: 'private-1', cardId: card.id, body: 'Changed on retry' }))).status, 400);
  const reply = await tool('daily_quote_comment', { id: 'reply-1', cardId: card.id, body: 'I saw this.' });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.equal(reply.body.result.comment.author, 'Ash');
  const second = await (await modules.route.GET(request('GET', '/api/daily-quotes'))).json();
  assert.equal(second.cards.length, 1);
  assert.equal(second.cards.find(item => item.id === card.id).kept, true);
  assert.deepEqual(second.cards.find(item => item.id === card.id).comments.map(item => item.author), ['Vera', 'Ash']);
  assert.equal((await tool('daily_quote_preferences', { categories: ['自然'], dailyCount: 5 })).status, 200);
  const third = await (await modules.route.GET(request('GET', '/api/daily-quotes'))).json();
  assert.equal(third.cards.length, 1);
  assert.equal(third.cards.find(item => item.id === card.id).text, card.text);
  assert.ok((await tool('daily_quote_candidates', {})).body.result.candidates.every(item => item.category === '自然'));
  assert.equal((await modules.route.POST(request('POST', '/api/daily-quotes', { action: 'preferences', dailyCount: 6 }))).status, 400);
  assert.equal((await modules.route.POST(request('POST', '/api/daily-quotes', { action: 'preferences', notify: false }))).status, 200);
  assert.equal((await (await modules.route.GET(request('GET', '/api/daily-quotes'))).json()).preferences.notify, false);
  const other = await modules.store.listDailyQuotes('other-user');
  assert.equal(other.cards.length, 0);
  console.log('PASS real Commons image search and verification, no generated cards, scoped favorites/comments, private Ash reply, idempotency and preferences');
} finally { globalThis.fetch = originalFetch; sqlite.close(); await rm(directory, { recursive: true, force: true }); }
