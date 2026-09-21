import assert from 'node:assert/strict';
import { codexToolDefinitions, validateCodexToolCatalog } from '../lib/codex-tool-definitions.ts';
import { attachmentInputText } from '../app/codex-attachment-input.ts';
const names = codexToolDefinitions.map(tool => tool.name);
assert.equal(new Set(names).size, names.length);
for (const name of ['album_save_photo', 'album_search_photos', 'album_send_photos', 'send_chat_file', 'sticker_search', 'sticker_send']) assert.ok(names.includes(name), name);
assert.deepEqual(validateCodexToolCatalog(codexToolDefinitions), codexToolDefinitions);
assert.throws(() => validateCodexToolCatalog(codexToolDefinitions.filter(tool => !tool.name.startsWith('album_'))), /更新 API/);
assert.throws(() => validateCodexToolCatalog([]), /为空/);
assert.throws(() => validateCodexToolCatalog(null), /为空/);
assert.ok(validateCodexToolCatalog(codexToolDefinitions.map(({type, ...tool}) => tool)).every(tool => tool.type === 'function'));
const save = codexToolDefinitions.find(tool => tool.name === 'album_save_photo');
assert.deepEqual(save.inputSchema.required, ['key', 'category', 'evaluation']);
const input = attachmentInputText({ key: 'owner/photo.jpg', name: 'photo.jpg', type: 'image/jpeg', size: 100, url: 'https://vesper.r-vera.com/api/media/photo' });
assert.ok(input.includes('Vesper photo key: "owner/photo.jpg"'));
assert.ok(input.includes('album_save_photo'));
console.log('Shared album/file/sticker tool schema, stale catalog rejection and exact attachment keys passed');

assert.throws(() => validateCodexToolCatalog([...codexToolDefinitions, codexToolDefinitions[0]]), /重复名称/);
