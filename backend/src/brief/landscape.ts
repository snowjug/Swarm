import type { StatementOrigin } from '../../../shared/brief.js';
import type { EvidenceRef } from '../../../shared/evidence.js';
import {
  STAKEHOLDER_CATEGORIES,
  type StakeholderCategory,
  type Stakeholder,
} from '../../../shared/stakeholders.js';
import type { Facts } from './facts.js';
import { directionOf } from './rules.js';

/** One stakeholder as the brief reads it, from the stakeholder set or, where there is none, from the cast. */
export interface LandscapeEntry {
  id: string;
  name: string;
  category: StakeholderCategory;
  priority: 'key' | 'standard' | 'background';
  direction: 'harmed' | 'benefited' | 'mixed' | 'unclear';
  directness: 'direct' | 'indirect' | null;
  relevance: string;
  rationale: string;
  /** The population it stands for: an assumption, never a count. Null when only the cast is known. */
  populationSize: number | null;
  refs: EvidenceRef[];
  supporting: number;
  contradicting: number;
  uncertainty: { level: 'low' | 'medium' | 'high'; reason: string };
  assumptions: string[];
  origin: StatementOrigin;
}

/** A stakeholder is a person's own unless the person never touched it: edited or added ones are theirs. */
export function stakeholderOrigin(stakeholder: Stakeholder): StatementOrigin {
  return stakeholder.origin === 'user' ||
    stakeholder.status === 'edited' ||
    stakeholder.status === 'added'
    ? 'user-assumption'
    : 'inferred-stakeholder';
}

const PRIORITY_ORDER = { key: 0, standard: 1, background: 2 } as const;

export function landscape(facts: Facts): LandscapeEntry[] {
  const entries: LandscapeEntry[] =
    facts.stakeholders.length > 0
      ? facts.stakeholders.map((stakeholder) => {
          const refs = facts.evidence.forStakeholder(stakeholder.id);
          return {
            id: stakeholder.id,
            name: stakeholder.name,
            category: stakeholder.category,
            priority: stakeholder.priority,
            direction: stakeholder.expectedImpact.direction,
            directness: stakeholder.directness,
            relevance: stakeholder.relevance || stakeholder.description,
            rationale: stakeholder.expectedImpact.rationale,
            populationSize: stakeholder.populationSize,
            refs,
            supporting: refs.filter((ref) => ref.role === 'supports').length,
            contradicting: refs.filter((ref) => ref.role === 'contradicts').length,
            uncertainty: stakeholder.uncertainty,
            assumptions: stakeholder.assumptions,
            origin: stakeholderOrigin(stakeholder),
          };
        })
      : facts.analysis.actors.map((actor) => {
          const refs = facts.evidence.forActor(actor);
          const direction = directionOf(actor);
          return {
            id: actor.stakeholderId,
            name: actor.name,
            category: actor.category,
            priority: actor.kind === 'key' ? ('key' as const) : ('standard' as const),
            direction: direction === 'neutral' ? ('unclear' as const) : direction,
            directness: null,
            relevance: actor.role,
            rationale: '',
            populationSize: actor.size,
            refs,
            supporting: refs.filter((ref) => ref.role === 'supports').length,
            contradicting: refs.filter((ref) => ref.role === 'contradicts').length,
            uncertainty: actor.uncertainty,
            assumptions: [],
            origin: 'inferred-stakeholder' as const,
          };
        });
  const categoryOrder = new Map(STAKEHOLDER_CATEGORIES.map((category, index) => [category, index]));
  return entries.sort(
    (a, b) =>
      (categoryOrder.get(a.category) ?? 0) - (categoryOrder.get(b.category) ?? 0) ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
      (a.id < b.id ? -1 : 1),
  );
}
