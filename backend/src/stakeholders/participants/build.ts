import type { EvidenceRef } from '../../../../shared/evidence.js';
import {
  CONFIDENCE_BASIS_MEANINGS,
  MAX_PROPOSED_KEY,
  MAX_PROPOSED_LIVE,
  PARTICIPANT_ROLES,
  PROPOSAL_VERSION,
  ROLE_CATEGORIES,
  participantOf,
  stakeholderSchema,
  stakeholderSetSchema,
  type ConfidenceBasis,
  type ProposedParticipant,
  type ProposedParticipants,
  type Stakeholder,
  type StakeholderRelation,
  type StakeholderSet,
  type UncertaintyLevel,
} from '../../../../shared/stakeholders.js';
import type { TaskFailure } from '../../models/task.js';
import { uniqueEvidence, verifiedEvidence } from '../evidence.js';
import { plural, slugify, truncate, uniqueId } from '../names.js';
import { categoryGaps, deriveRelations } from '../relations.js';
import { PLACEHOLDER_SIZE } from '../rules.js';
import { countDirections, describeDirections } from '../tone.js';
import type { ProposalContext } from './context.js';
import type { ProposalSide } from './fallback.js';
import { capitalise } from '../names.js';
import { distinctLines, nameTokens, normaliseLine } from './language.js';
import { ROLE_DEFAULTS, roleGapReason, withStandingClaims } from './taxonomy.js';
import { coverageOf, reviewContext } from './validate.js';

/** The most participants of one role a proposal keeps, so that no one view fills the list. */
export const MAX_PER_ROLE = 6;
/**
 * What reading the text for roles keeps: a group named once, in passing, is rarely what a decision
 * turns on, and a list that cannot be reviewed in one sitting is not reviewed. A model may propose more.
 */
export const MAX_RULES_PARTICIPANTS = 16;
const MAX_EVIDENCE = 8;
const NOTE_LIMIT = 500;

const PRIORITY_ORDER = ['key', 'standard', 'background'] as const;
const LEVELS: readonly UncertaintyLevel[] = ['low', 'medium', 'high'];
const higher = (a: UncertaintyLevel, b: UncertaintyLevel): UncertaintyLevel =>
  LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;

const nameKey = (name: string): string => [...new Set(nameTokens(name))].sort().join(' ');

export interface BuildInput {
  proposal: ProposedParticipants;
  context: ProposalContext;
  source: 'rules' | 'model';
  modelName: string | null;
  failure: TaskFailure | null;
  side: ProposalSide;
  /** The set this one replaces, so that a participant that is found again keeps its id. */
  existing: StakeholderSet | null;
  now: Date;
}

export interface Stats {
  quotesKept: number;
  quotesShortened: number;
  quotesDropped: number;
  unsourcedDropped: number;
}

export const newStats = (): Stats => ({
  quotesKept: 0,
  quotesShortened: 0,
  quotesDropped: 0,
  unsourcedDropped: 0,
});

function modelUncertainty(
  participant: ProposedParticipant,
  evidence: readonly EvidenceRef[],
  basis: ConfidenceBasis,
): Stakeholder['uncertainty'] {
  const said = normaliseLine(participant.uncertainty.reason, 200);
  if (evidence.length === 0) {
    return {
      level: 'high',
      reason: truncate(
        `No passage is quoted for this participant. ${CONFIDENCE_BASIS_MEANINGS[basis]} ${said}`,
        300,
      ),
    };
  }
  const passages = new Set(evidence.map((ref) => ref.passageId)).size;
  const derived: UncertaintyLevel =
    evidence.length >= 3 && passages >= 2 ? 'low' : evidence.length >= 2 ? 'medium' : 'high';
  return {
    level: higher(derived, participant.uncertainty.level),
    reason: truncate(
      `${plural(evidence.length, 'quoted passage')} name or describe this participant. That supports that the group is in the evidence, not what it wants or how it might react. ${said}`,
      300,
    ),
  };
}

/** One participant as the set holds it: quotes checked, text cleaned, defaults and standing prohibitions in place. Null when it cannot be held. */
export function buildParticipant(
  participant: ProposedParticipant,
  input: Pick<BuildInput, 'source' | 'side'>,
  byPassage: ReadonlyMap<string, ProposalContext['passages'][number]>,
  stats: Stats,
  id: string,
): Stakeholder | null {
  const legacy = input.source === 'rules' ? input.side.legacy.get(participant.id) : undefined;
  const refs: EvidenceRef[] = [];
  if (legacy) {
    refs.push(...legacy.evidence);
  } else {
    for (const item of participant.evidence) {
      const verified = verifiedEvidence(byPassage, item.passageId, item.quote);
      if (!verified) {
        stats.quotesDropped += 1;
        continue;
      }
      stats.quotesKept += 1;
      if (verified.shortened) stats.quotesShortened += 1;
      refs.push(verified.ref);
    }
  }
  const evidence = uniqueEvidence(refs, MAX_EVIDENCE);
  const model = input.source === 'model';
  const basis: ConfidenceBasis =
    evidence.length > 0
      ? 'source-quote'
      : participant.confidenceBasis === 'source-quote'
        ? model
          ? 'model-inference'
          : 'category-pattern'
        : participant.confidenceBasis;
  const role = participant.role;
  const category =
    participant.category && ROLE_CATEGORIES[role].includes(participant.category)
      ? participant.category
      : (ROLE_CATEGORIES[role][0] ?? 'other');
  const priority = participant.priority;
  const unsourcedNote =
    evidence.length === 0
      ? [
          `Assumption: no passage is quoted for this participant. ${CONFIDENCE_BASIS_MEANINGS[basis]}`,
        ]
      : [];
  const sizeNote =
    priority !== 'key'
      ? [
          participant.populationSize && model
            ? 'Population size is a modelling weight, not a count of real people.'
            : `Population size ${PLACEHOLDER_SIZE[priority]} is a placeholder for modelling, not a count.`,
        ]
      : [];
  const own = distinctLines(
    [...participant.assumptions, ...unsourcedNote, ...(model ? sizeNote : [])],
    8,
    300,
  );
  const direction = participant.impact.direction;
  const impactReason = normaliseLine(participant.impact.rationale, 400);
  const parsed = stakeholderSchema.safeParse({
    id,
    name: capitalise(normaliseLine(participant.name, 120)),
    category,
    description: normaliseLine(participant.description, 600),
    relevance: normaliseLine(participant.whyTheyMatter, 600),
    directness: participant.directness,
    priority,
    populationSize:
      priority === 'key'
        ? 1
        : (legacy?.populationSize ?? participant.populationSize ?? PLACEHOLDER_SIZE[priority]),
    expectedImpact: legacy
      ? legacy.expectedImpact
      : { direction, rationale: impactReason || 'The model gave no reason.', origin: 'model' },
    evidence,
    assumptions: legacy
      ? distinctLines([...participant.assumptions, ...unsourcedNote], 8, 300)
      : own,
    uncertainty: legacy
      ? {
          level: participant.uncertainty.level,
          reason: normaliseLine(participant.uncertainty.reason, 300),
        }
      : modelUncertainty(participant, evidence, basis),
    origin: model ? 'model' : (legacy?.origin ?? 'rules'),
    status: 'proposed',
    mergedFrom: [],
    participantRole: role,
    objective: normaliseLine(participant.objective, 300),
    incentives: distinctLines(participant.incentives, 6, 200),
    pressures: distinctLines(participant.pressures, 6, 200),
    constraints: distinctLines(participant.constraints, 6, 200),
    concerns: distinctLines(participant.concerns, 6, 200),
    influence: participant.influence,
    decisionAuthority: participant.decisionAuthority,
    informationAccess: distinctLines(
      participant.informationAccess.length > 0
        ? participant.informationAccess
        : ROLE_DEFAULTS[role].informationAccess,
      6,
      200,
    ),
    plausibleActions: distinctLines(participant.plausibleActions, 8, 200),
    prohibitedClaims: withStandingClaims(role, participant.prohibitedClaims),
    confidenceBasis: basis,
    synthetic: true,
  });
  return parsed.success ? parsed.data : null;
}

const rank = (stakeholder: Stakeholder): [number, number, number, string] => [
  stakeholder.participantRole === 'decision-owner' ? 0 : 1,
  PRIORITY_ORDER.indexOf(stakeholder.priority),
  -stakeholder.evidence.length,
  stakeholder.name,
];
const byRank = (a: Stakeholder, b: Stakeholder): number => {
  const left = rank(a);
  const right = rank(b);
  return (
    left[0] - right[0] ||
    left[1] - right[1] ||
    left[2] - right[2] ||
    left[3].localeCompare(right[3])
  );
};

/**
 * Folds `others` into `keeper`: the keeper takes their evidence (up to the limit) and a note of each
 * merge, and names them in `mergedFrom`; they are returned marked removed, so that the merge can be read
 * back and undone. Nothing is deleted.
 */
export function mergeInto(
  keeper: Stakeholder,
  others: readonly Stakeholder[],
): { keeper: Stakeholder; removed: Stakeholder[] } {
  const merged = others.slice(0, Math.max(0, 10 - keeper.mergedFrom.length));
  const evidence = uniqueEvidence(
    [...keeper.evidence, ...merged.flatMap((other) => other.evidence)],
    MAX_EVIDENCE,
  );
  return {
    keeper: {
      ...keeper,
      evidence,
      mergedFrom: [...keeper.mergedFrom, ...merged.map((other) => other.id)],
      assumptions: [
        ...keeper.assumptions,
        ...merged.map((other) => truncate(`Merged with “${other.name}”.`, 300)),
      ].slice(-8),
      confidenceBasis: evidence.length > 0 ? 'source-quote' : keeper.confidenceBasis,
    },
    removed: merged.map((other) => ({ ...other, status: 'removed' as const })),
  };
}

/** Relations with the merged participants' ends moved to the ones they went into; loops and repeats are dropped. */
export function rewireRelations(
  relations: readonly StakeholderRelation[],
  into: ReadonlyMap<string, string>,
): StakeholderRelation[] {
  const seen = new Set<string>();
  const rewired: StakeholderRelation[] = [];
  for (const relation of relations) {
    const from = into.get(relation.from) ?? relation.from;
    const to = into.get(relation.to) ?? relation.to;
    const mark = `${from}|${to}|${relation.type}`;
    if (from === to || seen.has(mark)) continue;
    seen.add(mark);
    rewired.push({ ...relation, from, to });
  }
  return rewired;
}

/** Folds participants with the same name into the one with the most behind it, keeping the others as removed so a merge can be seen. */
function foldDuplicates(list: Stakeholder[]): {
  kept: Stakeholder[];
  removed: Stakeholder[];
  into: Map<string, string>;
} {
  const groups = new Map<string, Stakeholder[]>();
  for (const stakeholder of list) {
    const key = nameKey(stakeholder.name) || stakeholder.id;
    const group = groups.get(key);
    if (group) group.push(stakeholder);
    else groups.set(key, [stakeholder]);
  }
  const kept: Stakeholder[] = [];
  const removed: Stakeholder[] = [];
  const into = new Map<string, string>();
  for (const group of groups.values()) {
    const [keeper, ...others] = [...group].sort(byRank);
    if (!keeper) continue;
    const folded = mergeInto(keeper, others);
    kept.push(folded.keeper);
    removed.push(...folded.removed);
    for (const other of folded.removed) into.set(other.id, keeper.id);
  }
  return { kept, removed, into };
}

/** Cuts the list to what can be reviewed and run, least important first, and says what was cut. */
function enforceLimits(
  list: Stakeholder[],
  dropped: { name: string; reason: string }[],
  limit: number,
): Stakeholder[] {
  const ordered = [...list].sort(byRank);
  const perRole = new Map<string, number>();
  const kept: Stakeholder[] = [];
  for (const stakeholder of ordered) {
    const role = participantOf(stakeholder).role;
    const held = perRole.get(role) ?? 0;
    if (held >= MAX_PER_ROLE) {
      dropped.push({
        name: stakeholder.name,
        reason: `Left out to keep the list balanced: ${MAX_PER_ROLE} already hold this role.`,
      });
      continue;
    }
    if (kept.length >= limit) {
      dropped.push({
        name: stakeholder.name,
        reason: `Left out to keep the list reviewable: the limit is ${limit}.`,
      });
      continue;
    }
    perRole.set(role, held + 1);
    kept.push(stakeholder);
  }
  let keys = 0;
  return kept.map((stakeholder) => {
    if (stakeholder.priority !== 'key') return stakeholder;
    keys += 1;
    return keys > MAX_PROPOSED_KEY
      ? { ...stakeholder, priority: 'standard', populationSize: PLACEHOLDER_SIZE.standard }
      : stakeholder;
  });
}

function relationsOf(
  input: BuildInput,
  idMap: ReadonlyMap<string, string>,
  into: ReadonlyMap<string, string>,
  live: readonly Stakeholder[],
): StakeholderRelation[] {
  const alive = new Set(live.map((stakeholder) => stakeholder.id));
  const settle = (id: string): string | undefined => {
    const mapped = idMap.get(id);
    return mapped === undefined ? undefined : (into.get(mapped) ?? mapped);
  };
  const seen = new Set<string>();
  const relations: StakeholderRelation[] = [];
  for (const raw of input.proposal.relations) {
    const from = settle(raw.from);
    const to = settle(raw.to);
    if (!from || !to || from === to || !alive.has(from) || !alive.has(to)) continue;
    const mark = `${from}|${to}|${raw.type}`;
    if (seen.has(mark)) continue;
    seen.add(mark);
    relations.push({
      from,
      to,
      type: raw.type,
      strength: raw.strength,
      rationale:
        input.source === 'model'
          ? truncate(
              `Assumption (model): ${normaliseLine(raw.rationale, 240) || 'proposed by the model.'}`,
              300,
            )
          : truncate(raw.rationale, 300),
    });
  }
  return relations.length > 0 ? relations.slice(0, 120) : deriveRelations(live);
}

function noteOf(
  input: BuildInput,
  live: readonly Stakeholder[],
  stats: Stats,
  folded: number,
  dropped: number,
): string {
  const { context, source, failure, modelName } = input;
  const parts: { text: string; keep: boolean }[] = [];
  if (source === 'model') {
    parts.push({
      text: `Proposed by a model${modelName ? ` (${modelName})` : ''} reading ${context.shown.length} of ${plural(context.passages.length, 'passage')}; the rules path was not used.`,
      keep: true,
    });
    parts.push({
      text: `Each quote was checked against its passage: ${stats.quotesKept} kept${stats.quotesShortened ? ` (${stats.quotesShortened} cut back to the part that matches)` : ''}, ${stats.quotesDropped} dropped.`,
      keep: true,
    });
  } else {
    parts.push({
      text: failure
        ? `The model could not be used: ${failure.detail.replace(/,? so rules were used\.?$/u, '')}. Participants were proposed by reading the text for roles instead; expect gaps.`
        : 'Participants were proposed by reading the text for roles and applying a domain-neutral role taxonomy, not by a model; expect gaps.',
      keep: true,
    });
    parts.push({
      text: `It read ${plural(context.passages.length, 'passage')} and proposed ${plural(live.length, 'participant')}.`,
      keep: true,
    });
    parts.push({
      text: describeDirections(countDirections(live), 'participants'),
      keep: false,
    });
  }
  if (stats.unsourcedDropped > 0) {
    parts.push({
      text: `${plural(stats.unsourcedDropped, 'participant')} the model proposed without a quote ${stats.unsourcedDropped === 1 ? 'was' : 'were'} left out, because a source carried text addressed to an AI system.`,
      keep: true,
    });
  }
  if (folded > 0) {
    parts.push({
      text: `${plural(folded, 'name')} that are certainly one participant were folded into another (see Removed).`,
      keep: false,
    });
  }
  if (dropped > 0) {
    parts.push({
      text: `${plural(dropped, 'participant')} left out; the review says which and why.`,
      keep: false,
    });
  }
  for (const notice of input.side.notes) parts.push({ text: notice, keep: true });
  const text = (): string =>
    parts
      .map((part) => part.text)
      .filter(Boolean)
      .join(' ');
  for (let at = parts.length - 1; at >= 0 && text().length > NOTE_LIMIT; at -= 1) {
    if (!parts[at]?.keep) parts.splice(at, 1);
  }
  return truncate(text(), NOTE_LIMIT);
}

/**
 * Turns a proposal into the set a person reviews, by the deterministic steps that follow the model or
 * the rules: every quote is checked against its passage; a participant found again keeps its id; the
 * same name twice is folded into one (the copies stay under Removed); no role fills the list and no
 * more than the limit are kept, and what was left out is recorded; relations with a missing end, a loop
 * or a repeat are dropped; a participant with no quote is labelled an assumption; and the roles that
 * nobody holds, where the text suggests one matters, are named as gaps. Nothing here asks a model.
 */
export function buildSet(input: BuildInput): StakeholderSet {
  const { context } = input;
  const byPassage = new Map(context.passages.map((passage) => [passage.id, passage]));
  const stats = newStats();
  const taken = new Set<string>();
  const reuse = new Map(
    (input.existing?.stakeholders ?? []).map((stakeholder) => [
      nameKey(stakeholder.name),
      stakeholder.id,
    ]),
  );
  const idMap = new Map<string, string>();
  const dropped = [...input.side.dropped];
  const asked = new Set(
    nameTokens(
      [
        context.question,
        context.scenario?.decision,
        ...(context.scenario?.likelyStakeholders ?? []),
      ]
        .filter(Boolean)
        .join(' '),
    ),
  );

  const built: Stakeholder[] = [];
  for (const participant of input.proposal.participants) {
    const wanted = reuse.get(nameKey(participant.name));
    const id = uniqueId(
      wanted && !taken.has(wanted) ? wanted : slugify(participant.id || participant.name),
      taken,
    );
    const stakeholder = buildParticipant(participant, input, byPassage, stats, id);
    if (!stakeholder) {
      dropped.push({
        name: normaliseLine(participant.name, 120),
        reason: 'It did not fit the participant contract.',
      });
      continue;
    }
    // A source carried text addressed to an AI: what only the model's word backs is not taken on trust.
    // A group the question or the scenario names (most of its words are theirs) is the person's own.
    const tokens = nameTokens(stakeholder.name);
    const named =
      tokens.filter((token) => asked.has(token)).length >= Math.ceil(tokens.length * 0.6);
    if (
      input.source === 'model' &&
      context.flagged.length > 0 &&
      stakeholder.evidence.length === 0 &&
      !named
    ) {
      stats.unsourcedDropped += 1;
      dropped.push({
        name: stakeholder.name,
        reason: 'No quote backs it, and a source carried text addressed to an AI system.',
      });
      continue;
    }
    idMap.set(participant.id, stakeholder.id);
    built.push(stakeholder);
  }

  const folded = foldDuplicates(built);
  const limited = enforceLimits(
    folded.kept,
    dropped,
    input.source === 'rules' ? MAX_RULES_PARTICIPANTS : MAX_PROPOSED_LIVE,
  );
  const removed = folded.removed.filter((copy) =>
    limited.some((keeper) => keeper.mergedFrom.includes(copy.id)),
  );
  const order = (stakeholder: Stakeholder): number => PRIORITY_ORDER.indexOf(stakeholder.priority);
  const roleOrder = (stakeholder: Stakeholder): number =>
    PARTICIPANT_ROLES.indexOf(participantOf(stakeholder).role);
  const live = [...limited].sort(
    (a, b) => order(a) - order(b) || roleOrder(a) - roleOrder(b) || a.name.localeCompare(b.name),
  );
  const copies = [...removed].sort((a, b) => a.name.localeCompare(b.name));

  const review = reviewContext({
    passages: context.passages,
    graph: context.graph,
    scenario: context.scenario,
    question: context.question,
  });
  const { missing } = coverageOf(live, review);
  const held = new Set(live.map((stakeholder) => participantOf(stakeholder).role));
  const voices = [
    ...missing.map(({ role, cue }) => ({ role, reason: roleGapReason(role, cue) })),
    ...input.proposal.gaps
      .filter((gap) => !held.has(gap.role) && !missing.some((item) => item.role === gap.role))
      .map((gap) => ({ role: gap.role, reason: normaliseLine(gap.reason, 300) })),
  ];
  if (!held.has('missing-voices') && !voices.some((voice) => voice.role === 'missing-voices')) {
    voices.push({ role: 'missing-voices', reason: roleGapReason('missing-voices', null) });
  }

  const relations = relationsOf(input, idMap, folded.into, live);
  return stakeholderSetSchema.parse({
    stakeholders: [...live, ...copies],
    relations,
    discovery: {
      mode: input.source,
      model: input.source === 'model' ? input.modelName : null,
      generatedAt: input.now.toISOString(),
      note: noteOf(input, live, stats, copies.length, dropped.length),
    },
    gaps: categoryGaps(live),
    approvedAt: null,
    proposal: {
      version: PROPOSAL_VERSION,
      generatedAt: input.now.toISOString(),
      source: input.source,
      model: input.source === 'model' ? input.modelName : null,
      failure: input.failure ? { code: input.failure.code, detail: input.failure.detail } : null,
      evidence: { shown: context.shown.length, of: context.passages.length },
      flaggedPassages: context.flagged.slice(0, 20),
      usedResearch: context.research !== null,
      usedConstraints: context.constraints.length > 0,
      merged: copies.length,
      dropped: dropped.slice(0, 30).map((item) => ({
        name: truncate(item.name, 120),
        reason: truncate(item.reason, 200),
      })),
      missingVoices: voices.slice(0, 14),
      notes: input.side.notes.slice(0, 12).map((note) => truncate(note, 300)),
    },
  });
}
