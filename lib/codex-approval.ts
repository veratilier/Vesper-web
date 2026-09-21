export const CODEX_APPROVAL_METHODS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
] as const;

export type CodexApprovalMethod = (typeof CODEX_APPROVAL_METHODS)[number];
export type CodexApprovalKind = "command" | "file" | "permissions";
export type RpcId = number | string;

export type PendingCodexApproval = {
  requestKey: string;
  rpcIds: RpcId[];
  method: CodexApprovalMethod;
  kind: CodexApprovalKind;
  threadId: string;
  turnId: string;
  itemId: string;
  title: string;
  summary: string;
  targetLabel: string;
  target: string;
  detailLabel: string;
  detail: string;
  permissions?: Record<string, unknown>;
};

export type CodexApprovalRequest = {
  id?: RpcId;
  method?: string;
  params?: Record<string, unknown>;
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

function describePermissions(permissions: Record<string, unknown>) {
  const lines: string[] = [];
  const fileSystem = record(permissions.fileSystem);
  const network = record(permissions.network);
  const read = Array.isArray(fileSystem.read) ? fileSystem.read.filter((item): item is string => typeof item === "string") : [];
  const write = Array.isArray(fileSystem.write) ? fileSystem.write.filter((item): item is string => typeof item === "string") : [];
  const entries = Array.isArray(fileSystem.entries) ? fileSystem.entries : [];
  if (read.length) lines.push(`Read files: ${read.join("、")}`);
  if (write.length) lines.push(`Write files: ${write.join("、")}`);
  for (const entry of entries) {
    const candidate = record(entry);
    const path = record(candidate.path);
    const location = text(path.path) || text(path.pattern) || text(record(path.value).path) || text(record(path.value).kind);
    if (location) lines.push(`${text(candidate.access) || "Access"}：${location}`);
  }
  if (network.enabled === true) lines.push("Network access");
  return lines.length ? lines.join("\n") : "No permission scope provided";
}

function describeCommandActions(actions: unknown) {
  if (!Array.isArray(actions)) return "";
  return actions.flatMap((entry) => {
    const action = record(entry);
    const command = text(action.command);
    const type = text(action.type);
    const path = text(action.path);
    const query = text(action.query);
    if (!command && !type) return [];
    return [`${type || "command"}${path ? ` · ${path}` : ""}${query ? ` · ${query}` : ""}${command ? `\n${command}` : ""}`];
  }).join("\n\n");
}

export function createCodexApprovalRequest(request: CodexApprovalRequest): PendingCodexApproval | null {
  if ((typeof request.id !== "number" && typeof request.id !== "string") || !CODEX_APPROVAL_METHODS.includes(request.method as CodexApprovalMethod)) return null;

  const method = request.method as CodexApprovalMethod;
  const params = request.params || {};
  const threadId = text(params.threadId);
  const turnId = text(params.turnId);
  const itemId = text(params.itemId);
  const approvalId = text(params.approvalId);
  const keyId = approvalId || itemId || String(request.id);
  const requestKey = `${method}\u0000${threadId}\u0000${turnId}\u0000${keyId}`;
  const reason = text(params.reason);

  if (method === "item/commandExecution/requestApproval") {
    const command = text(params.command);
    const actionDetail = describeCommandActions(params.commandActions);
    const network = record(params.networkApprovalContext);
    const cwd = text(params.cwd);
    const networkTarget = text(network.host) ? `${text(network.protocol) || "https"}://${text(network.host)}` : "";
    const commandKind = text(params.kind) === "writeStdin" ? "Write to an existing terminal" : "Run command";
    return {
      requestKey,
      rpcIds: [request.id],
      method,
      kind: "command",
      threadId,
      turnId,
      itemId,
      title: `Allow ${commandKind}?`,
      summary: reason || "Codex requests to run this action on your machine.",
      targetLabel: networkTarget ? "Network destination" : "Working directory",
      target: networkTarget || cwd || "Not provided",
      detailLabel: commandKind,
      detail: command || actionDetail || "No command provided",
    };
  }

  if (method === "item/fileChange/requestApproval") {
    const grantRoot = text(params.grantRoot);
    return {
      requestKey,
      rpcIds: [request.id],
      method,
      kind: "file",
      threadId,
      turnId,
      itemId,
      title: "Allow file changes?",
      summary: reason || "Codex requests to modify files on your machine.",
      targetLabel: "Writable scope",
      target: grantRoot || "Current workspace (scope not provided)",
      detailLabel: "Description",
      detail: reason || "No further file change details provided",
    };
  }

  const permissions = record(params.permissions);
  return {
    requestKey,
    rpcIds: [request.id],
    method,
    kind: "permissions",
    threadId,
    turnId,
    itemId,
    title: "Allow additional permissions?",
    summary: reason || "Codex requests temporary additional permissions for this turn.",
    targetLabel: "Working directory",
    target: text(params.cwd) || "Not provided",
    detailLabel: "Requested permissions",
    detail: describePermissions(permissions),
    permissions,
  };
}

export function queueCodexApproval(queue: PendingCodexApproval[], request: PendingCodexApproval) {
  const index = queue.findIndex((item) => item.requestKey === request.requestKey);
  if (index < 0) return [...queue, request];
  const current = queue[index];
  if (current.rpcIds.some((id) => id === request.rpcIds[0])) return queue;
  const next = [...queue];
  next[index] = { ...current, rpcIds: [...current.rpcIds, ...request.rpcIds] };
  return next;
}

export function removeCodexApproval(queue: PendingCodexApproval[], requestKey: string) {
  return queue.filter((item) => item.requestKey !== requestKey);
}

export function clearCodexApprovals(queue: PendingCodexApproval[], filter?: { threadId?: string; turnId?: string; itemId?: string }) {
  if (!filter) return [];
  return queue.filter((item) => {
    const threadMatches = !filter.threadId || item.threadId === filter.threadId;
    const turnMatches = !filter.turnId || item.turnId === filter.turnId;
    const itemMatches = !filter.itemId || item.itemId === filter.itemId;
    return !(threadMatches && turnMatches && itemMatches);
  });
}

export function approvalResultFor(request: PendingCodexApproval, action: "allow" | "deny"): Record<string, unknown> {
  if (request.kind === "permissions") {
    return {
      permissions: action === "allow" ? request.permissions || {} : {},
      // The app-server protocol calls this the `turn` scope. Vesper never asks
      // the user for a session-wide grant from this surface.
      scope: "turn",
    };
  }
  return { decision: action === "allow" ? "accept" : "decline" };
}

export function approvalWasResolved(request: PendingCodexApproval, params: Record<string, unknown>) {
  const requestId = params.requestId;
  return text(params.threadId) === request.threadId && request.rpcIds.some((id) => id === requestId);
}
