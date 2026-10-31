import type {
  ResponseShares,
  SensitivityClass,
  SensitivityRow,
  SimulationSpec,
  Simulator,
  Variant,
} from '../../../shared/analysis.js';
import type { Actor } from '../../../shared/stakeholders.js';
import { mean, pairedDifferences, round4, standardError } from './stats.js';

/**
 * One-at-a-time sensitivity: move one declared assumption of the proposed change, run the same seeds
 * again, and compare each perturbed run with the unperturbed run of that seed. Because the seeds are
 * the same, the random draws are the same, so the difference is the effect of the assumption and the
 * remaining noise is that of the pairs, not of two unrelated runs (common random numbers).
 */

export const SENSITIVITY_TOP_ACTORS = 4;
export const POPULATION_TOP_ACTORS = 2;
/** How far a trait is moved, on its own 0 to 1 (or -1 to 1) scale, and then clamped to the scale. */
export const TRAIT_STEP = 0.2;
/** How far the intensity of the proposed change is moved, as a share of itself. */
export const INTENSITY_STEP = 0.25;
export const SENSITIVITY_ROWS = 12;
/** A shift smaller than this is too small to matter, however clearly it is measured. */
export const MATERIAL_SHIFT = 0.05;
export const ROBUST_SHIFT = 0.02;
export const SMALL_STANDARD_ERROR = 0.01;

/** The share of simulated members in switch or resist, every actor weighted equally. */
export const headlineShare = (shares: ResponseShares): number => shares.switch + shares.resist;

const PERTURBED_TRAITS = ['impact', 'sensitivity', 'switchingCost', 'trust'] as const;
type PerturbedTrait = (typeof PERTURBED_TRAITS)[number];

const TRAIT_WORDS: Record<PerturbedTrait, string> = {
  impact: 'how the change lands on them (impact)',
  sensitivity: 'how strongly they respond (sensitivity)',
  switchingCost: 'cost of switching',
  trust: 'trust in the party making the change',
};

export interface Perturbation {
  id: string;
  target: SensitivityRow['target'];
  label: string;
  /** The change made: an amount for a trait, a share for the intensity, a factor less one for the spread. */
  perturbation: number;
  origin: SensitivityRow['assumptionOrigin'];
  apply: (spec: SimulationSpec) => SimulationSpec;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

function withActor(spec: SimulationSpec, actorId: string, change: (actor: Actor) => Actor) {
  return {
    ...spec,
    actors: spec.actors.map((actor) => (actor.id === actorId ? change(actor) : actor)),
  };
}

function withTrait(actor: Actor, trait: PerturbedTrait, value: number): Actor {
  const traits = actor.traits;
  switch (trait) {
    case 'impact':
      return { ...actor, traits: { ...traits, impact: { ...traits.impact, value } } };
    case 'sensitivity':
      return { ...actor, traits: { ...traits, sensitivity: { ...traits.sensitivity, value } } };
    case 'switchingCost':
      return { ...actor, traits: { ...traits, switchingCost: { ...traits.switchingCost, value } } };
    case 'trust':
      return { ...actor, traits: { ...traits, trust: { ...traits.trust, value } } };
  }
}

function scaleSpread(actor: Actor, factor: number): Actor {
  const traits = Object.fromEntries(
    Object.entries(actor.traits).map(([name, trait]) => [
      name,
      { ...trait, spread: clamp(trait.spread * factor, 0, 0.5) },
    ]),
  ) as Actor['traits'];
  return { ...actor, traits };
}

const byInfluence = (a: Actor, b: Actor): number =>
  b.traits.influence.value - a.traits.influence.value || a.id.localeCompare(b.id);

/**
 * The assumptions to move: four traits of the most influential actors, the intensity of the proposed
 * change, and how varied the members of the most influential cohorts are. A move that clamping
 * turns into no move at all is left out.
 */
export function planPerturbations(
  actors: readonly Actor[],
  proposed: Variant | undefined,
): Perturbation[] {
  if (!proposed) return [];
  const planned: Perturbation[] = [];
  const ranked = [...actors].sort(byInfluence);

  for (const actor of ranked.slice(0, SENSITIVITY_TOP_ACTORS)) {
    for (const trait of PERTURBED_TRAITS) {
      for (const direction of [1, -1] as const) {
        const current = actor.traits[trait].value;
        const moved = clamp(current + direction * TRAIT_STEP, trait === 'impact' ? -1 : 0, 1);
        const change = round4(moved - current);
        if (Math.abs(change) < 1e-9) continue;
        planned.push({
          id: `trait-${actor.id}-${trait}-${direction > 0 ? 'up' : 'down'}`,
          target: { kind: 'trait', actorId: actor.id, trait },
          label: `${actor.name}: ${TRAIT_WORDS[trait]}, ${Math.abs(change)} ${direction > 0 ? 'higher' : 'lower'}`,
          perturbation: change,
          origin: actor.traits[trait].origin,
          apply: (spec) => withActor(spec, actor.id, (target) => withTrait(target, trait, moved)),
        });
      }
    }
  }

  for (const direction of [1, -1] as const) {
    const moved = clamp(proposed.intensity * (1 + direction * INTENSITY_STEP), 0, 1);
    if (proposed.intensity <= 0 || Math.abs(moved - proposed.intensity) < 1e-9) continue;
    planned.push({
      id: `intensity-${direction > 0 ? 'up' : 'down'}`,
      target: { kind: 'intensity', actorId: null, trait: null },
      label: `Intensity of ${proposed.label}: ${INTENSITY_STEP * 100}% ${direction > 0 ? 'higher' : 'lower'} (${round4(proposed.intensity)} to ${round4(moved)})`,
      perturbation: direction * INTENSITY_STEP,
      origin: 'scenario',
      apply: (spec) => ({ ...spec, variant: { ...spec.variant, intensity: moved } }),
    });
  }

  const cohorts = ranked
    .filter((actor) => actor.kind === 'cohort' && actor.sampleSize > 1)
    .slice(0, POPULATION_TOP_ACTORS);
  for (const actor of cohorts) {
    for (const factor of [2, 0.5] as const) {
      const spreads = Object.values(actor.traits).map((trait) => trait.spread);
      if (spreads.every((spread) => Math.abs(clamp(spread * factor, 0, 0.5) - spread) < 1e-9)) {
        continue;
      }
      planned.push({
        id: `population-${actor.id}-${factor > 1 ? 'wider' : 'narrower'}`,
        target: { kind: 'population', actorId: actor.id, trait: null },
        label: `${actor.name}: members ${factor > 1 ? 'twice' : 'half'} as varied (spread ×${factor})`,
        perturbation: factor - 1,
        // The spread of a cohort is a modelling default, not something a source states.
        origin: 'system-assumption',
        apply: (spec) => withActor(spec, actor.id, (target) => scaleSpread(target, factor)),
      });
    }
  }
  return planned;
}

/**
 * `assumption-sensitive` when the shift is both clearly larger than its noise (more than two standard
 * errors) and material (at least 0.05, five points of the share); `robust` when it is negligible
 * (under 0.02) and measured tightly (a standard error under 0.01); otherwise `inconclusive`.
 */
export function classifySensitivity(shift: number, noise: number): SensitivityClass {
  const size = Math.abs(shift);
  if (size > 2 * noise && size >= MATERIAL_SHIFT) return 'assumption-sensitive';
  if (size < ROBUST_SHIFT && noise < SMALL_STANDARD_ERROR) return 'robust';
  return 'inconclusive';
}

const CLASS_ORDER: Record<SensitivityClass, number> = {
  'assumption-sensitive': 0,
  inconclusive: 1,
  robust: 2,
};

export interface SensitivityRun {
  rows: SensitivityRow[];
}

/**
 * Runs every perturbation on the given seeds and compares it with the unperturbed headline values of
 * those same seeds. Returns null when asked to stop part way.
 */
export async function runSensitivity(input: {
  spec: SimulationSpec;
  seeds: readonly number[];
  /** The headline value of the unperturbed run of each seed, in the order of `seeds`. */
  baseValues: readonly number[];
  simulator: Simulator;
  perturbations: readonly Perturbation[];
  shouldCancel?: () => boolean;
  /** Called after each run with the members it simulated. */
  onRun?: (members: number) => void;
  yieldNow?: () => Promise<void>;
}): Promise<SensitivityRun | null> {
  const { spec, seeds, baseValues, simulator } = input;
  const baseMean = mean(baseValues);
  const rows: SensitivityRow[] = [];
  for (const perturbation of input.perturbations) {
    const perturbed = perturbation.apply(spec);
    const values: number[] = [];
    for (const seed of seeds) {
      if (input.shouldCancel?.()) return null;
      const outcome = simulator(perturbed, seed);
      values.push(headlineShare(outcome.final.responseShares));
      input.onRun?.(outcome.work.members);
      await input.yieldNow?.();
    }
    const differences = pairedDifferences(values, baseValues);
    const shift = mean(differences);
    const noise = standardError(differences);
    rows.push({
      id: perturbation.id,
      target: perturbation.target,
      label: perturbation.label,
      perturbation: perturbation.perturbation,
      metric: `Share ending in switch or resist (all actors equal), ${seeds.length} paired seeds`,
      baseMean: round4(baseMean),
      shift: round4(shift),
      standardError: round4(noise),
      classification: classifySensitivity(shift, noise),
      assumptionOrigin: perturbation.origin,
    });
  }
  rows.sort(
    (a, b) =>
      CLASS_ORDER[a.classification] - CLASS_ORDER[b.classification] ||
      Math.abs(b.shift) - Math.abs(a.shift) ||
      a.id.localeCompare(b.id),
  );
  return { rows: rows.slice(0, SENSITIVITY_ROWS) };
}
