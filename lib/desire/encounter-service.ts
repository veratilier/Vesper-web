import { encounterInput, type EncounterInput } from "./encounter-input";
import { findEncounter, publicState, readState, saveEncounter, scoreEncounter } from "./desire-store";
import { sendEncounterPush, type PushEnv } from "./push";

type EncounterEnv = PushEnv & { DESIRE_DB: D1Database };

export async function recordEncounter(env: EncounterEnv, userId: string, raw: EncounterInput, now = new Date(), notify: typeof sendEncounterPush = sendEncounterPush) {
  // Validate at the service boundary as well as MCP; invalid legacy calls write nothing.
  const input = encounterInput.parse(raw);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([userId, input.request_id])));
  const id = `event-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const replay = (record: NonNullable<Awaited<ReturnType<typeof findEncounter>>>) => {
    if (record.kind !== input.kind || record.surface !== (input.surface ?? "chat")
      || record.interactionSource !== input.interaction_source
      || (input.note !== undefined && record.note !== input.note)) {
      throw new Error("request_id already belongs to another event; reuse it only for an identical retry");
    }
    return {
    encounterId: record.id, note: record.note, before: record.before, after: record.after, delta: record.delta,
    reasons: record.reasons, interaction_source: record.interactionSource, event_at: record.eventAt,
    replayed: true,
    };
  };
  const existing = await findEncounter(env, userId, id);
  if (existing) return replay(existing);

  const previous = await readState(env, userId, now);
  const score = scoreEncounter(previous, input.kind, now, {
    interactionSource: input.interaction_source, possessivenessTrigger: input.possessiveness_trigger,
  });
  let record;
  try {
    record = await saveEncounter(env, userId, previous, score, input.kind, input.surface ?? "chat", input.note, now, id);
  } catch (error) {
    // Another request may have committed this ID between lookup and insertion.
    const concurrent = await findEncounter(env, userId, id);
    if (concurrent) return replay(concurrent);
    throw error;
  }
  try { await notify(env, previous, score.state, input.kind, record.note); }
  catch { console.warn(JSON.stringify({ event: "encounter_push_error" })); }
  return {
    ...publicState(score.state), ...replay(record), replayed: false,
  };
}
