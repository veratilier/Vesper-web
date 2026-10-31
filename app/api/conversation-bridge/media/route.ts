import { appRoute, APIError } from '@/lib/backend/http';
import { optionsResponse } from '@/lib/cors';
import { getDb } from '@/lib/db';
import { env } from 'cloudflare:workers';
import { readBridgeMedia, uploadBridgeMedia } from '@/lib/bridge-media';
export const OPTIONS=optionsResponse;
const handle=appRoute({service:'bridge-media',methods:['GET','POST'],errorMessage:'Attachment unavailable'},async context=>{
  const owner=(await context.scope()).userId,db=getDb(),bucket=(env as unknown as {MEDIA:R2Bucket}).MEDIA;
  if(context.request.method==='GET') {
    const {object,attachment}=await readBridgeMedia(db,bucket,context.url.searchParams.get('bindingId'),context.url.searchParams.get('id'),owner);
    return new Response(object.body,{headers:{'content-type':attachment.type,'content-disposition':'attachment','x-content-type-options':'nosniff','cache-control':'private, no-store'}});
  }
  const form=await context.request.formData(),file=form.get('file');
  if(!(file instanceof File))throw new APIError('File required');
  if(file.size>32*1024*1024)throw new APIError('Attachment must be under 32 MB',413);
  return context.json(await uploadBridgeMedia(db,bucket,form.get('bindingId'),'user',{name:file.name,type:file.type||'application/octet-stream',bytes:new Uint8Array(await file.arrayBuffer()),kind:String(form.get('kind')||''),transcript:String(form.get('transcript')||''),duration:Number(form.get('duration')||0)},owner));
});
export const GET=handle,POST=handle;
