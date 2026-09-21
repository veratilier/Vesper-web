import assert from "node:assert/strict";
// Node strip-types tests import the TypeScript source directly.
import { chooseCodexModel, codexTurnModelParams, listCodexModels, selectionFromThread, startCodexTurnWithModel, type CodexModel } from "../lib/codex-models.ts";

// Synthetic fixtures intentionally do not define the production model catalog.
const first: CodexModel = { model: "model-a", displayName: "Model A", description: "", defaultReasoningEffort: "medium", supportedReasoningEfforts: ["low", "medium", "high"].map((reasoningEffort) => ({ reasoningEffort, description: "" })) };
const second: CodexModel = { ...first, model: "model-b", defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }] };
const requests: Record<string, unknown>[] = [];
const catalog = await listCodexModels(async (method, params) => {
  assert.equal(method, "model/list"); requests.push(params);
  return { result: params.cursor ? { data: [first, second], nextCursor: null } : { data: [first, { ...second, model: "hidden", hidden: true }], nextCursor: "page-2" } };
});
assert.deepEqual(catalog.map((item) => item.model), ["model-a", "model-b"]);
assert.equal(requests[0].includeHidden, false);
assert.equal(requests[1].cursor, "page-2");
assert.deepEqual(chooseCodexModel(first, "high"), { model: "model-a", effort: "high" });
assert.deepEqual(chooseCodexModel(second, "high"), { model: "model-b", effort: "low" }, "switching must discard unsupported effort");
assert.deepEqual(chooseCodexModel({ ...first, supportedReasoningEfforts: [] }), { model: "model-a", effort: null });
assert.deepEqual(selectionFromThread({ model: "model-b", reasoningEffort: "low" }), { model: "model-b", effort: "low" }, "resume must reflect the server, including another device's changes");
assert.equal(selectionFromThread({ thread: { id: "thread" } }), null, "no guessed default");
assert.deepEqual(codexTurnModelParams(null, []), {}, "ordinary turns retain existing app-server defaults");
assert.throws(() => codexTurnModelParams({ model: "gone", effort: "low" }, catalog), /不可用/);
assert.throws(() => codexTurnModelParams({ model: "model-b", effort: "high" }, catalog), /不可用/);
const selection = chooseCodexModel(first, "high");
const turnParams = { threadId: "existing-thread", input: [{ type: "text", text: "hello" }], clientUserMessageId: "original-user-id" };
const result = await startCodexTurnWithModel(async (method, params) => {
  assert.equal(method, "turn/start");
  assert.deepEqual(params, { ...turnParams, model: "model-a", effort: "high" });
  assert.equal("reasoningEffort" in params, false);
  return { result: { turn: { id: "turn" } } };
}, turnParams, selection, catalog);
assert.deepEqual(result.appliedSelection, selection);
for (const error of ["unsupported model", "disconnected"]) {
  await assert.rejects(startCodexTurnWithModel(async () => { throw new Error(error); }, turnParams, selection, catalog), new RegExp(error));
  assert.equal(selection.effort, "high", "failed request must not mutate pending selection");
}
await assert.rejects(listCodexModels(async () => ({ result: {} })), /格式/);
await assert.rejects(listCodexModels(async () => { throw new Error("disconnected"); }), /disconnected/);
await assert.rejects(listCodexModels(async () => ({ result: { data: [], nextCursor: "repeat" } })), /分页/);
assert.deepEqual(await listCodexModels(async () => ({ result: { data: [], nextCursor: null } })), []);
console.log("codex models: catalog pagination, defaults, switching, protocol, resume, rejected request and disconnect: ok");
