import { beforeAll, describe, expect, it } from 'vitest';
import { buildCanvas } from '../../backend/src/decision/build.js';
import { DECISION_STATUSES } from '../../shared/decision.js';
import { loadScenarios } from '../src/ai-datasets.js';
import { inputsFor } from '../src/ai-decision.js';
import { describeRow, expectedStatus, isStrict, loadLedger } from '../src/ai-expectations.js';
import { loadDecisionCases } from '../src/ai-suite-data.js';
import { scoreLenses, scoreStatus } from '../src/measure-decision.js';
import {
  measureSuites,
  observeSuites,
  suiteRows,
  type SuiteMeasures,
  type SuiteObservation,
} from '../src/ai-suites.js';
import { loadRegistered, type MetricRow } from '../src/ai-thresholds.js';

// The Decision Canvas: the product's pure builder over 41 gold fixtures set by hand (their gold was
// derived from docs/analysis/decision-canvas.md before the builder was run) and the five worked
// examples through the real rules path and engine. Each decision metric registered for a mode is one
// test; one that breaches is listed in known-breaches.json or fails.

const registered = loadRegistered();
const ledger = loadLedger();
const decisionIds = registered.suites.find((suite) => suite.name === 'decision status')!.ids;
let observed: SuiteObservation;
let measures: SuiteMeasures;
const rows: Record<'rules' | 'fake-foundry', MetricRow[]> = { rules: [], 'fake-foundry': [] };

beforeAll(async () => {
  observed = await observeSuites({ planner: false, research: false, modes: ['rules'] });
  measures = measureSuites(observed, 'all');
  for (const mode of ['rules', 'fake-foundry'] as const)
    rows[mode] = suiteRows(measures, mode, registered);
}, 180_000);

describe.each(['rules', 'fake-foundry'] as const)('the decision canvas in %s mode', (mode) => {
  it.each(decisionIds)('%s', (id) => {
    const row = rows[mode].find((item) => item.id === id);
    expect(row, `${id} has no row`).toBeDefined();
    if (!row) return;
    expect(row.status, describeRow(row, ledger)).toBe(
      expectedStatus(row, registered, ledger, isStrict()),
    );
  });
});

describe('what the fixtures put to the test', () => {
  it('built a canvas from every fixture and every worked example', () => {
    const m = measures.decision!;
    expect(m.errors).toEqual([]);
    expect(m.fixtures).toBe(41);
    expect(m.examples).toBe(45);
  });

  it('reaches every one of the six statuses, and every rule but the one the gate shadows', () => {
    const { reached } = measures.decision!;
    for (const status of DECISION_STATUSES)
      expect(reached.statuses[status], status).toBeGreaterThan(0);
    const unreached = Object.keys(reached.rules);
    expect(unreached).not.toContain('all-violate');
    expect(unreached.length).toBe(9);
  });

  it('holds the gold of the lenses: the clear leader or none, and whether the lenses agree', () => {
    const m = measures.decision!;
    expect(m.lensMisses).toEqual([]);
    expect(m.agreement.rate).toBe(1);
  });

  it('would notice a canvas that disagreed with its gold: the same fixture with six runs is not a robust option', () => {
    const fixture = loadDecisionCases().cases.find((item) => item.id === 'D01')!;
    const canvas = buildCanvas(inputsFor({ ...fixture, runs: 6 }, loadScenarios()));
    const score = scoreStatus(fixture.gold, canvas);
    expect(score.ok).toBe(false);
    expect(score.problems.join(' ')).toMatch(
      /status multiple-plausible-options, gold robust-option/u,
    );
    expect(scoreLenses(fixture.gold, canvas).misses.length).toBeGreaterThan(0);
  });

  it('is quick: fixtures and worked examples build in a few seconds', () => {
    expect(observed.elapsedMs.decision).toBeLessThan(60_000);
  });

  it('has one row for every registered metric in a mode, measured or NOT MEASURED, and none left out', () => {
    for (const mode of ['rules', 'fake-foundry'] as const) {
      const ids = rows[mode].map((row) => row.id).sort();
      const specs = registered.suites.flatMap((suite) => suite.ids).sort();
      expect(ids).toEqual(specs);
    }
    for (const row of rows['fake-foundry'].filter((item) => decisionIds.includes(item.id)))
      expect(row.status).toBe('not-measured');
  });
});
