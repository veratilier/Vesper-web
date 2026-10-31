/** Private media for one external-assistant conversation. R2 keys are never public URLs. */
type MediaRow={id:string;binding_id:string;sender:string;message_id:string|null;object_key:string;name:string;mime:string;size:number;kind:string;details?:string};
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MAX=32*1024*1024;
function id(v:unknown){if(typeof v!=='string'||!ID.test(v)) throw new Error('Invalid identifier');return v;}
export async function ensureBridgeMedia(db:D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS vesper_bridge_media (id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, sender TEXT NOT NULL, message_id TEXT, object_key TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}')"),
    db.prepare('CREATE INDEX IF NOT EXISTS vesper_bridge_media_message ON vesper_bridge_media(binding_id,message_id)'),
  ]);
}
export async function validateBridgeBinding(db:D1Database,bindingID:unknown,owner?:string) {
  const binding=id(bindingID);
  const row=owner===undefined
    ? await db.prepare('SELECT id FROM vesper_bridge_bindings WHERE id=? AND revoked=0').bind(binding).first()
    : await db.prepare('SELECT id FROM vesper_bridge_bindings WHERE id=? AND owner=? AND revoked=0').bind(binding,owner).first();
  if(!row) throw new Error('Connection unavailable');return binding;
}
export function mediaView(row:MediaRow) {return {id:row.id,name:row.name,type:row.mime,size:row.size,kind:row.kind,...JSON.parse(row.details||'{}')};}
export async function uploadBridgeMedia(db:D1Database,bucket:R2Bucket,bindingID:unknown,actor:'user'|'assistant',file:{name:string;type:string;bytes:Uint8Array;kind?:string;transcript?:string;duration?:number},owner?:string) {
  await ensureBridgeMedia(db);const binding=await validateBridgeBinding(db,bindingID,owner);
  const name=String(file.name||'').replace(/[\x00-\x1f/\\]/g,'_').slice(0,160).trim();
  const mime=String(file.type||'application/octet-stream').toLowerCase();
  if(!name||!/^[-a-z0-9.+]+\/[-a-z0-9.+]+$/.test(mime)) throw new Error('Invalid attachment');
  if(!file.bytes.length||file.bytes.length>MAX) throw new Error('Attachment must be under 32 MB');
  const kind=file.kind==='sticker'?'sticker':'file';
  const details=JSON.stringify({...(file.transcript?{transcript:file.transcript.slice(0,8000)}:{}),...(Number.isFinite(file.duration)&&file.duration!>0?{duration:file.duration}:{})});
  if(kind==='sticker'&&!mime.startsWith('image/')) throw new Error('Invalid sticker');
  const assetID=crypto.randomUUID(),key=`private-bridge/${binding}/${assetID}`;
  await bucket.put(key,file.bytes,{httpMetadata:{contentType:mime}});
  try {await db.prepare('INSERT INTO vesper_bridge_media(id,binding_id,sender,message_id,object_key,name,mime,size,kind,created_at,details) VALUES(?,?,?,NULL,?,?,?,?,?,?,?)')
    .bind(assetID,binding,actor,key,name,mime,file.bytes.length,kind,new Date().toISOString(),details).run();}
  catch(error){await bucket.delete(key).catch(()=>{});throw error;}
  return {attachment:mediaView({id:assetID,binding_id:binding,sender:actor,message_id:null,object_key:key,name,mime,size:file.bytes.length,kind,details})};
}
async function mediaRow(db:D1Database,bindingID:unknown,assetID:unknown,owner?:string) {
  await ensureBridgeMedia(db);const binding=await validateBridgeBinding(db,bindingID,owner);
  const row=await db.prepare('SELECT * FROM vesper_bridge_media WHERE id=? AND binding_id=? AND message_id IS NOT NULL').bind(id(assetID),binding).first<MediaRow>();
  if(!row)throw new Error('Attachment unavailable');return row;
}
export async function readBridgeMedia(db:D1Database,bucket:R2Bucket,bindingID:unknown,assetID:unknown,owner?:string) {
  const row=await mediaRow(db,bindingID,assetID,owner);const object=await bucket.get(row.object_key);
  if(!object)throw new Error('Attachment unavailable');return {object,attachment:mediaView(row)};
}
export async function getBridgeMedia(db:D1Database,bucket:R2Bucket,bindingID:unknown,assetID:unknown,offset:number) {
  const row=await mediaRow(db,bindingID,assetID);
  if(!Number.isInteger(offset)||offset<0||offset>=row.size) throw new Error('Invalid offset');
  const length=Math.min(384*1024,row.size-offset);const object=await bucket.get(row.object_key,{range:{offset,length}});
  if(!object)throw new Error('Attachment unavailable');
  const bytes=new Uint8Array(await object.arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {attachment:mediaView(row),offset,base64:btoa(raw),nextOffset:offset+bytes.length<row.size?offset+bytes.length:null};
}
export async function getBridgeImage(db:D1Database,bucket:R2Bucket,bindingID:unknown,assetID:unknown) {
  const row=await mediaRow(db,bindingID,assetID);
  if(!['image/png','image/jpeg','image/gif','image/webp'].includes(row.mime)||row.size>4*1024*1024) return null;
  const object=await bucket.get(row.object_key);if(!object)throw new Error('Attachment unavailable');
  const bytes=new Uint8Array(await object.arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {mimeType:row.mime,data:btoa(raw),attachment:mediaView(row)};
}
