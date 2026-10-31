/** Small text helpers for the brief. Everything a person or a source wrote goes through `embed`. */

export function oneLine(text: string): string {
  return [...text]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Text that a person, a source or an earlier step wrote, put into a sentence of ours: on one line,
 * shortened, and in curly quotation marks so that it reads, and is checked, as theirs. A final full
 * stop is dropped, because the sentence around the quotation supplies its own.
 */
export function embed(text: string, max = 120): string {
  const inner = oneLine(text)
    .replace(/[“”]/gu, '"')
    .replace(/(?<!\.)\.$/u, '');
  return `“${clip(inner, max)}”`;
}

/** A number of simulated members, written to the nearest whole member. */
export const whole = (value: number): string => String(Math.round(value));

/** A mean number of members: whole above ten, to one decimal place below, so that a small mean is not rounded away. */
export const approx = (value: number): string =>
  value >= 10 ? String(Math.round(value)) : String(Number(value.toFixed(1)));

export function decimals(value: number, digits = 2): string {
  const rounded = Number(value.toFixed(digits));
  return rounded.toFixed(digits);
}

export function signed(value: number, digits = 2): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}`;
}

export const plural = (count: number, one: string, many = `${one}s`): string =>
  count === 1 ? one : many;

/** `switchingCost` as "switching cost". */
export const traitLabel = (key: string): string => key.replace(/([A-Z])/gu, ' $1').toLowerCase();

/** A list in a sentence: "a", "a and b", "a, b and c". */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
