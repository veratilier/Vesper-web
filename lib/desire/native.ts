import { emotionState, emotionHistory, emotionEvents } from './emotion-store';
import { desireTools } from './tools';

export type NativeDesireEnv = { DB?: D1Database; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string };
export class DesireUnavailable extends Error {}
export async function legacyHistory(db: D1Database, limit: number) {
  try {
    const result = await db.prepare('SELECT id,note,created_at,after_state FROM vesper_desire_history WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ?').bind('vesper',limit).all<{id:string;note:string;created_at:string;after_state:string}>();
    return { schemaVersion: 1, legacy: true, records: result.results.map(r => ({id:r.id,note:r.note,createdAt:r.created_at,source:'legacy',values:JSON.parse(r.after_state)})) };
  } catch (e) { if (String(e).includes('no such table')) return {schemaVersion:1,legacy:true,records:[]}; throw e; }
}
/** Independent Vesper emotions. The original six-dimensional service stays intact. */
export async function executeDesire(env: NativeDesireEnv, name: string, raw: unknown = {}) {
  const tool = desireTools.find(tool => tool.name === name);
  if (!tool) throw new Error('Unknown Desire tool');
  const input = tool.schema.parse(raw) as Record<string, unknown>, db = env.DB;
  if (!db) throw new DesireUnavailable('Vesper Desire storage is unavailable.');
  if (name === 'desire_status') return emotionState(db);
  if (name === 'desire_history') return input.legacy ? legacyHistory(db,Number(input.limit ?? 20)) : emotionHistory(db,Number(input.limit ?? 20),input.cursor as string|undefined);
  if (name === 'desire_encounter') {
    // Older threads may record evidence, never apply legacy numeric formulas.
    const id = 'observation:' + input.request_id;
    await emotionEvents(db,[{id,stream:'vesper:observation',at:new Date().toISOString(),kind:'activity',text:String(input.note ?? '').slice(0,4000),outcome:'unconfirmed'}]);
    return { recorded:true,eventId:id,pendingAssessment:true,note:'Observation recorded; no emotion values changed. Do not write another observation for a chat turn with an attached emotion candidate.' };
  }
  return { deprecated:true, schemaVersion:3, note:'Desire now represents eight emotions. No canned expression or style-driven score is generated. Use desire_status for the committed state.' };
}
