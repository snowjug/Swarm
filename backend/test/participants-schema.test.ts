import { describe, expect, it } from 'vitest';
import {
  CATEGORY_DEFAULT_ROLE,
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_LABELS,
  PARTICIPANT_ROLE_MEANINGS,
  PROHIBITED_PARTICIPANT_FIELDS,
  ROLE_CATEGORIES,
  STAKEHOLDER_CATEGORIES,
  actorSchema,
  participantOf,
  proposedParticipantsSchema,
  stakeholderSetSchema,
} from '../../shared/stakeholders.js';
import {
  ROLE_CUES,
  ROLE_DEFAULTS,
  ROLE_COUNT_PHRASE,
} from '../src/stakeholders/participants/taxonomy.js';
import { actorFixture, stakeholderSetFixture } from '../../shared/lab-fixtures.js';
import { participant, passagesOf, proposal } from './support/participants-world.js';

const passages = passagesOf();

// What was stored before participants existed: no role, no profile, no proposal. It is written out in
// full, as the old code wrote it, so that this test fails if the schema stops reading it.
const OLD_SET = {
  stakeholders: [
    {
      id: 'regulators',
      name: 'Regulators',
      category: 'regulator',
      description: 'Public bodies.',
      relevance: 'Their notice rule applies.',
      directness: 'indirect',
      priority: 'key',
      populationSize: 1,
      expectedImpact: { direction: 'unclear', rationale: 'No direction in the text.' },
      evidence: [],
      assumptions: ['An assumption.'],
      uncertainty: { level: 'high', reason: 'One sentence.' },
      origin: 'rules',
      status: 'accepted',
      mergedFrom: [],
    },
    {
      id: 'customers',
      name: 'Customers',
      category: 'cost-bearer',
      directness: 'direct',
      priority: 'standard',
      expectedImpact: { direction: 'harmed' },
      uncertainty: { level: 'medium', reason: 'Two sentences.' },
      origin: 'user',
    },
  ],
  discovery: { mode: 'rules', generatedAt: '2026-03-01T09:00:00.000Z' },
  approvedAt: '2026-03-01T10:00:00.000Z',
};

describe('the participant taxonomy', () => {
  it('has fourteen roles, each said in words, each with the categories it may take', () => {
    expect(PARTICIPANT_ROLES).toHaveLength(14);
    for (const role of PARTICIPANT_ROLES) {
      expect(PARTICIPANT_ROLE_LABELS[role], role).toBeTruthy();
      expect(PARTICIPANT_ROLE_MEANINGS[role], role).toMatch(/\.$/u);
      expect(ROLE_CATEGORIES[role].length, role).toBeGreaterThan(0);
      expect(ROLE_DEFAULTS[role].plausibleActions.length, role).toBeGreaterThan(0);
      expect(ROLE_COUNT_PHRASE[role], role).toHaveLength(2);
      expect(role in ROLE_CUES, role).toBe(true);
    }
  });

  it('maps every category onto a role that may take it, and back, so that nothing breaks an exhaustive table of categories', () => {
    for (const category of STAKEHOLDER_CATEGORIES) {
      const role = CATEGORY_DEFAULT_ROLE[category];
      expect(ROLE_CATEGORIES[role], `${category} -> ${role}`).toContain(category);
    }
    for (const role of PARTICIPANT_ROLES) {
      expect(STAKEHOLDER_CATEGORIES).toContain(ROLE_CATEGORIES[role][0]);
    }
  });

  it('keeps the categories as they were: the lens the engine reads a party through is not changed', () => {
    expect(STAKEHOLDER_CATEGORIES).toEqual([
      'decision-maker',
      'end-user',
      'cost-bearer',
      'risk-bearer',
      'beneficiary',
      'influencer',
      'competitor',
      'substitute',
      'partner',
      'channel',
      'regulator',
      'governance',
      'operations',
      'other',
    ]);
  });
});

describe('a set stored before participants existed', () => {
  it('still parses, and gains none of the new fields', () => {
    const set = stakeholderSetSchema.parse(OLD_SET);
    expect(set.proposal).toBeUndefined();
    for (const stakeholder of set.stakeholders) {
      expect(stakeholder.participantRole).toBeUndefined();
      expect(stakeholder.objective).toBeUndefined();
      expect(stakeholder.plausibleActions).toBeUndefined();
      expect(stakeholder.prohibitedClaims).toBeUndefined();
      expect(stakeholder.synthetic).toBeUndefined();
    }
    // What was stored is what comes back, field for field.
    expect(JSON.parse(JSON.stringify(set)).stakeholders[0]).toMatchObject({
      id: 'regulators',
      status: 'accepted',
    });
  });

  it('reads as a participant with the defaults of its role, which say nothing about the sources', () => {
    const [regulators, customers] = stakeholderSetSchema.parse(OLD_SET).stakeholders;
    expect(participantOf(regulators!)).toMatchObject({
      role: 'regulators-governance',
      decisionAuthority: 'can-block',
      influence: 'high',
      confidenceBasis: 'category-pattern',
      synthetic: true,
      plausibleActions: [],
    });
    expect(participantOf(customers!)).toMatchObject({
      role: 'directly-affected',
      confidenceBasis: 'user-assertion',
      influence: 'medium',
      decisionAuthority: 'none',
    });
  });

  it('keeps the fixture set and the fixture actor that every other test builds on', () => {
    expect(() => stakeholderSetSchema.parse(stakeholderSetFixture())).not.toThrow();
    const actor = actorSchema.parse(actorFixture('customers', 'end-user'));
    expect(actor.synthetic).toBeUndefined();
    expect(actor.plausibleActions).toBeUndefined();
  });

  it('accepts a participant with its profile, and refuses a profile that says it is not synthetic', () => {
    const base = OLD_SET.stakeholders[0]!;
    const profile = {
      ...base,
      participantRole: 'regulators-governance',
      objective: 'Uphold the rules.',
      incentives: ['Stay within the rules.'],
      influence: 'high',
      decisionAuthority: 'can-block',
      plausibleActions: ['Ask for evidence.'],
      prohibitedClaims: ['What any real regulator has decided.'],
      confidenceBasis: 'source-quote',
      synthetic: true,
    };
    const parse = (stakeholder: unknown) =>
      stakeholderSetSchema.safeParse({ ...OLD_SET, stakeholders: [stakeholder] });
    expect(parse(profile).success).toBe(true);
    expect(parse({ ...profile, synthetic: false }).success).toBe(false);
    expect(parse({ ...profile, participantRole: 'staff' }).success).toBe(false);
    expect(parse({ ...profile, influence: 'extreme' }).success).toBe(false);
    expect(parse({ ...profile, plausibleActions: Array(9).fill('Act.') }).success).toBe(false);
  });
});

describe('ProposedParticipants v1', () => {
  const valid = () => JSON.parse(JSON.stringify(proposal(passages))) as Record<string, unknown>;

  it('accepts a proposal that is complete', () => {
    expect(proposedParticipantsSchema.safeParse(valid()).success).toBe(true);
  });

  it('is versioned: another version is refused', () => {
    expect(proposedParticipantsSchema.safeParse({ ...valid(), version: 2 }).success).toBe(false);
    const body = valid();
    delete body.version;
    expect(proposedParticipantsSchema.safeParse(body).success).toBe(false);
  });

  it('refuses a participant that says it is not synthetic, or does not say', () => {
    const one = participant(passages);
    const parse = (change: Record<string, unknown>) =>
      proposedParticipantsSchema.safeParse({
        ...valid(),
        participants: [{ ...one, ...change }, valid().participants as never].flat(),
      });
    expect(parse({ synthetic: false }).success).toBe(false);
    expect(parse({ synthetic: undefined }).success).toBe(false);
  });

  it.each(PROHIBITED_PARTICIPANT_FIELDS)('refuses a participant with the field %s', (field) => {
    const body = valid();
    (body.participants as Record<string, unknown>[])[0]![field] = 'x';
    const result = proposedParticipantsSchema.safeParse(body);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain(field);
    }
  });

  it('refuses a field it was not asked for anywhere in the reply', () => {
    expect(proposedParticipantsSchema.safeParse({ ...valid(), advice: 'x' }).success).toBe(false);
    const body = valid();
    (body.participants as Record<string, unknown>[])[0]!.impact = {
      direction: 'unclear',
      rationale: '',
      confidence: 0.9,
    };
    expect(proposedParticipantsSchema.safeParse(body).success).toBe(false);
  });

  it('holds its bounds: counts, ids, enums and lengths', () => {
    const body = valid();
    const list = body.participants as Record<string, unknown>[];
    const first = list[0]!;
    const refused = (change: Record<string, unknown>, among = [first]): boolean =>
      !proposedParticipantsSchema.safeParse({
        ...body,
        participants: [{ ...first, ...change }, ...among.slice(1)],
      }).success;
    expect(refused({ id: 'City Council' })).toBe(true);
    expect(refused({ id: 'x'.repeat(49) })).toBe(true);
    expect(refused({ role: 'staff' })).toBe(true);
    expect(refused({ category: 'people' })).toBe(true);
    expect(refused({ name: 'ab' })).toBe(true);
    expect(refused({ plausibleActions: [] })).toBe(true);
    expect(refused({ plausibleActions: Array(7).fill('Could act here.') })).toBe(true);
    expect(refused({ incentives: Array(7).fill('Could want this.') })).toBe(true);
    expect(refused({ evidence: Array(7).fill({ passageId: 'S1', quote: 'a quote' }) })).toBe(true);
    expect(refused({ evidence: [{ passageId: 'S1' }] })).toBe(true);
    expect(refused({ confidenceBasis: 'certain' })).toBe(true);
    expect(refused({ populationSize: 0 })).toBe(true);
    expect(refused({ whyTheyMatter: 'x'.repeat(601) })).toBe(true);
    expect(proposedParticipantsSchema.safeParse({ ...body, participants: [] }).success).toBe(false);
    expect(
      proposedParticipantsSchema.safeParse({
        ...body,
        participants: Array.from({ length: 31 }, (_, index) => ({ ...first, id: `p-${index}` })),
      }).success,
    ).toBe(false);
    expect(
      proposedParticipantsSchema.safeParse({
        ...body,
        relations: [{ from: 'a', to: 'b', type: 'worships', strength: 0.5 }],
      }).success,
    ).toBe(false);
    expect(
      proposedParticipantsSchema.safeParse({
        ...body,
        relations: [{ from: 'a', to: 'b', type: 'influences', strength: 1.5 }],
      }).success,
    ).toBe(false);
  });

  it('fills the optional lists a reply leaves out, so that a short answer is still whole', () => {
    const body = valid();
    const first = (body.participants as Record<string, unknown>[])[0]!;
    for (const key of [
      'incentives',
      'pressures',
      'constraints',
      'concerns',
      'assumptions',
      'evidence',
    ]) {
      delete first[key];
    }
    delete body.relations;
    delete body.gaps;
    const parsed = proposedParticipantsSchema.parse(body);
    expect(parsed.participants[0]).toMatchObject({ incentives: [], concerns: [], evidence: [] });
    expect(parsed.relations).toEqual([]);
    expect(parsed.gaps).toEqual([]);
  });
});
