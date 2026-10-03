import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const sqlite = new DatabaseSync(':memory:');
const db = { prepare(sql) {
  let values = [];
  return { bind(...args) { values = args; return this; }, async run() { return sqlite.prepare(sql).run(...values); }, async first() { return sqlite.prepare(sql).get(...values) || null; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; } };
} };
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/photo-album.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require(name) { assert.equal(name, './db'); return { getDb: () => db }; }, crypto: globalThis.crypto });
const { registerPhotoSource, saveAlbumPhoto, listAlbumPhotos, getAlbumPhoto } = exports;
const origin = 'https://example.test';
await registerPhotoSource('vera', { key: 'abc-123.jpg', name: '100% sky.jpg', type: 'image/jpeg', size: 20 }, 'user');
assert.equal((await listAlbumPhotos('vera', {}, origin)).photos.length, 0, 'upload must not archive');
await assert.rejects(saveAlbumPhoto('other', 'abc-123.jpg', '天空', '', origin));
const saved = await saveAlbumPhoto('vera', 'abc-123.jpg', '天空', '窗边', origin);
await registerPhotoSource('vera', { key: 'abc-123.jpg', name: '100% sky.jpg', type: 'image/jpeg', size: 20 }, 'user');
const updated = await saveAlbumPhoto('vera', 'abc-123.jpg', '夜晚', undefined, origin);
assert.equal(updated.id, saved.id); assert.equal(updated.savedAt, saved.savedAt); assert.equal(updated.caption, '窗边');
assert.equal((await listAlbumPhotos('other', {}, origin)).photos.length, 0);
await assert.rejects(getAlbumPhoto('other', saved.id, origin));
assert.equal((await listAlbumPhotos('vera', { query: '100%' }, origin)).photos.length, 1);
assert.equal((await listAlbumPhotos('vera', { query: '_' }, origin)).photos.length, 0, 'search must escape SQL wildcards');
assert.equal((await listAlbumPhotos('vera', { category: '天空' }, origin)).photos.length, 0);
for (let i = 0; i < 3; i++) {
  await registerPhotoSource('vera', { key: `photo-${i}.png`, name: 'picture', type: 'image/png', size: 10 }, 'agent');
  await saveAlbumPhoto('vera', `photo-${i}.png`, '夜晚', '', origin);
}
const first = await listAlbumPhotos('vera', { limit: 2 }, origin);
const second = await listAlbumPhotos('vera', { limit: 2, offset: first.nextOffset }, origin);
assert.equal(new Set([...first.photos, ...second.photos].map(p => p.id)).size, 4);
assert.equal(second.nextOffset, null);
assert.equal(saved.url, 'https://example.test/api/media/abc-123.jpg');
console.log('Album: explicit archive, owner isolation, replay identity, safe search and pagination passed');

await exports.linkPhotoSource('vera', saved.key, { conversationId: 'real-chat', messageId: 'real-message', messageIds: ['real-message'] });
assert.equal((await getAlbumPhoto('vera', saved.id, origin)).sourceMessageId, 'real-message');
assert.equal((await listAlbumPhotos('vera', { query: '100%' }, origin)).photos[0].sourceConversationId, 'real-chat');
assert.equal((await listAlbumPhotos('other', {}, origin)).photos.length, 0, 'provenance must not cross owners');
