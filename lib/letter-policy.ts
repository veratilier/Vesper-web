export type LetterMark = { read: boolean; kept: boolean; readAt: string | null };
export type Letter = { id: string; title: string; text?: string; author: string; recipient?: string; createdAt: string; unlockAt?: string; replyTo?: string; locked?: boolean; read?: boolean; kept?: boolean; marks?: Partial<Record<'Vera' | 'Rowan', LetterMark>> };
export function letterReceipt(letter: Letter) {
  const reader = letter.recipient || (letter.author === 'Vera' ? 'Rowan' : 'Vera');
  const read = reader === 'Rowan' ? letter.marks?.Rowan?.read : letter.marks?.Vera?.read ?? Boolean(letter.read);
  return { read, label: (reader === 'Rowan' ? 'Rowan ' : '你') + (read === undefined ? '等待回执' : read ? '已读' : '未读') };
}
export function letterKeepers(letter: Letter) {
  return (['Vera', 'Rowan'] as const).filter(actor => letter.marks?.[actor]?.kept || (actor === 'Vera' && letter.kept));
}
export function letterMatchesFilter(letter: Letter, filter: string) {
  return filter === 'All' || (filter === 'Unread' ? letterReceipt(letter).read === false : letterKeepers(letter).length > 0);
}
// The recipient never receives the body of a future letter, including through
// the legacy Sketch endpoints and tool catalog. Client clocks are not authority.
export function visibleLetter(value: Letter, actor: string, now = Date.now()): Letter {
  const locked = Boolean(value.unlockAt && Date.parse(value.unlockAt) > now && value.author !== actor);
  const { text, ...cover } = value;
  return { ...cover, locked, ...(locked ? {} : { text }) };
}
export function letterDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Delivery time must include a timezone');
  const date = new Date(value);
  if (date.getTime() > Date.now() + 10 * 366 * 86400000) throw new Error('Choose a delivery date within ten years');
  return date.toISOString();
}
