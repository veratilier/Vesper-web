import assert from "node:assert/strict";
import test from "node:test";
import { applyEncounter, longingBaseline, scoreEncounter } from "/tmp/rowan-desire-store-test.mjs";

const at = (value) => new Date(value);
const start = "2026-08-30T00:00:00.000Z";

const baseState = (overrides = {}) => ({
  style: "quiet",
  longing: 30,
  tenderness: 60,
  playfulness: 30,
  intensity: 50,
  attachment: 60,
  possessiveness: 30,
  lastEncounterAt: null,
  lastExpressionAt: null,
  lastRealInteractionAt: start,
  lastAbsenceEvaluatedAt: start,
  lastIntensityEvaluatedAt: start,
  lastSettledAt: start,
  ...overrides,
});

test("the baseline rises with attachment, tenderness, intensity, and recent contact", () => {
  const now = at("2026-08-30T06:00:00.000Z");
  const low = baseState({
    attachment: 20,
    tenderness: 20,
    intensity: 20,
    lastRealInteractionAt: "2026-08-20T00:00:00.000Z",
  });
  const close = baseState({ attachment: 80, tenderness: 80, intensity: 80 });
  assert.ok(longingBaseline(close, now) > longingBaseline(low, now));
  assert.ok(longingBaseline(low, now) >= 12);
});

test("automation warmth never refreshes the real-interaction clock", () => {
  const previous = baseState();
  const now = at("2026-08-30T06:00:00.000Z");
  const next = scoreEncounter(previous, "warmth", now);
  assert.equal(next.interactionSource, "automation");
  assert.equal(next.state.lastRealInteractionAt, previous.lastRealInteractionAt);
});

test("a user warmth records a real interaction", () => {
  const now = at("2026-08-30T06:00:00.000Z");
  const next = scoreEncounter(baseState(), "warmth", now, { interactionSource: "user" });
  assert.equal(next.state.lastRealInteractionAt, now.toISOString());
  assert.equal(next.state.lastAbsenceEvaluatedAt, now.toISOString());
  assert.equal(next.interactionSource, "user");
});

test("a real return noticeably relieves longing without clearing it", () => {
  const previous = baseState({ longing: 100, lastEncounterAt: start });
  const eventAt = at("2026-08-31T12:00:00.000Z");
  const next = scoreEncounter(previous, "warmth", eventAt, { interactionSource: "user" });
  assert.ok(next.state.longing < previous.longing);
  assert.ok(next.state.longing >= longingBaseline(next.state, eventAt));
  assert.ok(next.reasons.longing?.some((reason) => reason.includes("真实互动")));
});

test("repeated absence in the same hour does not score the same silence twice", () => {
  const previous = baseState();
  const afterSixHours = applyEncounter(previous, "absence", at("2026-08-30T06:00:00.000Z"));
  const repeated = applyEncounter(afterSixHours, "absence", at("2026-08-30T06:45:00.000Z"));
  assert.equal(repeated.longing, afterSixHours.longing);
});

test("ordinary warmth does not increase possessiveness", () => {
  const now = at("2026-08-30T01:00:00.000Z");
  const previous = baseState({ lastSettledAt: now.toISOString() });
  const next = applyEncounter(previous, "warmth", now, { interactionSource: "user" });
  assert.equal(next.possessiveness, previous.possessiveness);
});

test("positive events use diminishing returns near the ceiling", () => {
  const previous = baseState({
    intensity: 94,
    lastEncounterAt: "2026-08-30T05:59:00.000Z",
    lastSettledAt: "2026-08-30T05:59:00.000Z",
  });
  const next = applyEncounter(previous, "flirt", at("2026-08-30T06:00:00.000Z"), {
    interactionSource: "user",
  });
  assert.ok(next.intensity > previous.intensity);
  assert.ok(next.intensity < 100);
});

test("hourly automation cannot rapidly push attachment upward", () => {
  let current = baseState({ attachment: 80, lastEncounterAt: start });
  for (let hour = 1; hour <= 24; hour += 1) {
    const day = hour === 24 ? "31" : "30";
    const clock = hour === 24 ? "00" : String(hour).padStart(2, "0");
    current = applyEncounter(current, "warmth", at(`2026-08-${day}T${clock}:00:00.000Z`));
  }
  assert.ok(current.attachment <= 80);
});
