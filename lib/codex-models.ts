// Protocol checked against VPS codex-cli 0.149.0 generated bindings:
// v2/Model, ModelListResponse, ThreadResumeResponse and TurnStartParams.
// Model names and effort values are discovered, never a hard-coded allowlist.
export type CodexModel = {
  model: string;
  displayName: string;
  description: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
};
export type CodexModelSelection = { model: string; effort: string | null };
type Rpc = (method: string, params: Record<string, unknown>) => Promise<{ result?: Record<string, unknown> }>;

export async function listCodexModels(rpc: Rpc): Promise<CodexModel[]> {
  const models = new Map<string, CodexModel>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const { result } = await rpc("model/list", { limit: 50, includeHidden: false, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(result?.data)) throw new Error("模型列表返回格式不正确");
    for (const raw of result.data) {
      if (!raw || typeof raw.model !== "string" || raw.hidden === true) continue;
      const efforts = Array.isArray(raw.supportedReasoningEfforts)
        ? raw.supportedReasoningEfforts.filter((option: { reasoningEffort?: unknown }) => typeof option?.reasoningEffort === "string") : [];
      models.set(raw.model, {
        model: raw.model, displayName: raw.displayName || raw.model,
        description: raw.description || "", defaultReasoningEffort: raw.defaultReasoningEffort || "",
        supportedReasoningEfforts: efforts,
      });
    }
    cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
    if (cursor && cursors.has(cursor)) throw new Error("模型列表分页异常，请重试");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...models.values()];
}

export function selectionFromThread(result?: Record<string, unknown>): CodexModelSelection | null {
  if (typeof result?.model !== "string" || !result.model) return null;
  return { model: result.model, effort: typeof result.reasoningEffort === "string" ? result.reasoningEffort : null };
}

export function chooseCodexModel(model: CodexModel, effort?: string | null): CodexModelSelection {
  const supported = model.supportedReasoningEfforts.map((option) => option.reasoningEffort);
  return { model: model.model, effort: effort && supported.includes(effort) ? effort
    : supported.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : supported[0] ?? null };
}

export function codexTurnModelParams(selection: CodexModelSelection | null, catalog: CodexModel[]) {
  if (!selection) return {};
  const model = catalog.find((item) => item.model === selection.model);
  if (!model || (selection.effort !== null && !model.supportedReasoningEfforts.some((option) => option.reasoningEffort === selection.effort))) {
    throw new Error("所选模型或强度已不可用，请重新选择");
  }
  // turn/start calls this field `effort`, NOT `reasoningEffort`.
  return { model: selection.model, effort: selection.effort };
}

export async function startCodexTurnWithModel(rpc: Rpc, params: Record<string, unknown>, selection: CodexModelSelection | null, catalog: CodexModel[]) {
  const result = await rpc("turn/start", { ...params, ...codexTurnModelParams(selection, catalog) });
  // The caller commits its pending choice only after the original RPC succeeds.
  return { ...result, appliedSelection: selection };
}

export function effortLabel(effort: string | null) {
  return effort === null ? "Default" : ({ none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum", ultra: "Ultra" } as Record<string, string>)[effort] || effort;
}
