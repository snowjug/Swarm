import { describe, expect, it } from 'vitest';
import { MAX_ARTIFACT_BYTES } from '../../shared/artifacts.js';
import {
  analysisSchema,
  runOutcomeSchema,
  type Analysis,
  type RunOutcome,
  type Variant,
} from '../../shared/analysis.js';
import { actorFixture } from '../../shared/lab-fixtures.js';
import { MAX_TOTAL_RUNS, planRuns } from '../../shared/analysis-plan.js';
import type { Actor } from '../../shared/stakeholders.js';
import { AppError } from '../src/errors.js';
import { runAnalysis, validateInputs, type AnalysisInputs } from '../src/analysis/runset.js';
import { planPerturbations } from '../src/analysis/sensitivity.js';
import { quantile } from '../src/analysis/stats.js';
import { BASELINE, MILD, PROPOSED, clock, inputs, testCast } from './support/analysis-world.js';
import { countingSimulator, stubSimulator } from './support/stub-simulator.js';

/** An analysis without what legitimately differs between two runs of the same inputs. */
const stable = (analysis: Analysis) => ({
  ...analysis,
  completedAt: null,
  cost: { ...analysis.cost, wallMs: 0 },
});

describe('the stub simulator', () => {
  it('returns outcomes the contract accepts, and the same outcome for the same spec and seed', () => {
    const spec = {
      actors: testCast(),
      relations: [],
      rounds: 6,
      variant: PROPOSED,
    };
    const first = stubSimulator(spec, 17);
    expect(() => runOutcomeSchema.parse(first)).not.toThrow();
    expect(stubSimulator(spec, 17)).toEqual(first);
    expect(stubSimulator(spec, 18).final.stanceMean).not.toBe(first.final.stanceMean);
  });
});

describe('running a comparison', () => {
  it('uses the same seeds for every variant, seed by seed, so that runs can be paired', async () => {
    const { simulator, calls } = countingSimulator();
    const analysis = await runAnalysis(inputs(), simulator, { now: clock });
    const seeds = Array.from({ length: 12 }, (_, index) => 500 + index);
    for (const variant of inputs().variants) {
      const used = calls.filter((call) => call.variantId === variant.id).map((call) => call.seed);
      // The representative run repeats one seed of the proposed change; the rest are one per seed.
      expect(used.slice(0, 12), variant.id).toEqual(seeds);
    }
    // Seed-major: all variants run on a seed before the next seed starts.
    expect(calls.slice(0, 6).map((call) => call.seed)).toEqual([500, 500, 500, 501, 501, 501]);
    for (const result of analysis.variants) {
      expect(result.runs.map((run) => run.seed)).toEqual(seeds);
    }
    expect(analysisSchema.parse(analysis).status).toBe('completed');
  });

  it('shows the spread of the overall stance round by round as p10, p50 and p90 of the runs', async () => {
    const analysis = await runAnalysis(inputs(), stubSimulator, { now: clock });
    const proposed = analysis.variants.find((variant) => variant.variantId === 'proposed-change')!;
    expect(proposed.trajectory).toHaveLength(8);
    const variant = PROPOSED;
    const stances = (round: number) =>
      Array.from({ length: 12 }, (_, index) => {
        const outcome = stubSimulator(
          { actors: testCast(), relations: [], rounds: 8, variant },
          500 + index,
        );
        return outcome.rounds[round - 1]!.stanceMean;
      });
    for (const band of proposed.trajectory) {
      const expected = stances(band.round);
      expect(band.p10).toBeCloseTo(quantile(expected, 0.1), 3);
      expect(band.p50).toBeCloseTo(quantile(expected, 0.5), 3);
      expect(band.p90).toBeCloseTo(quantile(expected, 0.9), 3);
      expect(band.p10).toBeLessThanOrEqual(band.p50);
      expect(band.p50).toBeLessThanOrEqual(band.p90);
    }
    // The change lands in round 2, so the band moves down after it and not before.
    expect(proposed.trajectory[7]!.p50).toBeLessThan(proposed.trajectory[0]!.p50);
  });

  it('keeps a compact summary of every run and per-actor totals for every variant', async () => {
    const analysis = await runAnalysis(inputs(), stubSimulator, { now: clock });
    for (const result of analysis.variants) {
      expect(result.runs).toHaveLength(12);
      for (const run of result.runs) {
        expect(run.byActor).toHaveLength(5);
        const total = Object.values(run.responseShares).reduce((sum, share) => sum + share, 0);
        expect(total).toBeCloseTo(1, 2);
      }
      expect(result.actors).toHaveLength(5);
    }
  });

  it('keeps the full outcome of the run nearest the median under the proposed change', async () => {
    const analysis = await runAnalysis(inputs(), stubSimulator, { now: clock });
    const representative = analysis.representativeRun as RunOutcome;
    expect(representative.variantId).toBe('proposed-change');
    const proposed = analysis.variants.find((variant) => variant.variantId === 'proposed-change')!;
    const median = quantile(
      proposed.runs.map((run) => run.stanceMean),
      0.5,
    );
    const gaps = proposed.runs.map((run) => Math.abs(run.stanceMean - median));
    const own = proposed.runs.find((run) => run.seed === representative.seed)!;
    expect(Math.abs(own.stanceMean - median)).toBeCloseTo(Math.min(...gaps), 3);
    expect(representative.events.length).toBeGreaterThan(0);
    expect(() => runOutcomeSchema.parse(representative)).not.toThrow();
  });

  it('reports every run, and no model call, in the cost', async () => {
    const { simulator, calls } = countingSimulator();
    const analysis = await runAnalysis(inputs({ sensitivity: true }), simulator, { now: clock });
    expect(analysis.cost.simulatedRuns).toBe(calls.length);
    expect(analysis.cost.modelCalls).toBe(0);
    expect(analysis.cost.inputTokens).toBe(0);
    expect(analysis.cost.simulatedMembers).toBeGreaterThan(0);
    const plan = planRuns({
      variants: 3,
      runsPerVariant: 12,
      sensitivity: true,
      perturbations: planPerturbations(testCast(), PROPOSED).length,
    });
    // Every planned run, plus the one run that is repeated to keep its full detail.
    expect(calls.length).toBe(plan.totalRuns + 1);
    expect(analysis.progress).toEqual({ completedRuns: plan.totalRuns, totalRuns: plan.totalRuns });
  });

  it('declares the rules engine, and says what is not measured', async () => {
    const analysis = await runAnalysis(inputs(), stubSimulator, { now: clock });
    expect(analysis.fidelity).toMatchObject({
      engine: 'rules',
      keyActors: 'rules',
      cohorts: 'rules',
      repeatedRuns: 12,
      modelRepeats: 0,
    });
    const caveats = analysis.fidelity.caveats.join(' ');
    expect(caveats).toContain('mechanical consequence of the declared assumptions');
    expect(caveats).toContain('no model decided any actor’s behaviour');
    expect(caveats).toContain('Run-to-run variation of a model is not measured');
    expect(caveats).toContain('not how likely anything is in the world');
  });

  it('says so when there are fewer than 10 runs, and says what sensitivity did', async () => {
    const few = await runAnalysis(inputs({ runsPerVariant: 6 }), stubSimulator, { now: clock });
    expect(few.fidelity.caveats.join(' ')).toContain('fewer than 10 runs');
    const many = await runAnalysis(inputs({ sensitivity: true }), stubSimulator, { now: clock });
    expect(many.fidelity.caveats.join(' ')).toContain('one assumption at a time');
    expect(many.fidelity.caveats.join(' ')).not.toContain('fewer than 10 runs');
  });
});

describe('determinism', () => {
  it('gives an identical analysis for identical inputs, apart from the time it took', async () => {
    const a = await runAnalysis(inputs({ sensitivity: true }), stubSimulator);
    const b = await runAnalysis(inputs({ sensitivity: true }), stubSimulator);
    expect(JSON.stringify(stable(b))).toBe(JSON.stringify(stable(a)));
  });

  it('gives a different analysis for a different first seed', async () => {
    const a = await runAnalysis(inputs(), stubSimulator, { now: clock });
    const b = await runAnalysis(inputs({ baseSeed: 9_000 }), stubSimulator, { now: clock });
    expect(b.variants[0]!.runs[0]!.seed).toBe(9_000);
    expect(JSON.stringify(b.variants)).not.toBe(JSON.stringify(a.variants));
  });
});

describe('progress and cancellation', () => {
  it('reports progress after every run, rising to the total, and gives the event loop a turn', async () => {
    const seen: number[] = [];
    let turns = 0;
    await runAnalysis(inputs({ runsPerVariant: 5 }), stubSimulator, {
      now: clock,
      onProgress: ({ completedRuns, totalRuns }) => {
        seen.push(completedRuns);
        expect(totalRuns).toBe(15);
      },
      yieldNow: async () => {
        turns += 1;
      },
    });
    expect(seen).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    expect(turns).toBeGreaterThanOrEqual(15);
  });

  it('stops between runs when asked, and returns what was done as cancelled, with no findings', async () => {
    const { simulator, calls } = countingSimulator();
    const analysis = await runAnalysis(inputs(), simulator, {
      now: clock,
      shouldCancel: () => calls.length >= 7,
    });
    expect(analysis.status).toBe('cancelled');
    expect(calls).toHaveLength(7);
    expect(analysis.progress.completedRuns).toBe(7);
    expect(analysis.cost.simulatedRuns).toBe(7);
    expect(analysis.variants).toEqual([]);
    expect(analysis.findings).toEqual([]);
    expect(analysis.sensitivity).toEqual([]);
    expect(analysis.representativeRun).toBeNull();
    expect(() => analysisSchema.parse(analysis)).not.toThrow();
  });

  it('can be stopped during the sensitivity step too', async () => {
    const { simulator, calls } = countingSimulator();
    const mainRuns = 3 * 12;
    const analysis = await runAnalysis(inputs({ sensitivity: true }), simulator, {
      now: clock,
      shouldCancel: () => calls.length >= mainRuns + 5,
    });
    expect(analysis.status).toBe('cancelled');
    expect(calls).toHaveLength(mainRuns + 5);
    expect(analysis.sensitivity).toEqual([]);
  });
});

describe('bounds', () => {
  const refused = async (overrides: Partial<AnalysisInputs>): Promise<AppError> => {
    try {
      await runAnalysis(inputs(overrides), stubSimulator);
    } catch (error) {
      if (error instanceof AppError) return error;
      throw error;
    }
    throw new Error('Expected the analysis to be refused.');
  };

  it('refuses fewer than 3 or more than 200 runs for each variant', async () => {
    expect((await refused({ runsPerVariant: 2 })).code).toBe('ANALYSIS_INPUT_INVALID');
    expect((await refused({ runsPerVariant: 201 })).message).toContain('between 3 and 200');
    expect(() => validateInputs(inputs({ runsPerVariant: 3 }))).not.toThrow();
    expect(() => validateInputs(inputs({ runsPerVariant: 200, sensitivity: false }))).not.toThrow();
  });

  it('refuses more than 8 variants, a missing baseline or alternative, and repeated ids', async () => {
    const many: Variant[] = Array.from({ length: 9 }, (_, index) => ({
      ...MILD,
      id: `alternative-${index}`,
    }));
    expect((await refused({ variants: [BASELINE, ...many] })).message).toContain('between 2 and 8');
    expect((await refused({ variants: [PROPOSED, MILD] })).message).toContain(
      'exactly one baseline',
    );
    expect(
      (await refused({ variants: [BASELINE, { ...MILD, kind: 'baseline' }] })).message,
    ).toContain('exactly one baseline');
    expect((await refused({ variants: [BASELINE, BASELINE] })).message).toContain('id of its own');
  });

  it('refuses a comparison that needs more than the total cap of runs, and says how to shrink it', async () => {
    const variants: Variant[] = [
      BASELINE,
      ...Array.from({ length: 7 }, (_, index) => ({ ...MILD, id: `alternative-${index}` })),
    ];
    const error = await refused({ variants, runsPerVariant: 200, sensitivity: true });
    expect(error.message).toContain(MAX_TOTAL_RUNS.toLocaleString('en-GB'));
    expect(error.message).toContain('turn sensitivity off');
    expect(() =>
      validateInputs(inputs({ variants, runsPerVariant: 200, sensitivity: false })),
    ).not.toThrow();
  });

  it('refuses a change that lands after the last round, an unknown actor, and seeds past the limit', async () => {
    expect(
      (await refused({ rounds: 4, variants: [BASELINE, { ...MILD, round: 6 }] })).message,
    ).toContain('only 4 rounds');
    expect(
      (await refused({ variants: [BASELINE, { ...MILD, impactOverrides: { nobody: 0.5 } }] }))
        .message,
    ).toContain('not in the cast');
    expect((await refused({ baseSeed: 2_147_483_647 })).message).toContain('2,147,483,647');
  });
});

describe('the size of the document', () => {
  const cast = (count: number): Actor[] =>
    Array.from({ length: count }, (_, index) => {
      const actor = actorFixture(
        `actor-${String(index).padStart(2, '0')}`,
        index === 0 ? 'competitor' : index === 1 ? 'regulator' : 'cost-bearer',
        { sampleSize: 4 },
      );
      actor.traits.influence.value = 1 - index / 100;
      return actor;
    });

  it('stays under the artifact limit for 200 runs of 8 variants of 60 actors, by dropping per-run detail', async () => {
    const variants: Variant[] = [
      BASELINE,
      ...Array.from({ length: 7 }, (_, index) => ({
        ...MILD,
        id: `alternative-${index}`,
        label: `Alternative ${index}`,
        intensity: 0.2 + index * 0.1,
      })),
    ];
    const analysis = await runAnalysis(
      inputs({ actors: cast(60), variants, runsPerVariant: 200, rounds: 12, sensitivity: false }),
      stubSimulator,
      { now: clock },
    );
    const size = Buffer.byteLength(JSON.stringify(analysis), 'utf8');
    expect(size).toBeLessThan(MAX_ARTIFACT_BYTES);
    expect(() => analysisSchema.parse(analysis)).not.toThrow();
    expect(analysis.variants).toHaveLength(8);
    for (const result of analysis.variants) {
      expect(result.runs).toHaveLength(200);
      expect(result.actors).toHaveLength(60);
      expect(result.runs[0]!.byActor).toEqual([]);
    }
    expect(analysis.fidelity.caveats.join(' ')).toContain(
      'per-actor results of each individual run were not stored',
    );
    expect(analysis.findings.length).toBeLessThanOrEqual(40);
  }, 120_000);

  it('keeps the per-actor result of every run when it fits', async () => {
    const analysis = await runAnalysis(inputs({ runsPerVariant: 30 }), stubSimulator, {
      now: clock,
    });
    expect(Buffer.byteLength(JSON.stringify(analysis), 'utf8')).toBeLessThan(
      MAX_ARTIFACT_BYTES / 2,
    );
    expect(analysis.variants[0]!.runs[0]!.byActor).toHaveLength(5);
    expect(analysis.fidelity.caveats.join(' ')).not.toContain('were not stored');
  });
});
