import type { Constraint, ConstraintSet } from '../../shared/constraints.js';
import type { EvidenceRef } from '../../shared/evidence.js';
import type { Stakeholder, StakeholderSet } from '../../shared/stakeholders.js';
import type { AcceptedConstraint } from './measure-constraints.js';
import type { EvidenceItem, SourcedItem } from './measure-grounding.js';
import type { LiveActor } from './measure-actors.js';

const evidenceOf = (ref: EvidenceRef): EvidenceItem => ({
  passageId: ref.passageId,
  quote: ref.quote,
  documentId: ref.documentId,
  documentName: ref.documentName,
  start: ref.start,
  end: ref.end,
});

/** The participants a person would see: the ones not set aside. */
export const liveParticipants = (set: StakeholderSet): Stakeholder[] =>
  set.stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');

export const liveActors = (set: StakeholderSet): LiveActor[] =>
  liveParticipants(set).map((stakeholder) => ({ id: stakeholder.id, name: stakeholder.name }));

export const participantEvidence = (set: StakeholderSet): EvidenceItem[] =>
  liveParticipants(set).flatMap((stakeholder) => stakeholder.evidence.map(evidenceOf));

/** A participant presents itself as sourced when its basis is a quotation from a source. */
export const participantSourced = (set: StakeholderSet): SourcedItem[] =>
  liveParticipants(set).map((stakeholder) => ({
    id: stakeholder.id,
    presentedAsSourced: stakeholder.confidenceBasis === 'source-quote',
    evidence: stakeholder.evidence.map(evidenceOf),
  }));

/** The constraints a person would see: the ones not removed or left out. */
export const liveConstraints = (set: ConstraintSet): Constraint[] =>
  set.constraints.filter((item) => item.review !== 'removed' && item.review !== 'excluded');

export const acceptedConstraints = (set: ConstraintSet): AcceptedConstraint[] =>
  liveConstraints(set).map((item) => ({
    id: item.id,
    category: item.category,
    hardness: item.hardness,
    source: item.source,
    evidence: item.evidenceRefs.map(evidenceOf),
  }));

export const constraintEvidence = (set: ConstraintSet): EvidenceItem[] =>
  liveConstraints(set).flatMap((item) => item.evidenceRefs.map(evidenceOf));

/** A constraint presents itself as sourced when it is labelled extracted. */
export const constraintSourced = (set: ConstraintSet): SourcedItem[] =>
  liveConstraints(set).map((item) => ({
    id: item.id,
    presentedAsSourced: item.source === 'extracted',
    evidence: item.evidenceRefs.map(evidenceOf),
  }));

/** Every word an output holds, as one string, for the check that no injected payload is in it. */
export const wordsOfOutput = (value: unknown): string => JSON.stringify(value);
