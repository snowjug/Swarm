export const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
export const count = (value: number) => value.toLocaleString();

export function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown date'
    : new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date);
}

export function sourceLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
