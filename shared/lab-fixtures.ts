/**
 * Valid sample objects for tests and for building screens, made by parsing through the real schemas so
 * that they cannot drift from the contract. The names are deliberately abstract: nothing here belongs
 * to a market, a product or an industry. Every function returns a fresh object.
 */
import {
  analysisSchema,
  emptyResponseShares,
  type Analysis,
  type ResponseCategory,
  type Variant,
} from './analysis.js';
import { scenarioFrameSchema, type ScenarioFrame } from './scenario.js';
import {
  actorSchema,
  actorSetSchema,
  stakeholderSchema,
  stakeholderSetSchema,
  type Actor,
  type ActorSet,
  type Stakeholder,
  type StakeholderCategory,
  type StakeholderSet,
} from './stakeholders.js';

export const FIXTURE_TIME = '2026-01-15T10:00:00.000Z';

export function scenarioFixture(overrides: Partial<ScenarioFrame> = {}): ScenarioFrame {
  return scenarioFrameSchema.parse({
    decision: 'Whether the provider should raise the fee for a service by a fixed amount',
    system: 'A subscription service and the groups around it',
    geography: 'One region',
    horizon: 'The next two quarters',
    changes: [{ name: 'Monthly fee', from: 'current fee', to: 'current fee plus a fixed amount' }],
    baseline: 'The fee stays as it is.',
    alternatives: [
      { id: 'smaller-rise', label: 'Smaller rise', description: 'Half the proposed amount.' },
    ],
    requestedDecision: 'Go ahead, change it, or hold.',
    desiredOutput: 'A short decision brief',
    likelyStakeholders: ['subscribers', 'rival provider', 'regulator'],
    origin: 'user',
    ...overrides,
  });
}

const CATEGORY_IMPACT: Partial<Record<StakeholderCategory, 'harmed' | 'benefited'>> = {
  'cost-bearer': 'harmed',
  beneficiary: 'benefited',
};

export function stakeholderFixture(
  id: string,
  category: StakeholderCategory,
  overrides: Partial<Stakeholder> = {},
): Stakeholder {
  return stakeholderSchema.parse({
    id,
    name: id.replace(/-/gu, ' ').replace(/^./u, (letter) => letter.toUpperCase()),
    category,
    description: `The ${id.replace(/-/gu, ' ')} in this scenario.`,
    relevance: 'Affected by, or able to act on, the proposed change.',
    directness: 'direct',
    priority: 'standard',
    populationSize: 1,
    expectedImpact: {
      direction: CATEGORY_IMPACT[category] ?? 'unclear',
      rationale: 'Stated for the fixture only.',
    },
    uncertainty: { level: 'medium', reason: 'Fixture data.' },
    origin: 'rules',
    ...overrides,
  });
}

export function stakeholderSetFixture(): StakeholderSet {
  return stakeholderSetSchema.parse({
    stakeholders: [
      stakeholderFixture('provider', 'decision-maker', { priority: 'key' }),
      stakeholderFixture('subscribers', 'cost-bearer', { populationSize: 5_000 }),
      stakeholderFixture('rival-provider', 'competitor', { priority: 'key' }),
      stakeholderFixture('regulator', 'regulator', { priority: 'key' }),
      stakeholderFixture('resellers', 'partner', { populationSize: 40 }),
    ],
    relations: [
      { from: 'rival-provider', to: 'subscribers', type: 'competes-with', strength: 0.6 },
      { from: 'regulator', to: 'provider', type: 'regulates', strength: 0.5 },
      { from: 'resellers', to: 'provider', type: 'partners-with', strength: 0.5 },
    ],
    discovery: { mode: 'rules', model: null, generatedAt: FIXTURE_TIME, note: 'Fixture data.' },
    gaps: [],
    approvedAt: FIXTURE_TIME,
  });
}

const unsigned = (value: number) => ({
  value,
  spread: 0.1,
  origin: 'system-assumption' as const,
  rationale: 'Fixture assumption.',
});
const signed = (value: number) => unsigned(value);

export function actorFixture(
  id: string,
  category: StakeholderCategory,
  overrides: Partial<Actor> = {},
): Actor {
  const harmed = CATEGORY_IMPACT[category] === 'harmed';
  return actorSchema.parse({
    id,
    stakeholderId: id,
    name: id.replace(/-/gu, ' ').replace(/^./u, (letter) => letter.toUpperCase()),
    kind: 'cohort',
    category,
    size: 100,
    sampleSize: 20,
    role: `The ${id.replace(/-/gu, ' ')}`,
    traits: {
      priorStance: signed(0),
      impact: signed(harmed ? -0.6 : CATEGORY_IMPACT[category] === 'benefited' ? 0.6 : 0),
      influence: unsigned(0.5),
      openness: unsigned(0.4),
      sensitivity: unsigned(0.7),
      riskTolerance: unsigned(0.5),
      switchingCost: unsigned(0.4),
      trust: unsigned(0.5),
      adoptionTendency: unsigned(0.5),
      authority: unsigned(category === 'regulator' || category === 'competitor' ? 0.7 : 0.2),
      reactivity: unsigned(0.5),
    },
    uncertainty: { level: 'medium', reason: 'Fixture data.' },
    ...overrides,
  });
}

export function actorSetFixture(): ActorSet {
  return actorSetSchema.parse({
    actors: [
      actorFixture('provider', 'decision-maker', { kind: 'key', size: 1, sampleSize: 1 }),
      actorFixture('subscribers', 'cost-bearer', { size: 5_000, sampleSize: 30 }),
      actorFixture('rival-provider', 'competitor', { kind: 'key', size: 1, sampleSize: 1 }),
      actorFixture('regulator', 'regulator', { kind: 'key', size: 1, sampleSize: 1 }),
      actorFixture('resellers', 'partner', { size: 40, sampleSize: 10 }),
    ],
    relations: [
      { from: 'rival-provider', to: 'subscribers', type: 'competes-with', strength: 0.6 },
      { from: 'regulator', to: 'provider', type: 'regulates', strength: 0.5 },
      { from: 'resellers', to: 'provider', type: 'partners-with', strength: 0.5 },
    ],
    generatedAt: FIXTURE_TIME,
    mode: 'rules',
    stakeholderRevision: 1,
  });
}

export const FIXTURE_VARIANTS: Variant[] = [
  {
    id: 'baseline',
    label: 'No change',
    kind: 'baseline',
    description: 'The fee stays as it is.',
    round: 1,
    intensity: 0,
    impactOverrides: {},
    traitEdits: [],
  },
  {
    id: 'proposed-change',
    label: 'Proposed change',
    kind: 'alternative',
    description: 'The fee rises by the proposed amount.',
    round: 2,
    intensity: 0.7,
    impactOverrides: {},
    traitEdits: [],
  },
];

/** A cheap, repeatable stream so that the fixture's runs differ from one another but never from run to run. */
function stream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function sharesFor(adverse: number): Record<ResponseCategory, number> {
  const shares = emptyResponseShares();
  shares.resist = adverse * 0.4;
  shares.switch = adverse * 0.6;
  shares.wait = (1 - adverse) * 0.4;
  shares['adapt-defensively'] = (1 - adverse) * 0.3;
  shares['accept-with-conditions'] = (1 - adverse) * 0.2;
  shares.adopt = (1 - adverse) * 0.1;
  return shares;
}

/** A finished two-variant analysis of ten seeded runs each, with findings and sensitivity rows. */
export function analysisFixture(overrides: Partial<Analysis> = {}): Analysis {
  const actors = actorSetFixture();
  const runs = (adverseBase: number, seedOffset: number) => {
    const random = stream(seedOffset);
    return Array.from({ length: 10 }, (_, index) => {
      const adverse = Math.min(0.95, Math.max(0.02, adverseBase + (random() - 0.5) * 0.12));
      const stance = Number((0.2 - adverse * 0.9).toFixed(3));
      return {
        seed: 100 + index,
        stanceMean: stance,
        responseShares: sharesFor(adverse),
        byActor: actors.actors.map((actor) => ({
          actorId: actor.id,
          members: actor.sampleSize,
          stanceMean: stance,
          responseShares: sharesFor(adverse),
        })),
      };
    });
  };
  const band = (centre: number) =>
    Array.from({ length: 8 }, (_, index) => ({
      round: index + 1,
      p10: Number((centre - 0.1).toFixed(3)),
      p50: Number(centre.toFixed(3)),
      p90: Number((centre + 0.1).toFixed(3)),
    }));
  return analysisSchema.parse({
    id: 'analysis-1',
    status: 'completed',
    createdAt: FIXTURE_TIME,
    completedAt: FIXTURE_TIME,
    config: {
      runsPerVariant: 10,
      baseSeed: 100,
      rounds: 8,
      variants: FIXTURE_VARIANTS,
      sensitivity: true,
    },
    actors: actors.actors,
    relations: actors.relations,
    fidelity: {
      engine: 'rules',
      keyActors: 'rules',
      cohorts: 'rules',
      repeatedRuns: 10,
      modelRepeats: 0,
      label: 'Rules: outcomes follow from the declared assumptions',
      caveats: ['No model was used to decide any actor’s behaviour.'],
    },
    progress: { completedRuns: 20, totalRuns: 20 },
    variants: [
      { variantId: 'baseline', runs: runs(0.1, 1), trajectory: band(0.1) },
      { variantId: 'proposed-change', runs: runs(0.45, 2), trajectory: band(-0.2) },
    ],
    findings: [
      {
        id: 'f1',
        kind: 'direction-vs-baseline',
        variantId: 'proposed-change',
        actorId: null,
        statement:
          'Under the proposed change, simulated members ended less favourable than under no change in 10 of 10 runs.',
        predicate: 'Overall final stance under the change is below the baseline on the same seed.',
        holdsIn: 10,
        of: 10,
        interval: { lo: 0.72, hi: 1 },
        classification: 'mostly-repeatable',
      },
      {
        id: 'f2',
        kind: 'majority-response',
        variantId: 'proposed-change',
        actorId: 'subscribers',
        statement:
          'Most simulated subscribers ended up looking for an alternative or resisting in 6 of 10 runs.',
        predicate: 'Switch plus resist is the largest share within the actor.',
        holdsIn: 6,
        of: 10,
        interval: { lo: 0.31, hi: 0.83 },
        classification: 'unstable',
      },
    ],
    sensitivity: [
      {
        id: 's1',
        target: { kind: 'trait', actorId: 'subscribers', trait: 'switchingCost' },
        label: 'Subscribers: cost of switching, 0.2 higher',
        perturbation: 0.2,
        metric: 'Share ending in switch or resist',
        baseMean: 0.45,
        shift: -0.12,
        standardError: 0.01,
        classification: 'assumption-sensitive',
        assumptionOrigin: 'system-assumption',
      },
    ],
    representativeRun: null,
    crossCheck: null,
    cost: {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      simulatedRuns: 20,
      simulatedMembers: 1_300,
      wallMs: 40,
    },
    error: null,
    ...overrides,
  });
}
