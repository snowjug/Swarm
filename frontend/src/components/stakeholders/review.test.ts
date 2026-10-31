import { describe, expect, it } from 'vitest';
import { applyReview, reviewInputSchema } from '../../../../backend/src/stakeholders/review';
import type { EvidenceRef } from '../../../../shared/evidence';
import {
  FIXTURE_TIME,
  actorFixture,
  stakeholderFixture,
  stakeholderSetFixture,
} from '../../../../shared/lab-fixtures';
import {
  idSchema,
  stakeholderSchema,
  type Stakeholder,
  type StakeholderRelation,
  type StakeholderSet,
} from '../../../../shared/stakeholders';
import {
  EMPTY_DRAFT,
  MAX_MERGED,
  actorsDiffer,
  addedStakeholder,
  applyDraft,
  changedTraits,
  draftOf,
  draftProblems,
  freshId,
  groupByCategory,
  isReviewed,
  liveStakeholders,
  mergeStakeholders,
  mergedIntoMap,
  moveTrait,
  replace,
  restoredStatus,
  statusCounts,
  traitRange,
  traitText,
  undoMerge,
} from './review';

const ref = (
  passageId: string,
  quote: string | null = `A sentence in ${passageId}.`,
): EvidenceRef => ({
  passageId,
  documentId: 'D1',
  documentName: 'notes.md',
  start: 0,
  end: 20,
  quote,
  contentHash: `hash-${passageId}`,
  role: 'supports',
});

const byId = (list: readonly Stakeholder[], id: string): Stakeholder => {
  const found = list.find((stakeholder) => stakeholder.id === id);
  if (!found) throw new Error(`No stakeholder ${id}.`);
  return found;
};

/** A stored set, not yet approved, in which two stakeholders quote passages and one passage is shared. */
function stored(): StakeholderSet {
  const base = stakeholderSetFixture();
  return {
    ...base,
    approvedAt: null,
    stakeholders: base.stakeholders.map((stakeholder) =>
      stakeholder.id === 'resellers'
        ? { ...stakeholder, evidence: [ref('S1'), ref('S2')] }
        : stakeholder.id === 'provider'
          ? { ...stakeholder, evidence: [ref('S2'), ref('S3')] }
          : stakeholder,
    ),
  };
}

describe('listing stakeholders for review', () => {
  it('groups those not removed by category, key actors first, and leaves empty categories out', () => {
    const groups = groupByCategory([
      stakeholderFixture('zeta-customers', 'cost-bearer'),
      stakeholderFixture('alpha-customers', 'cost-bearer'),
      stakeholderFixture('main-customers', 'cost-bearer', { priority: 'key' }),
      stakeholderFixture('gone-customers', 'cost-bearer', { status: 'removed' }),
      stakeholderFixture('board', 'decision-maker', { priority: 'key' }),
    ]);
    expect(groups.map((group) => group.category)).toEqual(['decision-maker', 'cost-bearer']);
    expect(groups[1]?.items.map((item) => item.id)).toEqual([
      'main-customers',
      'alpha-customers',
      'zeta-customers',
    ]);
  });

  it('counts each status, and does not count a removed stakeholder as live', () => {
    const list = [
      stakeholderFixture('a', 'other'),
      stakeholderFixture('b', 'other', { status: 'accepted' }),
      stakeholderFixture('c', 'other', { status: 'removed' }),
      stakeholderFixture('d', 'other', { status: 'removed' }),
    ];
    expect(statusCounts(list)).toEqual({
      proposed: 1,
      accepted: 1,
      edited: 0,
      added: 0,
      removed: 2,
    });
    expect(liveStakeholders(list).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('knows that a set has been reviewed once anything is not merely proposed, or it is approved', () => {
    const fresh = { ...stored(), approvedAt: null };
    expect(isReviewed(fresh)).toBe(false);
    expect(isReviewed({ ...fresh, approvedAt: FIXTURE_TIME })).toBe(true);
    expect(
      isReviewed({
        ...fresh,
        stakeholders: replace(fresh.stakeholders, 'provider', (item) => ({
          ...item,
          status: 'accepted',
        })),
      }),
    ).toBe(true);
  });

  it('puts a restored stakeholder back as the person’s own if it was, and as proposed if not', () => {
    expect(restoredStatus(stakeholderFixture('a', 'other', { origin: 'user' }))).toBe('added');
    expect(restoredStatus(stakeholderFixture('a', 'other', { origin: 'rules' }))).toBe('proposed');
    expect(restoredStatus(stakeholderFixture('a', 'other', { origin: 'model' }))).toBe('proposed');
  });
});

describe('merging and undoing a merge', () => {
  it('marks the merged stakeholder removed and gives its evidence to the other, without repeats', () => {
    const set = stored();
    const merged = mergeStakeholders(set.stakeholders, set.relations, 'resellers', 'provider');
    expect(byId(merged.stakeholders, 'resellers').status).toBe('removed');
    const target = byId(merged.stakeholders, 'provider');
    expect(target.mergedFrom).toEqual(['resellers']);
    expect(target.evidence.map((item) => item.passageId)).toEqual(['S2', 'S3', 'S1']);
    expect(target.assumptions.at(-1)).toBe('Merged with “Resellers”.');
    expect(set.stakeholders).toEqual(stored().stakeholders);
  });

  it('points the relations of the merged stakeholder at the other, and drops those that would join it to itself', () => {
    const set = stored();
    const rival = stakeholderFixture('rival-provider', 'competitor');
    const relations: StakeholderRelation[] = [
      ...set.relations,
      { from: 'resellers', to: 'rival-provider', type: 'influences', strength: 0.3, rationale: '' },
      { from: 'provider', to: 'rival-provider', type: 'influences', strength: 0.3, rationale: '' },
    ];
    const merged = mergeStakeholders(
      [...set.stakeholders, rival],
      relations,
      'resellers',
      'provider',
    );
    expect(merged.relations).not.toContainEqual(expect.objectContaining({ from: 'resellers' }));
    expect(merged.relations).not.toContainEqual(expect.objectContaining({ to: 'resellers' }));
    expect(
      merged.relations.filter(
        (relation) => relation.from === 'provider' && relation.to === 'rival-provider',
      ),
    ).toHaveLength(1);
    expect(
      merged.relations.some((relation) => relation.from === relation.to),
      'a stakeholder is not related to itself',
    ).toBe(false);
  });

  it('keeps the evidence of the other at eight and does nothing for an unknown or identical pair', () => {
    const many = Array.from({ length: 8 }, (_, index) => ref(`P${index}`));
    const list = [
      stakeholderFixture('a', 'other', { evidence: many }),
      stakeholderFixture('b', 'other', { evidence: [ref('X1'), ref('X2')] }),
    ];
    const merged = mergeStakeholders(list, [], 'b', 'a');
    expect(byId(merged.stakeholders, 'a').evidence).toHaveLength(8);
    expect(mergeStakeholders(list, [], 'b', 'b').stakeholders).toEqual(list);
    expect(mergeStakeholders(list, [], 'missing', 'a').stakeholders).toEqual(list);
  });

  it('says where a merged stakeholder went, and takes the merge back', () => {
    const set = stored();
    const merged = mergeStakeholders(set.stakeholders, set.relations, 'resellers', 'provider');
    expect(mergedIntoMap(merged.stakeholders).get('resellers')?.id).toBe('provider');

    const undone = undoMerge(merged.stakeholders, 'resellers');
    expect(byId(undone, 'resellers').status).toBe('proposed');
    const target = byId(undone, 'provider');
    expect(target.mergedFrom).toEqual([]);
    expect(target.assumptions).not.toContain('Merged with “Resellers”.');
    // What the merge took from the other stakeholder goes back with it, including a passage that
    // mentioned both: it is not left under a stakeholder it may not be about.
    expect(target.evidence.map((item) => item.passageId)).toEqual(['S3']);
    expect(mergedIntoMap(undone).size).toBe(0);
  });

  it('leaves a list alone when the merged stakeholder to undo is unknown', () => {
    const set = stored();
    expect(undoMerge(set.stakeholders, 'missing')).toEqual(set.stakeholders);
  });

  it('allows no more merges into one stakeholder than the contract holds', () => {
    const ids = Array.from({ length: MAX_MERGED + 1 }, (_, index) => `merged-${index}`);
    const base = stakeholderFixture('target', 'other');
    expect(
      stakeholderSchema.safeParse({ ...base, mergedFrom: ids.slice(0, MAX_MERGED) }).success,
    ).toBe(true);
    expect(stakeholderSchema.safeParse({ ...base, mergedFrom: ids }).success).toBe(false);
  });
});

describe('what the person types', () => {
  it('reads a stakeholder into a draft and back without changing it', () => {
    const original = stakeholderFixture('customers', 'cost-bearer', {
      populationSize: 4_000,
      expectedImpact: { direction: 'harmed', rationale: 'They pay more.', origin: 'evidence' },
    });
    expect(applyDraft(original, draftOf(original))).toEqual(original);
    expect(draftOf(original).populationSize).toBe('4000');
  });

  it('asks for a name and a whole population from one to a million, and says what is too long', () => {
    expect(draftProblems(EMPTY_DRAFT)).toEqual({ name: 'Give the stakeholder a name.' });
    const draft = { ...EMPTY_DRAFT, name: 'Someone' };
    expect(draftProblems(draft)).toEqual({});
    for (const populationSize of ['0', '1.5', 'many', '', '1000001', '-3']) {
      expect(draftProblems({ ...draft, populationSize }).populationSize, populationSize).toBe(
        'Use a whole number from 1 to 1,000,000.',
      );
    }
    expect(draftProblems({ ...draft, populationSize: '1000000' })).toEqual({});
    expect(draftProblems({ ...draft, name: 'n'.repeat(121) }).name).toBe(
      'Keep the name to 120 characters.',
    );
    expect(draftProblems({ ...draft, description: 'd'.repeat(601) }).description).toBe(
      'Keep this to 600 characters.',
    );
    expect(draftProblems({ ...draft, impactRationale: 'r'.repeat(401) }).impactRationale).toBe(
      'Keep this to 400 characters.',
    );
    expect(draftProblems({ ...draft, uncertaintyReason: 'u'.repeat(301) }).uncertaintyReason).toBe(
      'Keep this to 300 characters.',
    );
  });

  it('makes an id of letters, digits and hyphens that nobody else has', () => {
    expect(freshId('Channel partners', [])).toBe('channel-partners');
    expect(freshId('Channel partners', ['channel-partners'])).toBe('channel-partners-2');
    expect(freshId('Channel partners', ['channel-partners', 'channel-partners-2'])).toBe(
      'channel-partners-3',
    );
    expect(freshId('顧客', [])).toBe('stakeholder');
    expect(freshId('  ---  ', ['stakeholder'])).toBe('stakeholder-2');
    expect(freshId(`${'a'.repeat(39)} b`, [])).toBe('a'.repeat(39));
    for (const name of ['Résumé reviewers', 'x'.repeat(300), '9 lives', 'A/B testers & co.']) {
      const taken: string[] = [];
      for (let n = 0; n < 12; n += 1) {
        const id = freshId(name, taken);
        expect(idSchema.safeParse(id).success, `${name} -> ${id}`).toBe(true);
        expect(taken).not.toContain(id);
        taken.push(id);
      }
    }
  });

  it('makes the stakeholder a person adds theirs: origin and impact are theirs, and no evidence is claimed', () => {
    const added = addedStakeholder(
      {
        ...EMPTY_DRAFT,
        name: ' Neighbours ',
        category: 'risk-bearer',
        populationSize: '250',
        impactDirection: 'harmed',
        impactRationale: 'Noise.',
      },
      ['neighbours'],
    );
    expect(added).toMatchObject({
      id: 'neighbours-2',
      name: 'Neighbours',
      category: 'risk-bearer',
      origin: 'user',
      status: 'added',
      populationSize: 250,
      evidence: [],
      mergedFrom: [],
      expectedImpact: { direction: 'harmed', rationale: 'Noise.', origin: 'user' },
      uncertainty: { level: 'high' },
    });
    expect(stakeholderSchema.parse(added)).toEqual(added);
  });
});

describe('what the server accepts of what the review screen sends', () => {
  const send = (
    from: StakeholderSet,
    stakeholders: readonly Stakeholder[],
    relations: readonly StakeholderRelation[] = from.relations,
  ): StakeholderSet =>
    applyReview(
      from,
      reviewInputSchema.parse({ stakeholders, relations, expectedRevision: 1 }),
      new Date(FIXTURE_TIME),
    );

  it('accepts a merge, and the merged stakeholder stays in the record as removed', () => {
    const set = stored();
    const merged = mergeStakeholders(set.stakeholders, set.relations, 'resellers', 'provider');
    const next = send(set, merged.stakeholders, merged.relations);
    expect(byId(next.stakeholders, 'resellers').status).toBe('removed');
    expect(byId(next.stakeholders, 'provider')).toMatchObject({
      mergedFrom: ['resellers'],
      status: 'edited',
    });
    expect(next.stakeholders).toHaveLength(set.stakeholders.length);
  });

  it('refuses a restore that leaves the merge in place, and accepts the undo that takes it back', () => {
    const set = stored();
    const merged = mergeStakeholders(set.stakeholders, set.relations, 'resellers', 'provider');
    const next = send(set, merged.stakeholders, merged.relations);

    expect(() =>
      send(
        next,
        replace(next.stakeholders, 'resellers', (item) => ({ ...item, status: 'proposed' })),
      ),
    ).toThrow(/merged stakeholder is marked removed/u);

    const undone = send(next, undoMerge(next.stakeholders, 'resellers'));
    expect(byId(undone.stakeholders, 'resellers').status).toBe('proposed');
    expect(byId(undone.stakeholders, 'provider').mergedFrom).toEqual([]);
  });

  it('accepts a merge into a stakeholder that was itself merged into, and an undo of the first', () => {
    const set = stored();
    const first = mergeStakeholders(set.stakeholders, set.relations, 'resellers', 'provider');
    const afterFirst = send(set, first.stakeholders, first.relations);
    const second = mergeStakeholders(
      afterFirst.stakeholders,
      afterFirst.relations,
      'provider',
      'subscribers',
    );
    const next = send(afterFirst, second.stakeholders, second.relations);
    expect(byId(next.stakeholders, 'subscribers').mergedFrom).toEqual(['provider']);
    expect(mergedIntoMap(next.stakeholders).get('resellers')?.id).toBe('provider');

    const undone = send(next, undoMerge(next.stakeholders, 'provider'));
    expect(byId(undone.stakeholders, 'provider').status).toBe('proposed');
    expect(byId(undone.stakeholders, 'subscribers').mergedFrom).toEqual([]);
  });

  it('accepts an edit, and marks it as the person’s', () => {
    const set = stored();
    const target = byId(set.stakeholders, 'subscribers');
    const next = send(
      set,
      replace(set.stakeholders, 'subscribers', () =>
        applyDraft(target, { ...draftOf(target), name: 'Paying subscribers', priority: 'key' }),
      ),
    );
    expect(byId(next.stakeholders, 'subscribers')).toMatchObject({
      name: 'Paying subscribers',
      priority: 'key',
      status: 'edited',
    });
  });

  it('accepts removing and restoring, for a stakeholder found and for one the person added', () => {
    const set = stored();
    const removed = send(
      set,
      replace(set.stakeholders, 'subscribers', (item) => ({ ...item, status: 'removed' })),
    );
    expect(byId(removed.stakeholders, 'subscribers').status).toBe('removed');
    const restored = send(
      removed,
      replace(removed.stakeholders, 'subscribers', (item) => ({
        ...item,
        status: restoredStatus(item),
      })),
    );
    expect(byId(restored.stakeholders, 'subscribers').status).toBe('proposed');

    const withAdded = send(set, [
      ...set.stakeholders,
      addedStakeholder(
        { ...EMPTY_DRAFT, name: 'Neighbours' },
        set.stakeholders.map((s) => s.id),
      ),
    ]);
    expect(byId(withAdded.stakeholders, 'neighbours')).toMatchObject({
      origin: 'user',
      status: 'added',
    });
    const gone = send(
      withAdded,
      replace(withAdded.stakeholders, 'neighbours', (item) => ({ ...item, status: 'removed' })),
    );
    const back = send(
      gone,
      replace(gone.stakeholders, 'neighbours', (item) => ({
        ...item,
        status: restoredStatus(item),
      })),
    );
    expect(byId(back.stakeholders, 'neighbours').status).toBe('added');
  });

  it('accepts accepting a stakeholder the person had edited, which keeps their edit’s words', () => {
    const set = stored();
    const target = byId(set.stakeholders, 'subscribers');
    const edited = send(
      set,
      replace(set.stakeholders, 'subscribers', () =>
        applyDraft(target, { ...draftOf(target), description: 'Those who pay each month.' }),
      ),
    );
    const accepted = send(
      edited,
      replace(edited.stakeholders, 'subscribers', (item) => ({ ...item, status: 'accepted' })),
    );
    expect(byId(accepted.stakeholders, 'subscribers')).toMatchObject({
      status: 'accepted',
      description: 'Those who pay each month.',
    });
  });
});

describe('moving a trait of an actor', () => {
  it('uses a scale of minus one to one for stance and impact and nought to one for the rest', () => {
    expect(traitRange('priorStance')).toEqual({ min: -1, max: 1 });
    expect(traitRange('impact')).toEqual({ min: -1, max: 1 });
    expect(traitRange('influence')).toEqual({ min: 0, max: 1 });
    expect(traitRange('reactivity')).toEqual({ min: 0, max: 1 });
  });

  it('writes a value with two decimals, and a sign only where the scale has one', () => {
    expect(traitText('priorStance', 0.5)).toBe('+0.50');
    expect(traitText('priorStance', -0.5)).toBe('-0.50');
    expect(traitText('impact', 0)).toBe('0.00');
    expect(traitText('trust', 0.456)).toBe('0.46');
    expect(traitText('trust', 1)).toBe('1.00');
  });

  it('moves one trait to two decimals without touching the actor it was given or the other traits', () => {
    const actor = actorFixture('customers', 'cost-bearer');
    const moved = moveTrait(actor, 'trust', 0.456);
    expect(moved.traits.trust.value).toBe(0.46);
    expect(moved.traits.trust).toMatchObject({
      origin: actor.traits.trust.origin,
      rationale: actor.traits.trust.rationale,
    });
    expect(moved.traits.influence).toEqual(actor.traits.influence);
    expect(actor.traits.trust.value).toBe(0.5);
  });

  it('tells which traits differ from the stored actor, and whether anything does', () => {
    const actor = actorFixture('customers', 'cost-bearer');
    const draft = moveTrait(moveTrait(actor, 'trust', 0.9), 'impact', -0.2);
    expect([...changedTraits(actor, draft)].sort()).toEqual(['impact', 'trust']);
    expect(changedTraits(actor, actor).size).toBe(0);
    expect(actorsDiffer([actor], [actor])).toBe(false);
    expect(actorsDiffer([actor], [draft])).toBe(true);
    expect(actorsDiffer([actor], [moveTrait(actor, 'trust', actor.traits.trust.value)])).toBe(
      false,
    );
  });
});
