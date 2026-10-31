/** One authorized connection's direct inbox and group inboxes. */
import { assistantMessagesBound, assistantReplyBound } from './conversation-bridge.ts';
import { assistantGroups, assistantGroupMessages, assistantGroupSend } from './bridge-groups.ts';

type DB = D1Database;

export async function readCombinedInbox(db: DB, bindingID: string) {
  const direct = await assistantMessagesBound(db, bindingID);
  const groups = await assistantGroups(db, bindingID);
  const groupPending: Record<string, unknown>[] = [];
  for (const group of groups.groups) {
    const history = await assistantGroupMessages(db, bindingID, group.id);
    // A group reply addresses the preceding outstanding messages as a batch.
    // Older group replies do not carry replyTo, so the last reply is the
    // available, backward-compatible checkpoint for existing groups.
    let lastReply = -1;
    for (let i = 0; i < history.messages.length; i++) {
      if (history.messages[i].senderId === bindingID) lastReply = i;
    }
    const inbox=await db.prepare('SELECT message_id FROM vesper_bridge_group_inbox WHERE binding_id=? AND group_id=?').bind(bindingID,group.id).all<{message_id:string}>();
    const notified=new Set(inbox.results.map(row=>row.message_id));
    const recent=history.messages.slice(-12).map(message=>({...message,
      senderName: message.senderId==='user'?'Vera':message.senderId==='ash'?'Ash':(group.members.find(member=>member.id===message.senderId)?.name ?? 'Member')}));
    for (const message of history.messages.slice(lastReply + 1)) {
      if (message.senderId === bindingID || !notified.has(message.id)) continue;
      groupPending.push({...message, sender: message.senderId==='user'?'user':'participant',
        senderName: message.senderId==='user'?'Vera':message.senderId==='ash'?'Ash':(group.members.find(member=>member.id===message.senderId)?.name ?? 'Member'),
        groupId: group.id, group_id: group.id, groupName: group.name, continuous: group.continuous, source: 'group', recentGroupMessages: recent});
    }
  }
  const pending = [...direct.pending, ...groupPending]
    .sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, 100);
  return {...direct, pending, group_pending: groupPending};
}

export async function replyFromCombinedInbox(db: DB, bindingID: string, input: Record<string, unknown>) {
  const replyTo = input.replyTo;
  if (typeof replyTo !== 'string' || !replyTo) return assistantReplyBound(db, bindingID, input);
  const direct = await db.prepare("SELECT 1 AS found FROM vesper_bridge_messages WHERE binding_id=? AND id=? AND sender='user'")
    .bind(bindingID, replyTo).first();
  const matches = await db.prepare(`SELECT i.group_id FROM vesper_bridge_group_inbox i
    JOIN vesper_bridge_group_members gm ON gm.group_id=i.group_id AND gm.binding_id=i.binding_id
    JOIN vesper_bridge_bindings b ON b.id=i.binding_id AND b.revoked=0
    JOIN vesper_bridge_group_messages m ON m.group_id=i.group_id AND m.id=i.message_id AND m.sender_id<>i.binding_id
    WHERE i.binding_id=? AND i.message_id=? AND NOT EXISTS
      (SELECT 1 FROM vesper_bridge_group_inflight f WHERE f.group_id=m.group_id AND f.message_id=m.id AND f.ready=0)`)
    .bind(bindingID, replyTo).all<{group_id:string}>();
  const groupID = typeof input.groupId === 'string' ? input.groupId : '';
  if (groupID) {
    if (!matches.results.some(row => row.group_id === groupID)) throw new Error('Group unavailable');
    return assistantGroupSend(db, bindingID, {...input, groupId: groupID});
  }
  if (matches.results.length && (direct || matches.results.length !== 1)) throw new Error('Ambiguous reply; specify groupId');
  if (matches.results.length === 1) return assistantGroupSend(db, bindingID, {...input, groupId: matches.results[0].group_id});
  return assistantReplyBound(db, bindingID, input);
}
