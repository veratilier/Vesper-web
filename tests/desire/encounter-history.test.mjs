import assert from "node:assert/strict";
import test from "node:test";
import { saveEncounter, scoreEncounter } from "/tmp/rowan-desire-store-test.mjs";

const start = "2026-08-30T00:00:00.000Z";
const state = {
  style: "quiet",
  longing: 80,
  tenderness: 60,
  playfulness: 30,
  intensity: 50,
  attachment: 60,
  possessiveness: 30,
  lastEncounterAt: start,
  lastExpressionAt: null,
  lastRealInteractionAt: start,
  lastAbsenceEvaluatedAt: start,
  lastIntensityEvaluatedAt: start,
  lastSettledAt: start,
};

test("encounter history persists source, event time, deltas, and reasons with the state", async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = { sql, values, run: async () => ({ success: true }) };
          statements.push(statement);
          return statement;
        },
      };
    },
    batch: async (batch) => {
      assert.equal(batch.length, 2);
      return batch;
    },
  };
  const eventAt = new Date("2026-08-30T06:00:00.000Z");
  const score = scoreEncounter(state, "warmth", eventAt, { interactionSource: "user" });
  const record = await saveEncounter(
    { DESIRE_DB: db, OAUTH_KV: {} },
    "owner",
    state,
    score,
    "warmth",
    "chat",
    "Vera 回来了。",
    eventAt,
  );

  assert.equal(record.interactionSource, "user");
  assert.equal(record.eventAt, eventAt.toISOString());
  assert.ok(record.delta.longing < 0);
  assert.ok(record.reasons.longing?.length);
  const historyInsert = statements.find((statement) => statement.sql.includes("INSERT INTO encounter_history"));
  assert.ok(historyInsert);
  assert.equal(historyInsert.values[6], eventAt.toISOString());
  assert.equal(historyInsert.values[7], "user");
  assert.ok(JSON.parse(historyInsert.values[11]).longing.length);
});
