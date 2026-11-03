import { z } from 'zod';
import {
  DECISION_AUTHORITIES,
  INFLUENCE_LEVELS,
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_LABELS,
  PARTICIPANT_ROLE_MEANINGS,
  ROLE_CATEGORIES,
  STAKEHOLDER_CATEGORIES,
  participantOf,
  type ParticipantRole,
  type Stakeholder,
  type StakeholderRelation,
  type StakeholderSet,
} from '../../../../shared/stakeholders.js';
import { AppError } from '../../errors.js';
import { slugify, uniqueId } from '../names.js';
import { CATEGORY_PURPOSE } from '../priors.js';
import { PLACEHOLDER_SIZE } from '../rules.js';
import { mergeInto, rewireRelations } from './build.js';
import { compareNames, distinctLines, nameTokens, normaliseLine } from './language.js';
import { ROLE_DEFAULTS, withStandingClaims } from './taxonomy.js';

/**
 * What a person can do to a set of participants through the routes that are not a whole-list save. Each
 * function takes the set as stored and returns the list, and the relations, that the review of a
 * person's changes then checks (`applyReview`): so every rule about what can be changed, and by whom,
 * is the one rule that already stands, and none of these can add evidence or change who proposed what.
 */

const text = (max: number) => z.string().trim().max(max);
const lines = (max: number, each: number) => z.array(text(each).min(1)).max(max);

/** The fields of a participant that a person may change. Nothing else is accepted. */
export const participantChangesSchema = z
  .strictObject({
    name: text(120).min(1).optional(),
    participantRole: z.enum(PARTICIPANT_ROLES).optional(),
    category: z.enum(STAKEHOLDER_CATEGORIES).optional(),
    description: text(600).optional(),
    relevance: text(600).optional(),
    directness: z.enum(['direct', 'indirect']).optional(),
    priority: z.enum(['key', 'standard', 'background']).optional(),
    populationSize: z.int().min(1).max(1_000_000).optional(),
    impact: z
      .strictObject({
        direction: z.enum(['harmed', 'benefited', 'mixed', 'unclear']),
        rationale: text(400),
      })
      .optional(),
    uncertainty: z
      .strictObject({ level: z.enum(['low', 'medium', 'high']), reason: text(300) })
      .optional(),
    assumptions: lines(8, 300).optional(),
    objective: text(300).optional(),
    incentives: lines(6, 200).optional(),
    pressures: lines(6, 200).optional(),
    constraints: lines(6, 200).optional(),
    concerns: lines(6, 200).optional(),
    influence: z.enum(INFLUENCE_LEVELS).optional(),
    decisionAuthority: z.enum(DECISION_AUTHORITIES).optional(),
    informationAccess: lines(6, 200).optional(),
    plausibleActions: lines(8, 200).optional(),
    prohibitedClaims: lines(10, 200).optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, 'Say what to change.');
export type ParticipantChanges = z.output<typeof participantChangesSchema>;

const refuse = (status: number, code: string, message: string): AppError =>
  new AppError(status, code, message);

export function findParticipant(stakeholders: readonly Stakeholder[], id: string): Stakeholder {
  const found = stakeholders.find((item) => item.id === id);
  if (!found) {
    throw refuse(404, 'PARTICIPANT_NOT_FOUND', 'There is no such participant in the list.');
  }
  return found;
}

const replaceOne = (
  stakeholders: readonly Stakeholder[],
  id: string,
  change: (stakeholder: Stakeholder) => Stakeholder,
): Stakeholder[] =>
  stakeholders.map((stakeholder) => (stakeholder.id === id ? change(stakeholder) : stakeholder));

/** A participant with the person's changes written onto it. The review that follows decides its status and keeps the server's fields. */
export function applyChanges(stakeholder: Stakeholder, changes: ParticipantChanges): Stakeholder {
  if (stakeholder.status === 'removed') {
    throw refuse(409, 'PARTICIPANT_REMOVED', 'Restore the participant before changing it.');
  }
  const next: Stakeholder = { ...stakeholder };
  const role = changes.participantRole ?? participantOf(stakeholder).role;
  if (changes.name !== undefined) next.name = normaliseLine(changes.name, 120);
  if (changes.participantRole !== undefined) {
    next.participantRole = changes.participantRole;
    if (changes.category === undefined && !ROLE_CATEGORIES[role].includes(next.category)) {
      next.category = ROLE_CATEGORIES[role][0] ?? next.category;
    }
  }
  if (changes.category !== undefined) {
    if (!ROLE_CATEGORIES[role].includes(changes.category)) {
      throw refuse(
        400,
        'ROLE_CATEGORY_MISMATCH',
        `${PARTICIPANT_ROLE_LABELS[role]} does not go with that kind of party. Choose one that does, or change the role first.`,
      );
    }
    next.category = changes.category;
  }
  if (changes.description !== undefined) next.description = normaliseLine(changes.description, 600);
  if (changes.relevance !== undefined) next.relevance = normaliseLine(changes.relevance, 600);
  if (changes.directness !== undefined) next.directness = changes.directness;
  if (changes.priority !== undefined) next.priority = changes.priority;
  if (changes.populationSize !== undefined) next.populationSize = changes.populationSize;
  if (changes.impact !== undefined) {
    next.expectedImpact = {
      direction: changes.impact.direction,
      rationale: normaliseLine(changes.impact.rationale, 400),
      ...(stakeholder.expectedImpact.origin ? { origin: stakeholder.expectedImpact.origin } : {}),
    };
  }
  if (changes.uncertainty !== undefined) {
    next.uncertainty = {
      level: changes.uncertainty.level,
      reason: normaliseLine(changes.uncertainty.reason, 300),
    };
  }
  if (changes.assumptions !== undefined)
    next.assumptions = distinctLines(changes.assumptions, 8, 300);
  if (changes.objective !== undefined) next.objective = normaliseLine(changes.objective, 300);
  if (changes.incentives !== undefined) next.incentives = distinctLines(changes.incentives, 6, 200);
  if (changes.pressures !== undefined) next.pressures = distinctLines(changes.pressures, 6, 200);
  if (changes.constraints !== undefined)
    next.constraints = distinctLines(changes.constraints, 6, 200);
  if (changes.concerns !== undefined) next.concerns = distinctLines(changes.concerns, 6, 200);
  if (changes.influence !== undefined) next.influence = changes.influence;
  if (changes.decisionAuthority !== undefined) next.decisionAuthority = changes.decisionAuthority;
  if (changes.informationAccess !== undefined) {
    next.informationAccess = distinctLines(changes.informationAccess, 6, 200);
  }
  if (changes.plausibleActions !== undefined) {
    next.plausibleActions = distinctLines(changes.plausibleActions, 8, 200);
  }
  if (changes.prohibitedClaims !== undefined) {
    next.prohibitedClaims = withStandingClaims(role, changes.prohibitedClaims);
  }
  return next;
}

export const editedList = (
  set: StakeholderSet,
  id: string,
  changes: ParticipantChanges,
): Stakeholder[] => {
  findParticipant(set.stakeholders, id);
  return replaceOne(set.stakeholders, id, (stakeholder) => applyChanges(stakeholder, changes));
};

export const removedList = (set: StakeholderSet, id: string): Stakeholder[] => {
  const target = findParticipant(set.stakeholders, id);
  if (target.status === 'removed') {
    throw refuse(409, 'PARTICIPANT_REMOVED', 'That participant is already removed.');
  }
  return replaceOne(set.stakeholders, id, (stakeholder) => ({ ...stakeholder, status: 'removed' }));
};

/** Accepts the participants named, or every one still only proposed. Naming one that is not in the list is refused. */
export function acceptedList(set: StakeholderSet, ids: readonly string[] | null): Stakeholder[] {
  const wanted = ids === null ? null : new Set(ids);
  if (wanted) {
    for (const id of wanted) {
      const found = set.stakeholders.find((item) => item.id === id);
      if (!found || found.status === 'removed') {
        throw refuse(
          404,
          'PARTICIPANT_NOT_FOUND',
          'One of the participants named is not in the list.',
        );
      }
    }
  }
  return set.stakeholders.map((stakeholder) =>
    stakeholder.status === 'proposed' && (wanted === null || wanted.has(stakeholder.id))
      ? { ...stakeholder, status: 'accepted' }
      : stakeholder,
  );
}

const PRIORITY = ['key', 'standard', 'background'] as const;

/** Groups of live participants that are certainly one: the same words in the name. The one with the most behind it is kept. */
export function duplicateGroups(set: StakeholderSet): { keep: string; merge: string[] }[] {
  const live = set.stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');
  const groups: Stakeholder[][] = [];
  for (const stakeholder of live) {
    const group = groups.find(
      (members) => compareNames(members[0]!.name, stakeholder.name) === 'same',
    );
    if (group) group.push(stakeholder);
    else groups.push([stakeholder]);
  }
  return groups
    .filter((members) => members.length > 1)
    .map((members) => {
      const [keeper, ...rest] = [...members].sort(
        (a, b) =>
          b.evidence.length - a.evidence.length ||
          PRIORITY.indexOf(a.priority) - PRIORITY.indexOf(b.priority),
      );
      return { keep: keeper!.id, merge: rest.map((member) => member.id) };
    });
}

/** The list and relations after the groups are merged: each merged participant stays, removed, and named by the one it went into. */
export function mergedLists(
  set: StakeholderSet,
  groups: readonly { keep: string; merge: readonly string[] }[],
): { stakeholders: Stakeholder[]; relations: StakeholderRelation[] } {
  const into = new Map<string, string>();
  let stakeholders = [...set.stakeholders];
  const named = groups.flatMap((group) => [group.keep, ...group.merge]);
  if (new Set(named).size !== named.length) {
    throw refuse(400, 'MERGE_INVALID', 'A participant can be in only one merge, and only once.');
  }
  for (const group of groups) {
    for (const id of [group.keep, ...group.merge]) {
      if (findParticipant(stakeholders, id).status === 'removed') {
        throw refuse(409, 'PARTICIPANT_REMOVED', 'A participant that is removed cannot be merged.');
      }
    }
    if (group.merge.length === 0 || group.merge.includes(group.keep)) {
      throw refuse(
        400,
        'MERGE_INVALID',
        'A merge names the participants to merge into the one kept, and not that one itself.',
      );
    }
    const keeper = findParticipant(stakeholders, group.keep);
    if (keeper.mergedFrom.length + group.merge.length > 10) {
      throw refuse(400, 'MERGE_INVALID', 'A participant can take in at most ten others.');
    }
    const folded = mergeInto(
      keeper,
      group.merge.map((id) => findParticipant(stakeholders, id)),
    );
    const replaced = new Map(
      [folded.keeper, ...folded.removed].map((stakeholder) => [stakeholder.id, stakeholder]),
    );
    stakeholders = stakeholders.map((stakeholder) => replaced.get(stakeholder.id) ?? stakeholder);
    for (const other of folded.removed) into.set(other.id, keeper.id);
  }
  return { stakeholders, relations: rewireRelations(set.relations, into) };
}

export const addMissingSchema = z
  .strictObject({
    role: z.enum(PARTICIPANT_ROLES),
    name: text(120).min(3),
    whyTheyMatter: text(600).optional(),
    objective: text(300).optional(),
  })
  .strict();
export type AddMissingInput = z.output<typeof addMissingSchema>;

/**
 * A participant a person adds to cover a role nobody holds: theirs, with no evidence, said to be an
 * assumption, and started from the defaults of its role so that the person only has to say who it is.
 */
export function missingParticipant(set: StakeholderSet, input: AddMissingInput): Stakeholder {
  const role: ParticipantRole = input.role;
  const defaults = ROLE_DEFAULTS[role];
  const category = ROLE_CATEGORIES[role][0] ?? 'other';
  const name = normaliseLine(input.name, 120);
  if (nameTokens(name).length === 0) {
    throw refuse(
      400,
      'PARTICIPANT_NAME_REQUIRED',
      'Name the participant by the role it plays here.',
    );
  }
  const priority = role === 'decision-owner' ? 'key' : 'standard';
  const used = new Set(set.stakeholders.map((stakeholder) => stakeholder.id));
  return {
    id: uniqueId(slugify(name), used),
    name,
    category,
    description: '',
    relevance: normaliseLine(
      input.whyTheyMatter ??
        `Added by you for the role of ${PARTICIPANT_ROLE_LABELS[role].toLowerCase()}. ${PARTICIPANT_ROLE_MEANINGS[role]}`,
      600,
    ),
    directness: defaults.directness,
    priority,
    populationSize: PLACEHOLDER_SIZE[priority],
    expectedImpact: { direction: 'unclear', rationale: 'Set by you.', origin: 'user' },
    evidence: [],
    assumptions: ['Added by you to cover a role nobody held; no passage is quoted for it.'],
    uncertainty: { level: 'high', reason: 'Added by you; no evidence has been checked for it.' },
    origin: 'user',
    status: 'added',
    mergedFrom: [],
    participantRole: role,
    objective: normaliseLine(input.objective ?? CATEGORY_PURPOSE[category], 300),
    incentives: [],
    pressures: [],
    constraints: [],
    concerns: [],
    influence: defaults.influence,
    decisionAuthority: defaults.decisionAuthority,
    informationAccess: defaults.informationAccess,
    plausibleActions: defaults.plausibleActions,
    prohibitedClaims: withStandingClaims(role, []),
    confidenceBasis: 'user-assertion',
    synthetic: true,
  };
}
