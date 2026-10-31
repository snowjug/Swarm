import { ENGLISH_WORDS } from './lexicon.js';

/** The most text of a question that is read; the rest is left out, and the person is told. */
export const MAX_READ_CHARS = 2_000;
/** Whatever arrives, work is done on no more than this before the cut to `MAX_READ_CHARS`. */
const MAX_SCANNED_CHARS = 20_000;

// Control characters other than tab and newline, and zero-width and line-separator characters.
// eslint-disable-next-line no-control-regex
const UNWANTED = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/gu;

/**
 * A question as plain text: no control characters, one space between words, line breaks kept (they end
 * a sentence), and no more than `MAX_READ_CHARS` of it.
 */
export function normalise(raw: string): { text: string; truncated: boolean } {
  const cleaned = raw
    .slice(0, MAX_SCANNED_CHARS)
    .replace(UNWANTED, ' ')
    .replace(/\r\n?/gu, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ ?\n ?/gu, '\n')
    .replace(/\n{2,}/gu, '\n')
    .trim();
  const truncated = raw.length > MAX_SCANNED_CHARS || cleaned.length > MAX_READ_CHARS;
  return { text: clip(cleaned, MAX_READ_CHARS, ''), truncated };
}

/** Sentences, in order. A full stop that is part of a number or an abbreviation does not end one. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}\p{N}"'(¿¡$€£])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 40);
}

/** Cuts text to at most `max` characters at a word boundary, without splitting a character in two. */
export function clip(text: string, max: number, ellipsis = '…'): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  let cut = trimmed.slice(0, max - ellipsis.length);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}${ellipsis}`;
}

export function sentenceCase(text: string): string {
  const [first = '', ...rest] = Array.from(text);
  return `${first.toLocaleUpperCase('en')}${rest.join('')}`;
}

/** A readable name for text that is unsafe to show as it is: printable, one line, and short. */
export function plainName(text: string, max = 80): string {
  return clip(text.replace(/[^\P{C}]+/gu, ' ').replace(/\s+/gu, ' '), max);
}

/** An id of lower-case letters, digits and hyphens that is not in `taken`; it is added to `taken`. */
export function slugify(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 40)
      .replace(/-+$/u, '') || 'option';
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/**
 * Whether the text reads as English. The rules read English only, so a question in another language
 * is read as little as possible and the person is told. Short text is given the benefit of the doubt.
 */
export function looksEnglish(text: string): boolean {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return true;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if (latin / letters < 0.6) return false;
  const words = text.match(/\p{L}+/gu) ?? [];
  if (words.length < 4) return true;
  const known = words.filter((word) => ENGLISH_WORDS.has(word.toLowerCase())).length;
  return known / words.length >= 0.1;
}
