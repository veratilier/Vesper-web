export type Style = "quiet" | "playful" | "clingy";
export type EncounterKind = "warmth" | "absence" | "repair" | "shared_work" | "flirt";
export type Surface = "chat" | "frontend";
export const interactionSources = ["user", "automation", "frontend"] as const;
export type InteractionSource = (typeof interactionSources)[number];
export const possessivenessTriggers = ["flirt", "jealousy", "relationship"] as const;
export type PossessivenessTrigger = (typeof possessivenessTriggers)[number];

export type EncounterContext = {
  /** Missing values deliberately default to automation so legacy callers cannot fake contact. */
  interactionSource?: InteractionSource;
  possessivenessTrigger?: PossessivenessTrigger;
};

export const desireFields = ["longing", "tenderness", "playfulness", "intensity", "attachment", "possessiveness"] as const;
export type DesireField = (typeof desireFields)[number];
export type DesireValues = Record<DesireField, number>;

export type DesireState = DesireValues & {
  style: Style;
  lastEncounterAt: string | null;
  lastExpressionAt: string | null;
  lastRealInteractionAt: string | null;
  /** Cursor for the already-scored portion of time since the last real interaction. */
  lastAbsenceEvaluatedAt: string;
  /** Separate cursor so long absence can cool/intensify without double-counting. */
  lastIntensityEvaluatedAt: string;
  /** The last point from which natural settling was successfully rounded and persisted. */
  lastSettledAt: string;
};

export type ChangeReasons = Partial<Record<DesireField, string[]>>;

export type EncounterScore = {
  state: DesireState;
  interactionSource: InteractionSource;
  eventAt: string;
  reasons: ChangeReasons;
};

export type EncounterRecord = {
  id: string;
  kind: EncounterKind;
  surface: Surface;
  note: string;
  createdAt: string;
  eventAt: string;
  interactionSource: InteractionSource;
  before: DesireValues;
  after: DesireValues;
  delta: Partial<DesireValues>;
  reasons: ChangeReasons;
};

type DesireEnv = { DESIRE_DB: D1Database; OAUTH_KV: KVNamespace };
type StateRow = {
  style: Style;
  longing: number;
  tenderness: number;
  playfulness: number;
  intensity: number;
  attachment: number;
  possessiveness: number;
  last_encounter_at: string | null;
  last_expression_at: string | null;
  last_real_interaction_at: string | null;
  longing_calculated_through_at: string;
  possessiveness_calculated_through_at: string | null;
  last_absence_evaluated_at: string | null;
  last_intensity_evaluated_at: string | null;
  last_settled_at: string | null;
};
type HistoryRow = {
  id: string;
  kind: EncounterKind;
  surface: Surface;
  note: string;
  created_at: string;
  before_state: string;
  after_state: string;
  delta: string;
  interaction_source: InteractionSource | null;
  change_reasons: string | null;
  event_at: string | null;
};

const DEFAULTS: Omit<DesireState, "lastAbsenceEvaluatedAt" | "lastIntensityEvaluatedAt" | "lastSettledAt"> = {
  style: "quiet",
  longing: 18,
  tenderness: 64,
  playfulness: 28,
  intensity: 22,
  attachment: 41,
  possessiveness: 20,
  lastEncounterAt: null,
  lastExpressionAt: null,
  lastRealInteractionAt: null,
};

export const fieldLabels: Record<DesireField, string> = {
  longing: "思念",
  tenderness: "温柔",
  playfulness: "玩心",
  intensity: "浓度",
  attachment: "依恋",
  possessiveness: "占有欲",
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const LONGING_MINIMUM = 12;
const LONGING_PER_SILENT_HOURS = 6;
const SETTLING_BASELINES: Omit<DesireValues, "longing"> = {
  tenderness: DEFAULTS.tenderness,
  playfulness: DEFAULTS.playfulness,
  intensity: DEFAULTS.intensity,
  attachment: DEFAULTS.attachment,
  possessiveness: DEFAULTS.possessiveness,
};

// Half-lives in hours. Activation settles first, while tenderness and
// attachment remain as slower traces instead of being erased by quiet time.
const SETTLING_HALF_LIVES: Omit<DesireValues, "longing"> = {
  tenderness: 72,
  playfulness: 36,
  intensity: 18,
  attachment: 96,
  possessiveness: 60,
};
const numberValue = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? clamp(value) : fallback;
const dateMs = (value: string | null | undefined, fallback: number) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function publicState(state: DesireState) {
  return {
    style: state.style,
    longing: state.longing,
    tenderness: state.tenderness,
    playfulness: state.playfulness,
    intensity: state.intensity,
    attachment: state.attachment,
    possessiveness: state.possessiveness,
    lastEncounterAt: state.lastEncounterAt,
    lastExpressionAt: state.lastExpressionAt,
    lastRealInteractionAt: state.lastRealInteractionAt,
  };
}

export function valuesOf(state: DesireState): DesireValues {
  return Object.fromEntries(desireFields.map((field) => [field, state[field]])) as DesireValues;
}

function rowToState(row: StateRow, now = new Date()): DesireState {
  const nowIso = now.toISOString();
  const legacyAbsenceCursor = row.last_absence_evaluated_at
    ?? row.longing_calculated_through_at
    ?? row.last_real_interaction_at
    ?? row.last_encounter_at
    ?? nowIso;

  return {
    style: row.style,
    longing: clamp(row.longing), tenderness: clamp(row.tenderness), playfulness: clamp(row.playfulness),
    intensity: clamp(row.intensity), attachment: clamp(row.attachment), possessiveness: clamp(row.possessiveness),
    lastEncounterAt: row.last_encounter_at, lastExpressionAt: row.last_expression_at,
    lastRealInteractionAt: row.last_real_interaction_at,
    lastAbsenceEvaluatedAt: legacyAbsenceCursor,
    lastIntensityEvaluatedAt: row.last_intensity_evaluated_at
      ?? row.possessiveness_calculated_through_at
      ?? legacyAbsenceCursor,
    lastSettledAt: row.last_settled_at ?? row.last_encounter_at ?? nowIso,
  };
}

function stateStatement(db: D1Database, userId: string, state: DesireState, updatedAt: string) {
  return db.prepare(`INSERT INTO desire_state (
    user_id, style, longing, tenderness, playfulness, intensity, attachment, possessiveness,
    last_encounter_at, last_expression_at, last_real_interaction_at, longing_calculated_through_at,
    possessiveness_calculated_through_at, last_absence_evaluated_at, last_intensity_evaluated_at,
    last_settled_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    style=excluded.style, longing=excluded.longing, tenderness=excluded.tenderness,
    playfulness=excluded.playfulness, intensity=excluded.intensity, attachment=excluded.attachment,
    possessiveness=excluded.possessiveness, last_encounter_at=excluded.last_encounter_at,
    last_expression_at=excluded.last_expression_at, last_real_interaction_at=excluded.last_real_interaction_at,
    longing_calculated_through_at=excluded.longing_calculated_through_at,
    possessiveness_calculated_through_at=excluded.possessiveness_calculated_through_at,
    last_absence_evaluated_at=excluded.last_absence_evaluated_at,
    last_intensity_evaluated_at=excluded.last_intensity_evaluated_at,
    last_settled_at=excluded.last_settled_at,
    updated_at=excluded.updated_at`).bind(
      userId, state.style, state.longing, state.tenderness, state.playfulness, state.intensity,
    state.attachment, state.possessiveness, state.lastEncounterAt, state.lastExpressionAt,
      state.lastRealInteractionAt, state.lastAbsenceEvaluatedAt, state.lastIntensityEvaluatedAt,
      state.lastAbsenceEvaluatedAt, state.lastIntensityEvaluatedAt, state.lastSettledAt, updatedAt,
    );
}

export async function readState(env: DesireEnv, userId: string, now = new Date()): Promise<DesireState> {
  const row = await env.DESIRE_DB.prepare("SELECT * FROM desire_state WHERE user_id = ?").bind(userId).first<StateRow>();
  if (row) return rowToState(row, now);

  const legacy = await env.OAUTH_KV.get<Record<string, unknown>>(`rowan-desire:${userId}`, "json");
  const longing = numberValue(legacy?.longing, DEFAULTS.longing);
  const tenderness = numberValue(legacy?.tenderness, DEFAULTS.tenderness);
  const intensity = numberValue(legacy?.intensity, DEFAULTS.intensity);
  const nowIso = now.toISOString();
  const legacyEncounter = typeof legacy?.lastEncounterAt === "string" ? legacy.lastEncounterAt : null;
  const state: DesireState = {
    ...DEFAULTS,
    style: legacy?.style === "playful" || legacy?.style === "clingy" ? legacy.style : "quiet",
    longing, tenderness,
    playfulness: numberValue(legacy?.playfulness, DEFAULTS.playfulness), intensity,
    attachment: clamp((tenderness + longing) / 2),
    possessiveness: clamp((longing + intensity) / 2),
    lastEncounterAt: legacyEncounter,
    lastExpressionAt: typeof legacy?.lastExpressionAt === "string" ? legacy.lastExpressionAt : null,
    lastRealInteractionAt: legacyEncounter,
    lastAbsenceEvaluatedAt: nowIso,
    lastIntensityEvaluatedAt: nowIso,
    lastSettledAt: nowIso,
  };
  await stateStatement(env.DESIRE_DB, userId, state, nowIso).run();
  return state;
}

const SOURCE_SCALE: Record<InteractionSource, number> = {
  user: 1,
  frontend: 0.45,
  // A wakeup is bookkeeping, not a social event. It can settle elapsed time
  // or score a real absence window, but never manufactures warmth on its own.
  automation: 0,
};

const sourceLabels: Record<InteractionSource, string> = {
  user: "Vera 的真实互动",
  frontend: "前端记录",
  automation: "自动化记录",
};

const kindLabels: Record<EncounterKind, string> = {
  warmth: "温暖互动",
  absence: "静默时段",
  repair: "修复互动",
  shared_work: "共同做事",
  flirt: "暧昧互动",
};

const triggerLabels: Record<PossessivenessTrigger, string> = {
  flirt: "明确暧昧",
  jealousy: "吃醋情境",
  relationship: "关系位置确认",
};

function add(state: DesireState, field: DesireField, amount: number): number {
  const before = state[field];
  state[field] = clamp(before + amount);
  return state[field] - before;
}

function addWithHeadroom(state: DesireState, field: DesireField, amount: number): number {
  if (amount <= 0) return add(state, field, amount);
  const headroom = Math.max(0, (100 - state[field]) / 100);
  // Positive events still matter near the top, but repeated identical events
  // cannot make a value race to 100 at a constant rate.
  const effective = Math.round(amount * Math.pow(headroom, 0.65));
  return effective > 0 ? add(state, field, effective) : 0;
}

function addReason(reasons: ChangeReasons, field: DesireField, reason: string) {
  (reasons[field] ??= []).push(reason);
}

function change(
  state: DesireState,
  reasons: ChangeReasons,
  field: DesireField,
  amount: number,
  reason: string,
  useHeadroom = amount > 0,
) {
  const delta = useHeadroom
    ? addWithHeadroom(state, field, amount)
    : add(state, field, amount);
  if (delta) addReason(reasons, field, reason);
  return delta;
}

function settle(state: DesireState, previous: DesireState, now: Date, reasons: ChangeReasons) {
  const nowMs = now.getTime();
  const settledAtMs = Math.min(nowMs, dateMs(previous.lastSettledAt, nowMs));
  const hours = Math.max(0, (nowMs - settledAtMs) / 3_600_000);
  if (!hours) return;

  let persistedChange = false;
  for (const field of Object.keys(SETTLING_BASELINES) as (keyof typeof SETTLING_BASELINES)[]) {
    const target = SETTLING_BASELINES[field];
    const halfLife = SETTLING_HALF_LIVES[field];
    const before = state[field];
    state[field] = clamp(target + (before - target) * Math.pow(0.5, hours / halfLife));
    if (state[field] !== before) {
      persistedChange = true;
      addReason(reasons, field, "随时间自然回落");
    }
  }

  // Keep fractional quiet-time decay available until it changes an integer value.
  if (persistedChange) state.lastSettledAt = now.toISOString();
}

/**
 * The persistent part of Rowan's wish to be close to Vera. Recent contact is
 * a positive trace, not a reset: it raises the floor while the connection is
 * fresh, then absence can continue to build on top of it.
 */
export function longingBaseline(state: DesireState, now = new Date()): number {
  const nowMs = now.getTime();
  const interactionMs = dateMs(state.lastRealInteractionAt, Number.NEGATIVE_INFINITY);
  const hoursSinceInteraction = Math.max(0, (nowMs - interactionMs) / 3_600_000);
  const recentInteraction = hoursSinceInteraction <= 6 ? 9
    : hoursSinceInteraction <= 24 ? 6
      : hoursSinceInteraction <= 72 ? 3
        : 0;
  return clamp(Math.max(
    LONGING_MINIMUM,
    8 + state.attachment * 0.16 + state.tenderness * 0.12 + state.intensity * 0.2 + recentInteraction,
  ));
}

function keepLongingPresent(state: DesireState, now: Date, reasons: ChangeReasons) {
  const target = Math.max(LONGING_MINIMUM, longingBaseline(state, now));
  if (state.longing < target) {
    state.longing = clamp(target);
    addReason(reasons, "longing", "由依恋、温柔、浓度与真实互动形成的基础值");
  }
}

function accrueAbsence(
  state: DesireState,
  previous: DesireState,
  now: Date,
  reasons: ChangeReasons,
) {
  const nowMs = now.getTime();
  const realMs = Math.min(nowMs, dateMs(previous.lastRealInteractionAt, nowMs));
  const absenceCursorMs = Math.max(
    realMs,
    Math.min(nowMs, dateMs(previous.lastAbsenceEvaluatedAt, realMs)),
  );
  const newlySilentHours = Math.max(0, (nowMs - absenceCursorMs) / 3_600_000);
  const longingSteps = Math.floor(newlySilentHours / LONGING_PER_SILENT_HOURS);

  if (longingSteps) {
    change(
      state,
      reasons,
      "longing",
      longingSteps,
      `距上次真实互动新增 ${longingSteps * LONGING_PER_SILENT_HOURS} 小时静默`,
      false,
    );
    state.lastAbsenceEvaluatedAt = new Date(
      absenceCursorMs + longingSteps * LONGING_PER_SILENT_HOURS * 3_600_000,
    ).toISOString();
  }

  // Long absence can heighten intensity, but never possessiveness on its own.
  const intensityCursorMs = Math.max(
    realMs + 24 * 3_600_000,
    Math.min(nowMs, dateMs(previous.lastIntensityEvaluatedAt, realMs)),
  );
  const intensitySteps = Math.floor(Math.max(0, nowMs - intensityCursorMs) / (12 * 3_600_000));
  if (intensitySteps) {
    change(
      state,
      reasons,
      "intensity",
      intensitySteps,
      `久别后新增 ${intensitySteps * 12} 小时静默`,
      false,
    );
    state.lastIntensityEvaluatedAt = new Date(
      intensityCursorMs + intensitySteps * 12 * 3_600_000,
    ).toISOString();
  }
}

function relieveLongingAfterRealInteraction(state: DesireState, now: Date, reasons: ChangeReasons) {
  const target = longingBaseline(state, now);
  if (state.longing <= target) return;
  const before = state.longing;
  // Relieve 25% of the excess, capped at 15 points per distinct user event.
  const relief = Math.min(15, Math.max(1, Math.round((before - target) * 0.25)));
  state.longing = clamp(Math.max(target, before - relief));
  if (state.longing !== before) addReason(reasons, "longing", "Vera 的真实互动缩短了距离");
}

function scaledEventDelta(field: DesireField, amount: number, source: InteractionSource): number {
  // Attachment is deliberately only built by real conversation, never wakeups.
  if (field === "attachment" && source !== "user") return 0;
  return amount * SOURCE_SCALE[source];
}

export function scoreEncounter(
  previous: DesireState,
  kind: EncounterKind,
  now = new Date(),
  context: EncounterContext = {},
): EncounterScore {
  const interactionSource = context.interactionSource ?? "automation";
  const state = { ...previous };
  const reasons: ChangeReasons = {};
  const eventAt = now.toISOString();

  if (kind === "absence" && interactionSource === "user") {
    throw new Error("absence cannot be a real user interaction");
  }

  settle(state, previous, now, reasons);
  const settledValues = valuesOf(state);
  accrueAbsence(state, previous, now, reasons);

  const fixed: Record<EncounterKind, Partial<DesireValues>> = {
    warmth: { tenderness: 6, intensity: -2, attachment: 1 },
    absence: {},
    repair: { tenderness: 7, intensity: -6, attachment: 2, possessiveness: -2 },
    shared_work: { tenderness: 3, playfulness: 2, intensity: 1, attachment: 1 },
    flirt: { playfulness: 7, intensity: 8 },
  };

  for (const [field, amount] of Object.entries(fixed[kind]) as [DesireField, number][]) {
    const scaled = scaledEventDelta(field, amount, interactionSource);
    if (!scaled) continue;
    change(
      state,
      reasons,
      field,
      scaled,
      `${sourceLabels[interactionSource]}的${kindLabels[kind]}`,
    );
  }

  const possessivenessTrigger = context.possessivenessTrigger
    ?? (kind === "flirt" ? "flirt" : undefined);
  if (interactionSource === "user" && possessivenessTrigger) {
    const amount: Record<PossessivenessTrigger, number> = {
      flirt: 6,
      jealousy: 8,
      relationship: 4,
    };
    change(
      state,
      reasons,
      "possessiveness",
      amount[possessivenessTrigger],
      `${triggerLabels[possessivenessTrigger]}带来的关系位置感`,
    );
  }

  state.lastEncounterAt = eventAt;
  if (interactionSource === "user") {
    state.lastRealInteractionAt = eventAt;
    state.lastAbsenceEvaluatedAt = eventAt;
    state.lastIntensityEvaluatedAt = eventAt;
    relieveLongingAfterRealInteraction(state, now, reasons);
  }

  keepLongingPresent(state, now, reasons);
  // Never apply quiet time preceding an event to activation created by that
  // event on the next wakeup (including another call at the same timestamp).
  if (desireFields.some((field) => field !== "longing" && state[field] !== settledValues[field])) {
    state.lastSettledAt = eventAt;
  }
  return { state, interactionSource, eventAt, reasons };
}

/** Backwards-compatible state-only scoring API for existing callers and tests. */
export function applyEncounter(
  previous: DesireState,
  kind: EncounterKind,
  now = new Date(),
  context: EncounterContext = {},
): DesireState {
  return scoreEncounter(previous, kind, now, context).state;
}

export async function saveEncounter(
  env: DesireEnv,
  userId: string,
  previous: DesireState,
  score: EncounterScore,
  kind: EncounterKind,
  surface: Surface,
  note: string | undefined,
  now = new Date(),
  recordId = crypto.randomUUID(),
): Promise<EncounterRecord> {
  const before = valuesOf(previous);
  const after = valuesOf(score.state);
  const delta = Object.fromEntries(desireFields.flatMap((field) => before[field] === after[field] ? [] : [[field, after[field] - before[field]]])) as Partial<DesireValues>;
  const record: EncounterRecord = {
    id: recordId, kind, surface, note: note ?? "",
    createdAt: now.toISOString(), eventAt: score.eventAt, interactionSource: score.interactionSource,
    before, after, delta, reasons: score.reasons,
  };
  await env.DESIRE_DB.batch([
    env.DESIRE_DB.prepare(`INSERT INTO encounter_history
      (id, user_id, kind, surface, note, created_at, event_at, interaction_source, before_state, after_state, delta, change_reasons)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        record.id, userId, kind, surface, record.note, record.createdAt,
        record.eventAt, record.interactionSource, JSON.stringify(before), JSON.stringify(after),
        JSON.stringify(delta), JSON.stringify(record.reasons),
      ),
    // Insert first: a duplicate event ID fails before any state write. D1 batch
    // rolls back the whole transaction, including concurrent retries.
    stateStatement(env.DESIRE_DB, userId, score.state, record.createdAt),
  ]);
  return record;
}

export async function saveState(env: DesireEnv, userId: string, state: DesireState, now = new Date()) {
  await stateStatement(env.DESIRE_DB, userId, state, now.toISOString()).run();
}

const encodeCursor = (record: Pick<EncounterRecord, "createdAt" | "id">) => btoa(`${record.createdAt}|${record.id}`).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

function historyRecord(row: HistoryRow): EncounterRecord {
  return {
    id: row.id, kind: row.kind, surface: row.surface, note: row.note, createdAt: row.created_at,
    eventAt: row.event_at ?? row.created_at,
    interactionSource: row.interaction_source ?? "automation",
    before: JSON.parse(row.before_state), after: JSON.parse(row.after_state),
    delta: JSON.parse(row.delta), reasons: parseReasons(row.change_reasons),
  };
}

export async function findEncounter(env: Pick<DesireEnv, "DESIRE_DB">, userId: string, id: string) {
  const row = await env.DESIRE_DB.prepare("SELECT * FROM encounter_history WHERE user_id = ? AND id = ?")
    .bind(userId, id).first<HistoryRow>();
  return row ? historyRecord(row) : null;
}

function parseReasons(value: string | null): ChangeReasons {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      desireFields.flatMap((field) => {
        const reasons = (parsed as Record<string, unknown>)[field];
        return Array.isArray(reasons) && reasons.every((reason) => typeof reason === "string")
          ? [[field, reasons]]
          : [];
      }),
    ) as ChangeReasons;
  } catch {
    return {};
  }
}

function decodeCursor(cursor?: string): { createdAt: string; id: string } | null {
  if (!cursor || cursor.length > 256) return null;
  try {
    const normalized = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const [createdAt, id, extra] = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)).split("|");
    if (extra || !createdAt || !id || !Number.isFinite(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch { return null; }
}

export async function readHistory(env: Pick<DesireEnv, "DESIRE_DB">, userId: string, requestedLimit = 20, cursor?: string) {
  const limit = Math.max(1, Math.min(50, Math.round(requestedLimit)));
  const decoded = decodeCursor(cursor);
  const query = decoded
    ? env.DESIRE_DB.prepare(`SELECT * FROM encounter_history WHERE user_id = ? AND
        (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(userId, decoded.createdAt, decoded.createdAt, decoded.id, limit + 1)
    : env.DESIRE_DB.prepare("SELECT * FROM encounter_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
      .bind(userId, limit + 1);
  const rows = (await query.all<HistoryRow>()).results;
  const hasMore = rows.length > limit;
  const records = rows.slice(0, limit).map(historyRecord);
  return { records, nextCursor: hasMore && records.length ? encodeCursor(records[records.length - 1]) : null };
}
