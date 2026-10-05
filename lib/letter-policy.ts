export type Letter = { id: string; title: string; text?: string; author: string; recipient?: string; createdAt: string; unlockAt?: string; replyTo?: string; locked?: boolean; read?: boolean; kept?: boolean };
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
