/** Group transcripts are independent of the contacts' private conversations. */
import { ensureBridge } from './conversation-bridge.ts';
type DB = D1Database;
type Group = {id:string;owner:string;name:string;created_at:string};
type GroupMessage = {id:string;group_id:string;sender_id:string;text:string;created_at:string};
const ID=/^[A-Za-z0-9_-]{1,128}$/;
function id(value:unknown):string { if(typeof value!=='string'||!ID.test(value))throw new Error('Invalid identifier');return value; }
function text(value:unknown,max:number):string { if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('Invalid content');return value.trim(); }
export async function ensureGroups(db:DB) {
  await ensureBridge(db);
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_groups (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_group_members (group_id TEXT NOT NULL, binding_id TEXT NOT NULL, PRIMARY KEY(group_id,binding_id))'),
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_group_ash (group_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL)'),
    db.prepare("CREATE TABLE IF NOT EXISTS vesper_bridge_ash_jobs (group_id TEXT NOT NULL, message_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', claimant TEXT, lease_until TEXT, PRIMARY KEY(group_id,message_id))"),
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_group_messages (group_id TEXT NOT NULL, id TEXT NOT NULL, sender_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(group_id,id))'),
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_group_inbox (binding_id TEXT NOT NULL, group_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(binding_id,group_id,message_id))'),
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_group_peer_notifications (group_id TEXT NOT NULL, recipient TEXT NOT NULL, round_id TEXT NOT NULL, sender_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(group_id,recipient,round_id,sender_id))'),
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_group_media (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, sender_id TEXT NOT NULL, message_id TEXT, object_key TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_group_inflight (group_id TEXT NOT NULL, message_id TEXT NOT NULL, intent TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(group_id,message_id))'),
    db.prepare('CREATE INDEX IF NOT EXISTS vesper_bridge_group_members_binding ON vesper_bridge_group_members(binding_id,group_id)'),
  ]);
}
async function owned(db:DB,owner:string,groupID:unknown):Promise<Group> {
  const row=await db.prepare('SELECT * FROM vesper_bridge_groups WHERE id=? AND owner=?').bind(id(groupID),owner).first<Group>();
  if(!row)throw new Error('Group unavailable');return row;
}
async function member(db:DB,bindingID:unknown,groupID:unknown):Promise<Group> {
  const row=await db.prepare('SELECT g.* FROM vesper_bridge_groups g JOIN vesper_bridge_group_members m ON m.group_id=g.id JOIN vesper_bridge_bindings b ON b.id=m.binding_id AND b.revoked=0 WHERE g.id=? AND m.binding_id=?').bind(id(groupID),id(bindingID)).first<Group>();
  if(!row)throw new Error('Group unavailable');return row;
}
export async function authorizeGroup(db:DB,groupID:unknown,access:{owner:string}|{bindingID:string}):Promise<string> {
  await ensureGroups(db);return 'owner' in access?(await owned(db,access.owner,groupID)).id:(await member(db,access.bindingID,groupID)).id;
}
async function describe(db:DB,groups:Group[]) {
  const output=[];
  for(const group of groups) {
    const members=await db.prepare('SELECT b.id,b.name,b.provider,b.revoked,p.avatar_id FROM vesper_bridge_group_members m JOIN vesper_bridge_bindings b ON b.id=m.binding_id LEFT JOIN vesper_bridge_profiles p ON p.binding_id=b.id WHERE m.group_id=? ORDER BY b.name,b.id').bind(group.id).all<{id:string;name:string;provider:string;revoked:number;avatar_id:string|null}>();
    const ash=await db.prepare('SELECT conversation_id FROM vesper_bridge_group_ash WHERE group_id=?').bind(group.id).first<{conversation_id:string}>();
    output.push({id:group.id,name:group.name,createdAt:group.created_at,includesAsh:!!ash,members:members.results.map(m=>({id:m.id,name:m.name,provider:m.provider,active:!m.revoked,avatarId:m.avatar_id||''}))});
  }
  return output;
}
export async function createGroup(db:DB,owner:string,input:Record<string,unknown>) {
  await ensureGroups(db);const name=text(input.name,80);
  if(!Array.isArray(input.members)||input.members.length<1||input.members.length>12)throw new Error('Choose group members');
  const ids=input.members.map(id);if(new Set(ids).size!==ids.length)throw new Error('Duplicate member');
  for(const memberID of ids)if(!await db.prepare('SELECT id FROM vesper_bridge_bindings WHERE id=? AND owner=? AND revoked=0').bind(memberID,owner).first())throw new Error('Contact unavailable');
  const group:Group={id:input.id===undefined?crypto.randomUUID():id(input.id),owner,name,created_at:new Date().toISOString()};
  const existing=await db.prepare('SELECT * FROM vesper_bridge_groups WHERE id=?').bind(group.id).first<Group>();
  if(existing) {
    if(existing.owner!==owner||existing.name!==name)throw new Error('Group id already used');
    const saved=await describe(db,[existing]);
    if(JSON.stringify(saved[0].members.map(m=>m.id).sort())!==JSON.stringify([...ids].sort())||saved[0].includesAsh!==(input.includeAsh===true))throw new Error('Group id already used');
    return {group:saved[0]};
  }
  const operations=[db.prepare('INSERT INTO vesper_bridge_groups(id,owner,name,created_at) VALUES(?,?,?,?)').bind(group.id,owner,name,group.created_at),...ids.map(memberID=>db.prepare('INSERT INTO vesper_bridge_group_members(group_id,binding_id) VALUES(?,?)').bind(group.id,memberID))];
  if(input.includeAsh===true)operations.push(db.prepare('INSERT INTO vesper_bridge_group_ash(group_id,conversation_id) VALUES(?,?)').bind(group.id,crypto.randomUUID()));
  await db.batch(operations);
  return {group:(await describe(db,[group]))[0]};
}
export async function userGroups(db:DB,owner:string) {
  await ensureGroups(db);const rows=await db.prepare('SELECT * FROM vesper_bridge_groups WHERE owner=? ORDER BY created_at DESC,id').bind(owner).all<Group>(),groups=await describe(db,rows.results);
  for(const group of groups) {const ash=await db.prepare('SELECT conversation_id FROM vesper_bridge_group_ash WHERE group_id=?').bind(group.id).first<{conversation_id:string}>();Object.assign(group,{ashConversationId:ash?.conversation_id||''});}
  return {groups};
}
export async function assistantGroups(db:DB,bindingID:unknown) {
  await ensureGroups(db);const rows=await db.prepare('SELECT g.* FROM vesper_bridge_groups g JOIN vesper_bridge_group_members m ON m.group_id=g.id JOIN vesper_bridge_bindings b ON b.id=m.binding_id AND b.revoked=0 WHERE m.binding_id=? ORDER BY g.created_at DESC,g.id').bind(id(bindingID)).all<Group>();return {groups:await describe(db,rows.results)};
}
function messageView(row:GroupMessage) {return {id:row.id,groupId:row.group_id,senderId:row.sender_id,text:row.text,createdAt:row.created_at};}
async function read(db:DB,group:Group) {
  const rows=await db.prepare('SELECT m.* FROM vesper_bridge_group_messages m WHERE m.group_id=? AND NOT EXISTS (SELECT 1 FROM vesper_bridge_group_inflight f WHERE f.group_id=m.group_id AND f.message_id=m.id AND f.ready=0) ORDER BY m.rowid DESC LIMIT 100').bind(group.id).all<GroupMessage>();
  if(!rows.results.length)return {group:(await describe(db,[group]))[0],messages:[]};
  const placeholders=rows.results.map(()=>'?').join(',');
  const media=await db.prepare(`SELECT id,message_id,name,mime,size,kind FROM vesper_bridge_group_media WHERE group_id=? AND message_id IN (${placeholders}) ORDER BY rowid`).bind(group.id,...rows.results.map(row=>row.id)).all<{id:string;message_id:string;name:string;mime:string;size:number;kind:string}>();
  return {group:(await describe(db,[group]))[0],messages:rows.results.reverse().map(row=>({...messageView(row),attachments:media.results.filter(m=>m.message_id===row.id).map(m=>({id:m.id,name:m.name,type:m.mime,size:m.size,kind:m.kind}))}))};
}
export async function userGroupMessages(db:DB,owner:string,groupID:unknown) {
  await ensureGroups(db);const group=await owned(db,owner,groupID),result=await read(db,group);
  const ash=await db.prepare('SELECT conversation_id FROM vesper_bridge_group_ash WHERE group_id=?').bind(group.id).first<{conversation_id:string}>();
  return {...result,ashConversationId:ash?.conversation_id||''};
}
export async function assistantGroupMessages(db:DB,bindingID:unknown,groupID:unknown) {await ensureGroups(db);return read(db,await member(db,bindingID,groupID));}
/** Deliver at most one notification per sender, recipient and user turn.
 * The guard is durable across retries and devices; a new user message starts a
 * new round. Never backfill old conversations or notify the original sender. */
async function notifyPeers(db:DB,group:Group,sender:string,messageID:string) {
  const origin=await db.prepare('SELECT rowid AS n FROM vesper_bridge_group_messages WHERE group_id=? AND id=? AND sender_id=?').bind(group.id,messageID,sender).first<{n:number}>();
  if(!origin)return;
  const lastUser=await db.prepare("SELECT id FROM vesper_bridge_group_messages WHERE group_id=? AND sender_id='user' AND rowid<? ORDER BY rowid DESC LIMIT 1").bind(group.id,origin.n).first<{id:string}>();
  const round=lastUser ? 'user:'+lastUser.id : 'before-first-user';
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO vesper_bridge_group_peer_notifications(group_id,recipient,round_id,sender_id,message_id)
      SELECT ?,b.id,?,?,? FROM vesper_bridge_group_members m JOIN vesper_bridge_bindings b ON b.id=m.binding_id AND b.revoked=0
      WHERE m.group_id=? AND b.id<>?`).bind(group.id,round,sender,messageID,group.id,sender),
    db.prepare(`INSERT OR IGNORE INTO vesper_bridge_group_peer_notifications(group_id,recipient,round_id,sender_id,message_id)
      SELECT group_id,'ash',?,?,? FROM vesper_bridge_group_ash WHERE group_id=? AND ?<>'ash'`).bind(round,sender,messageID,group.id,sender),
    db.prepare(`INSERT OR IGNORE INTO vesper_bridge_group_inbox(binding_id,group_id,message_id)
      SELECT recipient,group_id,message_id FROM vesper_bridge_group_peer_notifications
      WHERE group_id=? AND round_id=? AND message_id=? AND recipient<>'ash'`).bind(group.id,round,messageID),
    db.prepare(`INSERT OR IGNORE INTO vesper_bridge_ash_jobs(group_id,message_id,state)
      SELECT group_id,message_id,'pending' FROM vesper_bridge_group_peer_notifications
      WHERE group_id=? AND round_id=? AND message_id=? AND recipient='ash'`).bind(group.id,round,messageID),
  ]);
}
async function put(db:DB,group:Group,sender:string,input:Record<string,unknown>) {
  const messageID=id(input.id),body=typeof input.text==='string'?input.text.trim():'';
  const attachments=input.attachments===undefined?[]:Array.isArray(input.attachments)?input.attachments.map(id):null;
  if(!attachments||attachments.length>5||new Set(attachments).size!==attachments.length||body.length>12000||(!body&&!attachments.length))throw new Error('Invalid content');
  for(const asset of attachments){const row=await db.prepare('SELECT message_id FROM vesper_bridge_group_media WHERE id=? AND group_id=? AND sender_id=?').bind(asset,group.id,sender).first<{message_id:string|null}>();if(!row||(row.message_id!==null&&row.message_id!==messageID))throw new Error('Attachment unavailable');}
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({sender,body,attachments}))));
  const intent=Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('');
  await db.prepare('INSERT INTO vesper_bridge_group_inflight(group_id,message_id,intent,ready) VALUES(?,?,?,0) ON CONFLICT DO NOTHING').bind(group.id,messageID,intent).run();
  const savedIntent=await db.prepare('SELECT intent FROM vesper_bridge_group_inflight WHERE group_id=? AND message_id=?').bind(group.id,messageID).first<{intent:string}>();
  if(savedIntent?.intent!==intent)throw new Error('Message id already used');
  await db.prepare('INSERT INTO vesper_bridge_group_messages(group_id,id,sender_id,text,created_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING').bind(group.id,messageID,sender,body,new Date().toISOString()).run();
  const row=await db.prepare('SELECT * FROM vesper_bridge_group_messages WHERE group_id=? AND id=?').bind(group.id,messageID).first<GroupMessage>();
  if(!row||row.sender_id!==sender||row.text!==body)throw new Error('Message id already used');
  const linked=await db.prepare('SELECT id FROM vesper_bridge_group_media WHERE group_id=? AND message_id=?').bind(group.id,messageID).all<{id:string}>();
  if(linked.results.some(m=>!attachments.includes(m.id)))throw new Error('Message id already used');
  const existing=new Set(linked.results.map(m=>m.id));
  for(const asset of attachments.filter(m=>!existing.has(m))) {
    const result=await db.prepare('UPDATE vesper_bridge_group_media SET message_id=? WHERE id=? AND group_id=? AND sender_id=? AND message_id IS NULL').bind(messageID,asset,group.id,sender).run();
    if(!result.meta.changes)throw new Error('Attachment unavailable');
  }
  await db.prepare('UPDATE vesper_bridge_group_inflight SET ready=1 WHERE group_id=? AND message_id=?').bind(group.id,messageID).run();
  if(sender==='user')await db.batch([
    db.prepare('INSERT OR IGNORE INTO vesper_bridge_group_inbox(binding_id,group_id,message_id) SELECT binding_id,?,? FROM vesper_bridge_group_members WHERE group_id=?').bind(group.id,messageID,group.id),
    db.prepare("INSERT OR IGNORE INTO vesper_bridge_ash_jobs(group_id,message_id,state) SELECT group_id,?,'pending' FROM vesper_bridge_group_ash WHERE group_id=?").bind(messageID,group.id),
  ]);
  else await notifyPeers(db,group,sender,messageID);
  return {message:messageView(row)};
}
export async function userGroupSend(db:DB,owner:string,input:Record<string,unknown>) {await ensureGroups(db);return put(db,await owned(db,owner,input.groupId),'user',input);}
export async function claimGroupAsh(db:DB,owner:string,input:Record<string,unknown>) {
  await ensureGroups(db);const group=await owned(db,owner,input.groupId),claimant=id(input.claimant),now=new Date().toISOString();
  const job=await db.prepare("SELECT message_id FROM vesper_bridge_ash_jobs WHERE group_id=? AND (state='pending' OR (state='running' AND lease_until<?)) ORDER BY rowid LIMIT 1").bind(group.id,now).first<{message_id:string}>();
  if(!job)return {job:null};
  const leaseUntil=new Date(Date.now()+15*60*1000).toISOString();
  const result=await db.prepare("UPDATE vesper_bridge_ash_jobs SET state='running',claimant=?,lease_until=? WHERE group_id=? AND message_id=? AND (state='pending' OR (state='running' AND lease_until<?)) AND NOT EXISTS (SELECT 1 FROM vesper_bridge_ash_jobs active WHERE active.group_id=? AND active.message_id<>? AND active.state='running' AND active.lease_until>=?)").bind(claimant,leaseUntil,group.id,job.message_id,now,group.id,job.message_id,now).run();
  if(!result.meta.changes)return {job:null};
  const message=await db.prepare('SELECT * FROM vesper_bridge_group_messages WHERE group_id=? AND id=?').bind(group.id,job.message_id).first<GroupMessage>();
  if(!message)throw new Error('Group message unavailable');
  const media=await db.prepare('SELECT id,name,mime,size,kind FROM vesper_bridge_group_media WHERE group_id=? AND message_id=? ORDER BY rowid').bind(group.id,job.message_id).all<{id:string;name:string;mime:string;size:number;kind:string}>();
  return {job:{messageId:job.message_id,leaseUntil,message:{...messageView(message),attachments:media.results.map(m=>({id:m.id,name:m.name,type:m.mime,size:m.size,kind:m.kind}))}}};
}
export async function authorizeGroupAshUpload(db:DB,owner:string,groupID:unknown,messageID:unknown,claimant:unknown) {
  await ensureGroups(db);const group=await owned(db,owner,groupID);
  const job=await db.prepare("SELECT message_id FROM vesper_bridge_ash_jobs WHERE group_id=? AND message_id=? AND claimant=? AND state='running' AND lease_until>=?").bind(group.id,id(messageID),id(claimant),new Date().toISOString()).first();
  if(!job)throw new Error('Ash job unavailable');return group.id;
}
export async function completeGroupAsh(db:DB,owner:string,input:Record<string,unknown>) {
  await ensureGroups(db);const group=await owned(db,owner,input.groupId),claimant=id(input.claimant),messageID=id(input.messageId);
  const job=await db.prepare('SELECT state,claimant,lease_until FROM vesper_bridge_ash_jobs WHERE group_id=? AND message_id=?').bind(group.id,messageID).first<{state:string;claimant:string;lease_until:string}>();
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(group.id+'\n'+messageID)));
  const responseID='ash_'+Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('');
  const attachments=input.attachments===undefined?[]:Array.isArray(input.attachments)?input.attachments.map(id):null;
  const reply=typeof input.text==='string'?input.text.trim():'';
  if(!attachments||attachments.length>5||new Set(attachments).size!==attachments.length||reply.length>12000||(!reply&&!attachments.length))throw new Error('Invalid content');
  if(!job||job.claimant!==claimant)throw new Error('Ash job unavailable');
  if(job.state==='done') {
    const previous=await db.prepare('SELECT * FROM vesper_bridge_group_messages WHERE group_id=? AND id=?').bind(group.id,responseID).first<GroupMessage>();
    const linked=await db.prepare('SELECT id FROM vesper_bridge_group_media WHERE group_id=? AND message_id=? ORDER BY rowid').bind(group.id,responseID).all<{id:string}>();
    if(!previous||previous.text!==reply||JSON.stringify(linked.results.map(x=>x.id).sort())!==JSON.stringify([...attachments].sort()))throw new Error('Ash job unavailable');await notifyPeers(db,group,'ash',responseID);return {message:messageView(previous)};
  }
  const now=new Date().toISOString();
  if(job.state!=='running'||job.lease_until<now)throw new Error('Ash job unavailable');
  for(const asset of attachments){const media=await db.prepare('SELECT message_id FROM vesper_bridge_group_media WHERE id=? AND group_id=? AND sender_id=?').bind(asset,group.id,'ash').first<{message_id:string|null}>();if(!media||(media.message_id!==null&&media.message_id!==responseID))throw new Error('Attachment unavailable');}
  const responseIntent=JSON.stringify({reply,attachments:[...attachments].sort()});
  const results=await db.batch([
    db.prepare('INSERT INTO vesper_bridge_group_inflight(group_id,message_id,intent,ready) VALUES(?,?,?,0) ON CONFLICT DO NOTHING').bind(group.id,responseID,responseIntent),
    db.prepare("INSERT INTO vesper_bridge_group_messages(group_id,id,sender_id,text,created_at) SELECT ?,?,'ash',?,? WHERE EXISTS (SELECT 1 FROM vesper_bridge_ash_jobs WHERE group_id=? AND message_id=? AND claimant=? AND state='running' AND lease_until>=?) ON CONFLICT DO NOTHING").bind(group.id,responseID,reply,now,group.id,messageID,claimant,now),
    ...attachments.map(asset=>db.prepare("UPDATE vesper_bridge_group_media SET message_id=? WHERE id=? AND group_id=? AND sender_id='ash' AND (message_id IS NULL OR message_id=?) AND EXISTS (SELECT 1 FROM vesper_bridge_ash_jobs WHERE group_id=? AND message_id=? AND claimant=? AND state='running' AND lease_until>=?)").bind(responseID,asset,group.id,responseID,group.id,messageID,claimant,now)),
    db.prepare("UPDATE vesper_bridge_ash_jobs SET state='done' WHERE group_id=? AND message_id=? AND claimant=? AND state='running' AND lease_until>=? AND EXISTS (SELECT 1 FROM vesper_bridge_group_messages WHERE group_id=? AND id=? AND sender_id='ash' AND text=?) AND (SELECT COUNT(*) FROM vesper_bridge_group_media WHERE group_id=? AND message_id=?)=?").bind(group.id,messageID,claimant,now,group.id,responseID,reply,group.id,responseID,attachments.length),
    db.prepare("UPDATE vesper_bridge_group_inflight SET ready=1 WHERE group_id=? AND message_id=? AND intent=? AND EXISTS (SELECT 1 FROM vesper_bridge_ash_jobs WHERE group_id=? AND message_id=? AND claimant=? AND state='done')").bind(group.id,responseID,responseIntent,group.id,messageID,claimant),
  ]);
  if(!results.at(-1)?.meta.changes||!results.at(-2)?.meta.changes||results.slice(2,-2).some(r=>!r.meta.changes))throw new Error('Ash job unavailable');
  const saved=await db.prepare('SELECT * FROM vesper_bridge_group_messages WHERE group_id=? AND id=?').bind(group.id,responseID).first<GroupMessage>();
  if(!saved)throw new Error('Ash reply unavailable');await notifyPeers(db,group,'ash',responseID);return {message:messageView(saved)};
}
export async function assistantGroupSend(db:DB,bindingID:unknown,input:Record<string,unknown>) {await ensureGroups(db);const binding=id(bindingID);return put(db,await member(db,binding,input.groupId),binding,input);}
