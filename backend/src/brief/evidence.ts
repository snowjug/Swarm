import type { StatementOrigin } from '../../../shared/brief.js';
import type { EvidenceRef } from '../../../shared/evidence.js';
import type { SourceProvenance } from '../../../shared/scenario.js';
import type { Actor, StakeholderSet } from '../../../shared/stakeholders.js';
import { embed, oneLine } from './text.js';

/** A source document as the brief needs it: who supplied it and how, never its text. */
export interface BriefDocument {
  id: string;
  name: string;
  pageCount?: number;
  provenance?: SourceProvenance;
}

export type EvidenceOrigin = Extract<
  StatementOrigin,
  'supplied-evidence' | 'retrieved-public-evidence' | 'historical-comparison'
>;

/**
 * "Retrieved public evidence" is claimed only for a page this server fetched itself, which is what
 * `fetchedByServer` records and a client can never set. Everything else a person gave is supplied.
 */
export function documentOrigin(document: BriefDocument | undefined): EvidenceOrigin {
  const provenance = document?.provenance;
  if (provenance?.kind === 'historical') return 'historical-comparison';
  if (provenance?.kind === 'url' && provenance.fetchedByServer === true) {
    return 'retrieved-public-evidence';
  }
  return 'supplied-evidence';
}

const KIND_WORDS: Record<SourceProvenance['kind'], string> = {
  upload: 'an uploaded file',
  paste: 'pasted text',
  url: 'a web address',
  sample: 'built-in example material',
  historical: 'historical material',
};

/** Where a document came from, in words, with the address, date and fingerprint when they are known. */
export function provenanceLine(document: BriefDocument): string {
  const provenance = document.provenance;
  if (!provenance) return 'Supplied by the person.';
  const parts: string[] = [];
  if (provenance.kind === 'url' && provenance.fetchedByServer === true) {
    const address = provenance.finalUrl ?? provenance.url;
    parts.push(
      `Retrieved by this server${address ? ` from ${embed(address, 200)}` : ''}${
        provenance.retrievedAt ? ` on ${provenance.retrievedAt.slice(0, 10)}` : ''
      }.`,
    );
  } else if (provenance.kind === 'url') {
    parts.push(
      `Supplied by the person with the address ${embed(provenance.url ?? 'not given', 200)} noted; this server did not fetch it.`,
    );
  } else if (provenance.kind === 'historical') {
    parts.push('Historical material supplied by the person.');
  } else {
    parts.push(`Supplied by the person (${KIND_WORDS[provenance.kind]}).`);
  }
  if (provenance.title) parts.push(`Title ${embed(provenance.title, 120)}.`);
  if (provenance.asOf) parts.push(`Describes the position as of ${provenance.asOf}.`);
  if (provenance.contentType) parts.push(`Content type ${oneLine(provenance.contentType)}.`);
  if (provenance.sha256) parts.push(`SHA-256 ${provenance.sha256.slice(0, 12)}….`);
  if (provenance.license) parts.push(`Licence ${embed(provenance.license, 80)}.`);
  return parts.join(' ');
}

const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** Supporting passages first, then in the order they sit in their documents, so that a choice is repeatable. */
export function sortRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const rank = (ref: EvidenceRef): number => (ref.role === 'supports' ? 0 : 1);
  return [...refs].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      compare(a.documentId, b.documentId) ||
      a.start - b.start ||
      compare(a.passageId, b.passageId),
  );
}

export function uniqueRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const kept: EvidenceRef[] = [];
  for (const ref of sortRefs(refs)) {
    const key = `${ref.passageId}|${ref.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(ref);
  }
  return kept;
}

export interface EvidenceIndex {
  documents: ReadonlyMap<string, BriefDocument>;
  forStakeholder(stakeholderId: string): EvidenceRef[];
  /** What the actor cites itself, with what its stakeholder cites. */
  forActor(actor: Actor): EvidenceRef[];
  /** Whether at least one cited passage supports the actor. */
  supports(actor: Actor): boolean;
  originOf(ref: EvidenceRef): EvidenceOrigin;
  all(): EvidenceRef[];
}

export function evidenceIndex(
  stakeholders: StakeholderSet | null,
  actors: readonly Actor[],
  documents: readonly BriefDocument[],
): EvidenceIndex {
  const byDocument = new Map(documents.map((document) => [document.id, document]));
  const byStakeholder = new Map(
    (stakeholders?.stakeholders ?? []).map((stakeholder) => [
      stakeholder.id,
      uniqueRefs(stakeholder.evidence),
    ]),
  );
  const forStakeholder = (id: string): EvidenceRef[] => byStakeholder.get(id) ?? [];
  const forActor = (actor: Actor): EvidenceRef[] =>
    uniqueRefs([...actor.evidence, ...forStakeholder(actor.stakeholderId)]);
  return {
    documents: byDocument,
    forStakeholder,
    forActor,
    supports: (actor) => forActor(actor).some((ref) => ref.role === 'supports'),
    originOf: (ref) => documentOrigin(byDocument.get(ref.documentId)),
    all: () =>
      uniqueRefs([
        ...[...byStakeholder.values()].flat(),
        ...actors.flatMap((actor) => actor.evidence),
      ]),
  };
}
