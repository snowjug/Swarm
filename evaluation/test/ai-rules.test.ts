import { beforeAll, describe, expect, it } from 'vitest';
import { describeRow, expectedStatus, isStrict, loadLedger } from '../src/ai-expectations.js';
import { buildReport, PENDING_SUITES, type AiReport } from '../src/ai-run.js';
import { loadRegistered } from '../src/ai-thresholds.js';

// The rules mode: the product's rules paths, offline, over the labelled sets. Each registered metric
// is one test. A metric registered for this mode that breaches its threshold fails, unless
// known-breaches.json lists it (EVAL_STRICT=1 excuses nothing); a metric that is not registered for
// this mode must come out NOT MEASURED, and is never a pass.

const registered = loadRegistered();
const ledger = loadLedger();
let report: AiReport;

beforeAll(async () => {
  report = await buildReport({ modes: ['rules'] });
}, 120_000);

describe('rules mode against the registered thresholds', () => {
  it.each(Object.keys(registered.specs))('%s', (id) => {
    const row = report.rows.find((item) => item.mode === 'rules' && item.id === id);
    expect(row, `${id} has no row`).toBeDefined();
    if (!row) return;
    expect(row.status, describeRow(row, ledger)).toBe(
      expectedStatus(row, registered, ledger, isStrict()),
    );
  });

  it('measures every metric registered for the mode on at least one case', () => {
    for (const row of report.rows.filter((item) => item.mode === 'rules')) {
      if (!registered.specs[row.id]?.appliesIn.includes('rules')) continue;
      expect(row.cases, `${row.id} rests on no case`).toBeGreaterThan(0);
    }
  });

  it('reports a split of dev and test beside the pooled number', () => {
    const row = report.rows.find((item) => item.mode === 'rules' && item.id === 'actorCoverage');
    expect(row?.dev).toMatch(/\d/u);
    expect(row?.test).toMatch(/\d/u);
  });

  it('lists what other workstreams are still building as not measured', () => {
    expect(report.pending.map((item) => item.id)).toEqual(PENDING_SUITES.map((item) => item.id));
    for (const item of report.pending) expect(item.status).toBe('NOT MEASURED (pending)');
  });

  it('reports the long-page injection defect exactly when the metric breaches, and says how to see it', () => {
    const row = report.rows.find(
      (item) => item.mode === 'rules' && item.id === 'injectionLinesUnlabelled',
    );
    const found = report.findings.find(
      (item) => item.id === 'structured-tail-injection-unlabelled',
    );
    expect(Boolean(found)).toBe(row?.status === 'breached');
    if (found) {
      expect(found.severity).toBe('defect');
      expect(found.reproduce).toMatch(/JSON-LD/u);
    }
  });
});
