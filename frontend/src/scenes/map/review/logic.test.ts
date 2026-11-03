import { describe, expect, it } from 'vitest';
import { stakeholderFixture } from '../../../../../shared/lab-fixtures';
import type {
  ParticipantIssue,
  ParticipantReview,
  Stakeholder,
} from '../../../../../shared/stakeholders';
import {
  changesBetween,
  factsOf,
  gateOf,
  groupByRole,
  hasChanges,
  indexIssues,
  linesOf,
  mergeGroupOf,
  missingInput,
  missingProblems,
  participantDraftOf,
  participantDraftProblems,
  proposedIds,
  reasonOf,
  selectionOf,
  sentencesOf,
  splitCoverage,
  toggled,
  withRole,
} from './logic';

const issue = (
  patch: Partial<ParticipantIssue> & Pick<ParticipantIssue, 'code'>,
): ParticipantIssue => ({
  id: `${patch.code}:${patch.participantId ?? 'all'}`,
  severity: 'advisory',
  participantId: null,
  relatedIds: [],
  role: null,
  message: 'Something to look at.',
  fix: 'Look at it.',
  fixAction: null,
  ...patch,
});

const reviewOf = (patch: Partial<ParticipantReview> = {}): ParticipantReview => ({
  valid: true,
  profile: 'strict',
  summary:
    'Swarm proposes these 2 participants because it involves two roles. They are synthetic roles, not real people.',
  counts: {
    participants: 2,
    key: 1,
    sourced: 1,
    assumed: 1,
    proposed: 2,
    removed: 0,
    blocking: 0,
    advisory: 0,
  },
  coverage: [],
  issues: [],
  ...patch,
});

describe('grouping participants by the role they play', () => {
  it('lists the roles in the order of the taxonomy, each with its members, and leaves out roles nobody holds', () => {
    const list: Stakeholder[] = [
      stakeholderFixture('night-crew', 'operations', { participantRole: 'implementers' }),
      stakeholderFixture('chair', 'decision-maker', { participantRole: 'decision-owner' }),
      stakeholderFixture('inspectors', 'regulator'),
    ];
    const groups = groupByRole(list);
    expect(groups.map((group) => group.role)).toEqual([
      'decision-owner',
      'implementers',
      'regulators-governance',
    ]);
    expect(groups[0]).toMatchObject({ label: 'Decision owner' });
    expect(groups[0]?.meaning).not.toBe('');
  });

  it('puts a participant saved before roles existed under the role its category stands for, and leaves out the removed', () => {
    const list = [
      stakeholderFixture('buyers', 'end-user'),
      stakeholderFixture('gone', 'end-user', { status: 'removed' }),
    ];
    const groups = groupByRole(list);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.role).toBe('customers-users');
    expect(groups[0]?.members.map((member) => member.id)).toEqual(['buyers']);
  });
});

describe('what the checks found', () => {
  it('keeps issues about one participant together, blocking first, and those about the whole list apart', () => {
    const index = indexIssues([
      issue({ code: 'broad-name', participantId: 'a' }),
      issue({ code: 'generic-name', participantId: 'a', severity: 'blocking' }),
      issue({ code: 'too-many' }),
      issue({ code: 'incomplete', participantId: 'b', severity: 'blocking' }),
    ]);
    expect(index.byParticipant.get('a')?.map((item) => item.code)).toEqual([
      'generic-name',
      'broad-name',
    ]);
    expect(index.byParticipant.get('b')).toHaveLength(1);
    expect(index.general.map((item) => item.code)).toEqual(['too-many']);
  });

  it('shuts the way on while a blocking issue stands, and says how many things to fix; with no checks to read it holds nothing back', () => {
    const shut = gateOf(
      reviewOf({
        valid: false,
        counts: { ...reviewOf().counts, blocking: 2, advisory: 1 },
      }),
    );
    expect(shut).toEqual({ open: false, blocking: 2, advisory: 1, hint: 'Fix 2 things first' });
    expect(
      gateOf(reviewOf({ valid: false, counts: { ...reviewOf().counts, blocking: 1 } })).hint,
    ).toBe('Fix 1 thing first');
    expect(gateOf(reviewOf()).open).toBe(true);
    expect(gateOf(null)).toEqual({ open: true, blocking: 0, advisory: 0, hint: undefined });
  });

  it('splits the coverage of the roles into held, missing and optional', () => {
    const split = splitCoverage([
      { role: 'decision-owner', count: 1, status: 'covered', reason: null },
      { role: 'approvers', count: 0, status: 'missing', reason: 'The question names an approval.' },
      { role: 'competitors-alternatives', count: 0, status: 'optional', reason: null },
    ]);
    expect(split.covered.map((item) => item.role)).toEqual(['decision-owner']);
    expect(split.missing.map((item) => item.role)).toEqual(['approvers']);
    expect(split.optional.map((item) => item.role)).toEqual(['competitors-alternatives']);
  });
});

describe('choosing participants to accept', () => {
  const list = [
    stakeholderFixture('a-group', 'other', { status: 'proposed' }),
    stakeholderFixture('b-group', 'other', { status: 'accepted' }),
    stakeholderFixture('c-group', 'other', { status: 'proposed' }),
  ];

  it('offers only what is still proposed', () => {
    expect(proposedIds(list)).toEqual(['a-group', 'c-group']);
  });

  it('forgets a choice once the participant is accepted, removed or gone', () => {
    const chosen = new Set(['a-group', 'b-group', 'gone']);
    expect([...selectionOf(chosen, list)]).toEqual(['a-group']);
    expect([...toggled(new Set(['a-group']), 'a-group')]).toEqual([]);
    expect([...toggled(new Set(['a-group']), 'c-group')].sort()).toEqual(['a-group', 'c-group']);
  });
});

describe('what a card says of its participant', () => {
  it('gives the reason in full, with the passage it cites, and not a reason that is only the category’s own wording', () => {
    const sourced = stakeholderFixture('a-group', 'other', {
      relevance: 'Sets the rules. A cited passage reads “Rules apply.”',
    });
    expect(reasonOf(sourced)).toBe('Sets the rules. A cited passage reads “Rules apply.”');
    const generic = stakeholderFixture('b-group', 'other', {
      relevance: 'Category default: a party of this kind.',
      description: 'Runs the depot. Works nights.',
    });
    expect(reasonOf(generic)).toBe('Runs the depot.');
  });

  it('lists what it holds, the objective first, and nothing that is empty', () => {
    const facts = factsOf(
      stakeholderFixture('crew', 'operations', {
        objective: 'Keep the service running.',
        incentives: ['A steady rota'],
        concerns: [],
      }),
    );
    expect(facts.map((group) => group.key)).toEqual(['objective', 'incentives']);
    expect(facts[0]?.items).toEqual(['Keep the service running.']);
  });

  it('breaks the summary into sentences, one to a line', () => {
    expect(
      sentencesOf('Swarm proposes these 2 participants because “A. B.” matters. Next one. Last.'),
    ).toEqual([
      'Swarm proposes these 2 participants because “A. B.” matters.',
      'Next one.',
      'Last.',
    ]);
  });
});

describe('merging what looks like one participant', () => {
  const ref = (passageId: string) => ({
    passageId,
    documentId: 'D1',
    documentName: 'notes.md',
    start: 0,
    end: 9,
    quote: 'A quotation.',
    contentHash: 'hash',
    role: 'supports' as const,
  });
  it('keeps the one with most behind it and folds the others into it', () => {
    const list = [
      stakeholderFixture('night-crew', 'operations'),
      stakeholderFixture('night-staff', 'operations', { evidence: [ref('S1'), ref('S2')] }),
    ];
    expect(
      mergeGroupOf({ participantId: 'night-crew', relatedIds: ['night-staff'] }, list),
    ).toEqual({ keep: 'night-staff', merge: ['night-crew'] });
  });

  it('is nothing when fewer than two of them are still in the list', () => {
    const list = [
      stakeholderFixture('night-crew', 'operations'),
      stakeholderFixture('night-staff', 'operations', { status: 'removed' }),
    ];
    expect(
      mergeGroupOf({ participantId: 'night-crew', relatedIds: ['night-staff'] }, list),
    ).toBeNull();
    expect(mergeGroupOf({ participantId: null, relatedIds: [] }, list)).toBeNull();
  });
});

describe('changing a participant', () => {
  const original = stakeholderFixture('crew', 'operations', {
    name: 'Night operations crew',
    participantRole: 'implementers',
    objective: 'Keep the service running.',
    incentives: ['A steady rota'],
  });

  it('sends nothing for a draft nobody touched', () => {
    const changes = changesBetween(original, participantDraftOf(original));
    expect(changes).toEqual({});
    expect(hasChanges(changes)).toBe(false);
  });

  it('sends only what the person changed, with lists as one item to a line', () => {
    const draft = {
      ...participantDraftOf(original),
      name: '  Night shift operations crew ',
      incentives: 'A steady rota\n\n  Fewer cancelled shifts  \n',
      influence: 'high' as const,
    };
    expect(changesBetween(original, draft)).toEqual({
      name: 'Night shift operations crew',
      incentives: ['A steady rota', 'Fewer cancelled shifts'],
      influence: 'high',
    });
  });

  it('moves the kind of party with the role when the old kind does not go with the new role', () => {
    const draft = withRole(participantDraftOf(original), 'regulators-governance');
    expect(draft.category).toBe('regulator');
    const kept = withRole(participantDraftOf(original), 'implementers');
    expect(kept.category).toBe('operations');
    expect(changesBetween(original, draft)).toMatchObject({
      participantRole: 'regulators-governance',
      category: 'regulator',
    });
  });

  it('says what is wrong with a draft before it is sent', () => {
    const problems = participantDraftProblems({
      ...participantDraftOf(original),
      name: ' ',
      incentives: Array.from({ length: 7 }, (_, index) => `Line ${index}`).join('\n'),
      plausibleActions: 'x'.repeat(201),
      populationSize: '0',
    });
    expect(Object.keys(problems).sort()).toEqual([
      'incentives',
      'name',
      'plausibleActions',
      'populationSize',
    ]);
    expect(participantDraftProblems(participantDraftOf(original))).toEqual({});
  });

  it('reads lines as a person writes them', () => {
    expect(linesOf('one\r\n\r\n two \n')).toEqual(['one', 'two']);
  });
});

describe('adding a participant for a role nobody holds', () => {
  it('wants a name of a few words and sends only what was written', () => {
    expect(
      missingProblems({ role: 'approvers', name: 'Hi', whyTheyMatter: '', objective: '' }),
    ).toHaveProperty('name');
    const draft = {
      role: 'approvers' as const,
      name: '  Licence approval panel ',
      whyTheyMatter: '',
      objective: ' Check the change fits the rules. ',
    };
    expect(missingProblems(draft)).toEqual({});
    expect(missingInput(draft)).toEqual({
      role: 'approvers',
      name: 'Licence approval panel',
      objective: 'Check the change fits the rules.',
    });
  });
});
