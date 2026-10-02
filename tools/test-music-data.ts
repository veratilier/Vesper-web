import assert from 'node:assert/strict';
import { cleanMusicDocument } from '../lib/music-data.ts';
const apple = {id:'apple-1',appleMusicId:'1',title:'Keep',custom:{preserved:true}};
const old = {id:'netease-1',neteaseId:'1'};
const unknown = {title:'Unknown provenance: keep'};
for (const key of ['music','musicQueue','musicFavorites']) {
  assert.deepEqual(cleanMusicDocument(key,[apple,old,unknown,'netease-2','apple-2']),[apple,unknown,'apple-2']);
  // Repeated stale client sync cannot reintroduce a deleted provider.
  assert.deepEqual(cleanMusicDocument(key,[old,...cleanMusicDocument(key,[apple,old]) as unknown[]]),[apple]);
}
assert.deepEqual(cleanMusicDocument('musicAnnotations',{'netease-1':{},'apple-1':{body:'Keep'}}),{'apple-1':{body:'Keep'}});
assert.deepEqual(cleanMusicDocument('musicPlayback',{nativePlayback:{track:old},custom:'keep'}),{custom:'keep'});
assert.deepEqual(cleanMusicDocument('musicControl',{trackId:'netease-1'}),{});
assert.deepEqual(cleanMusicDocument('musicPlayback',{nativePlayback:{track:apple}}),{nativePlayback:{track:apple}});
assert.deepEqual(cleanMusicDocument('chat',[old]),[old]);
assert.deepEqual(cleanMusicDocument('notes',[old]),[old]);
console.log('Music-only legacy filtering and stale-sync regression passed');

assert.deepEqual(cleanMusicDocument('music',[{...apple,neteaseId:'legacy'}]),[{...apple,neteaseId:'legacy'}]);
