import { sha256 } from '../../ingest/url/provenance.js';

/** How a page repeats one that was read: the same address in another spelling, the same text, or nearly the same text. */
export type DuplicateBy = 'canonical-url' | 'content-hash' | 'near-duplicate';

// 64 bits of fingerprint, as two halves, and how many bits two fingerprints may differ in for the texts to be taken as the same.
const NEAR_BITS = 3;
// A short text has too few words for a fingerprint to mean anything.
const MIN_WORDS = 40;
const SHINGLE = 3;
const MAX_WORDS = 20_000;

function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_WORDS);
}

/** 32-bit FNV-1a, with a seed so that two halves of a fingerprint are not one. */
function fnv(text: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export type Fingerprint = readonly [high: number, low: number];

/**
 * A fingerprint of a text that is nearly the same for nearly the same text (SimHash over its
 * three-word shingles). It is null for a text too short to fingerprint.
 */
export function fingerprint(text: string): Fingerprint | null {
  const list = words(text);
  if (list.length < MIN_WORDS) return null;
  const votes = new Int32Array(64);
  for (let at = 0; at + SHINGLE <= list.length; at += 1) {
    const shingle = list.slice(at, at + SHINGLE).join(' ');
    const high = fnv(shingle, 0);
    const low = fnv(shingle, 0x9e3779b9);
    for (let bit = 0; bit < 32; bit += 1) {
      votes[bit] = (votes[bit] ?? 0) + ((high >>> bit) & 1 ? 1 : -1);
      votes[32 + bit] = (votes[32 + bit] ?? 0) + ((low >>> bit) & 1 ? 1 : -1);
    }
  }
  let high = 0;
  let low = 0;
  for (let bit = 0; bit < 32; bit += 1) {
    if ((votes[bit] ?? 0) > 0) high |= 1 << bit;
    if ((votes[32 + bit] ?? 0) > 0) low |= 1 << bit;
  }
  return [high >>> 0, low >>> 0];
}

const ones = (value: number): number => {
  let rest = value >>> 0;
  let count = 0;
  while (rest) {
    rest &= rest - 1;
    count += 1;
  }
  return count;
};

export const distance = (a: Fingerprint, b: Fingerprint): number =>
  ones(a[0] ^ b[0]) + ones(a[1] ^ b[1]);

export interface Seen {
  url: string;
  by: DuplicateBy;
}

/**
 * What a crawl has read, so that a page that repeats it is known. The first page with a text is the
 * original: a later one is its duplicate, by the hash of its text or by a fingerprint close to that of
 * a page already read. (The same address in another spelling is told apart by `urls.ts`, earlier.)
 */
export class ContentIndex {
  private readonly hashes = new Map<string, string>();
  private readonly prints: { print: Fingerprint; url: string; length: number; site: string }[] = [];

  /**
   * The page this text repeats, if it repeats one: the same text anywhere, or nearly the same text on
   * the same site. Nearly the same text on another site is not taken for a repeat, so that a page made
   * to look like another cannot stand in for it.
   */
  find(text: string, hash: string = sha256(text), site = ''): Seen | null {
    const exact = this.hashes.get(hash);
    if (exact) return { url: exact, by: 'content-hash' };
    const print = fingerprint(text);
    if (!print) return null;
    for (const known of this.prints) {
      if (known.site !== site) continue;
      const ratio = text.length / Math.max(1, known.length);
      if (ratio > 0.8 && ratio < 1.25 && distance(print, known.print) <= NEAR_BITS) {
        return { url: known.url, by: 'near-duplicate' };
      }
    }
    return null;
  }

  /** Remembers a page that was read, as the original of what repeats it. */
  add(url: string, text: string, hash: string = sha256(text), site = ''): void {
    if (!this.hashes.has(hash)) this.hashes.set(hash, url);
    const print = fingerprint(text);
    if (print) this.prints.push({ print, url, length: text.length, site });
  }
}
