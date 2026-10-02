import { ensureSchema, getDb } from '@/lib/db';
import type { MemoryScope } from '@/lib/memory';

// Additive schema: original evidence is append-only, independent of memory edits.
async function ready() {
  await ensureSchema();
  await getDb().batch([
    getDb().prepare(`CREATE TABLE IF NOT EXISTS vesper_memory_evidence (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, character_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, content TEXT NOT NULL,
      role TEXT NOT NULL, attachments TEXT NOT NULL, created_at TEXT NOT NULL, recorded_at TEXT NOT NULL)`),
    getDb().prepare(`CREATE TABLE IF NOT EXISTS vesper_memory_sources (
      memory_id TEXT NOT NULL, evidence_id TEXT NOT NULL, PRIMARY KEY(memory_id,evidence_id))`),
    getDb().prepare(`CREATE INDEX IF NOT EXISTS vesper_evidence_scope ON vesper_memory_evidence(user_id,character_id,created_at)`),
  ]);
}
export async function recordEvidence(scope: MemoryScope, input: { conversationId: string; messageId: string; content: string; role: string; createdAt?: string; attachments?: unknown }) {
  await ready();
  const content = String(input.content || '');
  const attachments = JSON.stringify(Array.isArray(input.attachments) ? input.attachments : []);
  if (!input.conversationId || !input.messageId || content.length + attachments.length > 2_000_000) throw new Error('Invalid evidence');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([scope.userId, scope.characterId, input.conversationId, input.messageId, content, attachments])));
  const id = [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
  const now = new Date().toISOString();
  await getDb().prepare(`INSERT OR IGNORE INTO vesper_memory_evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, scope.userId, scope.characterId, input.conversationId, input.messageId, content, input.role, attachments, input.createdAt || now, now).run();
  return id;
}
export async function linkEvidence(scope: MemoryScope, memoryId: string, ids: string[]) {
  await ready();
  for (const id of ids.slice(0, 24)) {
    await getDb().prepare(`INSERT OR IGNORE INTO vesper_memory_sources(memory_id,evidence_id)
      SELECT m.id,e.id FROM vesper_memories m JOIN vesper_memory_evidence e
      ON e.user_id=m.user_id AND e.character_id=m.character_id
      WHERE m.id=? AND e.id=? AND m.user_id=? AND m.character_id=?`)
      .bind(memoryId, id, scope.userId, scope.characterId).run();
  }
}
export async function evidenceFor(scope: MemoryScope, memoryId?: string) {
  await ready();
  const rows = await getDb().prepare(`SELECT e.* FROM vesper_memory_evidence e
    WHERE e.user_id=? AND e.character_id=? ${memoryId ? 'AND e.id IN (SELECT evidence_id FROM vesper_memory_sources WHERE memory_id=?)' : ''}
    ORDER BY e.created_at DESC LIMIT 200`).bind(scope.userId, scope.characterId, ...(memoryId ? [memoryId] : [])).all<Record<string, string>>();
  return rows.results.map(row => ({ id: row.id, conversationId: row.conversation_id, messageId: row.message_id,
    content: row.content, role: row.role, attachments: JSON.parse(row.attachments), createdAt: row.created_at, recordedAt: row.recorded_at }));
}

export async function evidenceIdsForMessages(scope: MemoryScope, conversationId: string, ids: string[]) {
  await ready();
  if (!ids.length) return [];
  const unique = [...new Set(ids)].slice(0, 24);
  const rows = await getDb().prepare(`SELECT id FROM vesper_memory_evidence
    WHERE user_id=? AND character_id=? AND conversation_id=? AND message_id IN (${unique.map(() => '?').join(',')})`)
    .bind(scope.userId, scope.characterId, conversationId, ...unique).all<{ id: string }>();
  return rows.results.map(row => row.id);
}

// Exact quotation checks for shared-memory writes and historical backfill.
export async function verifySharedEvidence(scope: MemoryScope, references: {conversation_id:string;message_id:string;quote:string}[]) {
  await ready();
  return Promise.all(references.map(async ref => {
    const rows = await getDb().prepare(`SELECT content,created_at FROM vesper_memory_evidence
      WHERE user_id=? AND character_id=? AND conversation_id=? AND message_id=? ORDER BY recorded_at`)
      .bind(scope.userId,scope.characterId,ref.conversation_id,ref.message_id).all<{content:string;created_at:string}>();
    const original=rows.results.find(row=>row.content.includes(ref.quote));
    if(!original)throw new Error('引用未在原始聊天中找到；请先查找原始消息，不能编造或把摘要当原话。');
    return {...ref,created_at:original.created_at};
  }));
}
