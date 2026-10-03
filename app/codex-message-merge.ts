import { visibleUserContext } from "../lib/web-chat-context.ts";
export type MergeableCodexMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  conversationId?: string;
  type?: string;
  status?: string;
  metadata?: { execution?: { status: string; updatedAt: string }; modelInputText?: string; itemId?: string; turnId?: string; threadId?: string; showTurnStatus?: boolean; blockType?: string };
};

// The first legacy bubble keeps the original itemId, but its message id has
// :bubble:0. Later bubbles carry the suffix in both fields. Inspect both.
export function codexBubbleIdentity(item: MergeableCodexMessage) {
  if (item.role !== "agent") return null;
  for (const id of [item.metadata?.itemId, item.id]) {
    const match = id?.match(/^(.+):bubble:(\d+)$/);
    if (match) return { parentId: match[1], index: Number(match[2]) };
  }
  return null;
}

export function hasCodexChatBubbles(items: MergeableCodexMessage[], parentId: string) {
  return items.some((item) => codexBubbleIdentity(item)?.parentId === parentId);
}

export function isCompletedCodexItem(items: MergeableCodexMessage[], itemId: string) {
  return hasCodexChatBubbles(items, itemId) || items.some((item) =>
    item.role === "agent" && item.metadata?.itemId === itemId && item.status === "delivered");
}

const scopeKey = (item: MergeableCodexMessage) => item.conversationId || item.metadata?.threadId || "";

export function mergeCodexMessages<T extends MergeableCodexMessage>(...groups: T[][]): T[] {
  const all = groups.flat().map(item => item.role === "user" ? { ...item, content: visibleUserContext(item.content) } as T : item);
  const familyKey = (item: T, parentId: string) => JSON.stringify([scopeKey(item), parentId]);
  const splitFamilies = new Set(all.flatMap((item) => {
    const bubble = codexBubbleIdentity(item);
    return bubble ? [familyKey(item, bubble.parentId)] : [];
  }));
  const bubblesByFamily = new Map<string, T[]>();
  for (const item of all) {
    const bubble = codexBubbleIdentity(item);
    if (!bubble) continue;
    const key = familyKey(item, bubble.parentId);
    bubblesByFamily.set(key, [...(bubblesByFamily.get(key) || []), item]);
  }
  const normalizedText = (text: string) => text.replace(/\s+/g, "");
  const isOverwrittenFirstBubble = (item: T) => {
    const identity = codexBubbleIdentity(item);
    if (!identity || identity.index !== 0) return false;
    const family = bubblesByFamily.get(familyKey(item, identity.parentId)) || [];
    const siblings = new Map<number, T>();
    for (const candidate of family) {
      const index = codexBubbleIdentity(candidate)!.index;
      if (index > 0) siblings.set(index, candidate);
    }
    if (!siblings.size) return false;
    const tail = [...siblings].sort(([a], [b]) => a - b).map(([, bubble]) => bubble.content).join("");
    // Older snapshot code could retain bubble 0's id while replacing its text
    // with the aggregate. Repair only an exact match against surviving pieces.
    return family.some((candidate) => codexBubbleIdentity(candidate)?.index === 0
      && candidate.content !== item.content
      && normalizedText(candidate.content + tail) === normalizedText(item.content));
  };
  // Decide across ALL sources before merging. Otherwise a late snapshot or
  // union-only recovery cache can overwrite bubble 0 with the complete text.
  // Never reconstruct missing siblings here: they may have been deleted.
  const candidates = all.filter((item) => !isOverwrittenFirstBubble(item) && (item.role !== "agent" || codexBubbleIdentity(item)
    || !splitFamilies.has(familyKey(item, item.metadata?.itemId || item.id))));
  const merged: Array<T | undefined> = [];
  const byId = new Map<string, number>();
  const byItemId = new Map<string, number>();
  const byTurnContent = new Map<string, number>();
  const scoped = (item: T, id: string) => JSON.stringify([scopeKey(item), item.role, id]);
  // Distinct assistant items/bubbles may intentionally say the same thing.
  const semanticKey = (item: T) => item.metadata?.turnId && !(item.role !== "user" && item.metadata?.itemId)
    ? JSON.stringify([scopeKey(item), item.metadata.turnId, item.role, item.role === "user" ? item.metadata?.modelInputText || item.content : item.content])
    : "";
  const indexMessage = (item: T, index: number) => {
    if (item.id) byId.set(scoped(item, item.id), index);
    if (item.metadata?.itemId) byItemId.set(scoped(item, item.metadata.itemId), index);
    const semantic = semanticKey(item);
    if (semantic) byTurnContent.set(semantic, index);
  };

  for (const item of candidates) {
    const matches = new Set<number>();
    const idMatch = item.id ? byId.get(scoped(item, item.id)) : undefined;
    const itemMatch = item.metadata?.itemId ? byItemId.get(scoped(item, item.metadata.itemId)) : undefined;
    const semantic = semanticKey(item);
    const semanticMatch = semantic ? byTurnContent.get(semantic) : undefined;
    if (idMatch !== undefined) matches.add(idMatch);
    if (itemMatch !== undefined) matches.add(itemMatch);
    if (semanticMatch !== undefined) matches.add(semanticMatch);

    const matchIndexes = [...matches].filter((index) => merged[index]);
    if (!matchIndexes.length) {
      const index = merged.length;
      merged.push(item);
      indexMessage(item, index);
      continue;
    }

    const targetIndex = Math.min(...matchIndexes);
    const original = merged[targetIndex]!;
    let next = original;
    for (const index of matchIndexes) {
      if (index === targetIndex) continue;
      const duplicate = merged[index];
      if (!duplicate) continue;
      next = { ...next, ...duplicate, id: next.id || duplicate.id, createdAt: next.createdAt || duplicate.createdAt, metadata: { ...next.metadata, ...duplicate.metadata } } as T;
      indexMessage(duplicate, targetIndex);
      merged[index] = undefined;
    }
    const previousExecution = next.metadata?.execution;
    const incomingExecution = item.metadata?.execution;
    const running = (status: string) => ["inProgress", "running", "unknown"].includes(status);
    const keepExecution = previousExecution && incomingExecution && (
      (!running(previousExecution.status) && running(incomingExecution.status)) ||
      (running(previousExecution.status) === running(incomingExecution.status) && Date.parse(previousExecution.updatedAt) > Date.parse(incomingExecution.updatedAt))
    );
    const executionSource = keepExecution ? next : item;
    next = {
      ...next,
      ...item,
      content: original.role === "user" && original.metadata?.modelInputText ? original.content : item.content,
      id: original.id || item.id,
      createdAt: original.createdAt || item.createdAt,
      metadata: { ...next.metadata, ...item.metadata },
    } as T;
    if (previousExecution && incomingExecution) {
      next = { ...next, content: executionSource.content, status: executionSource.status,
        metadata: { ...next.metadata, execution: executionSource.metadata?.execution } } as T;
    }
    merged[targetIndex] = next;
    indexMessage(item, targetIndex);
    indexMessage(next, targetIndex);
  }

  const seenTurns = new Set<string>();
  return merged.filter((item): item is T => Boolean(item)).sort((left, right) => {
    const a = codexBubbleIdentity(left), b = codexBubbleIdentity(right);
    if (a && b && familyKey(left, a.parentId) === familyKey(right, b.parentId)) return a.index - b.index;
    return Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id);
  }).map((item) => {
    if (item.role !== "agent" || !item.metadata?.turnId || item.type === "sticker"
      || ["sticker", "musicCard"].includes(item.metadata.blockType || "")) return item;
    const key = JSON.stringify([scopeKey(item), item.metadata.turnId]);
    const showTurnStatus = !seenTurns.has(key);
    seenTurns.add(key);
    return { ...item, metadata: { ...item.metadata, showTurnStatus } };
  });
}
