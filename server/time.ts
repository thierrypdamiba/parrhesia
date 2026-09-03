// Calendar arithmetic in America/New_York (PLAN.md 2.3, 4.1 item 1, docs/API.md conventions).

const NY = 'America/New_York';

/** 'YYYY-MM-DD' for `now` in America/New_York. */
export function todayNY(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Calendar days from today (NY) to `date`; negative when the date has passed. */
export function daysLeft(date: string | null | undefined, today: string = todayNY()): number {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  return Math.round((Date.UTC(...ymd(date)) - Date.UTC(...ymd(today))) / 86_400_000);
}

/** `comments_close_on < today (NY)` (2.3 Bound, closed). */
export function isClosed(date: string | null | undefined, today: string = todayNY()): boolean {
  if (!date) return false;
  return date < today;
}

/** Add `days` to a 'YYYY-MM-DD' date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = ymd(date);
  return new Date(Date.UTC(y, m, d + days)).toISOString().slice(0, 10);
}

function ymd(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m - 1, d];
}

/** 'HH:MM' in America/New_York for provenance lines. */
export function clockNY(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
