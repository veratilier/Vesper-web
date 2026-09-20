import assert from "node:assert/strict";
import test from "node:test";
import { formatEncounterChanges, encounterNotification } from "/tmp/rowan-push-test.mjs";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const state = (overrides = {}) => ({
  style: "quiet",
  longing: 30,
  tenderness: 60,
  playfulness: 30,
  intensity: 50,
  attachment: 60,
  possessiveness: 30,
  ...overrides,
});

test("ordinary notification and Service Worker display exactly the original note and delta", async () => {
  const note = "  刚看见窗外落下了雨。\n这一刻想和你一起听。  ";
  const notification = await encounterNotification({ OAUTH_KV: {} }, state(), state({ longing: 31 }), "absence", note);
  assert.equal(notification.body, note + "\n思念 30→31");
  const handlers = {};
  let shown;
  const self = { addEventListener(name, callback) { handlers[name] = callback; }, registration: {
    async showNotification(title, options) { shown = { title, body: options.body }; },
  } };
  runInNewContext(readFileSync(new URL("./public/sw.js", import.meta.url), "utf8"), { self });
  let pending;
  handlers.push({ data: { json: () => notification }, waitUntil(promise) { pending = promise; } });
  await pending;
  assert.equal(shown.title, "Desire");
  assert.equal(shown.body, notification.body);
});

test("missing note never generates a narrative, including threshold crossings", async () => {
  for (const longing of [31, 40]) {
    const notification = await encounterNotification({ OAUTH_KV: {} }, state(), state({ longing }), "absence");
    assert.equal(notification.body, `思念 30→${longing}`);
  }
});

test("encounter notifications list only dimensions that actually changed", () => {
  const changes = formatEncounterChanges(
    state(),
    state({ longing: 38, tenderness: 61, possessiveness: 30 }),
  );
  assert.equal(changes, "思念 30→38 · 温柔 60→61");
  assert.ok(!changes.includes("玩心"));
  assert.ok(!changes.includes("占有欲"));
});
