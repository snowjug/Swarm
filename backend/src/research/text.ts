import { tokenize } from '../knowledge/retrieval.js';

/** Collapses every run of white space, and the ends, to single spaces. */
export const squeeze = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/**
 * At most `max` characters, cut at the last word that fits, so that a line shown to a person never
 * ends in the middle of a word. Never longer than `max`, and never empty unless `text` is.
 */
export function clip(text: string, max: number): string {
  const line = squeeze(text);
  if (line.length <= max) return line;
  const head = line.slice(0, max).replace(/[\ud800-\udbff]$/u, '');
  const at = head.lastIndexOf(' ');
  return (at > max * 0.6 ? head.slice(0, at) : head).replace(/[\s,;:.-]+$/u, '');
}

/** A word as the comparisons of research read it: without the plural `s`, as the crawler's own scorer reads one. */
const stem = (word: string): string =>
  word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;

/** The distinct words that carry meaning, as the project's retrieval reads them, each without a plural `s`. */
export const termsOf = (text: string): Set<string> => new Set(tokenize(text).map(stem));

/** An address a person wrote into text: with a scheme, or beginning `www.`. Matched loosely, and never fetched. */
const ADDRESS = /\b(?:https?:\/\/|www\.)[^\s<>"'“”‘’)\]]+/giu;

/** Replaces each address in a text by the name of its site, so that a plan names things to find and never a place to fetch. */
export function withoutAddresses(text: string): string {
  return text.replace(ADDRESS, (found) => {
    const host = /^(?:https?:\/\/)?(?:www\.)?([^/?#:\s]+)/iu.exec(found)?.[1] ?? '';
    return host.toLowerCase();
  });
}

/** Whether a text still holds an address with a scheme, or one that begins `www.`. */
export const mentionsAddress = (text: string): boolean => /\b(?:https?:\/\/|www\.)\S/iu.test(text);

/** Characters that no line of text shown to a person should hold: controls other than tab and newline. */
// eslint-disable-next-line no-control-regex
export const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;

export const hasControl = (text: string): boolean => new RegExp(CONTROL.source, 'u').test(text);

/** A host name as `example.org`: lower case, labels of letters, digits and hyphens, a last label of letters. Never an address. */
export const BARE_HOST =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/u;
