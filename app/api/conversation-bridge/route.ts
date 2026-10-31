import { appRoute } from '@/lib/backend/http';
import { optionsResponse } from '@/lib/cors';
import { getDb } from '@/lib/db';
import { createBridge, listBridges, revokeBridge, userMessages, userSend } from '@/lib/conversation-bridge';
export const OPTIONS=optionsResponse;
const handle=appRoute({service:'conversation-bridge',methods:['GET','POST','DELETE'],errorMessage:'Conversation unavailable'},async context=>{
  const owner=(await context.scope()).userId, db=getDb();
  if(context.request.method==='GET') return context.json(context.url.searchParams.has('id') ? await userMessages(db,owner,context.url.searchParams.get('id')) : await listBridges(db,owner));
  const input=await context.request.json() as Record<string,unknown>;
  if(context.request.method==='DELETE') return context.json(await revokeBridge(db,owner,input.id));
  if(input.action==='create') return context.json(await createBridge(db,owner,input));
  if(input.action==='send') return context.json(await userSend(db,owner,input));
  throw new Error('Unsupported action');
});
export const GET=handle,POST=handle,DELETE=handle;
