/** A moment in the person's own time zone, with the zone named: "Nov 7, 5:30 AM GMT+5:30". */
export function formatLocal(value: string, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'an unknown time';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function formatDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'an unknown date'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date);
}

/** "1.5 MB": a size a person can read. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${units[unit]}`;
}

/** Dollars: cents for a dollar or more, and four places below it, where a day's spend is a few cents' worth of tokens. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '$0.00';
  const text = Math.abs(value) >= 1 ? value.toFixed(2) : value.toFixed(4).replace(/0{1,2}$/u, '');
  return `$${text}`;
}
