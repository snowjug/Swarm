import { CONSTRAINT_IMPACT_SEEDS, MAX_IMPACT_PAIRS } from '../../../shared/analysis-plan.js';
import type { SimulationSpec, Simulator, Variant } from '../../../shared/analysis.js';
import type {
  ConstraintImpact,
  ConstraintImpactClass,
  RecordedConstraint,
} from '../../../shared/constraint-effects.js';
import type { Actor, ActorRelation } from '../../../shared/stakeholders.js';
import { appliedFor } from '../constraints/enforce.js';
import {
  SENSITIVITY_ROWS,
  headlineShare,
  runSensitivity,
  type Perturbation,
} from './sensitivity.js';

/**
 * What taking one constraint away does to a scenario, measured the way the sensitivity step measures an
 * assumption: the scenario is run again on the same seeds without the constraint and each run is
 * compared with the run of that seed that had it, so the difference is the constraint's and not the
 * dice's. It reports the paired difference of the headline share (members ending in switch or resist,
 * every actor counting equally), with its noise, and the same classes as the sensitivity step under
 * words that say what they are about constraints.
 */
export { CONSTRAINT_IMPACT_SEEDS, MAX_IMPACT_PAIRS };

export interface ImpactPair {
  constraintId: string;
  variant: Variant;
}

const CLASS_OF = {
  'assumption-sensitive': 'material',
  robust: 'negligible',
  inconclusive: 'inconclusive',
} as const satisfies Record<string, ConstraintImpactClass>;

/**
 * The pairs of an applied constraint and a scenario worth measuring: each scenario that changes
 * something (every one but the baseline) with each constraint that applies to it, constraints in the
 * order they were applied, at most `MAX_IMPACT_PAIRS`.
 */
export function planImpacts(
  applied: readonly RecordedConstraint[],
  variants: readonly Variant[],
): ImpactPair[] {
  const ids = [...new Set(applied.map((item) => item.constraintId))];
  const pairs: ImpactPair[] = [];
  for (const variant of variants) {
    if (variant.kind === 'baseline') continue;
    for (const constraintId of ids) {
      const applies = applied.some(
        (item) =>
          item.constraintId === constraintId &&
          (item.alternativeIds.length === 0 || item.alternativeIds.includes(variant.id)),
      );
      if (applies) pairs.push({ constraintId, variant });
    }
  }
  return pairs.slice(0, MAX_IMPACT_PAIRS);
}

export interface MeasureInput {
  actors: readonly Actor[];
  relations: readonly ActorRelation[];
  rounds: number;
  applied: readonly RecordedConstraint[];
  pairs: readonly ImpactPair[];
  seeds: readonly number[];
  simulator: Simulator;
  /** The headline share of each seed's run of a scenario with every constraint, when the caller has them. */
  baseValues?: ReadonlyMap<string, readonly number[]>;
  shouldCancel?: () => boolean;
  /** Called after each run with the members it simulated. */
  onRun?: (members: number) => void;
  yieldNow?: () => Promise<void>;
}

/** Measures every pair. Returns null when asked to stop part way. */
export async function measureImpacts(input: MeasureInput): Promise<ConstraintImpact[] | null> {
  const impacts: ConstraintImpact[] = [];
  const variants = [
    ...new Map(input.pairs.map((pair) => [pair.variant.id, pair.variant])).values(),
  ];
  for (const variant of variants) {
    const spec: SimulationSpec = {
      actors: [...input.actors],
      relations: [...input.relations],
      rounds: input.rounds,
      variant,
      constraints: appliedFor(input.applied, variant.id),
    };
    let base = input.baseValues?.get(variant.id)?.slice(0, input.seeds.length);
    if (!base || base.length < input.seeds.length) {
      base = [];
      for (const seed of input.seeds) {
        if (input.shouldCancel?.()) return null;
        const outcome = input.simulator(spec, seed);
        base.push(headlineShare(outcome.final.responseShares));
        input.onRun?.(outcome.work.members);
        await input.yieldNow?.();
      }
    }
    const perturbations: Perturbation[] = input.pairs
      .filter((pair) => pair.variant.id === variant.id)
      .map((pair) => ({
        id: pair.constraintId,
        target: { kind: 'intensity', actorId: null, trait: null },
        label: pair.constraintId,
        perturbation: 0,
        origin: 'user',
        apply: (from) => ({
          ...from,
          constraints: (from.constraints ?? []).filter((item) => item.id !== pair.constraintId),
        }),
      }));
    // The sensitivity step keeps its twelve most telling rows: here none is left out.
    for (let at = 0; at < perturbations.length; at += SENSITIVITY_ROWS) {
      const result = await runSensitivity({
        spec,
        seeds: input.seeds,
        baseValues: base,
        simulator: input.simulator,
        perturbations: perturbations.slice(at, at + SENSITIVITY_ROWS),
        ...(input.shouldCancel ? { shouldCancel: input.shouldCancel } : {}),
        ...(input.onRun ? { onRun: input.onRun } : {}),
        ...(input.yieldNow ? { yieldNow: input.yieldNow } : {}),
      });
      if (!result) return null;
      for (const row of result.rows) {
        impacts.push({
          constraintId: row.id,
          variantId: variant.id,
          metric: row.metric,
          seeds: input.seeds.length,
          withMean: row.baseMean,
          withoutShift: row.shift,
          standardError: row.standardError,
          classification: CLASS_OF[row.classification],
        });
      }
    }
  }
  // The order of the pairs, not of the rows' size: a comparison that is run again lists them the same way.
  const order = new Map(
    input.pairs.map((pair, at) => [`${pair.constraintId}|${pair.variant.id}`, at]),
  );
  return impacts.sort(
    (a, b) =>
      (order.get(`${a.constraintId}|${a.variantId}`) ?? 0) -
      (order.get(`${b.constraintId}|${b.variantId}`) ?? 0),
  );
}
