/** Short-lived authorization state lives in D1 for consistent reads across regions. */
type ConsentRow = { authorization_url:string };
const TTL_SECONDS=1800;
const COOKIE_PREFIX='__Host-vesper-chat-';
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
async function ensure(db:D1Database) {
  await db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_oauth_consents (nonce_hash TEXT PRIMARY KEY, authorization_url TEXT NOT NULL, expires_at INTEGER NOT NULL)').run();
}
export async function createConsent(db:D1Database,nonce:string,url:string,now=Math.floor(Date.now()/1000)) {
  if(!/^[a-f0-9-]{72}$/.test(nonce)||url.length>10000) throw new Error('Invalid consent');
  await ensure(db);
  await db.prepare('DELETE FROM vesper_bridge_oauth_consents WHERE expires_at<=?').bind(now).run();
  await db.prepare('INSERT INTO vesper_bridge_oauth_consents(nonce_hash,authorization_url,expires_at) VALUES(?,?,?)').bind(await hash(nonce),url,now+TTL_SECONDS).run();
}
export async function getConsent(db:D1Database,nonce:string,now=Math.floor(Date.now()/1000)) {
  if(!/^[a-f0-9-]{72}$/.test(nonce)) return null;
  await ensure(db);
  const row=await db.prepare('SELECT authorization_url FROM vesper_bridge_oauth_consents WHERE nonce_hash=? AND expires_at>?').bind(await hash(nonce),now).first<ConsentRow>();
  return row?.authorization_url??null;
}
export async function deleteConsent(db:D1Database,nonce:string) {
  if(!/^[a-f0-9-]{72}$/.test(nonce)) return;
  await ensure(db);await db.prepare('DELETE FROM vesper_bridge_oauth_consents WHERE nonce_hash=?').bind(await hash(nonce)).run();
}
export function consentCookie(nonce:string) { return `${COOKIE_PREFIX}${nonce}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_SECONDS}`; }
export function clearConsentCookie(nonce:string) { return `${COOKIE_PREFIX}${nonce}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
export function cookieMatches(header:string|null,nonce:string) {
  if(!/^[a-f0-9-]{72}$/.test(nonce)) return false;
  const values=(header||'').split(';').map(s=>s.trim());
  return values.includes(`${COOKIE_PREFIX}${nonce}=${nonce}`)||values.includes(`__Host-vesper-chat=${nonce}`);
}
