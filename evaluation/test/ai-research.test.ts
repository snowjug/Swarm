import { beforeAll, describe, expect, it } from 'vitest';
import { describeRow, expectedStatus, isStrict, loadLedger } from '../src/ai-expectations.js';
import {
  measureSuites,
  observeSuites,
  suiteRows,
  type SuiteMeasures,
  type SuiteObservation,
} from '../src/ai-suites.js';
import { loadRunsFile } from '../src/ai-suite-data.js';
import { loadRegistered, type MetricRow } from '../src/ai-thresholds.js';

// Whole research runs: the real ResearchService, crawler, extraction, assessor and selection, over the
// fixture web served from loopback, on a clock that skips waiting. Each run metric registered for a
// mode is one test; one that breaches is listed in known-breaches.json or fails.

const registered = loadRegistered();
const ledger = loadLedger();
const runIds = registered.suites
  .flatMap((suite) => suite.ids)
  .filter((id) => id.startsWith('run') || id === 'planSuggestionFetched');
let observed: SuiteObservation;
let measures: SuiteMeasures;
const rows: Record<'rules' | 'fake-foundry', MetricRow[]> = { rules: [], 'fake-foundry': [] };

beforeAll(async () => {
  observed = await observeSuites({ planner: false, decision: false });
  measures = measureSuites(observed, 'all');
  for (const mode of ['rules', 'fake-foundry'] as const)
    rows[mode] = suiteRows(measures, mode, registered);
}, 180_000);

describe.each(['rules', 'fake-foundry'] as const)('whole research runs in %s mode', (mode) => {
  it.each(runIds)('%s', (id) => {
    const row = rows[mode].find((item) => item.id === id);
    expect(row, `${id} has no row`).toBeDefined();
    if (!row) return;
    expect(row.status, describeRow(row, ledger)).toBe(
      expectedStatus(row, registered, ledger, isStrict()),
    );
    if (registered.specs[id]?.appliesIn.includes(mode))
      expect(row.cases, `${id} rests on no case`).toBeGreaterThan(0);
  });
});

describe('what the runs were', () => {
  it('ran every case of the dataset, none of which could not be carried out', () => {
    const file = loadRunsFile();
    const ran = new Set(observed.research!.runs.map((run) => run.caseId));
    for (const item of file.cases) expect(ran.has(item.id), item.id).toBe(true);
    expect(observed.research!.runs.filter((run) => run.error !== null)).toEqual([]);
  });

  it('never met a fault the fake did not mean: nothing it was scripted or sent broke its own rules', () => {
    expect(observed.research!.fakeProblems).toEqual([]);
  });

  it('holds every statement the gold makes about a run that no registered metric already judges', () => {
    // A stop, a count, a bound, a host never asked for: the registered metrics are a part of these.
    for (const mode of ['rules', 'fake'] as const) {
      const m = measures.runs[mode]!;
      expect(m.checks.failed, `${mode}`).toEqual([]);
    }
  });

  it('is quick: the whole suite is a few seconds of real time on a clock that skips waiting', () => {
    expect(observed.elapsedMs.research).toBeLessThan(60_000);
  });
});
