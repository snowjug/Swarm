import { beforeAll, describe, expect, it } from 'vitest';
import { buildCanvas } from '../../backend/src/decision/build.js';
import { DECISION_STATUSES, STATUS_RULE_IDS } from '../../shared/decision.js';
import { loadScenarios } from '../src/ai-datasets.js';
import { inputsFor } from '../src/ai-decision.js';
import { describeRow, expectedStatus, isStrict, loadLedger } from '../src/ai-expectations.js';
import { loadDecisionCases } from '../src/ai-suite-data.js';
import { scopeProblems, scoreLenses, scoreStatus } from '../src/measure-decision.js';
import {
  measureSuites,
  observeSuites,
  suiteRows,
  type SuiteMeasures,
  type SuiteObservation,
} from '../src/ai-suites.js';
import { loadRegistered, type MetricRow } from '../src/ai-thresholds.js';

// The Decision Canvas: the product's pure builder over 58 gold fixtures set by hand (their gold was
// derived from docs/analysis/decision-canvas.md before the builder was run on them; the last 17, about
// the scope check, were written after that rule existed) and the five worked examples through the
// real rules path and engine. Each decision metric registered for a mode is one test; one that
// breaches is listed in known-breaches.json or fails.

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
    expect(m.fixtures).toBe(58);
    expect(m.examples).toBe(45);
  });

  it('reaches every one of the six statuses, and every rule but the one the gate shadows', () => {
    const { reached } = measures.decision!;
    for (const status of DECISION_STATUSES)
      expect(reached.statuses[status], status).toBeGreaterThan(0);
    const named = Object.keys(reached.rules);
    expect(named).not.toContain('all-violate');
    expect(named).toContain('individual-decision');
    expect(named.length).toBe(STATUS_RULE_IDS.length - 1);
  });

  it('holds the gold of the lenses: the clear leader or none, and whether the lenses agree', () => {
    const m = measures.decision!;
    expect(m.lensMisses).toEqual([]);
    expect(m.agreement.rate).toBe(1);
  });

  it('holds a card that is complete and of the kind its own status gives, for every canvas', () => {
    const m = measures.decision!;
    expect(m.recommendationMisses).toEqual([]);
    expect(m.recommendation.total).toBe(m.fixtures + m.examples);
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

// What the first rule is held to: questions about one person, and look-alikes that only name a matter
// at the level of a policy or an organisation. The gold of D43 to D59 was written after the rule
// existed, from the document; a miss here is a product finding, listed in known-breaches.json when it
// breaches a registered threshold, and it is never fixed by moving the gold.
describe('the first status rule: a question about one person', () => {
  it('names the rule only where the gold names it, and never for a look-alike', () => {
    const { individual, lookAlikes } = measures.decision!;
    expect(individual.spurious).toEqual([]);
    expect(individual.named.rate).toBe(1);
    expect(lookAlikes.overFired.total).toBeGreaterThanOrEqual(4);
    expect(lookAlikes.ids).toEqual([]);
  });

  it('finds the question about one person in all but the known miss', () => {
    const { individual } = measures.decision!;
    expect(individual.found.total).toBe(10);
    // D43 is the known miss (“make redundant” with its object in front): see known-breaches.json. A new
    // miss is a regression; the day D43 is read, this list is empty and the entry comes out.
    expect(individual.missed.map((item) => item.id).filter((id) => id !== 'D43')).toEqual([]);
    expect(individual.found.successes).toBeGreaterThanOrEqual(9);
  });

  it('gives a card, a plan and an approval for a person as the document says, except where the known faults are', () => {
    const { scope, scopeMisses } = measures.decision!;
    expect(scope.total).toBe(17);
    // D43 (not read) and D44 (a name in a cue) are the known faults: see the findings of the report.
    expect(scopeMisses.map((item) => item.id).filter((id) => id !== 'D43' && id !== 'D44')).toEqual(
      [],
    );
  });

  it('would notice a canvas that did not read the question: the same fixture with a question about no one', () => {
    const fixture = loadDecisionCases().cases.find((item) => item.id === 'D47')!;
    expect(fixture.gold.rules).toEqual(['individual-decision']);
    const canvas = buildCanvas(
      inputsFor(
        { ...fixture, question: 'What would change if we kept our deposit rules as they are?' },
        loadScenarios(),
      ),
    );
    expect(canvas.status.rule).not.toBe('individual-decision');
    const score = scoreStatus(fixture.gold, canvas);
    expect(score.ok).toBe(false);
    expect(score.problems.join(' ')).toMatch(/gold needs-human-decision/u);
    expect(scopeProblems(fixture.gold, canvas).length).toBeGreaterThan(0);
  });

  it('would notice a look-alike that fired: the same fixture with a question about one person', () => {
    const fixture = loadDecisionCases().cases.find((item) => item.id === 'D53')!;
    expect(fixture.gold.scope?.individual).toBe(false);
    const canvas = buildCanvas(
      inputsFor({ ...fixture, question: 'Should we fire this employee?' }, loadScenarios()),
    );
    expect(canvas.status.rule).toBe('individual-decision');
    expect(scoreStatus(fixture.gold, canvas).ok).toBe(false);
    expect(scopeProblems(fixture.gold, canvas)).toContain(
      'read as about one person, the gold says not one person',
    );
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
});
