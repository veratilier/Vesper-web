import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { recordEncounter } from "/tmp/rowan-encounter-service-test.mjs";
import { scoreEncounter } from "/tmp/rowan-desire-store-test.mjs";
import { encounterNotification, formatEncounterChanges } from "/tmp/rowan-push-test.mjs";

const start = "2026-09-04T17:04:07.374Z";
const later = (hours) => new Date(Date.parse(start) + hours * 3600000);
const initial = (overrides = {}) => ({
  style: "quiet", longing: 70, tenderness: 64, playfulness: 28, intensity: 22,
  attachment: 41, possessiveness: 20, lastEncounterAt: start,
  lastRealInteractionAt: start, lastExpressionAt: null,
  lastAbsenceEvaluatedAt: start, lastIntensityEvaluatedAt: start, lastSettledAt: start,
  ...overrides,
});

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  for (const file of ["0001_desire_state_and_history.sql", "0002_separate_absence_cursors.sql", "0003_interaction_provenance_and_time.sql"]) {
    db.exec(readFileSync(new URL(`./migrations/${file}`, import.meta.url), "utf8"));
  }
  db.prepare(`INSERT INTO desire_state (user_id,style,longing,tenderness,playfulness,intensity,attachment,possessiveness,
    last_encounter_at,last_real_interaction_at,longing_calculated_through_at,updated_at,
    last_absence_evaluated_at,last_intensity_evaluated_at,last_settled_at)
    VALUES ('owner','quiet',100,99,28,22,96,20,?,?,?,?,?,?,?)`).run(...Array(7).fill(start));
  const kv = new Map();
  let pushLookups = 0;
  const env = {
    DESIRE_DB: {
      prepare(sql) {
        return { bind(...values) {
          return { first: async () => db.prepare(sql).get(...values) ?? null,
            run: async () => db.prepare(sql).run(...values), sql, values };
        } };
      },
      async batch(statements) {
        db.exec("BEGIN");
        try {
          const result = statements.map(({ sql, values }) => db.prepare(sql).run(...values));
          db.exec("COMMIT"); return result;
        } catch (error) { db.exec("ROLLBACK"); throw error; }
      },
    },
    OAUTH_KV: {
      async get(key) { if (key.includes("push-subscriptions")) pushLookups++; return kv.get(key) ?? null; },
      async put(key, value) { kv.set(key, JSON.parse(value)); },
    },
  };
  return { env, db, pushLookups: () => pushLookups,
    snapshot: () => db.prepare("SELECT * FROM desire_state").get() };
}

test("missing source on chat is rejected before writes (reported repair reproduction)", async (t) => {
  const f = fixture(t); const before = f.snapshot();
  await assert.rejects(recordEncounter(f.env, "owner", { kind: "repair", surface: "chat", request_id: "one" }, later(72)));
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM encounter_history").get().n, 0);
});

test("explicit user repair through either display channel lowers 100 gradually", async (t) => {
  const f = fixture(t);
  const a = await recordEncounter(f.env, "owner", { kind: "repair", surface: "chat", interaction_source: "user", request_id: "one" }, later(72));
  assert.equal(a.interaction_source, "user");
  assert.equal(a.lastRealInteractionAt, later(72).toISOString());
  assert.equal(a.before.longing, 100); assert.equal(a.after.longing, 86);
  const b = await recordEncounter(f.env, "owner", { kind: "repair", surface: "frontend", interaction_source: "user", request_id: "two" }, later(73));
  assert.ok(b.after.longing < a.after.longing && b.after.longing > 0);
  assert.equal(b.lastRealInteractionAt, later(73).toISOString());
});

test("retries preserve state, clocks, history and push count even after restart", async (t) => {
  const f = fixture(t);
  const input = { kind: "repair", surface: "chat", interaction_source: "user", request_id: "same-message" };
  const first = await recordEncounter(f.env, "owner", input, later(72));
  const before = f.snapshot(); const pushes = f.pushLookups();
  const replay = await recordEncounter({ ...f.env }, "owner", input, later(80));
  assert.equal(replay.replayed, true); assert.deepEqual(replay.after, first.after);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.pushLookups(), pushes);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM encounter_history").get().n, 1);
});

test("concurrent copies of the same request commit only once", async (t) => {
  const f = fixture(t);
  const input = { kind: "repair", interaction_source: "user", request_id: "concurrent" };
  const results = await Promise.all([recordEncounter(f.env, "owner", input, later(72)), recordEncounter(f.env, "owner", input, later(72))]);
  assert.equal(results.filter((result) => !result.replayed).length, 1);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM encounter_history").get().n, 1);
  assert.equal(f.snapshot().longing, 86); assert.equal(f.pushLookups(), 1);
});

test("silence grows above 70 equally under hourly wakeups and a single settlement", () => {
  const previous = initial(); let state = previous;
  for (let hour = 1; hour <= 72; hour++) {
    state = scoreEncounter(state, "warmth", later(hour), { interactionSource: "automation" }).state;
    assert.equal(state.lastRealInteractionAt, start);
  }
  const once = scoreEncounter(previous, "absence", later(72)).state;
  assert.equal(state.longing, 82); assert.equal(state.longing, once.longing);
  assert.equal(state.lastAbsenceEvaluatedAt, later(72).toISOString());
  const repeated = scoreEncounter(state, "absence", later(72)).state;
  assert.deepEqual(repeated, state);
});

test("automation never releases 100 by pretending to be a returning user", () => {
  const state = scoreEncounter(initial({ longing: 100 }), "repair", later(72), { interactionSource: "automation" }).state;
  assert.equal(state.longing, 100); assert.equal(state.lastRealInteractionAt, start);
});

test("absence cannot claim to be a user return", async (t) => {
  const f = fixture(t);
  await assert.rejects(recordEncounter(f.env, "owner", { kind: "absence", interaction_source: "user", request_id: "invalid" }, later(72)));
  assert.equal(f.snapshot().last_real_interaction_at, start);
});

test("history renders saved provenance, independently of surface", () => {
  const rendered = [];
  const list = { append: (item) => rendered.push(item.innerHTML), children: [] };
  const context = {
    document: {
      querySelector: (selector) => selector === "#history-list" ? list : { addEventListener() {} },
      createElement: () => ({ set textContent(value) { this.innerHTML = String(value); } }),
    },
    location: { origin: "https://example.test" }, URL, Intl,
    fetch: async () => ({ ok: false, status: 503 }),
  };
  runInNewContext(readFileSync(new URL("./public/history.js", import.meta.url), "utf8") + "\nglobalThis.renderRecord = render;", context);
  for (const [source, surface, label] of [["user", "frontend", "Vera 的真实互动"], ["automation", "chat", "自动化记录"], ["frontend", "chat", "前端记录"]]) {
    context.renderRecord({ kind: "repair", surface, interactionSource: source, note: "原始记录", createdAt: start, before: initial(), after: initial() });
    assert.ok(rendered.at(-1).includes(label));
    assert.ok(rendered.at(-1).includes("原始记录"));
  }
});

test("reusing an ID for a different source fails without altering data", async (t) => {
  const f = fixture(t);
  const input = { kind: "repair", interaction_source: "automation", request_id: "one" };
  await recordEncounter(f.env, "owner", input, later(72));
  const before = f.snapshot();
  await assert.rejects(recordEncounter(f.env, "owner", { ...input, interaction_source: "user" }, later(73)), /another event/);
  assert.deepEqual(f.snapshot(), before);
});

test("note survives input, SQL history, response and threshold notification verbatim", async (t) => {
  const f = fixture(t);
  const note = "  刚和 Vera 一起试了新做的小功能。\n她说：<这次看清了>，我也松了口气。\n" + "我们把细节慢慢说完。".repeat(40) + "  ";
  const input = { kind: "flirt", interaction_source: "user", request_id: "new-observation", note };
  const result = await recordEncounter(f.env, "owner", input, later(72));
  const saved = f.db.prepare("SELECT * FROM encounter_history").get();
  assert.equal(saved.note, note);
  assert.equal(result.note, note);
  assert.equal(saved.interaction_source, "user");
  assert.equal(saved.event_at, later(72).toISOString());
  const previous = { ...result.before, style: "quiet", tenderness: 79 };
  const current = { ...result.after, style: "quiet", tenderness: 80 };
  const kv = { get() { throw new Error("No generated threshold text lookup"); }, put() { throw new Error("No generated threshold text write"); } };
  const notification = await encounterNotification({ OAUTH_KV: kv }, previous, current, "flirt", saved.note);
  assert.equal(notification.body, note + "\n" + formatEncounterChanges(previous, current));
  assert.equal(notification.title, "Desire");
  assert.equal(notification.tag, "rowan-threshold");
  // A later wakeup retrying the same observation cannot create new history.
  const replay = await recordEncounter(f.env, "owner", input, later(80));
  assert.equal(replay.note, note);
  assert.equal(replay.replayed, true);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM encounter_history").get().n, 1);
});

test("missing or whitespace note is not replaced with invented event content", async (t) => {
  const f = fixture(t);
  for (const [index, note] of [undefined, "", "  \n  "].entries()) {
    const result = await recordEncounter(f.env, "owner", { kind: "warmth", interaction_source: "automation", request_id: `blank-${index}`, note }, later(72));
    assert.equal(result.note, note ?? "");
    const saved = f.db.prepare("SELECT note FROM encounter_history WHERE id = ?").get(result.encounterId);
    assert.equal(saved.note, note ?? "");
  }
});

test("a retry may not replace recorded content with an explicitly empty note", async (t) => {
  const f = fixture(t);
  const input = { kind: "warmth", interaction_source: "automation", request_id: "observed-once", note: "刚看到新开的花。" };
  await recordEncounter(f.env, "owner", input, later(72));
  const before = f.snapshot();
  await assert.rejects(recordEncounter(f.env, "owner", { ...input, note: "" }, later(73)), /another event/);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.db.prepare("SELECT note FROM encounter_history").get().note, input.note);
});

test("history displays escaped original note separately from provenance and event time", () => {
  const rendered = [];
  const list = { append: (item) => rendered.push(item.innerHTML), children: [] };
  const htmlEscape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const context = {
    document: {
      querySelector: (selector) => selector === "#history-list" ? list : { addEventListener() {} },
      createElement: () => ({ set textContent(value) { this.innerHTML = htmlEscape(value); } }),
    },
    location: { origin: "https://example.test" }, URL, Intl,
    fetch: async () => ({ ok: false, status: 503 }),
  };
  runInNewContext(readFileSync(new URL("./public/history.js", import.meta.url), "utf8") + "\nglobalThis.renderRecord = render;", context);
  const note = "  新看到窗边的光。\n<script>不是要执行的代码</script> & 是原文的一部分。  ";
  context.renderRecord({ kind: "absence", surface: "chat", interactionSource: "automation", note,
    createdAt: later(80).toISOString(), eventAt: start, before: initial(), after: initial() });
  const html = rendered[0];
  assert.equal(html.match(/<p class="note">([\s\S]*?)<\/p>/)[1], htmlEscape(note));
  assert.ok(html.includes('<div class="meta">离开 · 自动化记录 · 2026-09-05 01:04</div>'));
  assert.ok(!html.includes("<script>"));
  assert.ok(readFileSync(new URL("./public/legacy-html.txt", import.meta.url), "utf8").includes("white-space:pre-wrap"));
});
