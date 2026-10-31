import { appRoute, APIError } from '@/lib/backend/http';
import { optionsResponse } from '@/lib/cors';
import { getDb } from '@/lib/db';
import { env } from 'cloudflare:workers';
import { ensureBridge } from '@/lib/conversation-bridge';
import { readBridgeAvatar, updateBridgeProfile } from '@/lib/bridge-media';
export const OPTIONS=optionsResponse;
const handle=appRoute({service:'bridge-profile',methods:['GET','POST'],errorMessage:'Contact unavailable'},async context=>{
  const owner=(await context.scope()).userId,db=getDb(),bucket=(env as unknown as {MEDIA:R2Bucket}).MEDIA;
  await ensureBridge(db);
  if(context.request.method==='GET') {
    const image=await readBridgeAvatar(db,bucket,context.url.searchParams.get('bindingId'),owner);
    return new Response(image.body,{headers:{'content-type':'image/jpeg','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
  }
  const form=await context.request.formData(),file=form.get('avatar');
  if(file instanceof File && file.size>4*1024*1024)throw new APIError('Avatar must be under 4 MB',413);
  return context.json(await updateBridgeProfile(db,bucket,form.get('bindingId'),owner,form.get('name'),file instanceof File?new Uint8Array(await file.arrayBuffer()):undefined));
});
export const GET=handle,POST=handle;
