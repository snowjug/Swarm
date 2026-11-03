import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentsOf, loadScenarios } from '../src/ai-datasets.js';
import { prepare, prepareFrom } from '../src/ai-corpus.js';
import { startFakeWorld, type FakeWorld, type Harness } from '../src/ai-fake.js';
import { decideLive, NOT_MEASURED_LIVE, observeLive } from '../src/ai-live.js';
import { liveRows } from '../src/ai-report.js';
import { argumentsOf, buildReport, exitCodeOf, renderMarkdown } from '../src/ai-run.js';
import { cleanConstraints, cleanParticipants } from '../src/ai-scripts.js';
import { loadRegistered } from '../src/ai-thresholds.js';
import type { FakeStep, RecordedRequest } from '../../backend/test/support/fake-foundry.js';

// The live mode is written and refuses to run here: Azure is not reachable from this machine. What
// is tested is the refusal, the empty column, and, against the in-process fake, that the code that
// would run live is wired up. Nothing here is a live result, and none is ever reported as one.

const registered = loadRegistered();
const scenarios = loadScenarios();
let world: FakeWorld;

beforeAll(async () => {
  world = await startFakeWorld();
});
afterAll(async () => world.close());

describe('the decision to run live', () => {
  it('refuses without --live, and says what it always says', () => {
    const decision = decideLive({ live: false, environment: {} });
    expect(decision.run).toBe(false);
    if (!decision.run) {
      expect(decision.message).toBe('NOT MEASURED: no Azure authorization on this machine');
      expect(decision.message).toBe(NOT_MEASURED_LIVE);
      expect(decision.reasons.join(' ')).toMatch(/--live was not given/u);
    }
  });

  it('refuses with --live and no Foundry configuration', () => {
    const decision = decideLive({ live: true, environment: {} });
    expect(decision.run).toBe(false);
    if (!decision.run) expect(decision.reasons.join(' ')).toMatch(/AI_PROVIDER is not foundry/u);
    const half = decideLive({ live: true, environment: { AI_PROVIDER: 'foundry' } });
    expect(half.run).toBe(false);
    if (!half.run) expect(half.reasons.join(' ')).toMatch(/not configured/u);
  });

  it('refuses an endpoint on this machine, which is a fake and not a deployment', () => {
    const decision = decideLive({ live: true, environment: world.fake.environment() });
    expect(decision.run).toBe(false);
    if (!decision.run) expect(decision.reasons.join(' ')).toMatch(/on this machine/u);
  });

  it('runs only when asked and configured, which the test of this code alone may fake', () => {
    const decision = decideLive({
      live: true,
      environment: world.fake.environment(),
      allowLoopbackForTests: true,
    });
    expect(decision.run).toBe(true);
    const unasked = decideLive({
      live: false,
      environment: world.fake.environment(),
      allowLoopbackForTests: true,
    });
    expect(unasked.run).toBe(false);
  });
});

describe('the live column', () => {
  it('is empty, every row NOT MEASURED with the reason, when it did not run', () => {
    const decision = decideLive({ live: false, environment: {} });
    const rows = liveRows(decision, registered, null, null);
    expect(rows.length).toBe(Object.keys(registered.specs).length);
    for (const row of rows) {
      expect(row.status).toBe('not-measured');
      expect(row.value).toBe('NOT MEASURED');
      expect(row.note).toContain(NOT_MEASURED_LIVE);
      expect(row.measured).toBeNull();
    }
  });

  it('is empty in the report, and the report says it', async () => {
    const report = await buildReport({ modes: ['live'], environment: {} });
    expect(report.live).toMatchObject({ ran: false, message: NOT_MEASURED_LIVE });
    const live = report.rows.filter((row) => row.mode === 'live');
    expect(live.length).toBeGreaterThan(10);
    expect(live.every((row) => row.status === 'not-measured')).toBe(true);
    expect(report.breached.filter((item) => item.mode === 'live')).toEqual([]);
  });
});

describe('the command', () => {
  it('exits 3 when a live measurement was asked for and refused, so nothing measured is not a pass', async () => {
    const report = await buildReport({ modes: ['live'], live: true, environment: {} });
    expect(argumentsOf(['--live']).liveAsked).toBe(true);
    expect(argumentsOf(['--mode', 'live']).liveAsked).toBe(true);
    expect(argumentsOf(['--mode', 'rules,fake-foundry']).liveAsked).toBe(false);
    expect(argumentsOf([]).liveAsked).toBe(false);
    expect(exitCodeOf(report, true)).toBe(3);
    expect(exitCodeOf(report, false)).toBe(0);
    const breached = { mode: 'rules' as const, id: 'x', value: '1', threshold: '0' };
    expect(exitCodeOf({ ...report, breached: [breached] }, true)).toBe(1);
  });

  it('says a mode was not run, rather than printing an empty table for it', async () => {
    const report = await buildReport({ modes: ['live'], live: true, environment: {} });
    const text = renderMarkdown(report, registered);
    expect(text.match(/Not run in this invocation/gu)).toHaveLength(2);
    expect(text).toContain(NOT_MEASURED_LIVE);
  });
});

describe('the code that would run live', () => {
  it("reads a model through the product's own client, counts what it spends, and stops at its budget", async () => {
    const base = scenarios.find((item) => item.id === 'S07')!;
    const answer = (request: RecordedRequest): FakeStep | undefined => {
      const data = request.data as Record<string, unknown> | null;
      if (!data) return undefined;
      if ('analysisId' in data) return { kind: 'reply', value: { critiques: [] } };
      const scenario = scenarios.find((item) => item.question === data.question) ?? base;
      const prepared =
        scenario === base && data.question !== base.question
          ? prepareFrom(String(data.question), documentsOf(base), 'full')
          : prepare(scenario, 'full');
      return {
        kind: 'reply',
        value:
          'roles' in data
            ? cleanParticipants(scenario, prepared)
            : cleanConstraints(scenario, prepared),
      };
    };
    world.fake.reset();
    world.fake.respond(answer);
    const harness: Harness = {
      factory: world.factory,
      problems: [],
      tokenBudget: 5_000_000,
      spent: 0,
    };
    const observed = await observeLive({ harness, modelName: 'fake', scenarios: [base], flaws: 2 });
    expect(observed.runs.filter((run) => run.scenario === 'S07').map((run) => run.result)).toEqual([
      'model',
      'model',
    ]);
    expect(observed.flaws).toHaveLength(2);
    expect(observed.safety).toHaveLength(4);
    expect(observed.tokens).toBeGreaterThan(10_000);
    expect(world.fake.requests.length).toBeGreaterThan(10);

    const spent = observed.tokens;
    const frugal: Harness = {
      factory: world.factory,
      problems: [],
      tokenBudget: spent / 4,
      spent: 0,
    };
    const stopped = await observeLive({
      harness: frugal,
      modelName: 'fake',
      scenarios: [base],
      flaws: 2,
    });
    expect(stopped.tokens).toBeLessThan(spent);
    expect(stopped.runs.some((run) => run.result !== 'model' || run.code !== null)).toBe(true);
  });
});
