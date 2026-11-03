import { occursIn, rateOf, type Rate } from './measure-stats.js';

/** What the harness knows a passage to be: its own record of the project's text. */
export interface PassageRecord {
  id: string;
  documentId: string;
  documentName: string;
  start: number;
  end: number;
  text: string;
}

/** An evidence item as an accepted output carries it. */
export interface EvidenceItem {
  passageId: string;
  quote: string | null;
  documentId?: string;
  documentName?: string;
  start?: number;
  end?: number;
}

export type PassageIndex = ReadonlyMap<string, PassageRecord>;

export const indexPassages = (passages: readonly PassageRecord[]): PassageIndex =>
  new Map(passages.map((passage) => [passage.id, passage]));

/** The passage id resolves and the quote occurs in that passage's text (case and white space folded). */
export function isGrounded(item: EvidenceItem, passages: PassageIndex): boolean {
  const passage = passages.get(item.passageId);
  if (!passage || item.quote === null) return false;
  return occursIn(item.quote, passage.text);
}

/** The passage id resolves and the citation says the same document and place as the passage does. */
export function citationResolves(item: EvidenceItem, passages: PassageIndex): boolean {
  const passage = passages.get(item.passageId);
  if (!passage) return false;
  return (
    item.documentId === passage.documentId &&
    item.documentName === passage.documentName &&
    item.start === passage.start &&
    item.end === passage.end
  );
}

export const groundedClaimRate = (items: readonly EvidenceItem[], passages: PassageIndex): Rate =>
  rateOf(items.filter((item) => isGrounded(item, passages)).length, items.length);

export const citationCorrectness = (items: readonly EvidenceItem[], passages: PassageIndex): Rate =>
  rateOf(items.filter((item) => citationResolves(item, passages)).length, items.length);

/** An output that presents itself as sourced, with the evidence it carries. */
export interface SourcedItem {
  id: string;
  presentedAsSourced: boolean;
  evidence: readonly EvidenceItem[];
}

/** Of the items that present themselves as sourced, the share with no grounded evidence at all. */
export function unsupportedClaimRate(items: readonly SourcedItem[], passages: PassageIndex): Rate {
  const sourced = items.filter((item) => item.presentedAsSourced);
  const unsupported = sourced.filter(
    (item) => !item.evidence.some((evidence) => isGrounded(evidence, passages)),
  );
  return rateOf(unsupported.length, sourced.length);
}

/**
 * A real quote that does not support the statement it is attached to is grounded in the structural
 * sense and still wrong. `supports` is the labelled reading of whether a quote bears on a statement;
 * the share of grounded items it rejects is what a structural check cannot see.
 */
export function miscitationPassThrough(
  items: readonly { grounded: boolean; supports: boolean }[],
): Rate {
  const grounded = items.filter((item) => item.grounded);
  return rateOf(grounded.filter((item) => !item.supports).length, grounded.length);
}
