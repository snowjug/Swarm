import {
  RESPONSE_CATEGORIES,
  RESPONSE_LABELS,
  type ResponseShares,
} from '../../../../shared/analysis';
import type { AnalysisSummary } from '../../../../shared/analysis-plan';
import { dateTime } from '../../lib/format';

/** A real minus sign: in a column of numbers it lines up with the plus, and a screen reader says "minus". */
export const MINUS = '\u2212';

/** A signed decimal such as +0.12 or −0.07; a value that rounds to nothing carries no sign. */
export function signed(value: number, digits = 2): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return text;
  return `${value < 0 ? MINUS : '+'}${text}`;
}

/** A share of simulated members as a percentage. A share that is not nothing is never shown as 0%. */
export function shareText(value: number, digits: 0 | 1 = 0): string {
  const points = value * 100;
  if (digits === 0) {
    const whole = Math.round(points);
    return whole === 0 && points > 0 ? '<1%' : `${whole}%`;
  }
  const text = points.toFixed(1);
  return Number(text) === 0 && points > 0 ? '<0.1%' : `${text}%`;
}

/** Whole numbers for shares that are large; a decimal for any that is small enough for a whole number to hide it. */
export const precisionOf = (values: readonly number[]): 0 | 1 =>
  values.some((value) => value > 0 && value < 0.1) ? 1 : 0;

/** The unit-less number of a range of shares: "7.3 to 11.3%" reads better than two percent signs. */
export function rangeText(low: number, high: number, digits: 0 | 1 = 0): string {
  const part = (value: number): string => (value * 100).toFixed(digits);
  return `${part(low)}–${part(high)}%`;
}

/** A shift of a share with its unit, as a person says it: "+9 points", "−0.4 points", "0 points". */
export function pointsPhrase(value: number, digits: 0 | 1 = 0): string {
  const text = signed(value * 100, digits);
  const exactlyOne = Math.abs(Number(text)) === 1;
  return `${text} ${exactlyOne ? 'point' : 'points'}`;
}

export const countText = (value: number): string => value.toLocaleString('en-GB');

/** "12 Nov, 14:05", or what is known when the time is not valid. */
export const whenText = (iso: string | null): string => (iso ? dateTime(iso) : 'not finished');

export const seedsText = (baseSeed: number, runs: number): string =>
  runs <= 1 ? `seed ${baseSeed}` : `seeds ${baseSeed} to ${baseSeed + runs - 1}`;

/** Joins names as a person lists them: "A", "A and B", "A, B and C". */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const plural = (count: number, one: string, many = `${one}s`): string =>
  count === 1 ? one : many;

/** How many decimals a scale needs so that no two of its ticks read alike: one more than the step's own, at most four. */
export function decimalsFor(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 2;
  return Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

/** A tick of a stance or difference scale: zero is plain, the rest are signed, at the precision the scale needs. */
export function tickLabel(value: number, step: number): string {
  return Math.abs(value) < 1e-9 ? '0' : signed(value, Math.max(2, decimalsFor(step)));
}

/** The six responses and their shares, in a sentence, for a screen reader. */
export function responseSummary(shares: ResponseShares): string {
  return RESPONSE_CATEGORIES.map(
    (category) => `${RESPONSE_LABELS[category]} ${shareText(shares[category], 0)}`,
  ).join(', ');
}

/** A saved comparison in one line: when it was made, how big it was, and how it ended. */
export function summaryLine(summary: AnalysisSummary): string {
  const done = summary.status === 'completed' ? '' : `, ${summary.status}`;
  return `${whenText(summary.createdAt)} · ${summary.variants.length} scenarios × ${summary.runsPerVariant} runs${done}`;
}
