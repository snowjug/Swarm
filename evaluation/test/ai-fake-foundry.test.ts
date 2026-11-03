import { beforeAll, describe, expect, it } from 'vitest';
import { loadScenarios } from '../src/ai-datasets.js';
import { describeRow, expectedStatus, isStrict, loadLedger } from '../src/ai-expectations.js';
import { observeFake, type FakeObservation } from '../src/ai-fake.js';
import { measureFake, type FakeMeasures } from '../src/ai-measure-fake.js';
import { fakeRows } from '../src/ai-report.js';
import { loadRegistered, type MetricRow } from '../src/ai-thresholds.js';

// The fake-foundry mode: the real client, runner and output policy against a scripted fake of the
// Foundry endpoint. It measures the rules around a model (what is rejected, corrected, kept and
// refused), never a model's quality. The replies are derived from the labels, then corrupted.

const registered = loadRegistered();
const ledger = loadLedger();
const scenarios = loadScenarios();
let observation: FakeObservation;
let measures: FakeMeasures;
let rows: MetricRow[];

beforeAll(async () => {
  // The clean arm runs for every scenario; the corruption arms for one of each split, to keep this quick.
  // `npm run eval:ai` corrupts all of them.
  observation = await observeFake({ corruptScenarios: ['S07', 'S08'] });
  measures = measureFake(observation, scenarios, registered.prices, registered.tokenCap, 'all');
  rows = fakeRows(measures, registered);
}, 120_000);

describe('fake-foundry mode against the registered thresholds', () => {
  // The planner, run and decision suites are registered (thresholds.json, `suites`) and wired in their own changes.
  it.each(
    Object.values(registered.specs)
      .filter((spec) => spec.kind !== 'suite')
      .map((spec) => spec.id),
  )('%s', (id) => {
    const row = rows.find((item) => item.id === id);
    expect(row, `${id} has no row`).toBeDefined();
    if (!row) return;
    expect(row.status, describeRow(row, ledger)).toBe(
      expectedStatus(row, registered, ledger, isStrict()),
    );
  });
});

describe('what the output policy does with a corrupted reply', () => {
  it('accepts a reply derived from the labels, nothing corrupted, for every scenario and stage', () => {
    expect(measures.cleanAccepted.rate).toBe(1);
  });

  it('never meets a fault the fake did not mean: nothing it was scripted or sent broke its own rules', () => {
    expect(measures.fakeProblems).toEqual([]);
  });

  const MUST_BE_CAUGHT = [
    'missing-field',
    'extra-field',
    'invented-evidence-id',
    'unverifiable-quote',
    'generic-name',
    'duplicate-names',
    'personal-detail',
    'forecast-wording',
    'stereotype',
    'duplicate-statements',
    'instruction-as-constraint',
    'echoed-injection',
  ];

  it.each(MUST_BE_CAUGHT)(
    'does not let %s through, whether the second reply is clean or not',
    (kind) => {
      const found = measures.catches.filter((item) => item.class === kind);
      expect(found.length, kind).toBeGreaterThan(0);
      for (const item of found) {
        expect(item.transient.rate, `${item.stage} ${kind} corrected once`).toBe(1);
        expect(item.persistent.rate, `${item.stage} ${kind} kept failing`).toBe(1);
      }
    },
  );

  it('knows a real quote from the wrong passage gets through: the structural checks cannot see it', () => {
    for (const item of measures.catches.filter((entry) => entry.class === 'mis-cited-real-quote')) {
      expect(item.persistent.rate, item.stage).toBe(0);
    }
  });

  it('takes the hardness of an extracted constraint from its words, not from the model', () => {
    expect(measures.hardnessInflation.rate).toBeLessThan(0.2);
  });

  it('keeps a model that fails, over budget or blocked out of the answer, and says why', () => {
    expect(measures.refusalsSurfaced.rate).toBe(1);
    expect(measures.failuresFellBack.rate).toBe(1);
    expect(measures.budgetFellBack.rate).toBe(1);
    expect(measures.fallbacks.valid.rate).toBe(1);
    expect(Object.keys(measures.fallbacks.codes)).toEqual(
      expect.arrayContaining([
        'MODEL_OUTPUT_INVALID',
        'MODEL_NOT_FOUND',
        'MODEL_AUTH',
        'MODEL_TRUNCATED',
        'MODEL_CALL_BUDGET',
      ]),
    );
  });

  it('surfaces every way a provider can decline, and answers a benign look-alike', () => {
    for (const [mechanism, rate] of Object.entries(measures.safety.mechanisms)) {
      expect(rate.rate, mechanism).toBe(1);
    }
    expect(measures.safety.benignRefused.rate).toBe(0);
  });

  it('states that the product answers an unsafe request the provider did not block', () => {
    expect(measures.safety.unscreenedAnswered.total).toBeGreaterThan(0);
  });

  it('counts tokens by the fake and keeps a flagship run far under the per-project cap', () => {
    const worst = measures.usage.flagship.worst;
    expect(worst?.tokens).toBeGreaterThan(1_000);
    expect(worst?.tokens).toBeLessThan(registered.tokenCap / 10);
    expect(measures.usage.flagship.perScenario.every((item) => item.calls === 3)).toBe(true);
  });

  it('allows the model critic two corrections, and no more', () => {
    expect(measures.criticCalls.persistentMaxRequests).toBe(3);
  });
});
