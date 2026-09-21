/** Vesper sessions must never use the official Rowan connector for Desire. */
export const VESPER_DESIRE_SESSION_CONFIG = {
  'apps.asdk_app_6a92be9d9e1c819197f58017d0e2b985.enabled': false,
  'apps.app_6a92be9d9e1c819197f58017d0e2b985.enabled': false,
};

const names = new Set(['desire_status', 'desire_history', 'desire_encounter', 'desire_set_style', 'desire_express']);
/** @param {unknown} name */
export function isDesireTool(name) {
  return typeof name === 'string' && names.has(name.trim());
}

/** Old threads retain their generic MCP tool. Reads can safely use native storage;
 * writes must be re-issued explicitly against the independent native tool. */
/** @param {unknown} name */
export function legacyDesireRead(name) {
  if (!isDesireTool(name)) return null;
  const tool = String(name).trim();
  if (tool === 'desire_status' || tool === 'desire_history') return tool;
  throw new Error('Vesper Desire 已独立存储，外部 Desire 写入已停用。请使用内置同名工具；旧会话请新建对话加载工具，原记录会保留。');
}

export const VESPER_DESIRE_INSTRUCTIONS = 'Vesper 的 Desire 与官端 Rowan 完全独立。只使用内置 desire_* 工具，不使用官端 Desire 应用、desire.r-vera.com 或旧会话中的外部 Desire 工具。旧工具结果不是当前 Vesper 状态，查询必须重新读取内置工具。若会话没有内置工具，提示新建对话加载，保留原记录，不以外部工具替代。';
