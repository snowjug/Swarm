import {
  STAKEHOLDER_CATEGORIES,
  type Actor,
  type Stakeholder,
  type StakeholderCategory,
  type StakeholderRelation,
  type StakeholderSet,
  type TraitKey,
} from '../../../../shared/stakeholders';

/** What the review screen does to a list of stakeholders. Each function returns a new list. */

export const MAX_STAKEHOLDERS = 40;
/** The most stakeholders one can have merged into it, as the contract allows. */
export const MAX_MERGED = 10;
const MAX_EVIDENCE = 8;
const PRIORITY_ORDER: Stakeholder['priority'][] = ['key', 'standard', 'background'];

export const isRemoved = (stakeholder: Stakeholder): boolean => stakeholder.status === 'removed';

export function liveStakeholders(stakeholders: readonly Stakeholder[]): Stakeholder[] {
  return stakeholders.filter((stakeholder) => !isRemoved(stakeholder));
}

/**
 * Stakeholders not removed, in the order a person reviews them: key actors, then standard cohorts,
 * then background ones, and by category and name within each. The order never depends on the review
 * status, so that a row does not move when it is accepted.
 */
export function orderForReview(stakeholders: readonly Stakeholder[]): Stakeholder[] {
  return liveStakeholders(stakeholders).sort(
    (a, b) =>
      PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
      STAKEHOLDER_CATEGORIES.indexOf(a.category) - STAKEHOLDER_CATEGORIES.indexOf(b.category) ||
      a.name.localeCompare(b.name),
  );
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

const firstSentence = (text: string): string =>
  /^[^.!?]*[.!?]?/u.exec(text.trim())?.[0].trim() ?? '';

/**
 * The one line that says why a stakeholder is on the list: what the person wrote or the model gave as
 * the reason it matters here, or, for a group found by reading the text, where it was found. The
 * category's generic wording is not offered as a reason, since it says nothing about this scenario.
 */
export function whyLine(stakeholder: Stakeholder): string {
  const relevance = stakeholder.relevance.trim();
  if (relevance && !/Category default/u.test(relevance)) return firstSentence(relevance);
  const description = firstSentence(stakeholder.description);
  if (description) return description;
  return stakeholder.origin === 'user'
    ? 'Added by you; no reason was given.'
    : 'No reason was given.';
}

/**
 * What the description says beyond the line that already opened the row, so that the opened row does
 * not say the same thing twice.
 */
export function describedFurther(stakeholder: Stakeholder): string {
  const description = stakeholder.description.trim();
  const relevance = stakeholder.relevance.trim();
  if (relevance && !/Category default/u.test(relevance)) return description;
  return description.slice(firstSentence(description).length).trim();
}

/** The four counts of the summary: how many were found, how many still need a person’s eye, how many are approved, and how many actors exist. */
export interface Summary {
  found: number;
  needReview: number;
  approved: number;
  actors: number;
}

export function summarise(
  set: StakeholderSet | null,
  actors: readonly Actor[] | null | undefined,
): Summary {
  const live = set ? liveStakeholders(set.stakeholders) : [];
  return {
    found: live.length,
    needReview: live.filter((stakeholder) => stakeholder.status === 'proposed').length,
    approved: set?.approvedAt ? live.length : 0,
    actors: actors?.length ?? 0,
  };
}

export type NextActionId =
  'review' | 'approval' | 'add' | 'approve' | 'make-actors' | 'review-actors';

export interface NextAction {
  id: NextActionId;
  label: string;
  /** The thing to do next, as opposed to a way to look at what is already done. */
  primary: boolean;
}

/**
 * The one thing to do next once there is a list, from where the person has got to: look at the
 * stakeholders no person has checked, approve the list, make the actors, then look at them. A person
 * who may not change anything is offered only the reading.
 */
export function nextAction(input: {
  set: StakeholderSet;
  actors: readonly Actor[] | null | undefined;
  may: { edit: boolean; run: boolean };
  /** How many of the actors the person has changed: approving keeps those instead of making them again. */
  editedActors?: number;
  /** Whether the list is open: it is being read, so the way on is the approval at the end of it. */
  listOpen?: boolean;
}): NextAction | null {
  const { set, actors, may } = input;
  const { found, needReview, actors: made } = summarise(set, actors);
  const allowed = may.edit && may.run;
  if (!set.approvedAt) {
    if (!may.edit) {
      return { id: 'review', label: `Read the ${count(found, 'stakeholder')}`, primary: false };
    }
    if (found < 2) return { id: 'add', label: 'Add a stakeholder', primary: true };
    if (needReview > 0) {
      if (input.listOpen && allowed) {
        return { id: 'approval', label: 'Go to approval', primary: false };
      }
      return { id: 'review', label: `Review ${count(needReview, 'stakeholder')}`, primary: true };
    }
    if (!allowed) return null;
    const keeps = (input.editedActors ?? 0) > 0;
    return {
      id: 'approve',
      label: keeps ? 'Approve stakeholders' : 'Approve and create actors',
      primary: true,
    };
  }
  if (made === 0) {
    return allowed ? { id: 'make-actors', label: 'Make the actors', primary: true } : null;
  }
  return {
    id: 'review-actors',
    label: made === 1 ? 'Review the actor' : `Review the ${made} actors`,
    primary: false,
  };
}

export function statusCounts(
  stakeholders: readonly Stakeholder[],
): Record<Stakeholder['status'], number> {
  const counts: Record<Stakeholder['status'], number> = {
    proposed: 0,
    accepted: 0,
    edited: 0,
    added: 0,
    removed: 0,
  };
  for (const stakeholder of stakeholders) counts[stakeholder.status] += 1;
  return counts;
}

export function replace(
  stakeholders: readonly Stakeholder[],
  id: string,
  change: (stakeholder: Stakeholder) => Stakeholder,
): Stakeholder[] {
  return stakeholders.map((stakeholder) =>
    stakeholder.id === id ? change(stakeholder) : stakeholder,
  );
}

/** Whether the person has reviewed anything, so that finding stakeholders again would lose it. */
export function isReviewed(set: StakeholderSet): boolean {
  return (
    set.approvedAt !== null ||
    set.stakeholders.some((stakeholder) => stakeholder.status !== 'proposed')
  );
}

/** Where a removed stakeholder goes back to when the person restores it. */
export function restoredStatus(stakeholder: Stakeholder): Stakeholder['status'] {
  return stakeholder.origin === 'user' ? 'added' : 'proposed';
}

const evidenceKey = (ref: Stakeholder['evidence'][number]): string =>
  `${ref.passageId}|${ref.quote ?? ''}`;

const mergeNote = (source: Stakeholder): string => `Merged with “${source.name}”.`.slice(0, 300);

/**
 * Merges one stakeholder into another: the first is kept, marked removed, and named by the second;
 * the second takes its evidence; relations that touched the first now touch the second. Nothing is
 * deleted, so the merge can be read back and undone.
 */
export function mergeStakeholders(
  stakeholders: readonly Stakeholder[],
  relations: readonly StakeholderRelation[],
  sourceId: string,
  targetId: string,
): { stakeholders: Stakeholder[]; relations: StakeholderRelation[] } {
  const source = stakeholders.find((stakeholder) => stakeholder.id === sourceId);
  if (!source || sourceId === targetId)
    return { stakeholders: [...stakeholders], relations: [...relations] };
  const merged = stakeholders.map((stakeholder): Stakeholder => {
    if (stakeholder.id === sourceId) return { ...stakeholder, status: 'removed' };
    if (stakeholder.id !== targetId) return stakeholder;
    const marks = new Set<string>();
    const evidence = [...stakeholder.evidence, ...source.evidence].filter((ref) => {
      const mark = evidenceKey(ref);
      if (marks.has(mark)) return false;
      marks.add(mark);
      return true;
    });
    return {
      ...stakeholder,
      mergedFrom: [...stakeholder.mergedFrom, sourceId],
      evidence: evidence.slice(0, MAX_EVIDENCE),
      assumptions: [...stakeholder.assumptions, mergeNote(source)].slice(-8),
    };
  });
  const seen = new Set<string>();
  const rewired: StakeholderRelation[] = [];
  for (const relation of relations) {
    const from = relation.from === sourceId ? targetId : relation.from;
    const to = relation.to === sourceId ? targetId : relation.to;
    const mark = `${from}|${to}|${relation.type}`;
    if (from === to || seen.has(mark)) continue;
    seen.add(mark);
    rewired.push({ ...relation, from, to });
  }
  return { stakeholders: merged, relations: rewired };
}

/** For each stakeholder that was merged into another, the one it went into. */
export function mergedIntoMap(stakeholders: readonly Stakeholder[]): Map<string, Stakeholder> {
  const into = new Map<string, Stakeholder>();
  for (const target of stakeholders) {
    for (const sourceId of target.mergedFrom) into.set(sourceId, target);
  }
  return into;
}

/**
 * Takes a merge back: the merged stakeholder returns, and the one it went into gives up the evidence
 * it took and the note of the merge. A passage that mentioned both goes back too, rather than stay
 * under a stakeholder it may not be about. Relations stay where the merge put them.
 */
export function undoMerge(stakeholders: readonly Stakeholder[], sourceId: string): Stakeholder[] {
  const source = stakeholders.find((stakeholder) => stakeholder.id === sourceId);
  if (!source) return [...stakeholders];
  const given = new Set(source.evidence.map(evidenceKey));
  return stakeholders.map((stakeholder): Stakeholder => {
    if (stakeholder.id === sourceId) return { ...stakeholder, status: restoredStatus(stakeholder) };
    if (!stakeholder.mergedFrom.includes(sourceId)) return stakeholder;
    return {
      ...stakeholder,
      mergedFrom: stakeholder.mergedFrom.filter((id) => id !== sourceId),
      evidence: stakeholder.evidence.filter((ref) => !given.has(evidenceKey(ref))),
      assumptions: stakeholder.assumptions.filter((note) => note !== mergeNote(source)),
    };
  });
}

/** The editable fields of a stakeholder, as the form holds them while the person types. */
export interface StakeholderDraft {
  name: string;
  category: StakeholderCategory;
  directness: Stakeholder['directness'];
  priority: Stakeholder['priority'];
  populationSize: string;
  description: string;
  relevance: string;
  impactDirection: Stakeholder['expectedImpact']['direction'];
  impactRationale: string;
  uncertaintyLevel: Stakeholder['uncertainty']['level'];
  uncertaintyReason: string;
}

export function draftOf(stakeholder: Stakeholder): StakeholderDraft {
  return {
    name: stakeholder.name,
    category: stakeholder.category,
    directness: stakeholder.directness,
    priority: stakeholder.priority,
    populationSize: String(stakeholder.populationSize),
    description: stakeholder.description,
    relevance: stakeholder.relevance,
    impactDirection: stakeholder.expectedImpact.direction,
    impactRationale: stakeholder.expectedImpact.rationale,
    uncertaintyLevel: stakeholder.uncertainty.level,
    uncertaintyReason: stakeholder.uncertainty.reason,
  };
}

export const EMPTY_DRAFT: StakeholderDraft = {
  name: '',
  category: 'other',
  directness: 'direct',
  priority: 'standard',
  populationSize: '100',
  description: '',
  relevance: '',
  impactDirection: 'unclear',
  impactRationale: '',
  uncertaintyLevel: 'high',
  uncertaintyReason: 'Added by hand; no evidence has been checked for it.',
};

export type DraftProblems = Partial<Record<keyof StakeholderDraft, string>>;

const LIMITS = { name: 120, description: 600, relevance: 600, rationale: 400, reason: 300 };

/** What is wrong with a draft, in a sentence per field; empty when it can be saved. */
export function draftProblems(draft: StakeholderDraft): DraftProblems {
  const problems: DraftProblems = {};
  if (draft.name.trim().length === 0) problems.name = 'Give the stakeholder a name.';
  else if (draft.name.trim().length > LIMITS.name) {
    problems.name = `Keep the name to ${LIMITS.name} characters.`;
  }
  const size = Number(draft.populationSize);
  if (!Number.isInteger(size) || size < 1 || size > 1_000_000) {
    problems.populationSize = 'Use a whole number from 1 to 1,000,000.';
  }
  if (draft.description.trim().length > LIMITS.description) {
    problems.description = `Keep this to ${LIMITS.description} characters.`;
  }
  if (draft.relevance.trim().length > LIMITS.relevance) {
    problems.relevance = `Keep this to ${LIMITS.relevance} characters.`;
  }
  if (draft.impactRationale.trim().length > LIMITS.rationale) {
    problems.impactRationale = `Keep this to ${LIMITS.rationale} characters.`;
  }
  if (draft.uncertaintyReason.trim().length > LIMITS.reason) {
    problems.uncertaintyReason = `Keep this to ${LIMITS.reason} characters.`;
  }
  return problems;
}

/** A stakeholder with a draft's fields written onto it. The server decides its status. */
export function applyDraft(stakeholder: Stakeholder, draft: StakeholderDraft): Stakeholder {
  return {
    ...stakeholder,
    name: draft.name.trim(),
    category: draft.category,
    directness: draft.directness,
    priority: draft.priority,
    populationSize: Number(draft.populationSize),
    description: draft.description.trim(),
    relevance: draft.relevance.trim(),
    expectedImpact: {
      direction: draft.impactDirection,
      rationale: draft.impactRationale.trim(),
      ...(stakeholder.expectedImpact.origin ? { origin: stakeholder.expectedImpact.origin } : {}),
    },
    uncertainty: { level: draft.uncertaintyLevel, reason: draft.uncertaintyReason.trim() },
  };
}

/** An id of lower-case letters, digits and hyphens that no other stakeholder has. */
export function freshId(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 40)
      .replace(/-+$/gu, '') || 'stakeholder';
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base.slice(0, 44)}-${n}`;
  return id;
}

/** A stakeholder the person adds: theirs, with no evidence, and said to be so. */
export function addedStakeholder(draft: StakeholderDraft, taken: readonly string[]): Stakeholder {
  return applyDraft(
    {
      id: freshId(draft.name, taken),
      name: '',
      category: draft.category,
      description: '',
      relevance: '',
      directness: draft.directness,
      priority: draft.priority,
      populationSize: 1,
      expectedImpact: { direction: 'unclear', rationale: '', origin: 'user' },
      evidence: [],
      assumptions: [],
      uncertainty: { level: 'high', reason: '' },
      origin: 'user',
      status: 'added',
      mergedFrom: [],
    },
    draft,
  );
}

// ---------------------------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------------------------

export const SIGNED_TRAITS: readonly TraitKey[] = ['priorStance', 'impact'];

export function traitRange(key: TraitKey): { min: number; max: number } {
  return SIGNED_TRAITS.includes(key) ? { min: -1, max: 1 } : { min: 0, max: 1 };
}

/** The value of a trait as the person sees it: two decimals, with a sign where the scale has one. */
export function traitText(key: TraitKey, value: number): string {
  const text = value.toFixed(2);
  return SIGNED_TRAITS.includes(key) && value > 0 ? `+${text}` : text;
}

/** An actor with one trait moved. The origin shown for it is the person's, until the server says so. */
export function moveTrait(actor: Actor, key: TraitKey, value: number): Actor {
  const rounded = Math.round(value * 100) / 100;
  return { ...actor, traits: { ...actor.traits, [key]: { ...actor.traits[key], value: rounded } } };
}

/** Which traits of a draft actor differ from the stored one, so that their origin reads as the person's. */
export function changedTraits(stored: Actor, draft: Actor): Set<TraitKey> {
  const changed = new Set<TraitKey>();
  for (const key of Object.keys(draft.traits) as TraitKey[]) {
    if (draft.traits[key].value !== stored.traits[key].value) changed.add(key);
  }
  return changed;
}

export function actorsDiffer(stored: readonly Actor[], draft: readonly Actor[]): boolean {
  return JSON.stringify(stored) !== JSON.stringify(draft);
}
