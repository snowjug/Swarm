import {
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_LABELS,
  PARTICIPANT_ROLE_MEANINGS,
  ROLE_CATEGORIES,
  participantOf,
  type DecisionAuthority,
  type InfluenceLevel,
  type ParticipantIssue,
  type ParticipantReview,
  type ParticipantRole,
  type RoleCoverage,
  type Stakeholder,
  type StakeholderCategory,
} from '../../../../../shared/stakeholders';
import type { ParticipantChanges } from '../../../api/participants';
import { orderForReview, whyLine } from '../../../lib/stakeholders/review';

/** What the review surface works out from the list and its checks. Nothing here touches the page or the server. */

const PRIORITY = ['key', 'standard', 'background'] as const;

export interface RoleGroup {
  role: ParticipantRole;
  label: string;
  meaning: string;
  members: Stakeholder[];
}

/** The live participants in the order of the roles, a person's review order within each. Roles nobody holds are left out. */
export function groupByRole(stakeholders: readonly Stakeholder[]): RoleGroup[] {
  const ordered = orderForReview(stakeholders);
  return PARTICIPANT_ROLES.flatMap((role) => {
    const members = ordered.filter((stakeholder) => participantOf(stakeholder).role === role);
    return members.length > 0
      ? [
          {
            role,
            label: PARTICIPANT_ROLE_LABELS[role],
            meaning: PARTICIPANT_ROLE_MEANINGS[role],
            members,
          },
        ]
      : [];
  });
}

export interface IssueIndex {
  /** Issues about one participant, blocking first. */
  byParticipant: Map<string, ParticipantIssue[]>;
  /** Issues about the whole list, or about a role nobody holds. */
  general: ParticipantIssue[];
}

const bySeverity = (a: ParticipantIssue, b: ParticipantIssue): number =>
  Number(b.severity === 'blocking') - Number(a.severity === 'blocking');

export function indexIssues(issues: readonly ParticipantIssue[]): IssueIndex {
  const byParticipant = new Map<string, ParticipantIssue[]>();
  const general: ParticipantIssue[] = [];
  for (const issue of [...issues].sort(bySeverity)) {
    if (issue.participantId === null) {
      general.push(issue);
      continue;
    }
    const held = byParticipant.get(issue.participantId);
    if (held) held.push(issue);
    else byParticipant.set(issue.participantId, [issue]);
  }
  return { byParticipant, general };
}

export const blockingOf = (issues: readonly ParticipantIssue[]): ParticipantIssue[] =>
  issues.filter((issue) => issue.severity === 'blocking');

const things = (n: number): string => `${n} ${n === 1 ? 'thing' : 'things'}`;

export interface Gate {
  /** Whether the list may be used: nothing blocking remains. A list with no checks to read is not held back here. */
  open: boolean;
  blocking: number;
  advisory: number;
  /** Why it is shut, in a few words a button can carry. */
  hint: string | undefined;
}

export function gateOf(review: ParticipantReview | null | undefined): Gate {
  if (!review) return { open: true, blocking: 0, advisory: 0, hint: undefined };
  const { blocking, advisory } = review.counts;
  return {
    open: review.valid,
    blocking,
    advisory,
    hint: review.valid ? undefined : `Fix ${things(Math.max(blocking, 1))} first`,
  };
}

/** The participants a bulk accept would change: the ones still only proposed. */
export const proposedIds = (stakeholders: readonly Stakeholder[]): string[] =>
  stakeholders.filter((item) => item.status === 'proposed').map((item) => item.id);

/** What a person selected, kept to the participants that are still in the list and still only proposed. */
export function selectionOf(
  selected: ReadonlySet<string>,
  stakeholders: readonly Stakeholder[],
): ReadonlySet<string> {
  const open = new Set(proposedIds(stakeholders));
  return new Set([...selected].filter((id) => open.has(id)));
}

export function toggled(selected: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Why a participant is on the list, as its card says it: the reason in full, which for a participant found by reading
 * the text includes the passage it cites. A reason that is only the category's own wording says nothing about this
 * scenario and is not offered as one.
 */
export function reasonOf(stakeholder: Stakeholder): string {
  const relevance = stakeholder.relevance.trim();
  return relevance && !/Category default/u.test(relevance) ? relevance : whyLine(stakeholder);
}

export interface FactGroup {
  key: string;
  label: string;
  items: string[];
}

/** What a participant holds about itself, as the card lists it: nothing empty, and the objective first. */
export function factsOf(stakeholder: Stakeholder): FactGroup[] {
  const view = participantOf(stakeholder);
  const groups: FactGroup[] = [
    { key: 'objective', label: 'Objective', items: view.objective ? [view.objective] : [] },
    { key: 'incentives', label: 'Incentives', items: view.incentives },
    { key: 'pressures', label: 'Pressures', items: view.pressures },
    { key: 'constraints', label: 'Constraints', items: view.constraints },
    { key: 'concerns', label: 'Concerns', items: view.concerns },
    { key: 'information', label: 'What it can see', items: view.informationAccess },
    { key: 'actions', label: 'What it could do', items: view.plausibleActions },
    { key: 'prohibited', label: 'Never asserted about it', items: view.prohibitedClaims },
  ];
  return groups.filter((group) => group.items.length > 0);
}

export interface CoverageSplit {
  covered: RoleCoverage[];
  missing: RoleCoverage[];
  /** Roles nobody holds that nothing says are needed here; a person may still add one. */
  optional: RoleCoverage[];
}

export function splitCoverage(coverage: readonly RoleCoverage[]): CoverageSplit {
  return {
    covered: coverage.filter((item) => item.status === 'covered'),
    missing: coverage.filter((item) => item.status === 'missing'),
    optional: coverage.filter((item) => item.status === 'optional'),
  };
}

/** The group a person asked to merge: the participant and what it looks like, the one with most behind it kept. */
export function mergeGroupOf(
  issue: Pick<ParticipantIssue, 'participantId' | 'relatedIds'>,
  stakeholders: readonly Stakeholder[],
): { keep: string; merge: string[] } | null {
  const ids = [issue.participantId, ...issue.relatedIds].filter((id): id is string => id !== null);
  const members = [...new Set(ids)].flatMap((id) => {
    const found = stakeholders.find((item) => item.id === id && item.status !== 'removed');
    return found ? [found] : [];
  });
  if (members.length < 2) return null;
  const [keeper, ...rest] = [...members].sort(
    (a, b) =>
      b.evidence.length - a.evidence.length ||
      PRIORITY.indexOf(a.priority) - PRIORITY.indexOf(b.priority),
  );
  return keeper ? { keep: keeper.id, merge: rest.map((item) => item.id).slice(0, 10) } : null;
}

export const FIX_LABELS: Record<NonNullable<ParticipantIssue['fixAction']>, string> = {
  rename: 'Rename',
  edit: 'Edit',
  remove: 'Remove',
  merge: 'Merge',
  'add-missing': 'Add one',
  regenerate: 'Propose again',
};

/** What a button that mends an issue is called: the action and what it is done to, so that a list of them is not a list of "Rename". */
export function fixName(issue: ParticipantIssue, who?: string): string {
  if (!issue.fixAction) return '';
  const action = FIX_LABELS[issue.fixAction];
  if (who) return `${action}: ${who}`;
  if (issue.role) return `${action}: ${PARTICIPANT_ROLE_LABELS[issue.role].toLowerCase()}`;
  return action;
}

/**
 * A sentence runs up to a full stop followed by a capital, so that the summary can be read a line at a time. A stop
 * inside a quotation does not end one: the summary quotes the person's own decision, which may hold several.
 */
export function sentencesOf(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  let quoted = false;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at] ?? '';
    if (char === '\u201c') quoted = true;
    else if (char === '\u201d') quoted = false;
    else if (
      !quoted &&
      /[.?!]/u.test(char) &&
      /\s/u.test(text[at + 1] ?? '') &&
      /^[A-Z\u201c"]/u.test(text.slice(at + 1).trimStart())
    ) {
      sentences.push(text.slice(start, at + 1).trim());
      start = at + 1;
    }
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences.filter(Boolean);
}

export const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------------------------
// Changing a participant
// ---------------------------------------------------------------------------------------------

type ListKey =
  | 'incentives'
  | 'pressures'
  | 'constraints'
  | 'concerns'
  | 'informationAccess'
  | 'plausibleActions'
  | 'prohibitedClaims';

/** What the editor holds: the lists are one item to a line, as a person writes them. */
export interface ParticipantDraft extends Record<ListKey, string> {
  name: string;
  role: ParticipantRole;
  category: StakeholderCategory;
  relevance: string;
  objective: string;
  influence: InfluenceLevel;
  authority: DecisionAuthority;
  directness: Stakeholder['directness'];
  priority: Stakeholder['priority'];
  impactDirection: Stakeholder['expectedImpact']['direction'];
  impactRationale: string;
  uncertaintyLevel: Stakeholder['uncertainty']['level'];
  uncertaintyReason: string;
  populationSize: string;
}

export const linesOf = (text: string): string[] =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

const asText = (lines: readonly string[]): string => lines.join('\n');

export function participantDraftOf(stakeholder: Stakeholder): ParticipantDraft {
  const view = participantOf(stakeholder);
  return {
    name: stakeholder.name,
    role: view.role,
    category: stakeholder.category,
    relevance: stakeholder.relevance,
    objective: view.objective,
    incentives: asText(view.incentives),
    pressures: asText(view.pressures),
    constraints: asText(view.constraints),
    concerns: asText(view.concerns),
    informationAccess: asText(view.informationAccess),
    plausibleActions: asText(view.plausibleActions),
    prohibitedClaims: asText(view.prohibitedClaims),
    influence: view.influence,
    authority: view.decisionAuthority,
    directness: stakeholder.directness,
    priority: stakeholder.priority,
    impactDirection: stakeholder.expectedImpact.direction,
    impactRationale: stakeholder.expectedImpact.rationale,
    uncertaintyLevel: stakeholder.uncertainty.level,
    uncertaintyReason: stakeholder.uncertainty.reason,
    populationSize: String(stakeholder.populationSize),
  };
}

/** The kinds of party a role may take, so that the editor offers only what the server accepts. */
export const categoriesOf = (role: ParticipantRole): readonly StakeholderCategory[] =>
  ROLE_CATEGORIES[role];

/** The draft with its role changed: the kind of party follows, when the old one does not go with the new role. */
export function withRole(draft: ParticipantDraft, role: ParticipantRole): ParticipantDraft {
  const allowed = ROLE_CATEGORIES[role];
  return {
    ...draft,
    role,
    category: allowed.includes(draft.category) ? draft.category : (allowed[0] ?? draft.category),
  };
}

export type DraftProblems = Partial<Record<keyof ParticipantDraft, string>>;

const LIST_LIMITS: readonly [ListKey, string, number][] = [
  ['incentives', 'Incentives', 6],
  ['pressures', 'Pressures', 6],
  ['constraints', 'Constraints', 6],
  ['concerns', 'Concerns', 6],
  ['informationAccess', 'What it can see', 6],
  ['plausibleActions', 'What it could do', 8],
  ['prohibitedClaims', 'Never asserted', 10],
];

/** What is wrong with a draft before it is sent, in the person's words; the server checks all of it again. */
export function participantDraftProblems(draft: ParticipantDraft): DraftProblems {
  const problems: DraftProblems = {};
  if (draft.name.trim() === '') problems.name = 'Name the role this participant plays.';
  else if (draft.name.trim().length > 120) problems.name = 'Keep the name to 120 characters.';
  if (draft.relevance.trim().length > 600) problems.relevance = 'Keep this to 600 characters.';
  if (draft.objective.trim().length > 300) problems.objective = 'Keep this to 300 characters.';
  if (draft.impactRationale.trim().length > 400)
    problems.impactRationale = 'Keep this to 400 characters.';
  if (draft.uncertaintyReason.trim().length > 300)
    problems.uncertaintyReason = 'Keep this to 300 characters.';
  for (const [key, label, max] of LIST_LIMITS) {
    const lines = linesOf(draft[key]);
    if (lines.length > max) problems[key] = `${label}: at most ${max}, one to a line.`;
    else if (lines.some((line) => line.length > 200))
      problems[key] = `${label}: keep each line to 200 characters.`;
  }
  const size = draft.populationSize.trim();
  if (!/^\d+$/u.test(size) || Number(size) < 1 || Number(size) > 1_000_000)
    problems.populationSize = 'Use a whole number from 1 to 1,000,000.';
  return problems;
}

const sameLines = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((line, index) => line === b[index]);

/** Only what the person changed, so that nothing they did not touch is sent or counted as theirs. */
export function changesBetween(original: Stakeholder, draft: ParticipantDraft): ParticipantChanges {
  const was = participantOf(original);
  const changes: ParticipantChanges = {};
  const name = draft.name.trim();
  if (name !== original.name) changes.name = name;
  if (draft.role !== was.role) changes.participantRole = draft.role;
  if (draft.category !== original.category) changes.category = draft.category;
  if (draft.relevance.trim() !== original.relevance) changes.relevance = draft.relevance.trim();
  if (draft.objective.trim() !== was.objective) changes.objective = draft.objective.trim();
  const lists: readonly [ListKey, readonly string[]][] = [
    ['incentives', was.incentives],
    ['pressures', was.pressures],
    ['constraints', was.constraints],
    ['concerns', was.concerns],
    ['informationAccess', was.informationAccess],
    ['plausibleActions', was.plausibleActions],
    ['prohibitedClaims', was.prohibitedClaims],
  ];
  for (const [key, before] of lists) {
    const now = linesOf(draft[key]);
    if (!sameLines(now, before)) changes[key] = now;
  }
  if (draft.influence !== was.influence) changes.influence = draft.influence;
  if (draft.authority !== was.decisionAuthority) changes.decisionAuthority = draft.authority;
  if (draft.directness !== original.directness) changes.directness = draft.directness;
  if (draft.priority !== original.priority) changes.priority = draft.priority;
  if (
    draft.impactDirection !== original.expectedImpact.direction ||
    draft.impactRationale.trim() !== original.expectedImpact.rationale
  ) {
    changes.impact = {
      direction: draft.impactDirection,
      rationale: draft.impactRationale.trim(),
    };
  }
  if (
    draft.uncertaintyLevel !== original.uncertainty.level ||
    draft.uncertaintyReason.trim() !== original.uncertainty.reason
  ) {
    changes.uncertainty = {
      level: draft.uncertaintyLevel,
      reason: draft.uncertaintyReason.trim(),
    };
  }
  const size = Number(draft.populationSize);
  if (size !== original.populationSize) changes.populationSize = size;
  return changes;
}

export const hasChanges = (changes: ParticipantChanges): boolean => Object.keys(changes).length > 0;

// ---------------------------------------------------------------------------------------------
// Adding a participant for a role nobody holds
// ---------------------------------------------------------------------------------------------

export interface MissingDraft {
  role: ParticipantRole;
  name: string;
  whyTheyMatter: string;
  objective: string;
}

export const emptyMissing = (role: ParticipantRole): MissingDraft => ({
  role,
  name: '',
  whyTheyMatter: '',
  objective: '',
});

export type MissingProblems = Partial<Record<keyof MissingDraft, string>>;

export function missingProblems(draft: MissingDraft): MissingProblems {
  const problems: MissingProblems = {};
  const name = draft.name.trim();
  if (name.length < 3) problems.name = 'Name the role by what it does here, in a few words.';
  else if (name.length > 120) problems.name = 'Keep the name to 120 characters.';
  if (draft.whyTheyMatter.trim().length > 600)
    problems.whyTheyMatter = 'Keep this to 600 characters.';
  if (draft.objective.trim().length > 300) problems.objective = 'Keep this to 300 characters.';
  return problems;
}

export function missingInput(draft: MissingDraft): {
  role: ParticipantRole;
  name: string;
  whyTheyMatter?: string;
  objective?: string;
} {
  const why = draft.whyTheyMatter.trim();
  const objective = draft.objective.trim();
  return {
    role: draft.role,
    name: draft.name.trim(),
    ...(why ? { whyTheyMatter: why } : {}),
    ...(objective ? { objective } : {}),
  };
}
