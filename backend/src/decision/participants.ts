import type { DecisionPosition } from '../../../shared/decision.js';
import {
  STAKEHOLDER_CATEGORY_LABELS,
  type Actor,
  type Stakeholder,
  type StakeholderCategory,
} from '../../../shared/stakeholders.js';
import { clip, humanize, oneLine } from './words.js';

/**
 * What the canvas reads of a participant. A stakeholder set made by the participant proposal carries a
 * role, an influence level, what the participant can do about the decision, what it could plausibly do
 * and a mark that it is synthetic; a set saved before that carries none of them. Every field is read as
 * if it might be missing or might be anything, and a missing one is filled from what the category and
 * the actor’s own traits say, so that the canvas reads the same before and after the proposal exists.
 * Nothing here describes a real person: a participant is a role Swarm models.
 */

export type InfluenceLevel = 'low' | 'medium' | 'high';

export interface ParticipantReading {
  /** The role in words: the participant role when there is one, else what the actor says it is, else its category. */
  role: string;
  roleId: string | null;
  influence: InfluenceLevel;
  position: DecisionPosition;
  plausibleActions: string[];
  /** Whether the stakeholder carried participant fields at all. */
  proposed: boolean;
}

const POSITIONS: ReadonlySet<string> = new Set([
  'decides',
  'approves',
  'can-block',
  'advises',
  'none',
]);
const LEVELS: ReadonlySet<string> = new Set(['low', 'medium', 'high']);

/** What each category can do about a decision when nothing says. */
const POSITION_BY_CATEGORY: Readonly<Record<StakeholderCategory, DecisionPosition>> = {
  'decision-maker': 'decides',
  governance: 'approves',
  regulator: 'can-block',
  influencer: 'advises',
  'end-user': 'none',
  'cost-bearer': 'none',
  'risk-bearer': 'none',
  beneficiary: 'none',
  competitor: 'none',
  substitute: 'none',
  partner: 'none',
  channel: 'none',
  operations: 'none',
  other: 'none',
};

const ROLE_WORDS: Readonly<Record<string, string>> = {
  'decision-owner': 'Decision owner',
  'directly-affected': 'Directly affected',
  'indirectly-affected': 'Indirectly affected',
  implementers: 'Implementers',
  approvers: 'Approvers',
  beneficiaries: 'Beneficiaries',
  'opponents-resistors': 'Opponents and resistors',
  'regulators-governance': 'Regulators and governance',
  'customers-users': 'Customers and users',
  'partners-suppliers': 'Partners and suppliers',
  'competitors-alternatives': 'Competitors and alternatives',
  'system-environment': 'System and environment',
  'observers-influencers': 'Observers and influencers',
  'missing-voices': 'Missing voices',
};

const stringOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? oneLine(value) : null;

/** The level an actor’s own influence trait stands for. */
export function influenceLevelOf(value: number): InfluenceLevel {
  return value >= 0.66 ? 'high' : value >= 0.33 ? 'medium' : 'low';
}

export function participantFor(
  actor: Actor,
  stakeholder: Stakeholder | undefined,
): ParticipantReading {
  const fields: Record<string, unknown> =
    stakeholder && typeof stakeholder === 'object'
      ? (stakeholder as unknown as Record<string, unknown>)
      : {};
  const roleId = stringOf(fields.participantRole);
  const level = stringOf(fields.influence);
  const position = stringOf(fields.decisionAuthority);
  const actions = Array.isArray(fields.plausibleActions)
    ? fields.plausibleActions
        .map(stringOf)
        .filter((entry): entry is string => entry !== null)
        .slice(0, 3)
        .map((entry) => clip(entry, 200))
    : [];
  const actorRole = stringOf(actor.role);
  return {
    role: clip(
      roleId
        ? (ROLE_WORDS[roleId] ?? humanize(roleId))
        : (actorRole ?? STAKEHOLDER_CATEGORY_LABELS[actor.category]),
      120,
    ),
    roleId,
    influence:
      level && LEVELS.has(level)
        ? (level as InfluenceLevel)
        : influenceLevelOf(actor.traits.influence.value),
    position:
      position && POSITIONS.has(position)
        ? (position as DecisionPosition)
        : POSITION_BY_CATEGORY[actor.category],
    plausibleActions: actions,
    proposed: roleId !== null || level !== null || position !== null || actions.length > 0,
  };
}

/** Every actor’s reading, by actor id. An actor whose stakeholder is gone is read from its own fields. */
export function participantsOf(
  actors: readonly Actor[],
  stakeholders: readonly Stakeholder[],
): Map<string, ParticipantReading> {
  const byId = new Map(stakeholders.map((stakeholder) => [stakeholder.id, stakeholder]));
  return new Map(
    actors.map((actor) => [actor.id, participantFor(actor, byId.get(actor.stakeholderId))]),
  );
}
