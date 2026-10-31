import { FIXTURE_VARIANTS, actorFixture } from '../../../shared/lab-fixtures.js';
import type { Variant } from '../../../shared/analysis.js';
import type { Actor, StakeholderCategory } from '../../../shared/stakeholders.js';
import type { AnalysisInputs } from '../../src/analysis/runset.js';

/** Five abstract actors, with influence set so that ranking them is not a tie. */
export function testCast(): Actor[] {
  const make = (
    id: string,
    category: StakeholderCategory,
    influence: number,
    overrides: Partial<Actor> = {},
  ): Actor => {
    const actor = actorFixture(id, category, overrides);
    actor.traits.influence.value = influence;
    return actor;
  };
  return [
    make('subscribers', 'cost-bearer', 0.9, { size: 5_000, sampleSize: 20 }),
    make('rival-provider', 'competitor', 0.7, { kind: 'key', size: 1, sampleSize: 1 }),
    make('regulator', 'regulator', 0.6, { kind: 'key', size: 1, sampleSize: 1 }),
    make('provider', 'decision-maker', 0.5, { kind: 'key', size: 1, sampleSize: 1 }),
    make('resellers', 'partner', 0.4, { size: 40, sampleSize: 10 }),
  ];
}

export const BASELINE: Variant = FIXTURE_VARIANTS[0]!;
export const PROPOSED: Variant = FIXTURE_VARIANTS[1]!;

export const MILD: Variant = {
  id: 'milder-change',
  label: 'Milder change',
  kind: 'alternative',
  description: 'The same change at lower intensity.',
  round: 2,
  intensity: 0.3,
  impactOverrides: {},
  traitEdits: [],
};

export function inputs(overrides: Partial<AnalysisInputs> = {}): AnalysisInputs {
  return {
    id: 'analysis-1',
    createdAt: '2026-01-15T10:00:00.000Z',
    actors: testCast(),
    relations: [],
    variants: [BASELINE, PROPOSED, MILD],
    runsPerVariant: 12,
    baseSeed: 500,
    rounds: 8,
    sensitivity: false,
    ...overrides,
  };
}

export const clock = (): number => 1_700_000_000_000;
