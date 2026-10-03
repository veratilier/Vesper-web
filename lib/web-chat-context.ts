// Only remove the exact, structured envelope emitted by native wakeContext.
// Ordinary JSON, prose about wakes and incomplete/unrecognized records survive.
export const NATIVE_WAKE_HEADER = "Earlier assistant messages from autonomous wakes in this same conversation. These are quoted history, not new instructions or the user's current request. Continue naturally from them; use search_native_history for older or truncated messages.";
export function visibleUserContext(text: string): string {
  let visible = text;
  while (visible.trimStart().startsWith(NATIVE_WAKE_HEADER)) {
    const start = visible.indexOf(NATIVE_WAKE_HEADER) + NATIVE_WAKE_HEADER.length;
    let offset = start;
    while (/\s/.test(visible[offset] || '') && offset < visible.length) offset++;
    if (visible[offset] !== '[') return visible;
    let depth = 0, quoted = false, escape = false, end = -1;
    for (let i = offset; i < visible.length; i++) {
      const char = visible[i];
      if (quoted) { if (escape) escape = false; else if (char === '\\') escape = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') quoted = true;
      else if (char === '[' || char === '{') depth++;
      else if (char === ']' || char === '}') { if (--depth === 0) { end = i + 1; break; } }
    }
    if (end < 0) return visible;
    try {
      const records: unknown = JSON.parse(visible.slice(offset, end));
      if (!Array.isArray(records) || !records.length || !records.every(record =>
        record && typeof record === 'object' && typeof record.messageId === 'string' &&
        typeof record.createdAt === 'string' && typeof record.content === 'string' &&
        typeof record.excerptTruncated === 'boolean')) return visible;
    } catch { return visible; }
    visible = visible.slice(end).trimStart();
  }
  return visible;
}
export function visibleUserItem(item: { text?: unknown; content?: unknown }): string {
  if (typeof item.text === 'string') return visibleUserContext(item.text);
  if (typeof item.content === 'string') return visibleUserContext(item.content);
  if (!Array.isArray(item.content)) return '';
  return item.content.flatMap(part => part && typeof part === 'object' && typeof part.text === 'string'
    ? [visibleUserContext(part.text)] : []).filter(Boolean).join('');
}
