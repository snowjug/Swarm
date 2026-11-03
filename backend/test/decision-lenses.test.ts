import { describe, expect, it } from 'vitest';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios.js';
import { LENS_IDS, LENS_INFO, type LensReading } from '../../shared/decision.js';
import { measureVariants } from '../src/brief/measures.js';
import { computeLenses } from '../src/decision/lenses.js';
import { participantsOf } from '../src/decision/participants.js';
import { totalsOnly } from './support/brief-world.js';
import { OPTIONS, controlledAnalysis, type OptionSpec } from './support/decision-fixtures.js';
import { analysisOf } from './support/decision-world.js';

/** The lenses of a hand-set comparison, with the cast’s own positions. */
function lensesOf(
  options: OptionSpec[],
  config: { runs?: number; blocked?: string[]; totals?: boolean } = {},
): LensReading[] {
  const analysis = controlledAnalysis(options, config.runs ? { runs: config.runs } : {});
  const shown = config.totals ? totalsOnly(analysis) : analysis;
  const positions = new Map(
    [...participantsOf(shown.actors, [])].map(([id, entry]) => [id, entry.position]),
  );
  return computeLenses({
    measures: measureVariants(shown),
    actors: shown.actors,
    positions,
    blocked: new Set(config.blocked ?? []),
  });
}
const lens = (lenses: LensReading[], id: (typeof LENS_IDS)[number]): LensReading =>
  lenses.find((entry) => entry.id === id)!;
const value = (reading: LensReading, id: string): number | null =>
  reading.results.find((entry) => entry.alternativeId === id)?.value ?? null;

describe('the lenses read only what the simulation measured', () => {
  it('has four named lenses, each saying what it measures and which way is better', () => {
    expect([...LENS_IDS]).toEqual([
      'overall-resistance',
      'key-actor-support',
      'decision-maker-resistance',
      'worst-affected-downside',
    ]);
    for (const id of LENS_IDS) {
      expect(LENS_INFO[id].measure).toMatch(/simulated share/u);
      expect(['lower', 'higher']).toContain(LENS_INFO[id].direction);
    }
  });

  it('computes each lens from the response shares of the runs, every actor counting equally', () => {
    const lenses = lensesOf([
      OPTIONS.baseline(
        { provider: 0.1, 'rival-provider': 0.2, regulator: 0.3, subscribers: 0.4, resellers: 0.5 },
        { favourable: 0.5 },
      ),
      OPTIONS.proposed(
        { provider: 0.5, 'rival-provider': 0.5, regulator: 0.5, subscribers: 0.5, resellers: 0.9 },
        { favourable: 0.1 },
      ),
    ]);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    // Overall: the mean over all five actors of switch plus resist.
    expect(value(lens(lenses, 'overall-resistance'), 'baseline')).toBeCloseTo(
      mean([0.1, 0.2, 0.3, 0.4, 0.5]),
      2,
    );
    expect(value(lens(lenses, 'overall-resistance'), 'proposed-change')).toBeCloseTo(
      mean([0.5, 0.5, 0.5, 0.5, 0.9]),
      2,
    );
    // Key actors (provider, rival-provider, regulator): the share going along or accepting.
    expect(value(lens(lenses, 'key-actor-support'), 'baseline')).toBeCloseTo(0.5, 2);
    // Deciders (provider decides, regulator can block): their own adverse share.
    expect(value(lens(lenses, 'decision-maker-resistance'), 'baseline')).toBeCloseTo(
      mean([0.1, 0.3]),
      2,
    );
    expect(value(lens(lenses, 'decision-maker-resistance'), 'proposed-change')).toBeCloseTo(0.5, 2);
    // Worst affected: the highest adverse share of any actor in a run.
    expect(value(lens(lenses, 'worst-affected-downside'), 'baseline')).toBeCloseTo(0.5, 2);
    expect(value(lens(lenses, 'worst-affected-downside'), 'proposed-change')).toBeCloseTo(0.9, 2);
    expect(lens(lenses, 'worst-affected-downside').results[0]?.detail).toMatch(
      /Worst affected: “/u,
    );
    expect(lens(lenses, 'overall-resistance').leaderId).toBe('baseline');
    expect(lens(lenses, 'key-actor-support').leaderId).toBe('baseline');
  });

  it('keeps every value on the lens’s own scale of 0 to 1 and the spread over the runs around the mean', () => {
    for (const reading of lensesOf([
      OPTIONS.baseline(0.3, { jitter: 0.1 }),
      OPTIONS.proposed(0.5, { jitter: 0.1 }),
    ])) {
      for (const result of reading.results) {
        expect(result.value).toBeGreaterThanOrEqual(0);
        expect(result.value).toBeLessThanOrEqual(1);
        expect(result.low).toBeLessThanOrEqual(result.value as number);
        expect(result.high).toBeGreaterThanOrEqual(result.value as number);
        expect(result.runs).toBe(20);
      }
    }
  });

  it('tells two options apart only by a clear gap that is also larger than the run-to-run noise', () => {
    const near = lens(
      lensesOf([OPTIONS.baseline(0.3), OPTIONS.proposed(0.34)]),
      'overall-resistance',
    );
    expect(near).toMatchObject({
      verdict: 'tie',
      leaderId: null,
      levelIds: ['baseline', 'proposed-change'],
    });
    expect(near.results.map((entry) => entry.standing)).toEqual(['level', 'level']);
    const clear = lens(
      lensesOf([OPTIONS.baseline(0.3), OPTIONS.proposed(0.4)]),
      'overall-resistance',
    );
    expect(clear).toMatchObject({ verdict: 'clear-leader', leaderId: 'baseline' });
    expect(clear.margin).toBeCloseTo(0.1, 2);
    expect(clear.results.map((entry) => entry.standing)).toEqual(['leads', 'behind']);
    const noisy = lens(
      lensesOf([OPTIONS.baseline(0.3, { jitter: 0.3 }), OPTIONS.proposed(0.4, { jitter: 0.3 })]),
      'overall-resistance',
    );
    expect(noisy.verdict).toBe('tie');
  });

  it('does not rank an option that a confirmed hard constraint rules out, and shows it as not assessed', () => {
    const lenses = lensesOf([OPTIONS.baseline(0.4), OPTIONS.proposed(0.1), OPTIONS.smaller(0.3)], {
      blocked: ['proposed-change'],
    });
    const overall = lens(lenses, 'overall-resistance');
    expect(overall.leaderId).toBe('smaller-rise');
    expect(
      overall.results.find((entry) => entry.alternativeId === 'proposed-change'),
    ).toMatchObject({ standing: 'not-assessed', value: expect.any(Number) });
  });

  it('compares nothing when fewer than two options can be chosen', () => {
    const lenses = lensesOf([OPTIONS.baseline(0.4), OPTIONS.proposed(0.1)], {
      blocked: ['proposed-change'],
    });
    expect(lens(lenses, 'overall-resistance')).toMatchObject({
      verdict: 'not-assessed',
      leaderId: null,
    });
    expect(lens(lenses, 'overall-resistance').note).toMatch(/Fewer than two options/u);
  });

  it('says a lens cannot be computed, and why, when nobody is there for it to read', () => {
    const analysis = controlledAnalysis([OPTIONS.baseline(0.4), OPTIONS.proposed(0.1)]);
    const lenses = computeLenses({
      measures: measureVariants(analysis),
      actors: analysis.actors.map((actor) => ({ ...actor, kind: 'cohort' as const })),
      positions: new Map(),
      blocked: new Set(),
    });
    expect(lens(lenses, 'key-actor-support')).toMatchObject({
      computable: false,
      results: [],
      verdict: 'not-assessed',
    });
    expect(lens(lenses, 'key-actor-support').note).toMatch(/No key actor/u);
    expect(lens(lenses, 'decision-maker-resistance').note).toMatch(
      /No actor decides, approves or can block/u,
    );
    expect(lens(lenses, 'overall-resistance').computable).toBe(true);
  });

  it('reads only totals when the analysis kept no run-by-run detail, and will not call a leader from them', () => {
    const lenses = lensesOf([OPTIONS.baseline(0.4), OPTIONS.proposed(0.1)], { totals: true });
    expect(lens(lenses, 'overall-resistance')).toMatchObject({
      verdict: 'clear-leader',
      leaderId: 'proposed-change',
    });
    for (const id of [
      'key-actor-support',
      'decision-maker-resistance',
      'worst-affected-downside',
    ] as const) {
      const reading = lens(lenses, id);
      expect(reading.computable, id).toBe(true);
      expect(reading.verdict, id).toBe('not-assessed');
      expect(reading.note, id).toMatch(/only totals/u);
      expect(reading.results.every((entry) => entry.low === null && entry.high === null)).toBe(
        true,
      );
    }
  });
});

describe('on the worked examples', () => {
  it.each(EXAMPLE_SCENARIOS.map((pack) => [pack.id, pack] as const))(
    '%s: the headline lens agrees with the engine’s own measure of the runs',
    async (_id, pack) => {
      const analysis = await analysisOf(pack);
      const measures = measureVariants(analysis);
      const participants = participantsOf(analysis.actors, []);
      const lenses = computeLenses({
        measures,
        actors: analysis.actors,
        positions: new Map([...participants].map(([id, entry]) => [id, entry.position])),
        blocked: new Set(),
      });
      const overall = lens(lenses, 'overall-resistance');
      for (const measure of measures) {
        expect(value(overall, measure.variant.id)).toBeCloseTo(measure.share.mean, 3);
      }
      for (const reading of lenses) {
        for (const result of reading.results) {
          expect(result.value).toBeGreaterThanOrEqual(0);
          expect(result.value).toBeLessThanOrEqual(1);
        }
        if (reading.verdict === 'clear-leader') expect(reading.margin).toBeGreaterThanOrEqual(0.05);
      }
    },
    60_000,
  );
});
