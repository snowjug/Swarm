import type {
  ConstraintCategory,
  ConstraintEffect,
  ConstraintHardness,
  ConstraintSeverity,
} from '../../../shared/constraints.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import type { Actor, ActorRelation } from '../../../shared/stakeholders.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import type { Origin } from './detect.js';

/** Where a proposal came from, apart from the text it was read in: a rule about who is involved, or a model. */
export type ProposalOrigin = Origin | { kind: 'category'; reason: string } | { kind: 'model' };

/**
 * A constraint as discovery proposes it, before the server has decided what to make of it: quotes still
 * have to be found in their passages, hardness is only what the words suggest, and nothing says yet whether
 * anyone has validated it. `build.ts` makes a `Constraint` of it, or drops it, by rules that do not depend
 * on who proposed it.
 */
export interface Proposal {
  category: ConstraintCategory;
  statement: string;
  hardness: ConstraintHardness;
  origin: ProposalOrigin;
  /** Passages and excerpts the proposal says it was found in. Each is checked against the passage. */
  quotes: { passageId: string; quote: string }[];
  affectedActorIds: string[];
  affectedAlternativeIds: string[];
  windowText: string;
  /** What the engine is to do, when the words say so plainly (a required approval, and by whom). */
  effects: ConstraintEffect[];
  /** The assumption of the scenario this holds only while that holds. */
  assumptionId: string | null;
  /** Said by the proposal and kept only as a hint: severity is worked out from the constraint. */
  severity?: ConstraintSeverity;
  /** How early to show it: lower first. */
  rank: number;
  /** A sentence on how it was read, when that is more than where it was found. */
  note?: string;
}

export interface AlternativeRef {
  id: string;
  label: string;
}

/** What discovery reads: the person's words, the sources, the cast and the alternatives. */
export interface DiscoveryContext {
  question: string;
  scenario: ScenarioFrame | null;
  actors: readonly Actor[];
  actorRelations: readonly ActorRelation[];
  alternatives: readonly AlternativeRef[];
  passages: readonly EvidenceChunk[];
  /** Documents that automatic research set aside, whose passages are not read. */
  setAsideDocuments?: ReadonlySet<string>;
  /** Documents that are illustrative or recorded examples, so that what is found in them is said to be so. */
  exampleDocuments?: ReadonlySet<string>;
}
