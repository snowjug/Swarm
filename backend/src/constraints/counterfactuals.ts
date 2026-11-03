import type { SimulationSpec, Simulator, Variant } from '../../../shared/analysis.js';
import type {
  AppliedConstraint,
  ConstraintImpactClass,
} from '../../../shared/constraint-effects.js';
import {
  COUNTERFACTUAL_LABELS,
  CONSTRAINT_SCHEMA_VERSION,
  isLive,
  type Constraint,
  type ConstraintCategory,
  type Counterfactual,
  type CounterfactualId,
  type CounterfactualSet,
} from '../../../shared/constraints.js';
import type { Actor, ActorRelation } from '../../../shared/stakeholders.js';
import { pairedDifferences, mean, round4, standardError } from '../analysis/stats.js';
import { classifySensitivity, headlineShare } from '../analysis/sensitivity.js';
import { appliedFor, compileConstraints, type World } from './enforce.js';

/** The seeds the views are measured on: enough to tell a difference from noise, few enough to answer in a moment. */
export const COUNTERFACTUAL_SEEDS = 12;
/** How much later the change lands in the delayed view, in rounds. */
export const DELAY_ROUNDS = 3;
/** How far the regulators' authority is raised, and their tolerance of risk lowered, in the stronger view. */
export const REGULATION_STEP = 0.2;
/** How much lower every actor's readiness to take the change up is in the lower-adoption view. */
export const ADOPTION_DROP = 0.2;

const REGULATORY: readonly ConstraintCategory[] = [
  'regulatory',
  'legal',
  'privacy',
  'security',
  'safety',
];
const CAPACITY: readonly ConstraintCategory[] = [
  'capacity',
  'staffing',
  'infrastructure',
  'operational',
];
const DEPENDENCY: readonly ConstraintCategory[] = [
  'dependency',
  'technical-feasibility',
  'infrastructure',
];
const AUTHORITIES = ['regulator', 'governance', 'decision-maker'] as const;

const IMPACT_CLASS = {
  'assumption-sensitive': 'material',
  robust: 'negligible',
  inconclusive: 'inconclusive',
} as const satisfies Record<string, ConstraintImpactClass>;

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

interface View {
  id: CounterfactualId;
  change: string;
  driver: string;
  driverConstraintIds: string[];
  /** The spec to run, or the reason it cannot be. */
  spec: SimulationSpec | null;
  reason: string | null;
}

export interface CounterfactualInput {
  actors: readonly Actor[];
  relations: readonly ActorRelation[];
  rounds: number;
  /** The proposed change: the scenario every view is a variation of. */
  variant: Variant;
  /** Every scenario of the comparison, for checking what a constraint names. */
  variantIds: ReadonlySet<string>;
  constraints: readonly Constraint[];
  seeds: readonly number[];
  simulator: Simulator;
  inputs: CounterfactualSet['inputs'];
  now: Date;
  yieldNow?: () => Promise<void>;
}

const withoutIds = (applied: readonly AppliedConstraint[], ids: ReadonlySet<string>) =>
  applied.filter((item) => !ids.has(item.id));

/**
 * The seven views of the proposed change, each the same run with one thing different, on the same
 * seeds as the base so that the difference is the thing's and not the dice's. A view that does not fit
 * the project says why and is not run. None of them is a forecast: each says what the simulation does
 * when that one thing is different.
 */
function viewsOf(input: CounterfactualInput): View[] {
  const world: World = {
    actorIds: new Set(input.actors.map((actor) => actor.id)),
    variantIds: input.variantIds,
  };
  const live = input.constraints.filter(isLive);
  const compiled = compileConstraints(input.constraints, world);
  const base = appliedFor(compiled.applied, input.variant.id);
  const specOf = (
    constraints: AppliedConstraint[],
    overrides: Partial<SimulationSpec> = {},
  ): SimulationSpec => ({
    actors: [...input.actors],
    relations: [...input.relations],
    rounds: input.rounds,
    variant: input.variant,
    ...(constraints.length > 0 ? { constraints } : {}),
    ...overrides,
  });
  const idsOf = (categories: readonly ConstraintCategory[]): Set<string> =>
    new Set(
      compiled.applied
        .filter((item) => (categories as readonly string[]).includes(item.category))
        .map((item) => item.constraintId),
    );
  const textOf = (ids: ReadonlySet<string>): string =>
    clip(
      live
        .filter((constraint) => ids.has(constraint.id))
        .map((constraint) => constraint.statement)
        .join(' · '),
      200,
    );
  const unread = (categories: readonly ConstraintCategory[]): boolean =>
    compiled.notApplied.some((item) => (categories as readonly string[]).includes(item.category));
  const taking = (
    id: CounterfactualId,
    categories: readonly ConstraintCategory[],
    what: string,
  ): View => {
    const ids = idsOf(categories);
    if (ids.size === 0) {
      return {
        id,
        change: `The ${what} constraints the simulation applies are taken away.`,
        driver: '',
        driverConstraintIds: [],
        spec: null,
        reason: unread(categories)
          ? `A ${what} constraint is read but not modelled, so the simulation has nothing of it to take away.`
          : `No ${what} constraint is applied by the simulation, so taking it away changes nothing.`,
      };
    }
    return {
      id,
      change: `The ${what} constraints the simulation applies are taken away.`,
      driver: `${what[0]?.toUpperCase() ?? ''}${what.slice(1)} constraint: ${textOf(ids)}`,
      driverConstraintIds: [...ids],
      spec: specOf(withoutIds(base, ids)),
      reason: null,
    };
  };

  const views: View[] = [];
  views.push(taking('without-budget', ['budget'], 'budget'));

  const landsAt = input.variant.round + DELAY_ROUNDS;
  views.push({
    id: 'delayed-implementation',
    change: `The change lands ${DELAY_ROUNDS} rounds later than it does in the base.`,
    driver: `Setting: the change lands in round ${landsAt} instead of round ${input.variant.round}.`,
    driverConstraintIds: [],
    spec:
      landsAt <= input.rounds
        ? specOf(base, { variant: { ...input.variant, round: landsAt } })
        : null,
    reason:
      landsAt <= input.rounds
        ? null
        : `A run of ${input.rounds} rounds is too short for a change that lands in round ${landsAt}.`,
  });

  const regulators = input.actors.filter((actor) => actor.category === 'regulator');
  const regulatory = idsOf(REGULATORY);
  const stronger: AppliedConstraint[] = base.map((item) => {
    if (!regulatory.has(item.id)) return item;
    const { effect } = item;
    switch (effect.kind) {
      case 'add-risk':
        return { ...item, effect: { ...effect, amount: Math.min(1, round4(effect.amount * 1.5)) } };
      case 'add-cost':
        return {
          ...item,
          effect: { ...effect, amount: Math.min(0.5, round4(effect.amount * 1.5)) },
        };
      case 'reduce-influence':
        return {
          ...item,
          effect: { ...effect, amount: Math.min(0.9, round4(effect.amount * 1.5)) },
        };
      case 'delay':
        return { ...item, effect: { ...effect, rounds: Math.min(36, effect.rounds + 1) } };
      default:
        return item;
    }
  });
  const strengthened = stronger.some((item, at) => item !== base[at]);
  views.push({
    id: 'stronger-regulation',
    change:
      'Regulators hold more authority and accept less risk, and the regulatory limits that are applied are one half stronger.',
    driver: [
      regulators.length > 0
        ? `Regulators: authority up by ${REGULATION_STEP}, risk tolerance down by ${REGULATION_STEP}`
        : '',
      strengthened ? `regulatory constraints made stronger: ${textOf(regulatory)}` : '',
    ]
      .filter(Boolean)
      .join('; '),
    driverConstraintIds: strengthened ? [...regulatory] : [],
    spec:
      regulators.length > 0 || strengthened
        ? specOf(stronger, {
            actors: input.actors.map((actor) => {
              if (actor.category !== 'regulator') return actor;
              const { traits } = actor;
              return {
                ...actor,
                traits: {
                  ...traits,
                  authority: {
                    ...traits.authority,
                    value: Math.min(1, round4(traits.authority.value + REGULATION_STEP)),
                  },
                  riskTolerance: {
                    ...traits.riskTolerance,
                    value: Math.max(0, round4(traits.riskTolerance.value - REGULATION_STEP)),
                  },
                },
              };
            }),
          })
        : null,
    reason:
      regulators.length > 0 || strengthened
        ? null
        : 'Nobody in the cast is a regulator and no regulatory constraint is applied, so there is nothing to strengthen.',
  });

  views.push({
    id: 'lower-adoption',
    change: `Every actor is ${ADOPTION_DROP} less ready to take the change up.`,
    driver: `Setting: readiness to take the change up is ${ADOPTION_DROP} lower for every actor.`,
    driverConstraintIds: [],
    spec: specOf([
      ...base,
      {
        id: 'cf-lower-adoption',
        effect: { kind: 'add-cost', target: 'adoption', amount: ADOPTION_DROP },
        actorIds: [],
        fromRound: null,
        toRound: null,
      },
    ]),
    reason: null,
  });

  views.push(taking('higher-capacity', CAPACITY, 'capacity'));

  const owners = compiled.applied.filter((item) => item.effect.kind === 'require-approval');
  const authority = (actor: Actor): number => actor.traits.authority.value;
  const swapped = base.map((item) => {
    if (item.effect.kind !== 'require-approval') return item;
    const current = item.effect.approverActorId;
    const other = input.actors
      .filter(
        (actor) =>
          actor.id !== current && (AUTHORITIES as readonly string[]).includes(actor.category),
      )
      .sort((a, b) => authority(b) - authority(a) || a.id.localeCompare(b.id))[0];
    return other ? { ...item, effect: { ...item.effect, approverActorId: other.id } } : item;
  });
  const swappable = swapped.some((item, at) => item !== base[at]);
  const ownerIds = [...new Set(owners.map((item) => item.constraintId))];
  views.push({
    id: 'different-decision-owner',
    change: 'The approval a constraint asks for comes from another authority in the cast.',
    driver: swappable ? `Approval constraint: ${textOf(new Set(ownerIds))}` : '',
    driverConstraintIds: swappable ? ownerIds : [],
    spec: swappable ? specOf(swapped) : null,
    reason: swappable
      ? null
      : owners.length === 0
        ? 'No constraint the simulation applies asks for an approval, so there is no decision owner to change.'
        : 'There is no other authority in the cast to ask for the approval.',
  });

  const dependencies = live.filter((constraint) =>
    (DEPENDENCY as readonly string[]).includes(constraint.category),
  );
  const stopped = [...new Set(dependencies.flatMap((constraint) => constraint.affectedActorIds))];
  views.push({
    id: 'dependency-fails',
    change:
      'What the change depends on fails: from the round it lands, it does not reach the actors that depend on it.',
    driver:
      dependencies.length > 0
        ? `Dependency: ${clip(dependencies.map((constraint) => constraint.statement).join(' · '), 200)}`
        : '',
    driverConstraintIds: dependencies.map((constraint) => constraint.id).slice(0, 20),
    spec:
      dependencies.length > 0
        ? specOf([
            ...base,
            {
              id: 'cf-dependency-fails',
              effect: { kind: 'block' },
              actorIds: stopped.filter((id) => world.actorIds.has(id)),
              fromRound: input.variant.round,
              toRound: null,
            },
          ])
        : null,
    reason:
      dependencies.length > 0
        ? null
        : 'No dependency, technical limit or infrastructure limit is among the constraints, so there is nothing that can fail.',
  });
  return views;
}

/**
 * Runs the counterfactual views of the proposed change on the same seeds as its base, and reports each as
 * the paired difference in the headline share (members ending in switch or resist, every actor counting
 * equally), with its noise and what drove it. Deterministic: the same inputs give the same views.
 */
export async function runCounterfactuals(input: CounterfactualInput): Promise<CounterfactualSet> {
  const baseSpec: SimulationSpec = {
    actors: [...input.actors],
    relations: [...input.relations],
    rounds: input.rounds,
    variant: input.variant,
  };
  const world: World = {
    actorIds: new Set(input.actors.map((actor) => actor.id)),
    variantIds: input.variantIds,
  };
  const applied = appliedFor(
    compileConstraints(input.constraints, world).applied,
    input.variant.id,
  );
  if (applied.length > 0) baseSpec.constraints = applied;
  const headline = (spec: SimulationSpec): number[] =>
    input.seeds.map((seed) => headlineShare(input.simulator(spec, seed).final.responseShares));
  const base = headline(baseSpec);

  const views: Counterfactual[] = [];
  for (const view of viewsOf(input)) {
    await input.yieldNow?.();
    const known = {
      id: view.id,
      label: COUNTERFACTUAL_LABELS[view.id],
      change: clip(view.change, 300),
    };
    if (!view.spec) {
      views.push({
        ...known,
        applicable: false,
        reason: clip(view.reason ?? 'This view does not apply to this project.', 240),
        deltaVsBase: null,
        standardError: null,
        classification: null,
        driver: '',
        driverConstraintIds: [],
      });
      continue;
    }
    const differences = pairedDifferences(headline(view.spec), base);
    const shift = mean(differences);
    const noise = standardError(differences);
    views.push({
      ...known,
      applicable: true,
      reason: null,
      deltaVsBase: Math.max(-1, Math.min(1, round4(shift))),
      standardError: round4(noise),
      classification: IMPACT_CLASS[classifySensitivity(shift, noise)],
      driver: clip(view.driver, 240),
      driverConstraintIds: view.driverConstraintIds.slice(0, 20),
    });
  }
  return {
    version: CONSTRAINT_SCHEMA_VERSION,
    generatedAt: input.now.toISOString(),
    variantId: input.variant.id,
    variantLabel: clip(input.variant.label, 120),
    metric: `Simulated share of members ending in switch or resist (each actor counts equally), ${input.seeds.length} paired seeds`,
    seeds: input.seeds.length,
    baseMean: round4(mean(base)),
    inputs: input.inputs,
    views,
  };
}
