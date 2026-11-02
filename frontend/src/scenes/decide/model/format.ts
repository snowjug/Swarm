/**
 * Numbers and words as the decision brief writes them, so that what the page leads with is read the same
 * as the sentence it came from. A share of simulated members is always "in 100": a percent sign would read
 * as a rate in a real population, which it is not.
 */

const MINUS = '\u2212';

/** A share from 0 to 1 as simulated members in 100, without the unit: "36", "9.6", "0.45". */
export function perHundred(share: number): string {
  const points = share * 100;
  const size = Math.abs(points);
  const shown = size >= 10 ? Math.round(points) : Number(points.toFixed(size >= 1 ? 1 : 2));
  return String(shown);
}

/** The same with its sign, for a difference: "+9.1", "\u22120.45", "0". */
export function signedPerHundred(share: number): string {
  const shown = perHundred(share);
  const value = Number(shown);
  if (value > 0) return `+${shown}`;
  return value < 0 ? `${MINUS}${shown.replace('-', '')}` : shown;
}

/** A mean number of simulated members: whole above ten, one decimal place below. */
export function approx(value: number): string {
  return value >= 10 ? String(Math.round(value)) : String(Number(value.toFixed(1)));
}

/** Digits enough that a number that is not zero is not printed as zero. */
function placesFor(value: number, digits: number): number {
  const size = Math.abs(value);
  if (size === 0 || size >= 0.01 || digits > 2) return digits;
  return Math.max(digits, size >= 0.001 ? 3 : 4);
}

export function decimals(value: number, digits = 2): string {
  const places = placesFor(value, digits);
  return Number(value.toFixed(places)).toFixed(places);
}

export function signedDecimals(value: number, digits = 2): string {
  const places = placesFor(value, digits);
  const rounded = Number(value.toFixed(places));
  const text = Math.abs(rounded).toFixed(places);
  if (rounded > 0) return `+${text}`;
  return rounded < 0 ? `${MINUS}${text}` : text;
}

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/** "A", "A and B", "A, B and C". */
export function listed(items: readonly string[]): string {
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The first letter in capitals, for a label made from a lower-case word. */
export const sentence = (value: string): string =>
  value.length === 0 ? value : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

/** A day, such as "1 Nov 2026": the same in every time zone, since the server's time is the record. */
export function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'an unknown date';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Keeps a long server text to a length that fits a line or two, at a word, with an ellipsis. */
export function clip(text: string, length: number): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  if (flat.length <= length) return flat;
  const cut = flat.slice(0, length);
  const space = cut.lastIndexOf(' ');
  const kept = space > length * 0.6 ? cut.slice(0, space) : cut;
  return `${kept.replace(/[\s,;:.\u2013\u2014-]+$/u, '')}\u2026`;
}
