import { NOT_UNITS, TIME_UNITS, verbAt } from './lexicon.js';

/** An amount written in a question: "$1", "10%", "20 seats", "3 months". */
export interface Quantity {
  /** As written. */
  raw: string;
  value: number;
  /** A currency symbol before the number. */
  prefix: string;
  /** Everything after the number, such as "%" or " million". */
  suffix: string;
  /** The plain word that names what is counted, as in the "seats" of "20 seats". */
  unit: string | null;
  /** A span of time or a date, which is a horizon or a duration more than a size. */
  time: boolean;
}

const TOKEN =
  /[$€£¥₹]\s?\d[\d,]*(?:\.\d+)?%?|\d[\d,]*(?:\.\d+)?%?|[\p{L}\p{N}][\p{L}\p{N}'’-]*|[,;&]/gu;

/** Words, amounts and the separators `,` `;` `&`; everything else is dropped. */
export function tokenize(text: string): string[] {
  return (text.match(TOKEN) ?? []).map((token) => token.replace(/^([$€£¥₹])\s/u, '$1'));
}

const NUMBER_TOKEN = /^([$€£¥₹])?(\d[\d,]*(?:\.\d+)?)(%)?$/u;
const MAGNITUDES = new Set(['thousand', 'million', 'billion', 'trillion', 'k', 'm', 'bn']);
const SHORT_MAGNITUDES = new Set(['k', 'm', 'bn']);
const TIME_UNIT = new RegExp(`^(?:${TIME_UNITS})$`, 'u');
const DATE_WORD =
  /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/u;

export function isAmount(token: string): boolean {
  return NUMBER_TOKEN.test(token);
}

/** The amount that starts at `tokens[index]`, and how many tokens it takes. */
export function readQuantity(
  tokens: readonly string[],
  index: number,
): { quantity: Quantity; length: number } | null {
  const found = NUMBER_TOKEN.exec(tokens[index] ?? '');
  if (!found) return null;
  const digits = found[2] ?? '';
  const value = Number(digits.replace(/,/gu, ''));
  if (!Number.isFinite(value) || digits.length > 15) return null;
  const prefix = found[1] ?? '';
  let suffix = found[3] ?? '';
  let unit: string | null = null;
  let length = 1;
  let time = false;
  if (!suffix) {
    const next = tokens[index + 1]?.toLowerCase();
    const after = tokens[index + 2]?.toLowerCase();
    if (next !== undefined && MAGNITUDES.has(next)) {
      suffix = SHORT_MAGNITUDES.has(next) ? next : ` ${next}`;
      length = 2;
    } else if (next === 'percent' || next === 'pp' || next === 'bps') {
      suffix = ` ${next}`;
      length = 2;
    } else if (next === 'per' && after === 'cent') {
      suffix = ' per cent';
      length = 3;
    } else if (next === 'percentage' && (after === 'point' || after === 'points')) {
      suffix = ` percentage ${after}`;
      length = 3;
    } else if (
      !prefix &&
      next !== undefined &&
      /^\p{L}/u.test(next) &&
      !NOT_UNITS.has(next) &&
      verbAt([next], 0) === null
    ) {
      unit = tokens[index + 1] ?? null;
      suffix = ` ${unit}`;
      length = 2;
      time = TIME_UNIT.test(next) || DATE_WORD.test(next);
    }
  }
  if (!prefix && !suffix && Number.isInteger(value) && value >= 1900 && value <= 2100) time = true;
  return {
    quantity: { raw: `${prefix}${digits}${suffix}`, value, prefix, suffix, unit, time },
    length,
  };
}

/** The same kind of amount with another value: `$1` and 2.5 give `$2.50`. */
export function formatQuantity(quantity: Quantity, value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const decimals = quantity.prefix && !Number.isInteger(rounded) ? 2 : 0;
  const digits =
    Math.abs(rounded) >= 1_000
      ? rounded.toLocaleString('en-US', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: 2,
        })
      : decimals
        ? rounded.toFixed(2)
        : String(rounded);
  return `${quantity.prefix}${digits}${quantity.suffix}`;
}
