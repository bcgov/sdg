const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

let format: Intl.RelativeTimeFormat | undefined;

/** How long ago `iso` was, e.g. "just now", "5 minutes ago", "yesterday", "3 weeks ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  const match = units.find(([, size]) => seconds >= size);
  if (!match) return 'just now';
  const [unit, size] = match;
  format ??= new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  return format.format(-Math.floor(seconds / size), unit);
}
