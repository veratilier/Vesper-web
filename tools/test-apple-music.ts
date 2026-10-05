import assert from 'node:assert/strict';
import { appleTrack, searchAppleMusic, lookupAppleMusic } from '../lib/apple-music-search.ts';
const raw = { kind:'song', trackId:123, trackName:'Test song', artistName:'Artist', collectionName:'Album', artworkUrl100:'https://is1-ssl.mzstatic.com/image.jpg', trackViewUrl:'https://music.apple.com/cn/album/test/456?i=123', trackTimeMillis:210000 };
assert.equal(appleTrack(raw)?.appleMusicId,'123'); assert.equal(appleTrack(raw)?.duration,210);
assert.equal(appleTrack({...raw,kind:'album'}),null);
const tracks = await searchAppleMusic('Test song', 5, async(url) => {
  assert.equal(new URL(String(url)).searchParams.get('country'),'tw');
  return new Response(JSON.stringify({results:[raw,{kind:'collection'}]}));
});
assert.equal(tracks.length,1); assert.equal(tracks[0].cover,raw.artworkUrl100);
await assert.rejects(searchAppleMusic('song',5,async()=>new Response('',{status:503})),/HTTP 503/);
let requests = 0;
const fallback = await searchAppleMusic('中文歌曲', 3, async url => {
  requests++; const country = new URL(String(url)).searchParams.get('country');
  return new Response(JSON.stringify({results: country === 'tw' ? [] : [raw]}));
});
assert.equal(requests,2); assert.equal(fallback[0].artist,'Artist');
console.log('Apple Music metadata contract: passed');

assert.equal((await lookupAppleMusic('123',async()=>new Response(JSON.stringify({results:[raw]}))))?.title,'Test song');
assert.equal(await lookupAppleMusic('invalid'),null);

const { appleSearchTransport } = await import('../lib/apple-music-transport.ts');
let calls = 0;
const transport = appleSearchTransport('test-secret', async (url, options) => {
  calls++;
  assert.equal(String(url), 'https://codex.r-vera.com/history/music/search');
  assert.equal(options?.redirect, 'manual');
  assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-secret');
  assert.deepEqual(JSON.parse(String(options?.body)), {query:'Test song',country:'tw',limit:5});
  return new Response(JSON.stringify({results:[raw]}));
});
assert.equal((await searchAppleMusic('Test song',5,transport))[0].appleMusicId,'123');
await assert.rejects(transport('https://example.com/search'),/unavailable/);
assert.equal(calls,1);
let lookupCalls = 0;
const lookupTransport = appleSearchTransport('test-secret', async (url, options) => {
  lookupCalls++;
  assert.equal(String(url),'https://codex.r-vera.com/history/music/search');
  assert.deepEqual(JSON.parse(String(options?.body)),{trackId:'123',country:'tw'});
  return new Response(JSON.stringify({results:[raw]}));
});
assert.equal((await lookupAppleMusic('123',lookupTransport))?.appleMusicId,'123');
assert.equal(lookupCalls,1);
await assert.rejects(lookupTransport('https://itunes.apple.com/arbitrary'),/unavailable/);
await assert.rejects(appleSearchTransport('')('https://itunes.apple.com/search'),/unavailable/);
console.log('Authenticated Apple Music transport: passed');

await assert.rejects(appleSearchTransport('test-secret', async () => new Response(null, {status:302,headers:{location:'https://example.com'}}))('https://itunes.apple.com/search'),/redirect rejected/);

const { isAppleMusicTrack } = await import('../lib/apple-music-search.ts');
assert.equal(isAppleMusicTrack({id:'apple-123',appleMusicId:'123'}),true);
assert.equal(isAppleMusicTrack({id:'netease-123',appleMusicId:'123'}),false);
assert.equal(isAppleMusicTrack({id:'123',neteaseId:'123'}),false);
assert.equal(isAppleMusicTrack({id:'123',source:'netease',appleMusicId:'123'}),false);
assert.equal(isAppleMusicTrack({id:'123'}),false);
