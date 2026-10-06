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
