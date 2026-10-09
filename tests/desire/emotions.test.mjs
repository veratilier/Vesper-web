import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture} from './fixture.mjs';
import {emotionState,emotionEvents,emotionHistory,commitEmotion,settlementReceipt} from '/tmp/vesper-emotion-store-test.mjs';
const values={joy:45,calm:70,sadness:10,anxiety:15,anger:0,closeness:65,curiosity:45,hurt:5};
const event=(id)=>({id,stream:'vps:chat',at:'2026-10-09T04:00:00Z',kind:'user',text:'A real incoming message',outcome:'observed'});
const candidate=(updateId,baseVersion,eventIds)=>({updateId,baseVersion,eventIds,values,reason:'A brief assessment based on actual conversation.',unresolved:'',source:'settlement',cadence:{minutes:45,mode:'calm',reason:'Continue quietly.'}});

test('uninitialized eight values never copy or seed old six-dimensional numbers',async t=>{
 const {adapter,db}=fixture(t);const state=await emotionState(adapter);
 assert.equal(state.schemaVersion,3);assert.equal(state.initialized,false);assert.equal(state.values,null);assert.equal(state.version,0);
 assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='vesper_desire_state'").get().n,0);
 assert.deepEqual(await emotionState(adapter),state);
});
test('CAS collision commits one state/history atomically, retaining losing events for next assessment',async t=>{
 const {adapter,db}=fixture(t);await emotionEvents(adapter,[event('one'),event('two')]);
 const results=await Promise.all([commitEmotion(adapter,candidate('chat-update',0,['one'])),commitEmotion(adapter,candidate('periodic-update',0,['two']))]);
 assert.equal(results.filter(r=>r.committed).length,1);assert.equal(results.filter(r=>r.conflict).length,1);
 assert.equal((await emotionHistory(adapter)).records.length,1);assert.equal((await emotionState(adapter)).version,1);
 const pending=db.prepare('SELECT id FROM vesper_emotion_events WHERE processed_by IS NULL').all();assert.equal(pending.length,1);
 assert.equal((await commitEmotion(adapter,candidate('next',1,[pending[0].id]))).committed,true);
 assert.equal(db.prepare('SELECT count(*) n FROM vesper_emotion_events WHERE processed_by IS NULL').get().n,0);
});
test('duplicate retry and overlapping evidence do not count twice; late low-ID events remain eligible',async t=>{
 const {adapter}=fixture(t);await emotionEvents(adapter,[event('zzz')]);const c=candidate('first',0,['zzz']);
 const first=await commitEmotion(adapter,c);assert.equal(first.version,1);
 assert.equal((await commitEmotion(adapter,c)).duplicate,true);assert.equal((await emotionState(adapter)).version,1);
 assert.equal((await commitEmotion(adapter,candidate('reuse-evidence',1,['zzz']))).conflict,true);
 await emotionEvents(adapter,[event('aaa')]);assert.equal((await commitEmotion(adapter,candidate('late',1,['aaa']))).committed,true);
 assert.equal((await emotionHistory(adapter)).records.length,2);
});
test('transaction interruption rolls back state, history and event consumption together',async t=>{
 const {adapter,db}=fixture(t);await emotionEvents(adapter,[event('one')]);adapter.failAt=2;
 await assert.rejects(commitEmotion(adapter,candidate('interrupted',0,['one'])),/interruption/);delete adapter.failAt;
 assert.equal((await emotionState(adapter)).version,0);assert.equal((await emotionHistory(adapter)).records.length,0);
 assert.equal(db.prepare('SELECT processed_by FROM vesper_emotion_events').get().processed_by,null);
 assert.equal((await commitEmotion(adapter,candidate('interrupted',0,['one']))).committed,true);
});
test('no new events can preserve initialized values and model failure never overwrites them',async t=>{
 const {adapter}=fixture(t);await emotionEvents(adapter,[event('one')]);await commitEmotion(adapter,candidate('init',0,['one']));
 await commitEmotion(adapter,candidate('continuity',1,[]));assert.deepEqual((await emotionState(adapter)).values,values);
 await settlementReceipt(adapter,'gpt-6-luna','quota reached');const state=await emotionState(adapter);
 assert.equal(state.version,2);assert.equal(state.runtime.error,'quota reached');assert.deepEqual(state.values,values);
});
test('strict full eight values, evidence references, independent scales and calm timing',async t=>{
 const {adapter}=fixture(t);await emotionEvents(adapter,[event('one')]);
 assert.equal((await commitEmotion(adapter,candidate('invented',0,['not-real']))).conflict,true);
 await assert.rejects(commitEmotion(adapter,{...candidate('bad',0,['one']),values:{longing:40}}));
 await assert.rejects(commitEmotion(adapter,{...candidate('bad',0,['one']),cadence:{minutes:20,mode:'calm',reason:'Calm'}}),/30–60/);
 assert.equal((await commitEmotion(adapter,candidate('valid',0,['one']))).committed,true);
 assert.notEqual(Object.values((await emotionState(adapter)).values).reduce((a,b)=>a+b),100);
});
