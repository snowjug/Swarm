import {
  simulationSpecSchema,
  type SimulationSpec,
  type Variant,
} from '../../../shared/analysis.js';
import { actorFixture } from '../../../shared/lab-fixtures.js';
import type { Actor, StakeholderCategory, TraitKey } from '../../../shared/stakeholders.js';

type TraitSetting = number | { value: number; spread?: number };

export interface ActorOptions {
  kind?: Actor['kind'];
  size?: number;
  sampleSize?: number;
  traits?: Partial<Record<TraitKey, TraitSetting>>;
}

/** An actor with the fixture's defaults and the given traits (a number sets the value, spread kept). */
export function actor(
  id: string,
  category: StakeholderCategory,
  options: ActorOptions = {},
): Actor {
  const built = actorFixture(id, category, {
    kind: options.kind ?? 'cohort',
    size: options.size ?? 100,
    sampleSize: options.sampleSize ?? 20,
  });
  for (const [key, setting] of Object.entries(options.traits ?? {}) as [TraitKey, TraitSetting][]) {
    const trait = built.traits[key];
    if (typeof setting === 'number') trait.value = setting;
    else {
      trait.value = setting.value;
      if (setting.spread !== undefined) trait.spread = setting.spread;
    }
  }
  return built;
}

export const key = (
  id: string,
  category: StakeholderCategory,
  traits: ActorOptions['traits'] = {},
): Actor => actor(id, category, { kind: 'key', size: 1, sampleSize: 1, traits });

export function variant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'change',
    label: 'The change',
    kind: 'alternative',
    description: '',
    round: 2,
    intensity: 0.7,
    impactOverrides: {},
    traitEdits: [],
    ...overrides,
  };
}

export function spec(
  actors: Actor[],
  options: {
    relations?: SimulationSpec['relations'];
    rounds?: number;
    variant?: Partial<Variant>;
  } = {},
): SimulationSpec {
  return simulationSpecSchema.parse({
    actors,
    relations: options.relations ?? [],
    rounds: options.rounds ?? 10,
    variant: variant(options.variant),
  });
}

/**
 * The abstract cast of the second-order tests: Alpha is harmed by the change, Beta is a competitor
 * and Gamma a substitute, both watching Alpha. None of the names means anything outside the test.
 */
export function chainCast(): Actor[] {
  return [
    actor('alpha', 'cost-bearer', {
      size: 1_000,
      sampleSize: 40,
      traits: {
        priorStance: { value: 0, spread: 0.05 },
        impact: { value: -0.6, spread: 0.05 },
        sensitivity: { value: 0.8, spread: 0.05 },
        switchingCost: { value: 0.65, spread: 0.05 },
        riskTolerance: { value: 0.4, spread: 0.05 },
      },
    }),
    key('beta', 'competitor', {
      impact: 0,
      reactivity: 0.5,
      riskTolerance: 0.4,
      authority: 0.8,
    }),
    key('gamma', 'substitute', {
      impact: 0,
      reactivity: 0.8,
      riskTolerance: 0.3,
      authority: 0.6,
    }),
  ];
}

export const CHAIN_RELATIONS: SimulationSpec['relations'] = [
  { from: 'beta', to: 'alpha', type: 'competes-with', strength: 0.8 },
  { from: 'gamma', to: 'alpha', type: 'substitutes-for', strength: 0.7 },
];
