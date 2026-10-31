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
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_group_messages (group_id TEXT NOT NULL, id TEXT NOT NULL, sender_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(group_id,id))'),
    db.prepare('CREATE TABLE IF NOT EXISTS vesper_bridge_group_inbox (binding_id TEXT NOT NULL, group_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(binding_id,group_id,message_id))'),
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
  const group:Group={id:crypto.randomUUID(),owner,name,created_at:new Date().toISOString()};
  const operations=[db.prepare('INSERT INTO vesper_bridge_groups(id,owner,name,created_at) VALUES(?,?,?,?)').bind(group.id,owner,name,group.created_at),...ids.map(memberID=>db.prepare('INSERT INTO vesper_bridge_group_members(group_id,binding_id) VALUES(?,?)').bind(group.id,memberID))];
  if(input.includeAsh===true)operations.push(db.prepare('INSERT INTO vesper_bridge_group_ash(group_id,conversation_id) VALUES(?,?)').bind(group.id,crypto.randomUUID()));
  await db.batch(operations);
  return {group:(await describe(db,[group]))[0]};
}
export async function userGroups(db:DB,owner:string) {
  await ensureGroups(db);const rows=await db.prepare('SELECT * FROM vesper_bridge_groups WHERE owner=? ORDER BY created_at DESC,id').bind(owner).all<Group>();return {groups:await describe(db,rows.results)};
}
export async function assistantGroups(db:DB,bindingID:unknown) {
  await ensureGroups(db);const rows=await db.prepare('SELECT g.* FROM vesper_bridge_groups g JOIN vesper_bridge_group_members m ON m.group_id=g.id JOIN vesper_bridge_bindings b ON b.id=m.binding_id AND b.revoked=0 WHERE m.binding_id=? ORDER BY g.created_at DESC,g.id').bind(id(bindingID)).all<Group>();return {groups:await describe(db,rows.results)};
}
function messageView(row:GroupMessage) {return {id:row.id,groupId:row.group_id,senderId:row.sender_id,text:row.text,createdAt:row.created_at};}
async function read(db:DB,group:Group) {
  const rows=await db.prepare('SELECT * FROM vesper_bridge_group_messages WHERE group_id=? ORDER BY rowid DESC LIMIT 100').bind(group.id).all<GroupMessage>();return {group:(await describe(db,[group]))[0],messages:rows.results.reverse().map(messageView)};
}
export async function userGroupMessages(db:DB,owner:string,groupID:unknown) {
  await ensureGroups(db);const group=await owned(db,owner,groupID),result=await read(db,group);
  const ash=await db.prepare('SELECT conversation_id FROM vesper_bridge_group_ash WHERE group_id=?').bind(group.id).first<{conversation_id:string}>();
  return {...result,ashConversationId:ash?.conversation_id||''};
}
export async function assistantGroupMessages(db:DB,bindingID:unknown,groupID:unknown) {await ensureGroups(db);return read(db,await member(db,bindingID,groupID));}
async function put(db:DB,group:Group,sender:string,input:Record<string,unknown>) {
  const messageID=id(input.id),body=text(input.text,12000);
  await db.prepare('INSERT INTO vesper_bridge_group_messages(group_id,id,sender_id,text,created_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING').bind(group.id,messageID,sender,body,new Date().toISOString()).run();
  const row=await db.prepare('SELECT * FROM vesper_bridge_group_messages WHERE group_id=? AND id=?').bind(group.id,messageID).first<GroupMessage>();
  if(!row||row.sender_id!==sender||row.text!==body)throw new Error('Message id already used');
  if(sender==='user')await db.prepare('INSERT OR IGNORE INTO vesper_bridge_group_inbox(binding_id,group_id,message_id) SELECT binding_id,?,? FROM vesper_bridge_group_members WHERE group_id=?').bind(group.id,messageID,group.id).run();
  return {message:messageView(row)};
}
export async function userGroupSend(db:DB,owner:string,input:Record<string,unknown>) {await ensureGroups(db);return put(db,await owned(db,owner,input.groupId),'user',input);}
export async function userGroupSendAsh(db:DB,owner:string,input:Record<string,unknown>) {
  await ensureGroups(db);const group=await owned(db,owner,input.groupId);
  if(!await db.prepare('SELECT conversation_id FROM vesper_bridge_group_ash WHERE group_id=?').bind(group.id).first())throw new Error('Ash is not a member');
  return put(db,group,'ash',input);
}
export async function assistantGroupSend(db:DB,bindingID:unknown,input:Record<string,unknown>) {await ensureGroups(db);const binding=id(bindingID);return put(db,await member(db,binding,input.groupId),binding,input);}
