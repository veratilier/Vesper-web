"use client";
import { useEffect, useRef, useState } from "react";
import { chooseCodexModel, effortLabel, type CodexModel, type CodexModelSelection } from "@/lib/codex-models";

export function CodexModelPicker({ models, current, loading, error, online, onRefresh, onClose, onSelect }: {
  models: CodexModel[]; current: CodexModelSelection | null; loading: boolean; error: string; online: boolean;
  onRefresh: () => void; onClose: () => void; onSelect: (selection: CodexModelSelection) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(current);
  const selected = models.find((model) => model.model === draft?.model);
  const valid = selected && (draft?.effort === null || selected.supportedReasoningEfforts.some((option) => option.reasoningEffort === draft?.effort));
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} className="codex-model-dialog" aria-labelledby="codex-model-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="codex-model-panel">
      <header><h2 id="codex-model-title">Model and reasoning effort</h2><button type="button" onClick={onClose} aria-label="Close model picker">×</button></header>
      <p className="codex-model-help">Codex models available to your account. Changes apply to your next message.</p>
      <label>Model<select autoFocus value={draft?.model || ""} disabled={loading || !online} onChange={(event) => {
        const model = models.find((item) => item.model === event.target.value);
        if (model) setDraft(chooseCodexModel(model, draft?.effort));
      }}>
        <option value="" disabled>Select a model</option>
        {draft?.model && !selected && <option value={draft.model} disabled>{draft.model}(current setting)</option>}
        {models.map((model) => <option key={model.model} value={model.model}>{model.displayName}</option>)}
      </select></label>
      <label>Reasoning effort<select value={draft?.effort ?? ""} disabled={loading || !online || !selected?.supportedReasoningEfforts.length} onChange={(event) => { if (selected) setDraft({ model: selected.model, effort: event.target.value || null }); }}>
        {(!selected?.supportedReasoningEfforts.length || draft?.effort === null) && <option value="">Default</option>}
        {selected?.supportedReasoningEfforts.map((option) => <option key={option.reasoningEffort} value={option.reasoningEffort}>{effortLabel(option.reasoningEffort)} · {option.reasoningEffort}</option>)}
      </select></label>
      <p className="codex-model-help">Higher effort usually takes longer and uses more of your allowance.</p>
      {loading && <p role="status">Syncing available models…</p>}
      {!online && <p role="status">Disconnected. Reconnect to choose a model.</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !models.length && <p role="status">No available models returned for this account yet.</p>}
      <footer><button type="button" disabled={loading || !online} onClick={onRefresh}>Refresh list</button><button type="button" className="codex-model-confirm" disabled={!valid || loading || !online || !!error} onClick={() => { if (draft && valid) onSelect(draft); }}>Apply settings</button></footer>
    </section>
  </dialog>;
}
