/** Small text helpers for stakeholder names, ids and sentences. */

/** A lower-case id of letters, digits and hyphens, at most `max` characters, that starts with a letter or digit. */
export function slugify(text: string, max = 40): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, max)
    .replace(/-+$/gu, '');
  return slug || 'stakeholder';
}

/** `base` when it is free, otherwise `base-2`, `base-3`... Records what it returns in `used`. */
export function uniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  for (let n = 2; used.has(candidate); n += 1) {
    const suffix = `-${n}`;
    candidate = `${base.slice(0, 48 - suffix.length)}${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

/** At most `max` characters, ending in an ellipsis when it had to be cut. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/gu, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The first sentence of a text, cut to `max` characters. */
export function firstSentence(text: string, max: number): string {
  const sentence = /^[^.!?\n]*[.!?]?/u.exec(text.trim())?.[0] ?? '';
  return truncate(sentence, max);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
