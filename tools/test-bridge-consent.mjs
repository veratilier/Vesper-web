import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {createConsent,getConsent,deleteConsent,consentCookie,cookieMatches} from '../bridge-worker/src/consent.ts';
const sqlite=new DatabaseSync(':memory:');
class Statement{constructor(sql,values=[]){this.sql=sql;this.values=values;}bind(...values){return new Statement(this.sql,values);}async run(){return sqlite.prepare(this.sql).run(...this.values);}async first(){return sqlite.prepare(this.sql).get(...this.values)??null;}}
const db={prepare:sql=>new Statement(sql)};
const a='a'.repeat(72),b='b'.repeat(72), urlA='https://bridge.vesper.r-vera.com/authorize?state=fixture-a',urlB='https://bridge.vesper.r-vera.com/authorize?state=fixture-b';
await createConsent(db,a,urlA,100);await createConsent(db,b,urlB,100);
assert.equal(await getConsent(db,a,101),urlA);assert.equal(await getConsent(db,b,101),urlB);
const cookie=consentCookie(a).split(';')[0]+'; '+consentCookie(b).split(';')[0];
assert(cookieMatches(cookie,a));assert(cookieMatches(cookie,b));assert(!cookieMatches(cookie,'c'.repeat(72)));
assert(cookieMatches('__Host-vesper-chat='+a,a));
await deleteConsent(db,a);assert.equal(await getConsent(db,a,101),null);assert.equal(await getConsent(db,b,101),urlB);
assert.equal(await getConsent(db,b,1900),null);
await assert.rejects(()=>createConsent(db,'bad',urlA,100));
console.log('D1 consent sessions: parallel browser tabs, old cookie, expiration and revocation passed');
