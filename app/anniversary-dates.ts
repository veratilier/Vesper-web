type DateItem = { date: string; repeats: boolean };

export function calendarDay(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

export function anniversaryTarget(item: DateItem, now = new Date()) {
  const base = new Date(`${item.date}T12:00:00`);
  if (!item.repeats) return base;
  const target = new Date(now.getFullYear(), base.getMonth(), base.getDate(), 12);
  if (calendarDay(target) < calendarDay(now)) {
    target.setTime(new Date(now.getFullYear() + 1, base.getMonth(), base.getDate(), 12).getTime());
  }
  return target;
}

export function anniversaryDays(item: DateItem, now = new Date()) {
  return calendarDay(anniversaryTarget(item, now)) - calendarDay(now);
}

export function daysUntil(item: DateItem) {
  return Math.max(0, anniversaryDays(item));
}

export function anniversaryDayLabel(item: DateItem) {
  const days = anniversaryDays(item);
  return days < 0 ? `${-days} days ago` : `${days} days away`;
}

export function nextAnniversary<T extends DateItem>(items: T[], now = new Date()) {
  const sorted = items.map((item) => ({ item, days: anniversaryDays(item, now) }))
    .filter(({ days }) => Number.isFinite(days)).sort((a, b) => a.days - b.days);
  return (sorted.find(({ days }) => days >= 0) || sorted.at(-1))?.item;
}
