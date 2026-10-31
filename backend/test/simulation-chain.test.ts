import { describe, expect, it } from 'vitest';
import { runOutcomeSchema, type RunOutcome, type SimEvent } from '../../shared/analysis.js';
import { EXTERNAL_RESPONDER_CATEGORIES } from '../../shared/stakeholders.js';
import {
  DEFAULT_REACH,
  RESPONDER_RULES,
  eventStrength,
  responderLag,
  responderThreshold,
} from '../src/simulation/responders.js';
import { SIGNAL_NAMES } from '../src/simulation/signals.js';
import { simulate } from '../src/simulation/simulate.js';
import { actor, CHAIN_RELATIONS, chainCast, key, spec } from './support/simulation-cast.js';

const SEEDS = Array.from({ length: 20 }, (_, at) => at + 1);
const finalOf = (outcome: RunOutcome, id: string) => {
  const found = outcome.final.byActor.find((entry) => entry.actorId === id);
  if (!found) throw new Error(`No actor ${id} in the outcome.`);
  return found;
};
const eventBy = (outcome: RunOutcome, id: string): SimEvent | undefined =>
  outcome.events.find((event) => event.actorId === id);
const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** The first round the named signal reached `threshold`, and so the round a responder acts `lag` later. */
function firstCrossing(outcome: RunOutcome, signal: string, threshold: number): number | null {
  return outcome.rounds.find((round) => (round.signals[signal] ?? 0) >= threshold)?.round ?? null;
}

describe('the rules a responder follows', () => {
  it('see a signal later the less reactive they are, and act at a level set by tolerance and authority', () => {
    expect(responderLag(1)).toBe(1);
    expect(responderLag(0.76)).toBe(1);
    expect(responderLag(0.5)).toBe(2);
    expect(responderLag(0.25)).toBe(3);
    expect(responderLag(0)).toBe(3);
    expect(responderThreshold(0, 1)).toBeCloseTo(0.15, 12);
    expect(responderThreshold(1, 0)).toBeCloseTo(0.75, 12);
    expect(responderThreshold(0.5, 0.7)).toBeCloseTo(0.4, 12);
    expect(responderThreshold(0.6, 0.7)).toBeGreaterThan(responderThreshold(0.4, 0.7));
    expect(responderThreshold(0.5, 0.9)).toBeLessThan(responderThreshold(0.5, 0.1));
  });

  it('act harder the further past the threshold the signal is and the more authority they have', () => {
    expect(eventStrength(0.4, 0.4, 0)).toBeCloseTo(0.2, 12);
    expect(eventStrength(1, 0.4, 1)).toBeCloseTo(1, 12);
    expect(eventStrength(0.7, 0.4, 0.5)).toBeGreaterThan(eventStrength(0.5, 0.4, 0.5));
    expect(eventStrength(0.7, 0.4, 0.9)).toBeGreaterThan(eventStrength(0.7, 0.4, 0.1));
    expect(eventStrength(0.2, 0.4, 0.5)).toBeCloseTo(eventStrength(0.4, 0.4, 0.5), 12);
  });

  it('exist for exactly the categories the contract names as external responders', () => {
    expect(Object.keys(RESPONDER_RULES).sort()).toEqual([...EXTERNAL_RESPONDER_CATEGORIES].sort());
    expect(Object.keys(DEFAULT_REACH).sort()).toEqual([...EXTERNAL_RESPONDER_CATEGORIES].sort());
    for (const rule of Object.values(RESPONDER_RULES)) {
      expect(SIGNAL_NAMES).toContain(rule.signal);
    }
  });
});

describe('a second-order chain among Alpha, Beta and Gamma', () => {
  const input = spec(chainCast(), { relations: CHAIN_RELATIONS, rounds: 12 });
  const beta = chainCast()[1]!.traits;
  const gamma = chainCast()[2]!.traits;
  const betaThreshold = responderThreshold(beta.riskTolerance.value, beta.authority.value);
  const gammaThreshold = responderThreshold(gamma.riskTolerance.value, gamma.authority.value);

  it('begins with a signal crossing a threshold and a responder acting after its lag', () => {
    for (const seed of SEEDS) {
      const outcome = simulate(input, seed);
      const crossing = firstCrossing(outcome, 'adverse-share', betaThreshold);
      expect(crossing, `seed ${seed}`).not.toBeNull();
      const counterMove = eventBy(outcome, 'beta');
      expect(counterMove?.kind).toBe('counter-move');
      expect(counterMove?.round).toBe(crossing! + responderLag(beta.reactivity.value));
      expect(counterMove?.causedBy).toEqual(['adverse-share']);
      expect(counterMove?.id).toBe('e1');
      expect(
        outcome.rounds
          .filter((round) => round.round < crossing!)
          .every((round) => (round.signals['adverse-share'] ?? 0) < betaThreshold),
      ).toBe(true);
    }
  });

  it('goes on to a second responder, whose event names the signal and the first event', () => {
    for (const seed of SEEDS) {
      const outcome = simulate(input, seed);
      const first = eventBy(outcome, 'beta')!;
      const second = eventBy(outcome, 'gamma');
      const crossing = firstCrossing(outcome, 'switching-pressure', gammaThreshold);
      expect(second?.kind, `seed ${seed}`).toBe('substitute-offer');
      expect(second?.round).toBe(crossing! + responderLag(gamma.reactivity.value));
      expect(second!.round).toBeGreaterThan(first.round);
      expect(second?.causedBy).toEqual(['switching-pressure', first.id]);
      expect(outcome.events.map((event) => event.id)).toEqual(['e1', 'e2']);
      expect(crossing).toBeGreaterThan(first.round);
    }
  });

  it('shifts later switching, and only from the round after the first event', () => {
    const switched: number[] = [];
    for (const seed of SEEDS) {
      const outcome = simulate(input, seed);
      const plain = simulate(input, seed, { signals: false });
      const acted = eventBy(outcome, 'beta')!.round;
      outcome.rounds.forEach((round, at) => {
        if (round.round <= acted) {
          expect(round.byActor).toEqual(plain.rounds[at]!.byActor);
          expect(round.responseShares).toEqual(plain.rounds[at]!.responseShares);
        }
      });
      expect(outcome.rounds[acted]!.responseShares.switch).toBeGreaterThan(
        plain.rounds[acted]!.responseShares.switch,
      );
      expect(finalOf(outcome, 'alpha').stanceMean).toBeLessThan(finalOf(plain, 'alpha').stanceMean);
      switched.push(
        finalOf(outcome, 'alpha').responseShares.switch -
          finalOf(plain, 'alpha').responseShares.switch,
      );
    }
    expect(Math.min(...switched)).toBeGreaterThan(0);
    expect(mean(switched)).toBeGreaterThan(0.8);
  });

  it('is emergent: without the first move there is no pressure to switch and no second move', () => {
    const lonely = spec([chainCast()[0]!, chainCast()[2]!], {
      relations: [CHAIN_RELATIONS[1]!],
      rounds: 12,
    });
    for (const seed of SEEDS) {
      const outcome = simulate(lonely, seed);
      expect(outcome.events, `seed ${seed}`).toEqual([]);
      expect(finalOf(outcome, 'alpha').responseShares.resist).toBeGreaterThan(0.9);
    }
  });

  it('does not begin when nothing is harmed enough to cross a threshold', () => {
    const gentle = spec(chainCast(), {
      relations: CHAIN_RELATIONS,
      rounds: 12,
      variant: { intensity: 0.05 },
    });
    const unaffected = spec(chainCast(), {
      relations: CHAIN_RELATIONS,
      rounds: 12,
      variant: { impactOverrides: { alpha: 0 } },
    });
    for (const seed of SEEDS) {
      expect(simulate(gentle, seed).events).toEqual([]);
      expect(simulate(unaffected, seed).events).toEqual([]);
    }
  });

  it('is read back through the events: valid, in order, each cause a signal or an earlier event', () => {
    const outcome = simulate(input, 4);
    expect(() => runOutcomeSchema.parse(outcome)).not.toThrow();
    for (const [at, event] of outcome.events.entries()) {
      expect(event.round).toBeGreaterThanOrEqual(2);
      expect(event.description.length).toBeLessThanOrEqual(300);
      expect(event.description).toContain(`round ${event.round}`);
      expect(event.description).not.toMatch(/NaN|undefined/u);
      expect(SIGNAL_NAMES as readonly string[]).toContain(event.causedBy[0]);
      for (const cause of event.causedBy.slice(1)) {
        const earlier = outcome.events.findIndex((candidate) => candidate.id === cause);
        expect(earlier).toBeGreaterThanOrEqual(0);
        expect(earlier).toBeLessThan(at);
      }
    }
  });

  it('keeps to the lag that reactivity gives a responder', () => {
    for (const [reactivity, lag] of [
      [1, 1],
      [0.5, 2],
      [0, 3],
    ] as const) {
      const cast = chainCast();
      cast[1]!.traits.reactivity.value = reactivity;
      const outcome = simulate(spec(cast, { relations: CHAIN_RELATIONS, rounds: 12 }), 6);
      const crossing = firstCrossing(outcome, 'adverse-share', betaThreshold)!;
      expect(eventBy(outcome, 'beta')?.round).toBe(crossing + lag);
    }
  });

  it('keeps to the threshold that tolerance and authority give a responder', () => {
    const cast = chainCast();
    cast[1]!.traits.riskTolerance.value = 1;
    cast[1]!.traits.authority.value = 0;
    // 0.75: only reached once almost all of the harmed actor's members are adverse.
    const outcome = simulate(
      spec(cast, { relations: CHAIN_RELATIONS, rounds: 12, variant: { intensity: 0.2 } }),
      6,
    );
    const crossing = firstCrossing(outcome, 'adverse-share', 0.75);
    const event = eventBy(outcome, 'beta');
    if (crossing === null) expect(event).toBeUndefined();
    else expect(event?.round).toBe(crossing + responderLag(0.5));
  });
});

describe('what each kind of responder does', () => {
  const harmed = (switchingCost = 0.65) =>
    actor('alpha', 'cost-bearer', {
      traits: {
        impact: -0.6,
        sensitivity: 0.8,
        switchingCost,
        riskTolerance: { value: 0.2, spread: 0.05 },
      },
    });

  it('has a competitor and a substitute make switching cheaper and discontent heavier', () => {
    // A substitute acts on members who are already leaning to switch, so its members switch cheaply.
    for (const [category, kind, cost] of [
      ['competitor', 'counter-move', 0.65],
      ['substitute', 'substitute-offer', 0.3],
    ] as const) {
      const input = spec([harmed(cost), key('other-side', category, { impact: 0 })], {
        rounds: 12,
        relations: [{ from: 'other-side', to: 'alpha', type: 'competes-with', strength: 0.8 }],
      });
      const outcome = simulate(input, 2);
      expect(eventBy(outcome, 'other-side')?.kind).toBe(kind);
      expect(finalOf(outcome, 'alpha').stanceMean).toBeLessThan(
        finalOf(simulate(input, 2, { signals: false }), 'alpha').stanceMean,
      );
    }
  });

  it('has a regulator raise risk concern and pull risk-averse members down', () => {
    const input = spec([harmed(), key('watchdog', 'regulator', { impact: 0 })], {
      rounds: 12,
      relations: [{ from: 'watchdog', to: 'alpha', type: 'regulates', strength: 0.8 }],
    });
    const outcome = simulate(input, 2);
    const event = eventBy(outcome, 'watchdog');
    expect(event?.kind).toBe('scrutiny');
    expect(event?.causedBy[0]).toBe('risk-concern');
    expect(finalOf(outcome, 'alpha').stanceMean).toBeLessThan(
      finalOf(simulate(input, 2, { signals: false }), 'alpha').stanceMean,
    );
    // Members who tolerate more risk are pulled down less.
    const bold = harmed();
    bold.traits.riskTolerance.value = 0.9;
    const calm = simulate(
      spec([bold, key('watchdog', 'regulator', { impact: 0, riskTolerance: 0.1, authority: 1 })], {
        rounds: 12,
        relations: [{ from: 'watchdog', to: 'alpha', type: 'regulates', strength: 0.8 }],
      }),
      2,
    );
    expect(calm.events).toEqual([]);
  });

  it('has a partner ease the burden and lift discontented members back toward neutral', () => {
    const input = spec([harmed(), key('helper', 'partner', { impact: 0 })], {
      rounds: 12,
      relations: [{ from: 'helper', to: 'alpha', type: 'partners-with', strength: 0.8 }],
    });
    const outcome = simulate(input, 2);
    expect(eventBy(outcome, 'helper')?.kind).toBe('enablement');
    expect(eventBy(outcome, 'helper')?.causedBy).toEqual(['adverse-share']);
    expect(finalOf(outcome, 'alpha').stanceMean).toBeGreaterThan(
      finalOf(simulate(input, 2, { signals: false }), 'alpha').stanceMean,
    );
  });

  it('lands on the actors it is related to and on no others', () => {
    const input = spec(
      [
        harmed(),
        actor('bystander', 'cost-bearer', { traits: { impact: -0.6 } }),
        key('rival', 'competitor', { impact: 0 }),
      ],
      {
        rounds: 12,
        relations: [{ from: 'rival', to: 'alpha', type: 'competes-with', strength: 0.9 }],
      },
    );
    const withEvents = simulate(input, 3);
    const plain = simulate(input, 3, { signals: false });
    expect(finalOf(withEvents, 'alpha')).not.toEqual(finalOf(plain, 'alpha'));
    // The bystander is harmed too and so is watched, but the rival has no tie to it: nothing lands.
    expect(finalOf(withEvents, 'bystander')).toEqual(finalOf(plain, 'bystander'));
  });
});

describe('a responder with no relations, or none that reach anyone affected', () => {
  it('still acts, through the categories it reaches by default', () => {
    const input = spec(chainCast(), { relations: [], rounds: 12 });
    for (const seed of SEEDS.slice(0, 8)) {
      const outcome = simulate(input, seed);
      expect(outcome.events.map((event) => event.kind)).toEqual([
        'counter-move',
        'substitute-offer',
      ]);
      expect(outcome.events[1]?.causedBy).toEqual(['switching-pressure', 'e1']);
      expect(() => runOutcomeSchema.parse(outcome)).not.toThrow();
    }
  });

  it('reaches the actors the change harms when no category reaches anyone', () => {
    const cast = [
      actor('alpha', 'other', { traits: { impact: -0.6, sensitivity: 0.8, switchingCost: 0.65 } }),
      key('rival', 'competitor', { impact: 0, riskTolerance: 0.4, authority: 0.8 }),
    ];
    const outcome = simulate(spec(cast, { relations: [], rounds: 12 }), 1);
    expect(outcome.events.map((event) => event.kind)).toEqual(['counter-move']);
  });

  it('reaches the harmed too when it is related only to an actor the change does not touch', () => {
    const cast = [
      actor('alpha', 'cost-bearer', {
        traits: { impact: -0.6, sensitivity: 0.8, riskTolerance: 0.2 },
      }),
      key('provider', 'decision-maker', { impact: 0 }),
      key('watchdog', 'regulator', { impact: 0, authority: 0.9 }),
      key('helper', 'partner', { impact: 0, authority: 0.9, riskTolerance: 0.1 }),
    ];
    const outcome = simulate(
      spec(cast, {
        rounds: 12,
        relations: [
          { from: 'watchdog', to: 'provider', type: 'regulates', strength: 0.5 },
          { from: 'helper', to: 'provider', type: 'partners-with', strength: 0.5 },
        ],
      }),
      1,
    );
    expect(outcome.events.map((event) => event.kind).sort()).toEqual(['enablement', 'scrutiny']);
  });

  it('does nothing, without failing, when nobody is harmed or there is nobody to watch', () => {
    const benefit = spec(
      [
        actor('alpha', 'cost-bearer', { traits: { impact: 0.6 } }),
        key('rival', 'competitor', { impact: 0 }),
        key('helper', 'partner', { impact: 0 }),
      ],
      { rounds: 8 },
    );
    expect(simulate(benefit, 1).events).toEqual([]);
    const alone = spec([key('rival', 'competitor', { impact: -0.9 })], { rounds: 8 });
    const outcome = simulate(alone, 1);
    expect(outcome.events).toEqual([]);
    expect(() => runOutcomeSchema.parse(outcome)).not.toThrow();
  });

  it('ignores a relation of no strength, so that the defaults still apply', () => {
    const input = spec(chainCast(), {
      relations: [{ from: 'beta', to: 'gamma', type: 'competes-with', strength: 0 }],
      rounds: 12,
    });
    expect(simulate(input, 3).events.map((event) => event.kind)).toEqual([
      'counter-move',
      'substitute-offer',
    ]);
  });
});

describe('events are bounded and unique', () => {
  it('keeps one event per responder, at most 200, with unique ids and (kind, actor, round)', () => {
    const categories = ['competitor', 'substitute', 'partner', 'regulator'] as const;
    const cast = [
      actor('alpha', 'cost-bearer', {
        size: 5_000,
        sampleSize: 30,
        traits: { impact: -0.8, sensitivity: 0.9, switchingCost: 0.6, riskTolerance: 0.2 },
      }),
      ...Array.from({ length: 59 }, (_, at) =>
        key(`responder-${at}`, categories[at % 4]!, {
          impact: 0,
          riskTolerance: 0.1 + (at % 5) * 0.05,
          authority: 0.5 + (at % 4) * 0.1,
          reactivity: (at % 6) / 5,
        }),
      ),
    ];
    for (const seed of [1, 2, 3]) {
      const outcome = simulate(spec(cast, { rounds: 36 }), seed);
      expect(() => runOutcomeSchema.parse(outcome)).not.toThrow();
      expect(outcome.events.length).toBeGreaterThan(10);
      expect(outcome.events.length).toBeLessThanOrEqual(200);
      expect(new Set(outcome.events.map((event) => event.id)).size).toBe(outcome.events.length);
      expect(
        new Set(outcome.events.map((event) => `${event.kind}|${event.actorId}|${event.round}`))
          .size,
      ).toBe(outcome.events.length);
      expect(new Set(outcome.events.map((event) => event.actorId)).size).toBe(
        outcome.events.length,
      );
      outcome.events.forEach((event, at) => {
        expect(event.causedBy.length).toBeLessThanOrEqual(8);
        for (const cause of event.causedBy.slice(1)) {
          expect(outcome.events.findIndex((candidate) => candidate.id === cause)).toBeLessThan(at);
        }
      });
    }
  });
});
