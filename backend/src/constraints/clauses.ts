/**
 * Where a sentence is cut into the parts that each say one thing: at a semicolon, a colon or a dash, at
 * a comma, and at the joining word of a comma ("and", "but", "so", "which"). The joint before each part
 * is kept, so that a part that begins "so" or "and some" can be read as going on from the one before.
 */
const JOINTS =
  /([;:—–]|,\s+(?:and|but|so|while|whereas|although|because|which)\s+|\s+(?:but|while|whereas|although|because)\s+|,\s+)/u;

export interface Clause {
  text: string;
  /** What joined it to the clause before, in lower case ("", ", and", ", so", ";"); empty for the first. */
  joint: string;
}

export function splitClauses(sentence: string): Clause[] {
  const parts = sentence.split(JOINTS);
  const clauses: Clause[] = [];
  let joint = '';
  for (let at = 0; at < parts.length; at += 2) {
    const text = parts[at] ?? '';
    if (text.trim().length > 0) clauses.push({ text, joint });
    joint = (parts[at + 1] ?? '').trim().replace(/\s+/gu, ' ').toLowerCase();
  }
  return clauses;
}
