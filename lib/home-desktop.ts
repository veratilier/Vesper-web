export function latestRowanNote<T extends { text: string; kind: string; createdAt: string; updatedAt?: string }>(notes: T[]): T | undefined {
  const stamp = (note: T) => Date.parse(note.createdAt) || Date.parse(note.updatedAt || '') || 0;
  return notes.filter(note => note.kind === 'agent' && note.text.trim()).sort((a, b) => stamp(b) - stamp(a))[0];
}
export function homeCountdown(days: number): string {
  if (days === 0) return 'Today';
  const count = Math.abs(days), unit = count === 1 ? 'day' : 'days';
  return days > 0 ? `In ${count} ${unit}` : `${count} ${unit} ago`;
}
export function darkHomeBackground(background: string): boolean {
  if (background.includes('vesper-black-20261005.jpg')) return true;
  if (!/^#[\da-f]{6}$/i.test(background)) return false;
  const rgb = [1, 3, 5].map(start => parseInt(background.slice(start, start + 2), 16) / 255);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 < .3;
}
export function homeWeatherCondition(code?: number): string {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code !== undefined && code >= 51 && code <= 57) return 'Drizzle';
  if (code !== undefined && ((code >= 61 && code <= 67) || (code >= 80 && code <= 82))) return 'Rain';
  if (code !== undefined && ((code >= 71 && code <= 77) || code === 85 || code === 86)) return 'Snow';
  if (code !== undefined && code >= 95 && code <= 99) return 'Thunderstorms';
  return 'Local weather';
}
export const chatWelcomeLines = ['A place for today, too.', 'The light is still on.', 'Come in. Take your time.', 'What shall we keep from today?', 'You can begin anywhere.', 'A little space for us.', 'Some things are easier said here.', 'No need to have all the words yet.', 'Let the day settle for a moment.', 'There is room for the small things.', 'Hello again, Vera.', 'Tell me the part you kept thinking about.', 'We can take this slowly.', 'Leave a thought here, if you like.', 'A quiet corner, whenever you need it.', 'What is on your mind today?'];
export function nextChatWelcome(previous: string): string {
  const choices = chatWelcomeLines.filter(line => line !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}
