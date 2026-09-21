export type ExecutionFile = { path: string; kind: string; diff: string; truncated?: boolean };
export type Execution = {
  id: string; type: string; title: string; status: string; command?: string;
  cwd?: string; output: string; exitCode?: number; durationMs?: number;
  updatedAt: string; truncated?: boolean; files?: ExecutionFile[]; filesTruncated?: boolean;
};
const types = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'toolCall', 'functionCall', 'mcpCall', 'shellCall', 'computerCall', 'webSearchCall', 'webSearch']);
const limit = 24000;
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
function display(v: unknown): string { if (v == null) return ''; return typeof v === 'string' ? v : JSON.stringify(v); }
/** Format only recognized text envelopes; React renders the result as plain text. */
export function formatExecutionOutput(value: unknown, depth = 0): string {
  if (depth > 5) return display(value);
  if (typeof value === 'string') {
    try { return formatExecutionOutput(JSON.parse(value), depth + 1); } catch { return value; }
  }
  if (Array.isArray(value) && value.length && value.every(v => {
    const block = record(v);
    return ['text', 'inputText', 'outputText'].includes(String(block.type)) && typeof block.text === 'string';
  })) return value.map(v => formatExecutionOutput(record(v).text, depth + 1)).join('\n\n');
  const envelope = record(value);
  if (Array.isArray(envelope.content) && Object.keys(envelope).every(key => ['content', 'isError'].includes(key))) {
    return formatExecutionOutput(envelope.content, depth + 1);
  }
  return value == null ? '' : JSON.stringify(value, null, 2);
}

/** Bound serialized storage, while retaining complete ordinary patches separately from log tails. */
export function executionFiles(value: unknown): { files: ExecutionFile[]; filesTruncated: boolean } {
  if (!Array.isArray(value)) return { files: [], filesTruncated: false };
  const files: ExecutionFile[] = [];
  let budget = 60000;
  let filesTruncated = false;
  for (const raw of value) {
    const change = record(raw);
    if (typeof change.path !== 'string') continue;
    if (files.length >= 50 || budget < 200) { filesTruncated = true; break; }
    const file: ExecutionFile = { path: change.path.slice(0, 1000), kind: (typeof change.kind === 'string' ? change.kind : String(record(change.kind).type || 'update')).slice(0, 200), diff: typeof change.diff === 'string' ? change.diff : '' };
    if (JSON.stringify(file).length > budget) {
      let low = 0, high = file.diff.length;
      const full = file.diff;
      file.truncated = true;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (JSON.stringify({ ...file, diff: full.slice(0, mid) }).length <= budget) low = mid;
        else high = mid - 1;
      }
      file.diff = full.slice(0, low);
      filesTruncated = true;
    }
    budget -= JSON.stringify(file).length;
    files.push(file);
  }
  return { files, filesTruncated };
}
export function executionEvent(method: string, params: Record<string, unknown>, previous?: Execution): Execution | null {
  const item = record(params.item);
  const id = String(item.id || params.itemId || '');
  const delta = method === 'item/commandExecution/outputDelta' || method === 'item/fileChange/outputDelta';
  if (!id || (!delta && !(['item/started', 'item/completed'].includes(method) && types.has(String(item.type))))) return null;
  if (delta && previous && !['inProgress', 'running', 'unknown'].includes(previous.status)) return previous;
  const type = String(item.type || previous?.type || 'commandExecution');
  const command = (display(item.command) || previous?.command || '').slice(0, 3000) || undefined;
  let output = previous?.output || '';
  if (delta) output += display(params.delta);
  else if (item.aggregatedOutput != null) output = display(item.aggregatedOutput);
  else if (item.error != null) output = display(item.error);
  else if (item.result != null) output = display(item.result);
  else if (item.changes != null) output = ''; // Structured patches are retained below.
  else if (item.contentItems != null) output = display(item.contentItems);
  const changes = item.changes != null ? executionFiles(item.changes) : { files: previous?.files, filesTruncated: previous?.filesTruncated };
  let boundedOutput = output.slice(-limit);
  while (JSON.stringify(boundedOutput).length > 50000) boundedOutput = boundedOutput.slice(Math.ceil(boundedOutput.length / 10));
  const exitCode = typeof item.exitCode === 'number' ? item.exitCode : previous?.exitCode;
  // A late start/delta must not turn a completed item back into a running one.
  const terminal = previous && !['inProgress', 'running', 'unknown'].includes(previous.status);
  const status = terminal && method !== 'item/completed' ? previous.status : String(item.status || (method === 'item/completed' ? 'completed' : previous?.status || 'inProgress'));
  const result: Execution = { id, type, command, title: command || display(item.tool || item.name).slice(0, 500) || (type === 'fileChange' ? "File changes" : type === 'commandExecution' ? "Terminal" : type), cwd: display(item.cwd).slice(0, 1000) || previous?.cwd,
    status: item.success === false || (exitCode != null && exitCode !== 0 && status === 'completed') ? 'failed' : status,
    ...changes, output: boundedOutput, truncated: boundedOutput.length < output.length || previous?.truncated,
    exitCode, durationMs: typeof item.durationMs === 'number' ? item.durationMs : previous?.durationMs, updatedAt: new Date().toISOString() };
  // Include escaped command/title/path metadata in the persistence budget too.
  while (result.output && JSON.stringify(result).length > 120000) {
    result.output = result.output.slice(Math.max(1, Math.ceil(result.output.length / 10)));
    result.truncated = true;
  }
  return result;
}
export function workspaceOptions(value: unknown) {
  const cwd = typeof value === 'string' ? value.trim() : '';
  if (!cwd) return {};
  if (!cwd.startsWith('/') || /[\r\n\0]/.test(cwd)) throw new Error("The workspace must be an absolute path on the app-server machine.");
  return { cwd };
}
