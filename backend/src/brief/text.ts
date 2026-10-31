/** Small text helpers for the brief. Everything a person or a source wrote goes through `embed`. */
import type { ActorMeasure } from './measures.js';

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
  const hard = text.slice(0, Math.max(0, max - 1));
  // A word is not cut in two when ending at the last space loses no more than a fifth of the room.
  const space = hard.lastIndexOf(' ');
  return `${(space >= max * 0.8 ? hard.slice(0, space) : hard).trimEnd()}…`;
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

/**
 * Digits enough that a number that is not zero is not printed as zero: the asked-for two, three below
 * 0.01 and four below 0.001, so that a shift of 0.009 with an error of 0.001 reads as such and not as
 * "0.01 (error 0.00)".
 */
function placesFor(value: number, digits: number): number {
  const size = Math.abs(value);
  if (size === 0 || size >= 0.01 || digits > 2) return digits;
  return Math.max(digits, size >= 0.001 ? 3 : 4);
}

export function decimals(value: number, digits = 2): string {
  const places = placesFor(value, digits);
  const rounded = Number(value.toFixed(places));
  return rounded.toFixed(places);
}

export function signed(value: number, digits = 2): string {
  const places = placesFor(value, digits);
  const rounded = Number(value.toFixed(places));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(places)}`;
}

/**
 * A share from 0 to 1 as simulated members in 100, without the unit: "36", "9.6", "0.45". Brief
 * statements never write a share of simulated members with a percent sign, which would read as a rate
 * in a real population; the sentence around the number says "in 100" and what the 100 are.
 */
export function perHundred(share: number): string {
  const points = share * 100;
  const size = Math.abs(points);
  const shown = size >= 10 ? Math.round(points) : Number(points.toFixed(size >= 1 ? 1 : 2));
  return String(shown);
}

/** The same with its sign, for a difference: "+9.1", "-0.45", "0". */
export function signedPerHundred(share: number): string {
  const shown = perHundred(share);
  return Number(shown) > 0 ? `+${shown}` : shown;
}

export const plural = (count: number, one: string, many = `${one}s`): string =>
  count === 1 ? one : many;

/** `switchingCost` as "switching cost". */
export const traitLabel = (key: string): string => key.replace(/([A-Z])/gu, ' $1').toLowerCase();

/** Parts of a text joined while they fit, whole: a sentence is dropped rather than cut in two. */
export function fit(parts: readonly string[], max: number): string {
  let text = '';
  for (const part of parts) {
    const next = text === '' ? part : `${text} ${part}`;
    if (next.length > max) {
      if (text === '') return clip(part, max);
      break;
    }
    text = next;
  }
  return text;
}

/** A list in a sentence: "a", "a and b", "a, b and c". */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * What a count of simulated members is, said wherever one stands: how many members are sampled for a
 * group is a numerical setting of the simulation, so the count is a resolution and not a size.
 */
export const RESOLUTION_NOTE =
  'how many members are sampled for each group is a numerical resolution set when the actors were made, not a population';

/** A group's own outcome in words: a count only for a group of several, with the group's own size as its denominator. */
export function groupOutcome(
  measure: Pick<ActorMeasure, 'members' | 'adverseShare'>,
  runs: number,
  share = measure.adverseShare,
): string {
  return measure.members === 1
    ? `its one simulated member ended up looking for an alternative or resisting in about ${Math.round(share * runs)} of ${runs} seeded runs`
    : `about ${approx(share * measure.members)} of its ${measure.members} simulated members ended up looking for an alternative or resisting`;
}
