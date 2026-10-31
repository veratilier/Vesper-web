import {authorizeGroup,authorizeGroupAshUpload} from './bridge-groups.ts';
type DB=D1Database;
type Access={owner:string;ash?:{messageId:string;claimant:string}}|{bindingID:string};
type Row={id:string;group_id:string;sender_id:string;message_id:string|null;object_key:string;name:string;mime:string;size:number;kind:string};
const ID=/^[A-Za-z0-9_-]{1,128}$/;
function id(value:unknown):string {if(typeof value!=='string'||!ID.test(value))throw new Error('Invalid identifier');return value;}
function view(row:Row){return {id:row.id,name:row.name,type:row.mime,size:row.size,kind:row.kind};}
export async function uploadGroupMedia(db:DB,bucket:R2Bucket,groupID:unknown,access:Access,file:{name:string;type:string;bytes:Uint8Array;kind?:string}) {
  const group='owner' in access&&access.ash ? await authorizeGroupAshUpload(db,access.owner,groupID,access.ash.messageId,access.ash.claimant) : await authorizeGroup(db,groupID,access);
  const sender='owner' in access?(access.ash?'ash':'user'):access.bindingID;
  const name=String(file.name||'').replace(/[\x00-\x1f/\\]/g,'_').slice(0,160).trim(),mime=String(file.type||'application/octet-stream').toLowerCase();
  const kind=file.kind==='sticker'?'sticker':'file';
  if(!name||!/^[-a-z0-9.+]+\/[-a-z0-9.+]+$/.test(mime)||!file.bytes.length||file.bytes.length>32*1024*1024||(kind==='sticker'&&!mime.startsWith('image/')))throw new Error('Invalid attachment');
  const asset=crypto.randomUUID(),key=`private-groups/${group}/${asset}`;
  await bucket.put(key,file.bytes,{httpMetadata:{contentType:mime}});
  try{await db.prepare('INSERT INTO vesper_bridge_group_media(id,group_id,sender_id,message_id,object_key,name,mime,size,kind) VALUES(?,?,?,NULL,?,?,?,?,?)').bind(asset,group,sender,key,name,mime,file.bytes.length,kind).run();}
  catch(error){await bucket.delete(key).catch(()=>{});throw error;}
  return {attachment:view({id:asset,group_id:group,sender_id:sender,message_id:null,object_key:key,name,mime,size:file.bytes.length,kind})};
}
export async function readGroupMedia(db:DB,bucket:R2Bucket,groupID:unknown,assetID:unknown,access:Access) {
  const group=await authorizeGroup(db,groupID,access);
  const row=await db.prepare('SELECT m.* FROM vesper_bridge_group_media m WHERE m.id=? AND m.group_id=? AND m.message_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vesper_bridge_group_inflight f WHERE f.group_id=m.group_id AND f.message_id=m.message_id AND f.ready=0)').bind(id(assetID),group).first<Row>();
  if(!row)throw new Error('Attachment unavailable');const object=await bucket.get(row.object_key);if(!object)throw new Error('Attachment unavailable');return {object,attachment:view(row),key:row.object_key};
}
export async function groupMediaChunk(db:DB,bucket:R2Bucket,groupID:unknown,assetID:unknown,access:Access,offset:number) {
  const {attachment,key}=await readGroupMedia(db,bucket,groupID,assetID,access);
  if(!Number.isInteger(offset)||offset<0||offset>=attachment.size)throw new Error('Invalid offset');
  const object=await bucket.get(key,{range:{offset,length:Math.min(384*1024,attachment.size-offset)}});if(!object)throw new Error('Attachment unavailable');
  const bytes=new Uint8Array(await object.arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {attachment,offset,base64:btoa(raw),nextOffset:offset+bytes.length<attachment.size?offset+bytes.length:null};
}
