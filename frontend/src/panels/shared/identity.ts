/** A small, stable hash (FNV-1a), so that the same identifier always gets the same look. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export interface OrbParts {
  /** Two of the eight category colours (1 to 8), always different. */
  a: number;
  b: number;
  /** Where the colours turn from, in degrees. */
  turn: number;
}

/** The look of an identifier: two category colours and a turn. It is derived, never random. */
export function orbParts(seed: string): OrbParts {
  const hash = hashString(seed);
  const a = (hash % 8) + 1;
  const b = ((a + 2 + ((hash >>> 3) % 5)) % 8) + 1;
  return { a, b: b === a ? (a % 8) + 1 : b, turn: (hash >>> 7) % 360 };
}

/** The first characters of a long identifier, as the people list and the audit log show them. */
export function shortIdentifier(value: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)
    ? `${value.slice(0, 8)}…`
    : value;
}
