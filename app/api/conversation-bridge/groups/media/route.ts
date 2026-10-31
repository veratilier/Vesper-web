import { appRoute,APIError } from '@/lib/backend/http';
import { optionsResponse } from '@/lib/cors';
import { getDb } from '@/lib/db';
import { env } from 'cloudflare:workers';
import { uploadGroupMedia,readGroupMedia } from '@/lib/bridge-group-media';
export const OPTIONS=optionsResponse;
const handle=appRoute({service:'bridge-group-media',methods:['GET','POST'],errorMessage:'Attachment unavailable'},async context=>{
  const owner=(await context.scope()).userId,db=getDb(),bucket=(env as unknown as {MEDIA:R2Bucket}).MEDIA;
  if(context.request.method==='GET') {const {object,attachment}=await readGroupMedia(db,bucket,context.url.searchParams.get('groupId'),context.url.searchParams.get('id'),{owner});return new Response(object.body,{headers:{'content-type':attachment.type,'content-disposition':'attachment','x-content-type-options':'nosniff','cache-control':'private, no-store'}});}
  const form=await context.request.formData(),file=form.get('file');if(!(file instanceof File))throw new APIError('File required');if(file.size>32*1024*1024)throw new APIError('Attachment must be under 32 MB',413);
  const claimant=form.get('ashClaimant'),messageId=form.get('ashMessageId');
  const access=typeof claimant==='string'&&typeof messageId==='string'?{owner,ash:{claimant,messageId}}:{owner};
  return context.json(await uploadGroupMedia(db,bucket,form.get('groupId'),access,{name:file.name,type:file.type||'application/octet-stream',bytes:new Uint8Array(await file.arrayBuffer()),kind:String(form.get('kind')||'')}));
});
export const GET=handle,POST=handle;
