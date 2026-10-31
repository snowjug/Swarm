import { z } from 'zod';
import type { EvidenceRef } from '../../../shared/evidence.js';
import {
  stakeholderRelationSchema,
  stakeholderSchema,
  stakeholderSetSchema,
  type Stakeholder,
  type StakeholderRelation,
  type StakeholderSet,
} from '../../../shared/stakeholders.js';
import { AppError } from '../errors.js';
import { categoryGaps, isCategoryGap } from './relations.js';

/** What a person sends when they review the set: the whole set as they now want it, and what they saw. */
export const reviewInputSchema = z
  .object({
    stakeholders: z.array(stakeholderSchema).max(40),
    relations: z.array(stakeholderRelationSchema).max(160).default([]),
    /** The revision the person was looking at; 0 when they are building a set by hand. */
    expectedRevision: z.int().min(0),
  })
  .strict();
export type ReviewInput = z.output<typeof reviewInputSchema>;

const refuse = (code: string, message: string): AppError => new AppError(400, code, message);

const evidenceMark = (ref: EvidenceRef): string =>
  `${ref.passageId}|${ref.start}|${ref.end}|${ref.contentHash}|${ref.quote ?? ''}`;

/** The fields a person may change. Anything else on a stakeholder is the server's. */
const content = (stakeholder: Stakeholder): string =>
  JSON.stringify([
    stakeholder.name,
    stakeholder.category,
    stakeholder.description,
    stakeholder.relevance,
    stakeholder.directness,
    stakeholder.priority,
    stakeholder.populationSize,
    stakeholder.expectedImpact.direction,
    stakeholder.expectedImpact.rationale,
    stakeholder.assumptions,
    stakeholder.uncertainty,
    stakeholder.evidence.map(evidenceMark),
  ]);

const impactOf = (stakeholder: Stakeholder): string =>
  JSON.stringify([stakeholder.expectedImpact.direction, stakeholder.expectedImpact.rationale]);

/** The expected impact with the origin the server decides: nobody can claim a source for their own edit. */
function impactWithOrigin(
  stakeholder: Stakeholder,
  origin: Stakeholder['expectedImpact']['origin'],
): Stakeholder['expectedImpact'] {
  const { direction, rationale } = stakeholder.expectedImpact;
  return { direction, rationale, ...(origin ? { origin } : {}) };
}

const USER_STATUSES: readonly Stakeholder['status'][] = ['added', 'removed'];
const REVIEW_STATUSES: readonly Stakeholder['status'][] = [
  'proposed',
  'accepted',
  'edited',
  'removed',
];

/** The status a reviewed stakeholder has: what the person chose, made to fit what they actually did. */
function statusAfter(
  before: Stakeholder | undefined,
  incoming: Stakeholder,
  changed: boolean,
): Stakeholder['status'] {
  if (incoming.status === 'removed') return 'removed';
  if (incoming.origin === 'user' || before?.origin === 'user') return 'added';
  if (changed) return 'edited';
  if (incoming.status !== 'edited') return incoming.status;
  if (before?.status === 'edited') return 'edited';
  return before && before.status !== 'removed' ? before.status : 'proposed';
}

/**
 * Checks a reviewed set against the one stored and returns what to store. The person may accept, edit,
 * merge, remove (and restore), add and re-prioritise, and nothing else: a stakeholder is never deleted
 * (it is marked removed, so the review can be read back), its origin and its evidence are the
 * sources' and not the person's (evidence can be taken away, never added), a status is one the person
 * could have reached, and a merge is a removed stakeholder named by the one it went into, with the
 * evidence of both. Whatever the person changes about an approved set takes the approval away.
 */
export function applyReview(
  stored: StakeholderSet | null,
  input: ReviewInput,
  now: Date,
): StakeholderSet {
  const before = new Map(
    (stored?.stakeholders ?? []).map((stakeholder) => [stakeholder.id, stakeholder]),
  );
  const ids = input.stakeholders.map((stakeholder) => stakeholder.id);
  if (new Set(ids).size !== ids.length) {
    throw refuse('STAKEHOLDER_ID_DUPLICATE', 'Every stakeholder needs an id of its own.');
  }
  for (const id of before.keys()) {
    if (!ids.includes(id)) {
      throw refuse(
        'STAKEHOLDER_MISSING',
        'A stakeholder is never deleted. Mark it removed instead, so that the review can be read back.',
      );
    }
  }
  const incoming = new Map(input.stakeholders.map((stakeholder) => [stakeholder.id, stakeholder]));

  // Merge bookkeeping first: who went into whom, and whose evidence may therefore be carried.
  const mergedInto = new Map<string, string>();
  for (const target of input.stakeholders) {
    for (const source of target.mergedFrom) {
      const merged = incoming.get(source);
      if (!merged || source === target.id) {
        throw refuse('MERGE_INVALID', 'A merge names a stakeholder in this list, and not itself.');
      }
      const fresh = !before.get(target.id)?.mergedFrom.includes(source);
      if (merged.status !== 'removed' || (fresh && target.status === 'removed')) {
        throw refuse(
          'MERGE_INVALID',
          'A merged stakeholder is marked removed, and the one it went into is not.',
        );
      }
      if (mergedInto.has(source)) {
        throw refuse('MERGE_INVALID', 'A stakeholder can be merged into only one other.');
      }
      mergedInto.set(source, target.id);
    }
  }
  for (const [id, was] of before) {
    for (const source of was.mergedFrom) {
      if (incoming.get(source)?.status === 'removed' && mergedInto.get(source) !== id) {
        throw refuse(
          'MERGE_INVALID',
          'A merge cannot be hidden. Restore the merged stakeholder to undo it.',
        );
      }
    }
  }

  const stakeholders = input.stakeholders.map((raw): Stakeholder => {
    const was = before.get(raw.id);
    if (!was) {
      if (raw.origin !== 'user' || raw.status !== 'added') {
        throw refuse(
          'STAKEHOLDER_ORIGIN_LOCKED',
          'A stakeholder you add is marked as added by you, and nothing else can add one.',
        );
      }
      if (raw.evidence.length > 0 || raw.mergedFrom.length > 0) {
        throw refuse(
          'EVIDENCE_NOT_VERIFIED',
          'Evidence comes from the sources. A stakeholder you add has none until the stakeholders are found again.',
        );
      }
      return { ...raw, expectedImpact: impactWithOrigin(raw, 'user') };
    }
    if (raw.origin !== was.origin) {
      throw refuse('STAKEHOLDER_ORIGIN_LOCKED', 'Who found a stakeholder cannot be changed.');
    }
    const allowedStatuses = was.origin === 'user' ? USER_STATUSES : REVIEW_STATUSES;
    if (!allowedStatuses.includes(raw.status)) {
      throw refuse('STATUS_INVALID', 'That is not a status this stakeholder can have.');
    }
    const carried = new Set([
      ...was.evidence.map(evidenceMark),
      ...raw.mergedFrom.flatMap((source) => before.get(source)?.evidence.map(evidenceMark) ?? []),
    ]);
    if (raw.evidence.some((ref) => !carried.has(evidenceMark(ref)))) {
      throw refuse(
        'EVIDENCE_NOT_VERIFIED',
        'Evidence can be taken away, but not added: it comes from the sources.',
      );
    }
    const changed = content(raw) !== content(was);
    const impactChanged = impactOf(raw) !== impactOf(was);
    return {
      ...raw,
      status: statusAfter(was, raw, changed),
      expectedImpact: impactWithOrigin(raw, impactChanged ? 'user' : was.expectedImpact.origin),
    };
  });

  const known = new Set(stakeholders.map((stakeholder) => stakeholder.id));
  const seen = new Set<string>();
  const relations = input.relations.map((relation): StakeholderRelation => {
    const mark = `${relation.from}|${relation.to}|${relation.type}`;
    if (!known.has(relation.from) || !known.has(relation.to) || relation.from === relation.to) {
      throw refuse('RELATION_INVALID', 'A relation joins two different stakeholders in this list.');
    }
    if (seen.has(mark)) {
      throw refuse('RELATION_INVALID', 'The same relation is listed twice.');
    }
    seen.add(mark);
    // A relation between stakeholders is an assumption, whoever wrote it, and says so.
    return /^Assum/u.test(relation.rationale)
      ? relation
      : { ...relation, rationale: `Assumption (you): ${relation.rationale}`.slice(0, 300) };
  });

  const next = {
    stakeholders,
    relations,
    discovery: stored?.discovery ?? {
      mode: 'user' as const,
      model: null,
      generatedAt: now.toISOString(),
      note: 'Added by hand; nothing was discovered.',
    },
    gaps: [
      ...categoryGaps(stakeholders),
      ...(stored?.gaps ?? []).filter((gap) => !isCategoryGap(gap)),
    ].slice(0, 20),
    approvedAt: stored?.approvedAt ?? null,
  };
  const same =
    stored !== null &&
    JSON.stringify([stored.stakeholders, stored.relations]) ===
      JSON.stringify([next.stakeholders, next.relations]);
  return stakeholderSetSchema.parse({ ...next, approvedAt: same ? next.approvedAt : null });
}

/** The set as approved: at least two stakeholders left in it, and every one still only proposed accepted. */
export function approveSet(stored: StakeholderSet, now: Date): StakeholderSet {
  const left = stored.stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');
  if (left.length < 2) {
    throw new AppError(
      409,
      'STAKEHOLDERS_TOO_FEW',
      'Keep or add at least two stakeholders before approving: a simulation needs more than one party.',
    );
  }
  return stakeholderSetSchema.parse({
    ...stored,
    stakeholders: stored.stakeholders.map((stakeholder) =>
      stakeholder.status === 'proposed' ? { ...stakeholder, status: 'accepted' } : stakeholder,
    ),
    approvedAt: now.toISOString(),
  });
}
