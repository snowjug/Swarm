import { describe, expect, it } from 'vitest';
import type { SimulationSpec, Simulator } from '../../shared/analysis.js';
import type { Actor } from '../../shared/stakeholders.js';
import { runAnalysis, type AnalysisInputs } from '../src/analysis/runset.js';
import {
  INTENSITY_STEP,
  SENSITIVITY_ROWS,
  SENSITIVITY_TOP_ACTORS,
  TRAIT_STEP,
  classifySensitivity,
  headlineShare,
  planPerturbations,
  runSensitivity,
  type Perturbation,
} from '../src/analysis/sensitivity.js';
import { standardError } from '../src/analysis/stats.js';
import {
  PROPOSED,
  clock,
  inputs as baseInputs,
  testCast as plainCast,
} from './support/analysis-world.js';
import { countingSimulator, stubSimulator } from './support/stub-simulator.js';

/** Three of the five actors are harmed, so that moving one assumption can move the headline materially. */
function testCast(): Actor[] {
  const actors = plainCast();
  for (const actor of actors) {
    if (actor.id === 'resellers' || actor.id === 'provider') actor.traits.impact.value = -0.6;
  }
  return actors;
}

const inputs = (overrides: Partial<AnalysisInputs> = {}): AnalysisInputs =>
  baseInputs({ actors: testCast(), ...overrides });

const spec = (): SimulationSpec => ({
  actors: testCast(),
  relations: [],
  rounds: 8,
  variant: PROPOSED,
});

const seeds = Array.from({ length: 20 }, (_, index) => 100 + index);
const baseValues = (simulator: Simulator = stubSimulator): number[] =>
  seeds.map((seed) => headlineShare(simulator(spec(), seed).final.responseShares));

const noOp = (id = 'no-op'): Perturbation => ({
  id,
  target: { kind: 'trait', actorId: 'subscribers', trait: 'trust' },
  label: 'Subscribers: no change at all',
  perturbation: 0,
  origin: 'system-assumption',
  apply: (given) => given,
});

describe('which assumptions are moved', () => {
  const perturbations = planPerturbations(testCast(), PROPOSED);

  it('moves four traits, up and down, of the most influential actors, and nothing else of theirs', () => {
    const traits = perturbations.filter((item) => item.target.kind === 'trait');
    expect(new Set(traits.map((item) => item.target.actorId))).toEqual(
      new Set(['subscribers', 'rival-provider', 'regulator', 'provider']),
    );
    expect(new Set(traits.map((item) => item.target.trait))).toEqual(
      new Set(['impact', 'sensitivity', 'switchingCost', 'trust']),
    );
    expect(traits).toHaveLength(SENSITIVITY_TOP_ACTORS * 4 * 2);
    for (const item of traits) expect(Math.abs(item.perturbation)).toBeCloseTo(TRAIT_STEP, 6);
  });

  it('moves the intensity of the proposed change by a quarter either way, and says where it came from', () => {
    const intensity = perturbations.filter((item) => item.target.kind === 'intensity');
    expect(intensity.map((item) => item.perturbation)).toEqual([INTENSITY_STEP, -INTENSITY_STEP]);
    expect(intensity.every((item) => item.origin === 'scenario')).toBe(true);
    const raised = intensity[0]!.apply(spec());
    expect(raised.variant.intensity).toBeCloseTo(0.875, 6);
    expect(intensity[1]!.apply(spec()).variant.intensity).toBeCloseTo(0.525, 6);
    expect(intensity[0]!.label).toContain('25% higher');
  });

  it('makes cohorts twice and half as varied, and leaves single actors alone', () => {
    const population = perturbations.filter((item) => item.target.kind === 'population');
    expect(new Set(population.map((item) => item.target.actorId))).toEqual(
      new Set(['subscribers', 'resellers']),
    );
    expect(population).toHaveLength(4);
    const wider = population.find((item) => item.id === 'population-subscribers-wider')!;
    const moved = wider.apply(spec()).actors.find((actor) => actor.id === 'subscribers')!;
    expect(moved.traits.impact.spread).toBeCloseTo(0.2, 6);
    expect(moved.traits.trust.spread).toBeCloseTo(0.2, 6);
    expect(wider.origin).toBe('system-assumption');
  });

  it('records the origin of every assumption, so that an unevidenced one can stand out', () => {
    const cast = testCast();
    cast[0]!.traits.switchingCost.origin = 'evidence';
    cast[0]!.traits.trust.origin = 'user';
    const planned = planPerturbations(cast, PROPOSED);
    const origin = (id: string) => planned.find((item) => item.id === id)?.origin;
    expect(origin('trait-subscribers-switchingCost-up')).toBe('evidence');
    expect(origin('trait-subscribers-trust-down')).toBe('user');
    expect(origin('trait-subscribers-sensitivity-up')).toBe('system-assumption');
  });

  it('changes one thing at a time, and leaves the spec it was given as it was', () => {
    const original = spec();
    const before = JSON.stringify(original);
    for (const item of perturbations) {
      const changed = item.apply(original);
      expect(JSON.stringify(original)).toBe(before);
      const differing = changed.actors.filter(
        (actor, index) => JSON.stringify(actor) !== JSON.stringify(original.actors[index]),
      );
      expect(differing.length, item.id).toBe(item.target.kind === 'intensity' ? 0 : 1);
      if (item.target.kind !== 'intensity') expect(differing[0]!.id).toBe(item.target.actorId);
    }
  });

  it('clamps to each trait’s scale and leaves out a move that clamping turns into nothing', () => {
    const cast = testCast();
    cast[0]!.traits.trust.value = 1;
    cast[0]!.traits.impact.value = -0.9;
    const planned = planPerturbations(cast, PROPOSED);
    expect(planned.some((item) => item.id === 'trait-subscribers-trust-up')).toBe(false);
    const down = planned.find((item) => item.id === 'trait-subscribers-impact-down')!;
    const lowered = down.apply({ ...spec(), actors: cast }).actors[0]!;
    expect(lowered.traits.impact.value).toBe(-1);
    expect(down.perturbation).toBeCloseTo(-0.1, 6);
    const capped = planPerturbations(testCast(), { ...PROPOSED, intensity: 0.9 });
    const up = capped.find((item) => item.id === 'intensity-up')!;
    expect(up.apply(spec()).variant.intensity).toBe(1);
    expect(
      planPerturbations(testCast(), { ...PROPOSED, intensity: 1 }).some(
        (item) => item.id === 'intensity-up',
      ),
    ).toBe(false);
    expect(
      planPerturbations(testCast(), { ...PROPOSED, intensity: 0 }).some(
        (item) => item.target.kind === 'intensity',
      ),
    ).toBe(false);
  });

  it('plans nothing without a proposed change, and stays within a bounded number of runs', () => {
    expect(planPerturbations(testCast(), undefined)).toEqual([]);
    expect(perturbations.length).toBeLessThanOrEqual(SENSITIVITY_TOP_ACTORS * 8 + 2 + 4);
    expect(new Set(perturbations.map((item) => item.id)).size).toBe(perturbations.length);
  });
});

describe('measuring a shift on the same seeds', () => {
  it('gives a shift of exactly 0 with a standard error of exactly 0 for a perturbation that changes nothing', async () => {
    const result = await runSensitivity({
      spec: spec(),
      seeds,
      baseValues: baseValues(),
      simulator: stubSimulator,
      perturbations: [noOp()],
    });
    expect(result!.rows).toHaveLength(1);
    expect(result!.rows[0]).toMatchObject({ shift: 0, standardError: 0, classification: 'robust' });
  });

  it('gives a signed shift when the outcome is monotone in the assumption', async () => {
    const planned = planPerturbations(testCast(), PROPOSED);
    const pick = (...ids: string[]) => planned.filter((item) => ids.includes(item.id));
    const result = await runSensitivity({
      spec: spec(),
      seeds,
      baseValues: baseValues(),
      simulator: stubSimulator,
      perturbations: pick(
        'trait-subscribers-sensitivity-up',
        'trait-subscribers-sensitivity-down',
        'trait-subscribers-trust-up',
        'trait-subscribers-trust-down',
        'trait-subscribers-impact-up',
        'trait-subscribers-impact-down',
        'intensity-up',
        'intensity-down',
      ),
    });
    const shift = (id: string) => result!.rows.find((row) => row.id === id)!.shift;
    // More sensitivity, less trust, more harm and a stronger change push more members to leave.
    expect(shift('trait-subscribers-sensitivity-up')).toBeGreaterThan(0);
    expect(shift('trait-subscribers-sensitivity-down')).toBeLessThan(0);
    expect(shift('trait-subscribers-trust-down')).toBeGreaterThan(0);
    expect(shift('trait-subscribers-trust-up')).toBeLessThan(0);
    expect(shift('trait-subscribers-impact-down')).toBeGreaterThan(0);
    expect(shift('trait-subscribers-impact-up')).toBeLessThan(0);
    expect(shift('intensity-up')).toBeGreaterThan(0);
    expect(shift('intensity-down')).toBeLessThan(0);
  });

  it('measures the shift against the unmoved run of the same seed, so the noise is that of the pairs', async () => {
    const id = 'intensity-up';
    const result = await runSensitivity({
      spec: spec(),
      seeds,
      baseValues: baseValues(),
      simulator: stubSimulator,
      perturbations: planPerturbations(testCast(), PROPOSED).filter((item) => item.id === id),
    });
    const row = result!.rows[0]!;
    const moved = planPerturbations(testCast(), PROPOSED)
      .find((item) => item.id === id)!
      .apply(spec());
    const differences = seeds.map(
      (seed, index) =>
        headlineShare(stubSimulator(moved, seed).final.responseShares) - baseValues()[index]!,
    );
    expect(row.shift).toBeCloseTo(
      differences.reduce((sum, value) => sum + value, 0) / seeds.length,
      4,
    );
    expect(row.standardError).toBeCloseTo(standardError(differences), 4);
    expect(row.baseMean).toBeCloseTo(
      baseValues().reduce((sum, value) => sum + value, 0) / seeds.length,
      4,
    );
    expect(row.metric).toContain('switch or resist');
    expect(row.metric).toContain('20 paired seeds');
    // The same seeds make the pairs close, so the noise is far smaller than the shift it measures.
    expect(row.shift).toBeGreaterThan(0.05);
    expect(row.standardError).toBeLessThan(Math.abs(row.shift) / 2);
    expect(row.classification).toBe('assumption-sensitive');
  });

  it('runs every perturbation on exactly the seeds it was given, once each', async () => {
    const { simulator, calls } = countingSimulator();
    const planned = planPerturbations(testCast(), PROPOSED);
    await runSensitivity({
      spec: spec(),
      seeds,
      baseValues: baseValues(),
      simulator,
      perturbations: planned,
    });
    expect(calls).toHaveLength(planned.length * seeds.length);
    expect(calls.slice(0, seeds.length).map((call) => call.seed)).toEqual(seeds);
  });

  it('returns at most 12 rows, the sensitive ones first and the largest shift first within a class', async () => {
    const result = await runSensitivity({
      spec: spec(),
      seeds,
      baseValues: baseValues(),
      simulator: stubSimulator,
      perturbations: planPerturbations(testCast(), PROPOSED),
    });
    expect(result!.rows).toHaveLength(SENSITIVITY_ROWS);
    const order = { 'assumption-sensitive': 0, inconclusive: 1, robust: 2 } as const;
    const classes = result!.rows.map((row) => order[row.classification]);
    expect([...classes].sort((a, b) => a - b)).toEqual(classes);
    const sensitive = result!.rows.filter((row) => row.classification === 'assumption-sensitive');
    expect(sensitive.length).toBeGreaterThan(0);
    for (let index = 1; index < sensitive.length; index += 1) {
      expect(Math.abs(sensitive[index - 1]!.shift)).toBeGreaterThanOrEqual(
        Math.abs(sensitive[index]!.shift),
      );
    }
  });

  it('stops part way when asked, and returns nothing', async () => {
    let asked = 0;
    const result = await runSensitivity({
      spec: spec(),
      seeds,
      baseValues: baseValues(),
      simulator: stubSimulator,
      perturbations: planPerturbations(testCast(), PROPOSED),
      shouldCancel: () => (asked += 1) > 25,
    });
    expect(result).toBeNull();
  });
});

describe('what a shift is called', () => {
  it('is assumption-sensitive when it is over two standard errors and at least 0.05', () => {
    expect(classifySensitivity(0.05, 0.02)).toBe('assumption-sensitive');
    expect(classifySensitivity(-0.2, 0.01)).toBe('assumption-sensitive');
    // Clear of the noise but too small to matter.
    expect(classifySensitivity(0.049, 0.001)).toBe('inconclusive');
    // Large but not clear of the noise: exactly two standard errors is not over.
    expect(classifySensitivity(0.05, 0.025)).toBe('inconclusive');
    expect(classifySensitivity(0.2, 0.15)).toBe('inconclusive');
  });

  it('is robust when it is under 0.02 and its standard error is under 0.01', () => {
    expect(classifySensitivity(0.019, 0.009)).toBe('robust');
    expect(classifySensitivity(0, 0)).toBe('robust');
    expect(classifySensitivity(-0.019, 0.0099)).toBe('robust');
    expect(classifySensitivity(0.019, 0.01)).toBe('inconclusive');
    expect(classifySensitivity(0.02, 0.001)).toBe('inconclusive');
  });
});

describe('sensitivity inside an analysis', () => {
  it('is skipped when it is turned off, and adds no run', async () => {
    const { simulator, calls } = countingSimulator();
    const analysis = await runAnalysis(inputs({ sensitivity: false }), simulator, { now: clock });
    expect(analysis.sensitivity).toEqual([]);
    expect(calls).toHaveLength(3 * 12 + 1);
  });

  it('is run on the first seeds, up to 30, and reports at most 12 rows', async () => {
    const analysis = await runAnalysis(
      inputs({ sensitivity: true, runsPerVariant: 40 }),
      stubSimulator,
      { now: clock },
    );
    expect(analysis.sensitivity).toHaveLength(12);
    expect(analysis.sensitivity.every((row) => row.metric.includes('30 paired seeds'))).toBe(true);
  });

  it('shifts the same way on a rerun, because it only ever uses the seeds of the main runs', async () => {
    const a = await runAnalysis(inputs({ sensitivity: true }), stubSimulator, { now: clock });
    const b = await runAnalysis(inputs({ sensitivity: true }), stubSimulator, { now: clock });
    expect(b.sensitivity).toEqual(a.sensitivity);
  });

  it('finds nothing when the simulator does not respond to the assumptions: no shift is made up', async () => {
    const ignoring: Simulator = (given, seed) =>
      stubSimulator(
        {
          ...given,
          actors: testCast(),
          variant: { ...given.variant, intensity: PROPOSED.intensity },
        },
        seed,
      );
    const analysis = await runAnalysis(inputs({ sensitivity: true }), ignoring, { now: clock });
    expect(analysis.sensitivity.length).toBeGreaterThan(0);
    expect(analysis.sensitivity.every((row) => row.shift === 0 && row.standardError === 0)).toBe(
      true,
    );
    expect(analysis.sensitivity.every((row) => row.classification === 'robust')).toBe(true);
  });
});
