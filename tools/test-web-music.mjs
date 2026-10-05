import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const sqlite = new DatabaseSync(':memory:');
const db = {
  prepare(sql) { const stmt=(args=[])=>({bind:(...values)=>stmt(values),first:async()=>sqlite.prepare(sql).get(...args)??null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>sqlite.prepare(sql).run(...args)});return stmt(); },
  async batch(statements) { for(const s of statements) await s.run(); },
};
globalThis.__webMusicFixture={ DB:db,VESPER_APP_TOKEN:'fixture-token' };
const directory=await mkdtemp(join(tmpdir(),'vesper-web-music-tests-'));
try {
  const modules={};
  for(const [name,entry] of Object.entries({state:'app/api/state/route.ts',tools:'app/api/codex/tools/route.ts',playback:'lib/web-music-playback.ts'})) {
    const outfile=join(directory,name+'.mjs');
    await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'esm',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export function waitUntil(p){return p;} export const env=globalThis.__webMusicFixture;',loader:'js'}));}}]});
    modules[name]=await import(pathToFileURL(outfile));
  }
  const request=(method,path,body,auth=true)=>new Request('https://vesper.test'+path,{method,headers:{'content-type':'application/json',...(auth?{'x-vesper-device-token':'fixture-token'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const get=async key=>(await modules.state.GET(request('GET','/api/state?key='+key))).json();
  const put=async(key,value)=>modules.state.PUT(request('PUT','/api/state',{key,value}));
  const tool=async(name,args,surface='web')=>modules.tools.POST(request('POST','/api/codex/tools',{name,arguments:args,...(surface?{musicSurface:surface}:{})}));
  assert.equal((await modules.state.GET(request('GET','/api/state?key=webMusicQueue',null,false))).status,401);
  await get('musicQueue'); // initializes schema only
  const apple={id:'apple-99',appleMusicId:'99',title:'Native song',artist:'Artist',playable:true};
  const net={id:'netease-123',neteaseId:'123',title:'Web song',artist:'Artist',url:'',playable:false};
  const net2={...net,id:'netease-456',neteaseId:'456',title:'Second song'};
  sqlite.prepare('INSERT INTO vesper_documents VALUES(?,?,?)').run('musicQueue',JSON.stringify([apple,net]),'legacy-fixture');
  await put('music',[apple]);
  await put('webMusic',[net,net2]);
  const original=sqlite.prepare('SELECT * FROM vesper_documents WHERE key=?').get('musicQueue');
  assert.deepEqual((await get('webMusicQueue')).value,[net]);
  assert.deepEqual(sqlite.prepare('SELECT * FROM vesper_documents WHERE key=?').get('musicQueue'),original);
  // Clearing Web is an intentional empty queue, never repopulated from native.
  await put('webMusicQueue',[]);
  assert.deepEqual((await get('webMusicQueue')).value,[]);
  await put('musicQueue',[apple,net2]);
  assert.deepEqual((await get('webMusicQueue')).value,[]);
  const nativeBefore=sqlite.prepare('SELECT * FROM vesper_documents WHERE key=?').get('musicQueue');
  const bad=await tool('music_queue_add',{trackId:apple.id});
  assert.equal(bad.status,400);
  assert.deepEqual((await get('webMusicQueue')).value,[]);
  const play=await tool('music_play',{trackId:net.id});
  assert.equal(play.status,200,await play.clone().text());
  assert.equal((await play.json()).result.action,'play_requested');
  assert.deepEqual((await get('webMusicQueue')).value,[net]);
  assert.equal((await get('webMusicControl')).value.trackId,net.id);
  assert.deepEqual(sqlite.prepare('SELECT * FROM vesper_documents WHERE key=?').get('musicQueue'),nativeBefore);
  assert.equal((await get('musicControl')).value,null);
  await put('webMusicPlayback',{trackId:net.id,playing:false,positionSeconds:0});
  await put('musicPlayback',{trackId:apple.id,playing:true,positionSeconds:42});
  assert.equal((await (await tool('music_get_status',{})).json()).result.playback.track.trackId,net.id);
  assert.equal((await (await tool('music_get_status',{},null)).json()).result.playback.track.trackId,apple.id);
  await tool('music_control',{action:'pause'});
  assert.equal((await get('webMusicControl')).value.action,'pause');
  assert.equal((await get('musicControl')).value,null);
  await tool('music_control',{action:'pause'},null);
  assert.equal((await get('musicControl')).value.action,'pause');
  // Named Vesper playlists persist independently of playback and Apple's library.
  const apple2={...apple,id:'apple-100',appleMusicId:'100',title:'Another song',source:'appleMusic'};
  await put('music',[apple,apple2]);
  const queueBefore=JSON.stringify((await get('musicQueue')).value);
  const createArgs={name:'Evening',requestId:'playlist-fixture',trackIds:[apple.id,apple.id]};
  const created=await tool('music_playlist_create',createArgs,null);
  assert.equal(created.status,200,await created.clone().text());
  const playlist=(await created.json()).result.playlist;
  assert.equal(playlist.name,'Evening');assert.equal(playlist.tracks.length,1);
  assert.equal(JSON.stringify((await get('musicQueue')).value),queueBefore);
  const retry=await tool('music_playlist_create',createArgs,null);
  assert.equal((await retry.json()).result.alreadyCreated,true);
  assert.equal((await (await tool('music_playlist_list',{},null)).json()).result.playlists.length,1);
  assert.equal((await tool('music_playlist_create',{...createArgs,trackIds:[apple2.id]},null)).status,400);
  assert.equal((await tool('music_playlist_create',{name:'Broken',requestId:'invalid-fixture',trackIds:['not-a-song']},null)).status,400);
  assert.equal((await get('musicPlaylists')).value.length,1,'invalid song cannot partially create a playlist');
  const added=await tool('music_playlist_add',{playlistId:playlist.id,trackId:apple2.id},null);
  assert.equal((await added.json()).result.playlist.tracks.length,2);
  const repeated=await tool('music_playlist_add',{playlistId:playlist.id,trackId:apple2.id},null);
  assert.equal((await repeated.json()).result.alreadyInPlaylist,true);
  assert.equal((await tool('music_playlist_add',{playlistId:'missing',trackId:apple.id},null)).status,400);
  const playList=await tool('music_playlist_play',{playlistId:playlist.id},null);
  const playbackRequest=(await playList.json()).result;
  assert.equal(playbackRequest.action,'play_requested');
  assert.deepEqual(playbackRequest.command.queue.map(t=>t.id),[apple.id,apple2.id]);
  assert.deepEqual((await get('musicQueue')).value.map(t=>t.id),[apple.id,apple2.id]);
  assert.equal((await get('webMusicQueue')).value[0].id,net.id);
  await put('musicPlayback',{trackId:apple.id,positionSeconds:10,durationSeconds:180});
  const seek=await tool('music_seek',{positionSeconds:45},null);
  assert.equal(seek.status,200);assert.equal((await seek.json()).result.command.trackId,apple.id);
  assert.equal((await get('musicControl')).value.positionSeconds,45);
  for(const positionSeconds of [-1,'30',null]) assert.equal((await tool('music_seek',{positionSeconds},null)).status,400);
  assert.equal((await tool('music_seek',{positionSeconds:30},'web')).status,400);
  await put('musicPlayback',{});
  assert.equal((await tool('music_seek',{positionSeconds:30},null)).status,400);
  assert.equal((await modules.tools.POST(request('POST','/api/codex/tools',{name:'music_playlist_list',arguments:{}},false))).status,401);
  console.log('PASS Vesper playlists: saved create/list/add/play, retry identity, invalid tracks, deduplication, playback isolation, seek validation and authorization');
  // Resolution refreshes expired/missing URLs by exact NetEase ID only.
  let calls=0;
  const source=await modules.playback.resolveWebMusic(net,async payload=>{
    calls++;assert.deepEqual(payload.songIds,['123']);
    return {tracks:[{...net,url:'https://example.com/fresh.mp3',playable:true}]};
  });
  assert.equal(source,'https://example.com/fresh.mp3'); assert.equal(calls,1);
  await assert.rejects(modules.playback.resolveWebMusic(apple,async()=>{throw new Error('must not resolve Apple ID');}),/Web 使用网易云/);
  await assert.rejects(modules.playback.resolveWebMusic(net,async()=>({tracks:[net]})),/播放权限/);
  await assert.rejects(modules.playback.resolveWebMusic(net,async()=>({tracks:[{...net2,url:'https://example.com/wrong.mp3'}]})),/播放权限/);
  const page=await readFile('app/page.tsx','utf8');
  assert.ok(!page.includes('src={currentTrack?.url}'));
  assert.ok(page.includes('musicSurface: "web"'));
  console.log('PASS real state/tool routes: one-time filtered migration, native preservation, separate queue/control/status, empty queue persistence, exact NetEase resolution and unavailable audio');
} finally {sqlite.close();await rm(directory,{recursive:true,force:true});}
