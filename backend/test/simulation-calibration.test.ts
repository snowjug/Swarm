import { describe, expect, it } from 'vitest';
import {
  simulationSpecSchema,
  type RunOutcome,
  type SimulationSpec,
} from '../../shared/analysis.js';
import { actorSetFixture, FIXTURE_VARIANTS } from '../../shared/lab-fixtures.js';
import { simulateValidated } from '../src/simulation/simulate.js';

/**
 * Calibration on the fixture cast (a subscription service: subscribers who bear the change, a rival, a
 * regulator and resellers), the one the analysis is built and shown on. These tests do not check that
 * the model is right, which nothing here can; they check that it is not degenerate. A harmed cohort must
 * not end at the end of the scale whatever its members are like, shares must move gradually with the
 * strength of the change and vary from seed to seed, and a responder's threshold must decide whether
 * it acts. The seeds and rounds are fixed, so a failure is a change in the model, not in the dice.
 */
const SEEDS = Array.from({ length: 30 }, (_, at) => 100 + at);
const cast = actorSetFixture();
const proposed = FIXTURE_VARIANTS[1]!;

const cache = new Map<string, RunOutcome[]>();
function runs(intensity: number, rounds = 12, options: { signals?: boolean } = {}): RunOutcome[] {
  const key = `${intensity}|${rounds}|${options.signals ?? true}`;
  const known = cache.get(key);
  if (known) return known;
  const spec: SimulationSpec = simulationSpecSchema.parse({
    actors: cast.actors,
    relations: cast.relations,
    rounds,
    variant: { ...proposed, intensity },
  });
  const outcomes = SEEDS.map((seed) => simulateValidated(spec, seed, options));
  cache.set(key, outcomes);
  return outcomes;
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]): number => sum(values) / values.length;
const sd = (values: number[]): number =>
  Math.sqrt(sum(values.map((value) => (value - mean(values)) ** 2)) / (values.length - 1));
const subscribers = (outcome: RunOutcome) => {
  const found = outcome.final.byActor.find((entry) => entry.actorId === 'subscribers');
  if (!found) throw new Error('No subscribers in the outcome.');
  return found.responseShares;
};
/** The share of the simulated members that end switching or resisting, each actor counting once. */
const overall = (outcome: RunOutcome): number =>
  outcome.final.responseShares.switch + outcome.final.responseShares.resist;
const subscribersAgainst = (outcome: RunOutcome): number =>
  subscribers(outcome).switch + subscribers(outcome).resist;
const rate = (outcomes: RunOutcome[], kind?: string): number =>
  outcomes.filter((outcome) =>
    kind ? outcome.events.some((event) => event.kind === kind) : outcome.events.length > 0,
  ).length / outcomes.length;

describe('the fixture cast under a change of growing strength', () => {
  it('leaves everyone at their prior when nothing changes', () => {
    const baseline = runs(0);
    expect(mean(baseline.map(overall))).toBe(0);
    expect(rate(baseline)).toBe(0);
    expect(Math.abs(mean(baseline.map((outcome) => outcome.final.stanceMean)))).toBeLessThan(0.03);
  });

  it('splits the subscribers at the proposed strength: some adapt, some switch, on average', () => {
    const outcomes = runs(proposed.intensity);
    const against = mean(outcomes.map(subscribersAgainst));
    expect(against).toBeGreaterThan(0.15);
    expect(against).toBeLessThan(0.85);
    const adapting = mean(outcomes.map((outcome) => subscribers(outcome)['adapt-defensively']));
    const switching = mean(outcomes.map((outcome) => subscribers(outcome).switch));
    expect(adapting).toBeGreaterThan(0.1);
    expect(switching).toBeGreaterThan(0.1);
    // Not the same in every run: some runs have most subscribers against, some few.
    expect(Math.max(...outcomes.map(subscribersAgainst))).toBeGreaterThan(0.75);
    expect(Math.min(...outcomes.map(subscribersAgainst))).toBeLessThan(0.3);
  });

  it('varies from seed to seed, in the overall share and not only in the subscribers', () => {
    for (const intensity of [0.5, 0.6, 0.7, 0.8]) {
      expect(sd(runs(intensity).map(overall)), `intensity ${intensity}`).toBeGreaterThan(0.02);
    }
    expect(sd(runs(1).map(overall))).toBeGreaterThan(0.015);
    expect(sd(runs(proposed.intensity).map(subscribersAgainst))).toBeGreaterThan(0.1);
    expect(new Set(runs(proposed.intensity).map(overall)).size).toBeGreaterThan(10);
  });

  it('rises with the strength of the change, steadily and without saturating early', () => {
    const intensities = [0.2, 0.4, 0.6, 0.8, 1];
    const whole = intensities.map((intensity) => mean(runs(intensity).map(overall)));
    const among = intensities.map((intensity) => mean(runs(intensity).map(subscribersAgainst)));
    for (const series of [whole, among]) {
      series.forEach((value, at) => {
        if (at > 0) expect(value).toBeGreaterThan(series[at - 1]!);
      });
    }
    expect(new Set(whole.map((value) => value.toFixed(2))).size).toBeGreaterThanOrEqual(4);
    expect(new Set(among.map((value) => value.toFixed(2))).size).toBeGreaterThanOrEqual(4);
    among.forEach((value, at) => {
      if (at > 0) {
        expect(value - among[at - 1]!).toBeGreaterThan(0.03);
        expect(value - among[at - 1]!).toBeLessThan(0.45);
      }
    });
    expect(among[0]!).toBeLessThan(0.05);
    expect(among[3]!).toBeLessThan(0.9);
    expect(among[4]!).toBeGreaterThan(0.7);
  });

  it('has most subscribers wait or adapt when the change is slight', () => {
    const slight = runs(0.2);
    const quiet = mean(
      slight.map(
        (outcome) => subscribers(outcome).wait + subscribers(outcome)['adapt-defensively'],
      ),
    );
    expect(quiet).toBeGreaterThan(0.8);
    expect(mean(slight.map(subscribersAgainst))).toBeLessThan(0.05);
  });

  it('has the members of the cohort end in several responses, not one', () => {
    for (const intensity of [0.4, 0.6, 0.7, 0.8]) {
      const occupied = runs(intensity).map(
        (outcome) => Object.values(subscribers(outcome)).filter((share) => share > 0).length,
      );
      expect(mean(occupied), `intensity ${intensity}`).toBeGreaterThan(2);
    }
  });
});

describe('the second-order events on the fixture cast', () => {
  it('appear in some runs and not all at a moderate strength, and more often at a higher one', () => {
    const rates = [0.5, 0.6, 0.7, 0.8, 1].map((intensity) => rate(runs(intensity)));
    rates.forEach((value, at) => {
      if (at > 0) expect(value).toBeGreaterThan(rates[at - 1]!);
    });
    for (const intensity of [0.6, 0.7]) {
      expect(rate(runs(intensity)), `intensity ${intensity}`).toBeGreaterThan(0.1);
      expect(rate(runs(intensity)), `intensity ${intensity}`).toBeLessThan(0.95);
    }
    expect(rate(runs(1))).toBeGreaterThan(rate(runs(0.7)));
  });

  it('are decided by the thresholds: none when the change is too slight to reach them', () => {
    for (const intensity of [0, 0.2, 0.4]) {
      expect(rate(runs(intensity)), `intensity ${intensity}`).toBeLessThan(0.1);
    }
  });

  it('hold for each kind of responder, not only for one', () => {
    for (const kind of ['counter-move', 'enablement', 'scrutiny']) {
      expect(rate(runs(0.7), kind), kind).toBeGreaterThan(0.1);
      expect(rate(runs(0.7), kind), kind).toBeLessThan(0.95);
      expect(rate(runs(1), kind), kind).toBeGreaterThan(rate(runs(0.6), kind));
    }
  });

  it('change the outcome by a part of what the change itself does, not all of it', () => {
    const withEvents = runs(0.7).map(subscribersAgainst);
    const without = runs(0.7, 12, { signals: false }).map(subscribersAgainst);
    const effect = mean(withEvents) - mean(without);
    expect(mean(without)).toBeGreaterThan(0.3);
    expect(effect).toBeGreaterThan(0.02);
    expect(effect).toBeLessThan(0.2);
  });
});

describe('the same on a shorter and a longer run', () => {
  it('keeps the shares interior, the seeds apart and the events partial at the proposed strength', () => {
    for (const rounds of [8, 24]) {
      const outcomes = runs(0.7, rounds);
      const against = mean(outcomes.map(subscribersAgainst));
      expect(against, `${rounds} rounds`).toBeGreaterThan(0.15);
      expect(against, `${rounds} rounds`).toBeLessThan(0.85);
      expect(sd(outcomes.map(overall)), `${rounds} rounds`).toBeGreaterThan(0.02);
      expect(rate(outcomes), `${rounds} rounds`).toBeGreaterThan(0.1);
      expect(rate(outcomes), `${rounds} rounds`).toBeLessThan(0.95);
    }
  });
});
