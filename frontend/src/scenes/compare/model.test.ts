import { describe, expect, it } from 'vitest';
import { analysisFixture } from '../../../../shared/lab-fixtures';
import type { RunOutcome, SensitivityRow } from '../../../../shared/analysis';
import {
  bandPath,
  fitAxis,
  linePath,
  linear,
  nearest,
  niceStep,
  shareAxis,
  spreadLabels,
  ticksBetween,
} from './scale';
import { sensitivityTally, tornadoOrder, tornadoReach } from './tornado';
import { acrossRuns, secondOrderFindings } from './chain';

describe('chart scales', () => {
  it('maps values to positions and back', () => {
    const x = linear([0, 10], [100, 300]);
    expect(x(0)).toBe(100);
    expect(x(5)).toBe(200);
    expect(x.invert(250)).toBe(7.5);
    expect(linear([2, 2], [0, 100])(2)).toBe(50);
  });

  it('chooses steps a person would choose', () => {
    expect(niceStep(0.03)).toBe(0.05);
    expect(niceStep(0.2)).toBe(0.2);
    expect(niceStep(0.21)).toBe(0.25);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0)).toBe(1);
  });

  it('ticks between limits at round values, without drift', () => {
    expect(ticksBetween(0, 0.15, 3)).toEqual([0, 0.05, 0.1, 0.15]);
    expect(ticksBetween(-0.25, 0.25, 4)).toEqual([-0.2, 0, 0.2]);
  });

  it('ends a share axis at a round figure just past the largest share', () => {
    const axis = shareAxis(0.113);
    expect(axis.max).toBeGreaterThanOrEqual(0.113);
    expect(axis.max).toBeLessThanOrEqual(0.2);
    expect(axis.ticks[0]).toBe(0);
    expect(axis.ticks.at(-1)).toBe(axis.max);
    expect(shareAxis(0).max).toBeGreaterThan(0);
  });

  it('frames small stances tightly and keeps zero inside', () => {
    const axis = fitAxis([-0.115, 0.009]);
    expect(axis.min).toBeLessThanOrEqual(-0.115);
    expect(axis.max).toBeGreaterThanOrEqual(0.009);
    expect(axis.max - axis.min).toBeLessThan(0.5);
    expect(axis.ticks).toEqual([-0.15, -0.1, -0.05, 0, 0.05]);
    expect(fitAxis([-3, 3])).toMatchObject({ min: -1, max: 1 });
  });

  it('draws lines and the band between two lines', () => {
    expect(
      linePath([
        { x: 0, y: 1 },
        { x: 10, y: 2.26 },
      ]),
    ).toBe('M0,1 L10,2.3');
    const band = bandPath(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      [
        { x: 0, y: 5 },
        { x: 1, y: 5 },
      ],
    );
    expect(band).toBe('M0,0 L1,0 L1,5 L0,5 Z');
    expect(bandPath([], [])).toBe('');
  });

  it('finds the round under the pointer', () => {
    expect(nearest([1, 2, 3, 4], 2.6)).toBe(3);
    expect(nearest([1, 2, 3, 4], -5)).toBe(1);
    expect(nearest([], 3)).toBe(0);
  });

  it('keeps labels apart, in order, inside the chart', () => {
    const placed = spreadLabels([100, 102, 104, 300], 14, 0, 320);
    for (let at = 1; at < placed.length; at += 1)
      expect(placed[at]! - placed[at - 1]!).toBeGreaterThanOrEqual(14);
    expect(placed[3]).toBe(300);
    const crowded = spreadLabels([310, 315, 320], 14, 0, 320);
    expect(Math.max(...crowded)).toBeLessThanOrEqual(320);
    expect(crowded[1]! - crowded[0]!).toBeGreaterThanOrEqual(14);
    // The labels come back in the order they were asked for.
    expect(spreadLabels([50, 10], 14, 0, 100)).toEqual([50, 10]);
  });
});

const row = (
  id: string,
  shift: number,
  standardError: number,
  overrides: Partial<SensitivityRow> = {},
): SensitivityRow => ({
  id,
  target: { kind: 'trait', actorId: null, trait: 'impact' },
  label: id,
  perturbation: 0.2,
  metric: 'metric',
  baseMean: 0.2,
  shift,
  standardError,
  classification: 'robust',
  assumptionOrigin: 'system-assumption',
  ...overrides,
});

describe('what the result depends on', () => {
  it('puts the assumption that moved the result most first, in either direction', () => {
    const ordered = tornadoOrder([
      row('small', 0.001, 0),
      row('down', -0.05, 0),
      row('up', 0.04, 0),
      row('also-small', -0.001, 0),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['down', 'up', 'small', 'also-small']);
  });

  it('runs the bars to a round figure that holds the largest shift with its noise', () => {
    expect(tornadoReach([row('a', -0.0517, 0.0055), row('b', 0.0467, 0.0046)])).toBe(0.1);
    expect(tornadoReach([row('a', 0.0002, 0.0001)])).toBe(0.02);
    expect(tornadoReach([row('a', 0.95, 0.04)])).toBe(1);
    expect(tornadoReach([])).toBe(0.02);
  });

  it('counts what moved clearly, and what could not have been tested', () => {
    const rows = [
      row('a', 0.05, 0.005, { classification: 'assumption-sensitive' }),
      row('b', 0, 0),
      row('c', 0, 0, { classification: 'inconclusive' }),
    ];
    expect(sensitivityTally(rows, false)).toEqual({ total: 3, sensitive: 1, untestable: 0 });
    expect(sensitivityTally(rows, true)).toEqual({ total: 3, sensitive: 1, untestable: 1 });
  });
});

describe('what a change sets off', () => {
  const events: RunOutcome['events'] = [
    {
      id: 'e1',
      round: 3,
      kind: 'counter-move',
      actorId: 'rival-provider',
      description: 'x',
      causedBy: ['adverse-share'],
    },
    {
      id: 'e2',
      round: 5,
      kind: 'scrutiny',
      actorId: 'regulator',
      description: 'y',
      causedBy: ['risk-concern', 'e1'],
      followed: [],
    },
  ];

  it('finds how often the engine counted an event like this one across the runs', () => {
    const findings = [
      {
        ...analysisFixture().findings[0]!,
        id: 'x1',
        kind: 'second-order-event' as const,
        variantId: 'proposed-change',
        actorId: 'rival-provider',
        statement:
          'In 8 of 10 seeded runs, a simulated “counter-move” event by Rival provider occurred under Proposed change (under No change: 0 of 10).',
        holdsIn: 8,
        of: 10,
      },
      {
        ...analysisFixture().findings[0]!,
        id: 'x2',
        kind: 'second-order-event' as const,
        variantId: 'other',
        actorId: 'rival-provider',
        statement:
          'In 1 of 10 seeded runs, a simulated “counter-move” event by Rival provider occurred under Other.',
        holdsIn: 1,
        of: 10,
      },
    ];
    expect(acrossRuns(findings, 'proposed-change', events[0]!)?.id).toBe('x1');
    expect(acrossRuns(findings, 'proposed-change', events[1]!)).toBeNull();
    expect(secondOrderFindings(findings, 'other').map((finding) => finding.id)).toEqual(['x2']);
  });
});
