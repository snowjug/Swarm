import {
  PUBLICATION_STATUSES,
  SUPPORT_CLASSES,
  isOpenConflict,
  type ClaimRecord,
  type ContradictionRecord,
  type EvidenceRef,
  type EvidenceSufficiency,
  type Ledger,
  type PublicationStatus,
  type SupportClass,
} from '../../../shared/evidence';
import type { ChatGroundingStatus } from '../../../shared/types';

/** How a status looks. Every tone also has its own icon and words, so colour is never the only cue. */
export type Tone = 'good' | 'caution' | 'bad' | 'neutral' | 'info';

export const SUPPORT_TONE: Record<SupportClass, Tone> = {
  'directly-supported': 'good',
  'partially-supported': 'caution',
  contradicted: 'bad',
  unsupported: 'bad',
  'not-applicable': 'neutral',
  'not-checkable': 'neutral',
  'simulation-derived': 'info',
  'assumption-dependent': 'info',
};

export const PUBLICATION_TONE: Record<PublicationStatus, Tone> = {
  finding: 'good',
  qualified: 'caution',
  'contradiction-shown': 'bad',
  'labelled-hypothesis': 'caution',
  'labelled-simulation': 'info',
  'labelled-unverified': 'neutral',
  input: 'neutral',
  withheld: 'bad',
};

export const SUFFICIENCY_HEADLINE: Record<EvidenceSufficiency['level'], string> = {
  sufficient: 'The evidence supports putting a recommendation forward',
  limited: 'The evidence is limited: treat any recommendation as tentative',
  insufficient: 'The evidence is not enough for a recommendation',
};

export const SUFFICIENCY_TONE: Record<EvidenceSufficiency['level'], Tone> = {
  sufficient: 'good',
  limited: 'caution',
  insufficient: 'bad',
};

export interface LedgerFilter {
  support: SupportClass | 'all';
  publication: PublicationStatus | 'all';
  /** Only statements nobody has reviewed yet. */
  unreviewedOnly: boolean;
}

export const NO_FILTER: LedgerFilter = {
  support: 'all',
  publication: 'all',
  unreviewedOnly: false,
};

export function filterClaims(claims: readonly ClaimRecord[], filter: LedgerFilter): ClaimRecord[] {
  return claims.filter(
    (claim) =>
      (filter.support === 'all' || claim.supportClass === filter.support) &&
      (filter.publication === 'all' || claim.publication.status === filter.publication) &&
      (!filter.unreviewedOnly || claim.review.result === 'pending'),
  );
}

export function isFilterActive(filter: LedgerFilter): boolean {
  return filter.support !== 'all' || filter.publication !== 'all' || filter.unreviewedOnly;
}

/** Support classes that actually occur, in the fixed order of the taxonomy, with their counts. */
export function supportCounts(
  claims: readonly ClaimRecord[],
): { support: SupportClass; count: number }[] {
  return SUPPORT_CLASSES.map((support) => ({
    support,
    count: claims.filter((claim) => claim.supportClass === support).length,
  })).filter((entry) => entry.count > 0);
}

export function publicationCounts(
  claims: readonly ClaimRecord[],
): { status: PublicationStatus; count: number }[] {
  return PUBLICATION_STATUSES.map((status) => ({
    status,
    count: claims.filter((claim) => claim.publication.status === status).length,
  })).filter((entry) => entry.count > 0);
}

export interface LedgerSummary {
  statements: number;
  /** Shown as findings, with or without a qualification. */
  findings: number;
  /** Shown only with a label that says they are not findings. */
  labelled: number;
  withheld: number;
  reviewed: number;
  openConflicts: number;
}

const LABELLED: ReadonlySet<PublicationStatus> = new Set([
  'labelled-hypothesis',
  'labelled-simulation',
  'labelled-unverified',
  'input',
]);

export function summarise(ledger: Ledger): LedgerSummary {
  const statuses = ledger.claims.map((claim) => claim.publication.status);
  return {
    statements: ledger.claims.length,
    findings: statuses.filter((status) => status === 'finding' || status === 'qualified').length,
    labelled: statuses.filter((status) => LABELLED.has(status)).length,
    withheld: statuses.filter((status) => status === 'withheld').length,
    reviewed: ledger.claims.filter((claim) => claim.review.result !== 'pending').length,
    openConflicts: openConflicts(ledger.contradictions).length,
  };
}

export function openConflicts(conflicts: readonly ContradictionRecord[]): ContradictionRecord[] {
  return conflicts.filter((conflict) => isOpenConflict(conflict.status));
}

/** Where a quotation sits, in words a reader can use to find it in the document. */
export function locationText(ref: EvidenceRef): string {
  return `${ref.documentName}, passage ${ref.passageId}, characters ${ref.start + 1} to ${ref.end}`;
}

/** The exact quotation highlighted inside its whole passage, split so it can be rendered safely. */
export function splitAtQuote(
  passage: string,
  quote: string | null,
): { before: string; quote: string; after: string } | null {
  if (!quote) return null;
  const at = passage.indexOf(quote);
  if (at < 0) return null;
  return {
    before: passage.slice(0, at),
    quote,
    after: passage.slice(at + quote.length),
  };
}

export interface ChatGroundingView {
  label: string;
  tone: Tone;
  /** One sentence on what the reader may and may not conclude. */
  meaning: string;
}

export const CHAT_GROUNDING: Record<ChatGroundingStatus, ChatGroundingView> = {
  cited: {
    label: 'Cited from project evidence',
    tone: 'good',
    meaning: 'The answer cites passages or simulation memories, and its figures appear in them.',
  },
  caveated: {
    label: 'Cited, with figures to check',
    tone: 'caution',
    meaning: 'The answer cites evidence, but some figures in it were not found in what it cited.',
  },
  abstained: {
    label: 'Not enough evidence to answer',
    tone: 'neutral',
    meaning: 'The project does not hold evidence that answers this, so no answer is offered.',
  },
  uncited: {
    label: 'No citation: unverified',
    tone: 'bad',
    meaning: 'The reply cites nothing from the project. Treat it as unverified.',
  },
};
