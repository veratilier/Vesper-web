/** Isolated external-assistant conversations. Does not access Codex chat history. */
import { ensureBridgeMedia, mediaView } from './bridge-media.ts';
type DB = D1Database;
type Binding = { id: string; owner: string; name: string; provider: string; token_hash: string; revoked: number; created_at: string };
type Message = { id: string; binding_id: string; sender: string; text: string; reply_to: string | null; created_at: string };
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN = /^vb_[A-Za-z0-9_-]{43}$/;
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('Invalid identifier');
  return value;
}
function content(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid content');
  return value.trim();
}
async function hash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2,'0')).join('');
}
export async function ensureBridge(db: DB) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_bindings (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, provider TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_messages (id TEXT NOT NULL, binding_id TEXT NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL, reply_to TEXT, created_at TEXT NOT NULL, PRIMARY KEY(binding_id,id))'),
    db.prepare('CREATE INDEX IF NOT EXISTS vesper_bridge_messages_order ON vesper_bridge_messages(binding_id,created_at,id)'),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS vesper_bridge_one_reply ON vesper_bridge_messages(binding_id,reply_to) WHERE sender='assistant'"),
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_cards (binding_id TEXT NOT NULL, message_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(binding_id,message_id))'),
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_inflight (binding_id TEXT NOT NULL, message_id TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0, intent TEXT NOT NULL, PRIMARY KEY(binding_id,message_id))'),
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_profiles (binding_id TEXT PRIMARY KEY, avatar_id TEXT NOT NULL)'),
  ]);
}
async function owned(db: DB, owner: string, bindingID: unknown): Promise<Binding> {
  const row = await db.prepare('SELECT * FROM vesper_bridge_bindings WHERE id=? AND owner=? AND revoked=0').bind(identifier(bindingID),owner).first<Binding>();
  if (!row) throw new Error('Connection unavailable');
  return row;
}
async function authenticated(db: DB, token: unknown): Promise<Binding> {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new Error('Connection unavailable');
  const row = await db.prepare('SELECT * FROM vesper_bridge_bindings WHERE token_hash=? AND revoked=0').bind(await hash(token)).first<Binding>();
  if (!row) throw new Error('Connection unavailable');
  return row;
}
export async function bridgeIdentity(db: DB, token: unknown) { await ensureBridge(db); return (await authenticated(db,token)).id; }
async function activeBinding(db: DB, id: unknown): Promise<Binding> {
  const row = await db.prepare('SELECT * FROM vesper_bridge_bindings WHERE id=? AND revoked=0').bind(identifier(id)).first<Binding>();
  if (!row) throw new Error('Connection unavailable');
  return row;
}
function publicBinding(row: Binding & {avatar_id?:string}) { return { id: row.id, name: row.name, provider: row.provider, createdAt: row.created_at, avatarId: row.avatar_id||'' }; }
function publicMessage(row: Message) { return { id: row.id, bindingId: row.binding_id, sender: row.sender, text: row.text, replyTo: row.reply_to, createdAt: row.created_at }; }
async function withMedia(db:DB,bindingID:string,rows:Message[]) {
  if(!rows.length)return [];
  await ensureBridgeMedia(db);
  const marks=rows.map(()=>'?').join(',');
  const found=await db.prepare(`SELECT * FROM vesper_bridge_media WHERE binding_id=? AND message_id IN (${marks}) ORDER BY rowid`).bind(bindingID,...rows.map(x=>x.id)).all<any>();
  const cards=await db.prepare(`SELECT message_id,value FROM vesper_bridge_cards WHERE binding_id=? AND message_id IN (${marks})`).bind(bindingID,...rows.map(x=>x.id)).all<{message_id:string;value:string}>();
  return rows.map(row=>{const card=cards.results.find(x=>x.message_id===row.id);return {...publicMessage(row),attachments:found.results.filter(x=>x.message_id===row.id).map(mediaView),...(card?{card:JSON.parse(card.value)}:{})};});
}
export async function createBridge(db: DB, owner: string, input: Record<string, unknown>) {
  await ensureBridge(db);
  const name=content(input.name,80), provider=content(input.provider,32);
  if (!['work','muse'].includes(provider)) throw new Error('Unsupported provider');
  const id=crypto.randomUUID(), bytes=crypto.getRandomValues(new Uint8Array(32));
  const token='vb_'+btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const createdAt=new Date().toISOString();
  await db.prepare('INSERT INTO vesper_bridge_bindings(id,owner,name,provider,token_hash,created_at) VALUES(?,?,?,?,?,?)').bind(id,owner,name,provider,await hash(token),createdAt).run();
  return { binding:{id,name,provider,createdAt}, token };
}
export async function listBridges(db: DB, owner: string) {
  await ensureBridge(db);
  const rows=await db.prepare('SELECT b.*, p.avatar_id FROM vesper_bridge_bindings b LEFT JOIN vesper_bridge_profiles p ON p.binding_id=b.id WHERE b.owner=? AND b.revoked=0 ORDER BY b.created_at,b.id').bind(owner).all<Binding & {avatar_id?:string}>();
  return { bindings: rows.results.map(publicBinding) };
}
export async function revokeBridge(db: DB, owner: string, bindingID: unknown) {
  await ensureBridge(db); const binding=await owned(db,owner,bindingID);
  await db.prepare('UPDATE vesper_bridge_bindings SET revoked=1 WHERE id=? AND owner=?').bind(binding.id,owner).run();
  return { revoked:true };
}
async function putMessage(db: DB, binding: Binding, input: Record<string, unknown>, sender: 'user'|'assistant') {
  await ensureBridgeMedia(db);
  const id=identifier(input.id), replyTo=sender==='assistant'&&input.replyTo!=null?identifier(input.replyTo):null;
  const attachmentIDs=input.attachments===undefined?[]:Array.isArray(input.attachments)?input.attachments.map(identifier):null;
  if(!attachmentIDs||attachmentIDs.length>5||new Set(attachmentIDs).size!==attachmentIDs.length)throw new Error('Invalid attachments');
  const text=typeof input.text==='string'?input.text.trim():'';
  let card:string|null=null;
  if(input.card!==undefined&&input.card!==null) {
    if(typeof input.card!=='object'||Array.isArray(input.card))throw new Error('Invalid card');
    const value=input.card as Record<string,unknown>;
    if(!['location','music'].includes(String(value.kind))||!value.data||typeof value.data!=='object'||Array.isArray(value.data))throw new Error('Invalid card');
    card=JSON.stringify(value);if(card.length>12000)throw new Error('Invalid card');
  }
  if(text.length>12000||(!text&&!attachmentIDs.length&&!card))throw new Error('Invalid content');
  for(const attachmentID of attachmentIDs){
    const row=await db.prepare('SELECT message_id FROM vesper_bridge_media WHERE id=? AND binding_id=? AND sender=?').bind(attachmentID,binding.id,sender).first<{message_id:string|null}>();
    if(!row||(row.message_id!==null&&row.message_id!==id))throw new Error('Attachment unavailable');
  }
  if (replyTo) {
    const parent=await db.prepare('SELECT id FROM vesper_bridge_messages WHERE binding_id=? AND id=? AND sender=?').bind(binding.id,replyTo,'user').first();
    if (!parent) throw new Error('Message unavailable');
  }
  const prior=await db.prepare('SELECT id FROM vesper_bridge_messages WHERE binding_id=? AND id=?').bind(binding.id,id).first();
  const storedIntent=await db.prepare('SELECT intent FROM vesper_bridge_inflight WHERE binding_id=? AND message_id=?').bind(binding.id,id).first<{intent:string}>();
  if(prior&&!storedIntent&&(attachmentIDs.length||card))throw new Error('Message id already used');
  const intent=await hash(JSON.stringify({sender,text,replyTo,attachments:attachmentIDs,card}));
  await db.prepare('INSERT INTO vesper_bridge_inflight(binding_id,message_id,ready,intent) VALUES(?,?,0,?) ON CONFLICT DO NOTHING').bind(binding.id,id,intent).run();
  const confirmed=await db.prepare('SELECT intent FROM vesper_bridge_inflight WHERE binding_id=? AND message_id=?').bind(binding.id,id).first<{intent:string}>();
  if(confirmed?.intent!==intent)throw new Error('Message id already used');
  await db.prepare('INSERT INTO vesper_bridge_messages(id,binding_id,sender,text,reply_to,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING')
    .bind(id,binding.id,sender,text,replyTo,new Date().toISOString()).run();
  const saved=await db.prepare('SELECT * FROM vesper_bridge_messages WHERE binding_id=? AND id=?').bind(binding.id,id).first<Message>();
  if (!saved && replyTo) {
    const existing=await db.prepare("SELECT * FROM vesper_bridge_messages WHERE binding_id=? AND sender='assistant' AND reply_to=?").bind(binding.id,replyTo).first<Message>();
    if (existing) return { message:publicMessage(existing), alreadyReplied:true };
  }
  if (!saved || saved.sender!==sender || saved.text!==text || saved.reply_to!==replyTo) throw new Error('Message id already used');
  const savedCard=await db.prepare('SELECT value FROM vesper_bridge_cards WHERE binding_id=? AND message_id=?').bind(binding.id,id).first<{value:string}>();
  if(savedCard&&savedCard.value!==card)throw new Error('Message id already used');
  if(!savedCard&&card)await db.prepare('INSERT INTO vesper_bridge_cards(binding_id,message_id,value) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(binding.id,id,card).run();
  const current=await db.prepare('SELECT id FROM vesper_bridge_media WHERE binding_id=? AND message_id=? ORDER BY rowid').bind(binding.id,id).all<{id:string}>();
  const attached=new Set(current.results.map(x=>x.id));
  if([...attached].some(x=>!attachmentIDs.includes(x)))throw new Error('Message id already used');
  const missing=attachmentIDs.filter(x=>!attached.has(x));
  if(missing.length) {
    const updates=missing.map(attachmentID=>db.prepare('UPDATE vesper_bridge_media SET message_id=? WHERE id=? AND binding_id=? AND sender=? AND message_id IS NULL').bind(id,attachmentID,binding.id,sender));
    const results=await db.batch(updates);
    if(results.some(x=>!x.meta.changes)) throw new Error('Attachment unavailable');
  }
  await db.prepare('UPDATE vesper_bridge_inflight SET ready=1 WHERE binding_id=? AND message_id=?').bind(binding.id,id).run();
  return { message:(await withMedia(db,binding.id,[saved]))[0] };
}
async function messages(db: DB,binding: Binding) {
  const rows=await db.prepare('SELECT m.* FROM vesper_bridge_messages m WHERE m.binding_id=? AND NOT EXISTS (SELECT 1 FROM vesper_bridge_inflight f WHERE f.binding_id=m.binding_id AND f.message_id=m.id AND f.ready=0) ORDER BY m.rowid DESC LIMIT 100').bind(binding.id).all<Message>();
  return { messages:await withMedia(db,binding.id,rows.results.reverse()) };
}
export async function userSend(db: DB,owner: string,input: Record<string, unknown>) { await ensureBridge(db); return putMessage(db,await owned(db,owner,input.bindingId),input,'user'); }
export async function userMessages(db: DB,owner: string,bindingID: unknown) { await ensureBridge(db); return messages(db,await owned(db,owner,bindingID)); }
async function assistantHistory(db: DB,binding: Binding) {
  const history=await messages(db,binding);
  const pending=await db.prepare(`SELECT m.* FROM vesper_bridge_messages m WHERE m.binding_id=? AND m.sender='user'
    AND NOT EXISTS (SELECT 1 FROM vesper_bridge_inflight f WHERE f.binding_id=m.binding_id AND f.message_id=m.id AND f.ready=0)
    AND NOT EXISTS (SELECT 1 FROM vesper_bridge_messages r WHERE r.binding_id=m.binding_id AND r.sender='assistant' AND r.reply_to=m.id)
    ORDER BY m.rowid LIMIT 100`).bind(binding.id).all<Message>();
  return { messages:history.messages.slice(-20), pending:await withMedia(db,binding.id,pending.results) };
}
export async function assistantMessages(db: DB,token: unknown) { await ensureBridge(db); return assistantHistory(db,await authenticated(db,token)); }
export async function assistantReply(db: DB,token: unknown,input: Record<string, unknown>) { await ensureBridge(db); return putMessage(db,await authenticated(db,token),input,'assistant'); }
export async function assistantMessagesBound(db: DB,id: unknown) { await ensureBridge(db); return assistantHistory(db,await activeBinding(db,id)); }
export async function assistantReplyBound(db: DB,id: unknown,input: Record<string, unknown>) { await ensureBridge(db); return putMessage(db,await activeBinding(db,id),input,'assistant'); }
