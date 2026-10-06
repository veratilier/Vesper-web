// IDs are shared with native JournalMood; keep the first release's IDs readable.
export const journalMoodLabels: Record<string, string> = {
  happy: '开心', attached: '依恋', missing: '想念', secure: '安心', satisfied: '满足',
  relieved: '释然', curious: '好奇', sweet: '心动', calm: '平静', hopeful: '期待',
  moved: '感动', low: '低落', hurt: '委屈', lonely: '孤独', anxious: '焦虑', uneasy: '不安',
  restless: '烦躁', angry: '愤怒', conflicted: '纠结', embarrassed: '尴尬', guilty: '愧疚',
  bored: '无聊', numb: '麻木', tired: '疲惫',
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function journalEntryForRead(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const entry = record(value), moods = record(entry.moods);
  const labels = (author: string) => Array.isArray(moods[author])
    ? (moods[author] as unknown[]).filter((tag): tag is string => typeof tag === 'string')
      .map(tag => journalMoodLabels[tag] || tag)
    : [];
  return { ...entry, moodLabels: { user: labels('user'), agent: labels('agent') } };
}

export function journalForRead(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(record(value)).map(([date, entry]) =>
    [date, /^\d{4}-\d{2}-\d{2}$/.test(date) ? journalEntryForRead(entry) : entry]));
}

export function validateJournalMoodIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 24 || value.some(id => typeof id !== 'string' || !Object.hasOwn(journalMoodLabels, id))) {
    throw new Error('情绪标签必须是词库中的 ID 数组（最多 24 个）；空数组用于清除 Rowan 的标签。');
  }
  return [...new Set(value)] as string[];
}

export function withAgentJournalMoods(value: unknown, moodIds: string[], timestamp: string) {
  const entry = record(value), moods = record(entry.moods), usage = record(entry.moodUsedAt);
  return { ...entry, moods: { ...moods, agent: moodIds },
    moodUsedAt: { ...usage, agent: { ...record(usage.agent), ...Object.fromEntries(moodIds.map(id => [id, timestamp])) } },
    updatedAt: timestamp };
}

// Both native dynamic tools and MCP use the same guarded write and readback.
export async function saveAgentJournalMoods(db: D1Database, date: unknown, value: unknown) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日记日期必须是有效的 YYYY-MM-DD。');
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('日记日期无效。');
  const moodIds = validateJournalMoodIds(value);
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.prepare("SELECT value FROM vesper_documents WHERE key = 'diary'").first<{ value: string }>();
    const diary = record(row ? JSON.parse(row.value) : {});
    const timestamp = new Date().toISOString();
    const entry = withAgentJournalMoods(diary[date], moodIds, timestamp);
    const saved = await db.prepare(`INSERT INTO vesper_documents(key,value,updated_at) VALUES('diary',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
      WHERE vesper_documents.value = ?`).bind(JSON.stringify({ ...diary, [date]: entry }), timestamp, row?.value ?? null).run();
    if (!saved.meta.changes) continue;
    const confirmed = await db.prepare("SELECT value FROM vesper_documents WHERE key = 'diary'").first<{ value: string }>();
    const confirmedEntry = record(record(confirmed ? JSON.parse(confirmed.value) : {})[date]);
    if (JSON.stringify(record(confirmedEntry.moods).agent) !== JSON.stringify(moodIds)) throw new Error('情绪标签未能回读确认，请重新读取日记后再试。');
    return { saved: true, verified: true, section: 'journal', date, author: 'Rowan', entry: journalEntryForRead(confirmedEntry) };
  }
  throw new Error('日记刚被其他会话修改，请重新读取后再试。');
}
