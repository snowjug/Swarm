import type { DecisionCanvas, DecisionPosition } from '../../../shared/decision.js';
import { RULES_FALLBACK_LABEL, withoutRulesUsed } from '../../../shared/model-failure.js';
import {
  STAKEHOLDER_CATEGORY_LABELS,
  type Actor,
  type Stakeholder,
  type StakeholderCategory,
  type StakeholderSet,
} from '../../../shared/stakeholders.js';
import { clip, humanize, oneLine } from './words.js';

/** How the participants were made: see `participantOrigin`. */
export type ParticipantOrigin = DecisionCanvas['actors']['origin'];

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

/** The note the first way of finding stakeholders left when a model could not be used and rules answered. */
const OLD_FALLBACK_NOTE = /could not be used|did not answer in time/u;

/**
 * How the list of participants was made, for the canvas to say beside the roles that came from it. A list
 * that rules made after the model was asked and could not be used is `rules-fallback`, with the failure in
 * the server’s own words, and is never read as the model’s; a list a model proposed says which model; a list
 * made by rules as asked, or by a person, says that. Where no list was recorded it says that.
 */
export function participantOrigin(set: StakeholderSet | null): ParticipantOrigin {
  if (!set) {
    return {
      source: 'unknown',
      label: 'Participants: where they came from was not recorded',
      detail:
        'No list of participants was recorded for this project, so the roles below were read from the simulated actors alone.',
    };
  }
  const { discovery, proposal } = set;
  if (discovery.mode === 'user') {
    return {
      source: 'user',
      label: 'Participants added by a person',
      detail: 'A person built this list. Swarm did not propose it.',
    };
  }
  if (discovery.mode === 'model') {
    return {
      source: 'model',
      label: 'Participants proposed by a model',
      detail: `${discovery.model ? `The model ${discovery.model}` : 'A model'} proposed them, and Swarm checked every quotation against the sources.`,
    };
  }
  const failure = proposal?.failure ?? null;
  if (failure || OLD_FALLBACK_NOTE.test(discovery.note)) {
    const what = failure ? withoutRulesUsed(failure.detail) : oneLine(discovery.note);
    return {
      source: 'rules-fallback',
      label: RULES_FALLBACK_LABEL,
      detail: clip(
        `${what} Swarm read the text for roles instead, so no model proposed these participants.`,
        400,
      ),
    };
  }
  return {
    source: 'rules',
    label: 'Participants read from the text by rules',
    detail:
      'No model was used: Swarm read the sources for role words and quoted the sentence for each.',
  };
}
