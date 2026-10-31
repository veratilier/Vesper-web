import { appRoute } from '@/lib/backend/http';
import { optionsResponse } from '@/lib/cors';
import { getDb } from '@/lib/db';
import { createGroup, userGroups, userGroupMessages, userGroupSend, claimGroupAsh, completeGroupAsh } from '@/lib/bridge-groups';
export const OPTIONS=optionsResponse;
const handle=appRoute({service:'bridge-groups',methods:['GET','POST'],errorMessage:'Group unavailable'},async context=>{
  const owner=(await context.scope()).userId,db=getDb();
  if(context.request.method==='GET')return context.json(context.url.searchParams.has('id')?await userGroupMessages(db,owner,context.url.searchParams.get('id')):await userGroups(db,owner));
  const input=await context.request.json() as Record<string,unknown>;
  if(input.action==='create')return context.json(await createGroup(db,owner,input));
  if(input.action==='send')return context.json(await userGroupSend(db,owner,input));
  if(input.action==='claimAsh')return context.json(await claimGroupAsh(db,owner,input));
  if(input.action==='completeAsh')return context.json(await completeGroupAsh(db,owner,input));
  throw new Error('Unsupported action');
});
export const GET=handle,POST=handle;
