import type { D1Database } from '@cloudflare/workers-types';
import { saveSchema,saveMemory,MemoryError } from './shared-memory-engine';
import * as z from 'zod/v4';
const ready=new WeakMap<D1Database,Promise<unknown>>();
async function ensure(db:D1Database){if(!ready.has(db))ready.set(db,db.prepare('CREATE TABLE IF NOT EXISTS memory_candidates (id TEXT PRIMARY KEY,owner TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,memory_id TEXT,UNIQUE(owner,id))').run().catch(e=>{ready.delete(db);throw e;}));await ready.get(db);
 // The guard and acceptance update share saveMemory's transaction, so reject cannot race a save.
 await db.prepare("CREATE TRIGGER IF NOT EXISTS memory_candidate_pending BEFORE INSERT ON memories WHEN substr(NEW.source_id,1,10)='candidate:' AND NOT EXISTS (SELECT 1 FROM memory_candidates WHERE id=substr(NEW.source_id,11) AND status='pending' AND json_extract(payload,'$.body')=NEW.body AND json_extract(payload,'$.kind')=NEW.kind AND json_extract(payload,'$.source')=NEW.source) BEGIN SELECT RAISE(ABORT,'candidate_not_pending'); END").run();
}

export async function proposeMemory(db:D1Database,owner:string,input:unknown){
 await ensure(db);const payload=saveSchema.parse(input);
 if(payload.kind==='episode'&&!payload.details?.evidence?.length)throw new MemoryError('episode_requires_original_evidence',400);
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([owner,payload.kind,payload.details?.evidence?.length?payload.details.evidence.map(r=>[r.conversation_id,r.message_id]).sort():payload])));
 const id=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
 await db.prepare("INSERT OR IGNORE INTO memory_candidates VALUES (?,?,?,'pending',?,NULL)").bind(id,owner,JSON.stringify(payload),new Date().toISOString()).run();
 const row=await db.prepare('SELECT status,memory_id FROM memory_candidates WHERE id=? AND owner=?').bind(id,owner).first<{status:string;memory_id:string|null}>();
 return {stored:row?.status==='accepted',candidateId:id,status:row?.status,memoryId:row?.memory_id,needsReview:row?.status==='pending'};
}
export async function listCandidates(db:D1Database,owner:string){await ensure(db);return {items:(await db.prepare("SELECT id,payload,created_at FROM memory_candidates WHERE owner=? AND status='pending' ORDER BY created_at DESC LIMIT 40").bind(owner).all<{id:string;payload:string;created_at:string}>()).results.map(r=>({id:r.id,...JSON.parse(r.payload),createdAt:r.created_at}))};}
export async function reviewCandidate(db:D1Database,owner:string,input:unknown,verify:(refs:NonNullable<z.infer<typeof saveSchema>['details']>['evidence'])=>Promise<unknown>){
 const action=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),action:z.enum(['accept','reject'])}).parse(input);await ensure(db);
 const row=await db.prepare('SELECT payload,status,memory_id FROM memory_candidates WHERE id=? AND owner=?').bind(action.id,owner).first<{payload:string;status:string;memory_id:string|null}>();if(!row)throw new MemoryError('candidate_not_found',404);
 if(row.status!=='pending')return {status:row.status,memoryId:row.memory_id};
 if(action.action==='reject'){
  await db.prepare("UPDATE memory_candidates SET status='rejected' WHERE id=? AND owner=? AND status='pending'").bind(action.id,owner).run();
  return await db.prepare('SELECT status,memory_id AS memoryId FROM memory_candidates WHERE id=? AND owner=?').bind(action.id,owner).first<{status:string;memoryId:string|null}>();
 }
 const payload=saveSchema.parse(JSON.parse(row.payload));if(payload.details?.evidence?.length)await verify(payload.details.evidence);
 const memory=await saveMemory(db,{...payload,source_id:'candidate:'+action.id},false,id=>[
  // A concurrent edit conflicts on the primary key, rolling back the complete D1 batch.
  db.prepare("INSERT INTO memory_candidates SELECT * FROM memory_candidates WHERE id=? AND (status!='pending' OR payload!=?)").bind(action.id,row.payload),
  db.prepare("UPDATE memory_candidates SET status='accepted',memory_id=? WHERE id=? AND owner=? AND status='pending' AND payload=?").bind(id,action.id,owner,row.payload)
 ]);
 return {status:'accepted',memoryId:memory.id};
}

export async function editCandidate(db:D1Database,owner:string,id:string,input:unknown){
 z.string().regex(/^[a-f0-9]{64}$/).parse(id);await ensure(db);const payload=saveSchema.parse(input);
 if(payload.kind==='episode'&&!payload.details?.evidence?.length)throw new MemoryError('episode_requires_original_evidence',400);
 const row=await db.prepare("SELECT payload FROM memory_candidates WHERE id=? AND owner=? AND status='pending'").bind(id,owner).first<{payload:string}>();
 if(!row)throw new MemoryError('candidate_not_pending',409);
 // Preserve the original references and candidate identity; edits correct the interpretation.
 const original=saveSchema.parse(JSON.parse(row.payload));
 if(JSON.stringify(payload.details?.evidence)!==JSON.stringify(original.details?.evidence))throw new MemoryError('candidate_sources_immutable',409);
 await db.prepare("UPDATE memory_candidates SET payload=? WHERE id=? AND owner=? AND status='pending'").bind(JSON.stringify(payload),id,owner).run();
 const current=await db.prepare('SELECT status,payload FROM memory_candidates WHERE id=? AND owner=?').bind(id,owner).first<{status:string;payload:string}>();
 if(current?.status!=='pending'||current.payload!==JSON.stringify(payload))throw new MemoryError('candidate_changed_reload',409);
 return {id,status:'pending'};
}
