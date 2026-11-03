import { beforeAll, describe, expect, it } from 'vitest';
import { describeRow, expectedStatus, isStrict, loadLedger } from '../src/ai-expectations.js';
import {
  measureSuites,
  observeSuites,
  suiteRows,
  type SuiteMeasures,
  type SuiteObservation,
} from '../src/ai-suites.js';
import { loadRegistered, type MetricRow, type Mode } from '../src/ai-thresholds.js';

// The research planner: the product's own buildResearchPlan, with rules and with a scripted model,
// over 20 labelled questions, 6 seeded instructions and 19 classes of corrupted reply. Each planner
// metric registered for a mode is one test; one that breaches is listed in known-breaches.json or
// fails. The suggested site that a run never fetches is measured in the research-run suite.

const registered = loadRegistered();
const ledger = loadLedger();
const plannerIds = registered.suites
  .flatMap((suite) => suite.ids)
  .filter((id) => id.startsWith('plan') && id !== 'planSuggestionFetched');
let observed: SuiteObservation;
let measures: SuiteMeasures;
const rows: Record<'rules' | 'fake-foundry', MetricRow[]> = { rules: [], 'fake-foundry': [] };

beforeAll(async () => {
  // The clean arm runs for every question; the corruptions for one question of each split, to keep it quick.
  observed = await observeSuites({
    research: false,
    decision: false,
    corruptCases: ['L07', 'L08'],
  });
  measures = measureSuites(observed, 'all');
  for (const mode of ['rules', 'fake-foundry'] as const)
    rows[mode] = suiteRows(measures, mode, registered);
}, 120_000);

describe.each(['rules', 'fake-foundry'] as const)('the planner in %s mode', (mode: Mode) => {
  it.each(plannerIds)('%s', (id) => {
    const row = rows[mode as 'rules' | 'fake-foundry'].find((item) => item.id === id);
    expect(row, `${id} has no row`).toBeDefined();
    if (!row) return;
    expect(row.status, describeRow(row, ledger)).toBe(
      expectedStatus(row, registered, ledger, isStrict()),
    );
    if (registered.specs[id]?.appliesIn.includes(mode))
      expect(row.cases, `${id} rests on no case`).toBeGreaterThan(0);
  });
});

describe('what the planner does with a corrupted reply', () => {
  it('plans every labelled question and every seeded instruction, with no address and a valid plan', () => {
    const rules = measures.plans.rules!;
    expect(rules.valid.total).toBe(26);
    expect(rules.invalid).toEqual([]);
    expect(rules.addresses.count).toBe(0);
  });

  it('accepts a clean reply for every question, and never meets a fault the fake did not mean', () => {
    const fake = measures.plans.fake!;
    expect(fake.cleanAccepted.rate).toBe(1);
    expect(observed.plans.fake?.problems).toEqual([]);
  });

  it('answers a provider failure from rules and surfaces a refusal as a refusal', () => {
    const fake = measures.plans.fake!;
    expect(fake.providerFallbackValid).toBe(true);
    expect(fake.refusalSurfaced).toBe(true);
  });

  const MUST_BE_CAUGHT = [
    'address-in-claim-www',
    'address-in-description',
    'category-user-supplied',
    'claim-ids-out-of-order',
    'control-character',
    'domain-ip-address',
    'domain-localhost',
    'domain-repeated',
    'domain-single-label',
    'domain-upper-case',
    'domain-with-path',
    'domain-with-scheme',
    'forecast-wording',
    'missing-time-sensitivity',
    'percentage-wording',
    'too-many-topics',
  ];

  it.each(MUST_BE_CAUGHT)(
    'does not let %s through, whether the second reply is clean or not',
    (kind) => {
      const found = measures.plans.fake!.catches.find((item) => item.class === kind);
      expect(found, kind).toBeDefined();
      expect(found?.transient.rate, `${kind} corrected once`).toBe(1);
      expect(found?.persistent.rate, `${kind} kept failing`).toBe(1);
    },
  );

  it('knows a reply that obeys an instruction in a wording the guard does not know gets through', () => {
    // Recorded in known-breaches.json and in the report's defects: the heuristic's own stated limit.
    // If the guard now catches every one, take planBadAccepted out of the ledger and this test.
    const found = measures.plans.fake!.catches.find((item) => item.class === 'obeys-injection');
    expect(found?.persistent.rate).toBeLessThan(1);
    expect(measures.plans.fake!.badAccepted.count).toBeGreaterThan(0);
  });
});
