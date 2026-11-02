const DAY = 86_400_000;

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Whole local days between `date` and `now`: 0 is today, 1 is yesterday. */
export function daysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / DAY);
}

/** "Today", "Yesterday", a weekday within the last week, then a date. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  const days = daysAgo(date, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7)
    return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(
    undefined,
    sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' },
  ).format(date);
}

export function clockTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/** The whole moment, for a tooltip or a `title`: the short forms above hide the date. */
export function fullTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'Unknown time'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

/** How long ago, in the short words a list needs. Falls back to the date once it is no longer recent. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24 && daysAgo(date, now) === 0) return `${hours} h ago`;
  const days = daysAgo(date, now);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} d ago`;
  return dayLabel(iso, now);
}

export interface DayGroup<T> {
  key: string;
  label: string;
  items: T[];
}

/** Items in the order given, split wherever the local day changes. */
export function groupByDay<T>(
  items: readonly T[],
  at: (item: T) => string,
  now: Date = new Date(),
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const label = dayLabel(at(item), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ key: `${groups.length}-${label}`, label, items: [item] });
  }
  return groups;
}
