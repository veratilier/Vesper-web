import assert from 'node:assert/strict';
import { appleTrack, searchAppleMusic, lookupAppleMusic } from '../lib/apple-music-search.ts';
const raw = { kind:'song', trackId:123, trackName:'Test song', artistName:'Artist', collectionName:'Album', artworkUrl100:'https://is1-ssl.mzstatic.com/image.jpg', trackViewUrl:'https://music.apple.com/cn/album/test/456?i=123', trackTimeMillis:210000 };
assert.equal(appleTrack(raw)?.appleMusicId,'123'); assert.equal(appleTrack(raw)?.duration,210);
assert.equal(appleTrack({...raw,kind:'album'}),null);
const tracks = await searchAppleMusic('Test song', 5, async(url) => {
  assert.equal(new URL(String(url)).searchParams.get('country'),'cn');
  return new Response(JSON.stringify({results:[raw,{kind:'collection'}]}));
});
assert.equal(tracks.length,1); assert.equal(tracks[0].cover,raw.artworkUrl100);
await assert.rejects(searchAppleMusic('song',5,async()=>new Response('',{status:503})),/HTTP 503/);
let requests = 0;
const fallback = await searchAppleMusic('中文歌曲', 3, async url => {
  requests++; const country = new URL(String(url)).searchParams.get('country');
  return new Response(JSON.stringify({results: country === 'cn' ? [] : [raw]}));
});
assert.equal(requests,2); assert.equal(fallback[0].artist,'Artist');
console.log('Apple Music metadata contract: passed');

assert.equal((await lookupAppleMusic('123',async()=>new Response(JSON.stringify({results:[raw]}))))?.title,'Test song');
assert.equal(await lookupAppleMusic('invalid'),null);
