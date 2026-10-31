import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { analysisSchema, type Analysis, type Variant } from '../../shared/analysis.js';
import type { AnalysisList } from '../../shared/analysis-plan.js';
import {
  FIXTURE_VARIANTS,
  actorSetFixture,
  analysisFixture,
  scenarioFixture,
} from '../../shared/lab-fixtures.js';
import { NO_DIRECTION_NOTICE } from '../../shared/signal.js';
import { buildApp } from '../src/app.js';
import { AnalysisService, type AnalysisServiceOptions } from '../src/analysis/service.js';
import { ROUTE_POLICY } from '../src/auth/policy.js';
import { SimulationInputError } from '../src/simulation/simulate.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import { Repository } from '../src/storage/repository.js';
import { fixtureInput, testConfig } from './fixtures.js';
import {
  TENANT_A,
  TENANT_B,
  authorization,
  entraEnvironment,
  idp,
  type Minted,
} from './support/entra-idp.js';
import { stubSimulator } from './support/stub-simulator.js';

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
const repositories: Repository[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
  for (const repository of repositories.splice(0)) repository.close();
});

/** Saves progress after every run, so that a test can see each step. */
const EVERY_RUN = { runs: 1, ms: 0 };

interface Gate {
  /** Waits until `open` is called, once `after` runs have finished. */
  yieldNow: () => Promise<void>;
  open: () => void;
  reached: () => boolean;
}

/** Holds a comparison still after a number of runs, so that a test can look at it and act while it runs. */
function gateAfter(after: number): Gate {
  let runs = 0;
  let release: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  return {
    yieldNow: async () => {
      runs += 1;
      if (runs === after) {
        held = true;
        await opened;
      }
    },
    open: () => release(),
    reached: () => held,
  };
}

async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('The condition was not reached in time.');
}

async function world(analysis: AnalysisServiceOptions = {}, rateScale = '50') {
  const instance = await buildApp({
    config: testConfig({ LOG_LEVEL: 'silent', RATE_LIMIT_SCALE: rateScale }),
    analysis: { simulator: stubSimulator, progressEvery: EVERY_RUN, ...analysis },
  });
  applications.push(instance);
  const project = instance.repository.create(fixtureInput({ workflow: 'guided' }));
  const url = `/api/projects/${project.id}/analysis`;
  const withActors = () => {
    instance.repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
    instance.repository.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
  };
  const start = (payload: unknown = {}) =>
    instance.app.inject({ method: 'POST', url, payload: payload as object });
  const read = async (id: string) =>
    (await instance.app.inject({ method: 'GET', url: `${url}/${id}` })).json().analysis as Analysis;
  const list = async () =>
    (await instance.app.inject({ method: 'GET', url })).json() as AnalysisList;
  const cancel = (id: string) =>
    instance.app.inject({ method: 'POST', url: `${url}/${id}/cancel` });
  const finished = (id: string) =>
    until(
      () => read(id),
      (value) => !['running', 'queued'].includes(value.status),
    );
  return { ...instance, project, url, withActors, start, read, list, cancel, finished };
}

describe('starting a comparison', () => {
  it('needs actors, and says so in plain words, and saves nothing', async () => {
    const { start, list } = await world();
    const response = await start({});
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ACTORS_REQUIRED');
    expect(response.json().error.message).toContain(
      'Approve the stakeholders and create the actors',
    );
    expect((await list()).analyses).toEqual([]);
  });

  it('starts it, answers 202 with the comparison as running, and finishes it in the background', async () => {
    const { start, withActors, finished, read, list } = await world();
    withActors();
    const response = await start({ runsPerVariant: 8, sensitivity: false });
    expect(response.statusCode, response.body).toBe(202);
    const started = response.json().analysis as Analysis;
    expect(started.status).toBe('running');
    expect(started.progress.totalRuns).toBe(24);
    expect(started.config.variants.map((variant) => variant.id)).toEqual([
      'baseline',
      'proposed-change',
      'smaller-rise',
    ]);
    expect(started.actors).toHaveLength(5);

    const done = await finished(started.id);
    expect(done.status).toBe('completed');
    expect(() => analysisSchema.parse(done)).not.toThrow();
    expect(done.progress).toEqual({ completedRuns: 24, totalRuns: 24 });
    expect(done.variants).toHaveLength(3);
    expect(done.findings.length).toBeGreaterThan(0);
    expect(done.representativeRun).not.toBeNull();
    expect(done.fidelity).toMatchObject({ engine: 'rules', keyActors: 'rules', repeatedRuns: 8 });
    expect(done.cost).toMatchObject({ modelCalls: 0, inputTokens: 0, outputTokens: 0 });
    expect(done.cost.simulatedRuns).toBe(25);
    expect(done.completedAt).not.toBeNull();
    expect(await read(started.id)).toEqual(done);

    const listed = await list();
    expect(listed.analyses).toHaveLength(1);
    expect(listed.analyses[0]).toMatchObject({
      id: started.id,
      status: 'completed',
      runsPerVariant: 8,
      findings: done.findings.length,
    });
    expect(listed.analyses[0]!.variants.map((variant) => variant.label)).toEqual([
      'No change',
      'Proposed change',
      'Smaller rise',
    ]);
  });

  it('shows progress while it runs, and uses the project’s seed for its first run', async () => {
    const gate = gateAfter(4);
    const { start, withActors, read, finished, project, repository } = await world({
      yieldNow: gate.yieldNow,
    });
    withActors();
    const seed = repository.get(project.id).settings.seed;
    const started = (await start({ runsPerVariant: 6, sensitivity: false })).json()
      .analysis as Analysis;
    const midway = await until(
      () => read(started.id),
      (value) => value.progress.completedRuns >= 4,
    );
    expect(gate.reached()).toBe(true);
    expect(midway.status).toBe('running');
    expect(midway.progress).toEqual({ completedRuns: 4, totalRuns: 18 });
    expect(midway.variants).toEqual([]);
    gate.open();
    const done = await finished(started.id);
    expect(done.config.baseSeed).toBe(seed);
    expect(done.variants[0]!.runs[0]!.seed).toBe(seed);
  });

  it('can be given its own scenarios, seed and length, and runs sensitivity only when asked to', async () => {
    const { start, withActors, finished } = await world();
    withActors();
    const variants: Variant[] = [
      FIXTURE_VARIANTS[0]!,
      { ...FIXTURE_VARIANTS[1]!, label: 'My change', intensity: 0.5 },
    ];
    const response = await start({ variants, baseSeed: 9_000, runsPerVariant: 5, rounds: 6 });
    expect(response.statusCode, response.body).toBe(202);
    const done = await finished((response.json().analysis as Analysis).id);
    expect(done.config).toMatchObject({
      baseSeed: 9_000,
      runsPerVariant: 5,
      rounds: 6,
      sensitivity: true,
    });
    expect(done.config.variants[1]!.label).toBe('My change');
    expect(done.variants[0]!.runs.map((run) => run.seed)).toEqual([
      9_000, 9_001, 9_002, 9_003, 9_004,
    ]);
    expect(done.sensitivity.length).toBeGreaterThan(0);
    expect(done.sensitivity.length).toBeLessThanOrEqual(12);
  });

  it('refuses a bad request in plain words and starts nothing', async () => {
    const { start, withActors, list } = await world();
    withActors();
    const bad: [unknown, number, string][] = [
      [{ runsPerVariant: 2 }, 400, 'INVALID_INPUT'],
      [{ runsPerVariant: 201 }, 400, 'INVALID_INPUT'],
      [{ runsPerVariant: 30.5 }, 400, 'INVALID_INPUT'],
      [{ extra: true }, 400, 'INVALID_INPUT'],
      [{ variants: [FIXTURE_VARIANTS[0]] }, 400, 'INVALID_INPUT'],
      [{ variants: 'many' }, 400, 'INVALID_INPUT'],
      [{ sensitivity: 'yes' }, 400, 'INVALID_INPUT'],
      [{ variants: [FIXTURE_VARIANTS[1], FIXTURE_VARIANTS[1]] }, 400, 'ANALYSIS_INPUT_INVALID'],
      [
        { variants: [FIXTURE_VARIANTS[0], { ...FIXTURE_VARIANTS[1], round: 20 }] },
        400,
        'ANALYSIS_INPUT_INVALID',
      ],
      [
        {
          variants: [
            FIXTURE_VARIANTS[0],
            { ...FIXTURE_VARIANTS[1], impactOverrides: { nobody: 0.2 } },
          ],
        },
        400,
        'ANALYSIS_INPUT_INVALID',
      ],
      [{ baseSeed: 2_147_483_647, runsPerVariant: 5 }, 400, 'ANALYSIS_INPUT_INVALID'],
    ];
    for (const [payload, status, code] of bad) {
      const response = await start(payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(status);
      expect(response.json().error.code, JSON.stringify(payload)).toBe(code);
    }
    expect((await list()).analyses).toEqual([]);
  });

  it('limits how often a comparison may be started, because each one costs the server real work', async () => {
    const { start, withActors } = await world({}, '1');
    withActors();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect((await start({ invalid: true })).statusCode).toBe(400);
    }
    const limited = await start({ invalid: true });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
  });

  it('refuses a comparison that needs more runs than the cap allows, and says how to shrink it', async () => {
    const { start, withActors } = await world();
    withActors();
    const many: Variant[] = [
      FIXTURE_VARIANTS[0]!,
      ...Array.from({ length: 7 }, (_, index) => ({
        ...FIXTURE_VARIANTS[1]!,
        id: `alternative-${index}`,
        label: `Alternative ${index}`,
      })),
    ];
    const response = await start({ variants: many, runsPerVariant: 200 });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('turn sensitivity off');
  });

  it('allows one comparison at a time for a project, and a bounded number for the server', async () => {
    const gate = gateAfter(2);
    const { start, withActors, app, repository, cancel, finished } = await world({
      yieldNow: gate.yieldNow,
      maxConcurrent: 1,
    });
    withActors();
    const first = (await start({ runsPerVariant: 5, sensitivity: false })).json()
      .analysis as Analysis;
    await until(
      () => gate.reached(),
      (reached) => reached,
    );
    const again = await start({ runsPerVariant: 5 });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ANALYSIS_RUNNING');
    const other = repository.create(fixtureInput({ workflow: 'guided' }));
    repository.artifacts.put(other.id, 'actors', 'default', actorSetFixture());
    const busy = await app.inject({
      method: 'POST',
      url: `/api/projects/${other.id}/analysis`,
      payload: { runsPerVariant: 5 },
    });
    expect(busy.statusCode).toBe(429);
    expect(busy.json().error.code).toBe('ANALYSIS_BUSY');
    await cancel(first.id);
    gate.open();
    await finished(first.id);
  });

  it('runs on the population simulator when no other engine is supplied', async () => {
    const instance = await buildApp({ config: testConfig({ LOG_LEVEL: 'silent' }) });
    applications.push(instance);
    const project = instance.repository.create(fixtureInput({ workflow: 'guided' }));
    instance.repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
    instance.repository.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
    const url = `/api/projects/${project.id}/analysis`;
    const started = (
      await instance.app.inject({
        method: 'POST',
        url,
        payload: { runsPerVariant: 3, sensitivity: false },
      })
    ).json().analysis as Analysis;
    const done = await until(
      async () => (await instance.app.inject(`${url}/${started.id}`)).json().analysis as Analysis,
      (value) => !['running', 'queued'].includes(value.status),
    );
    expect(done.status, JSON.stringify(done.error)).toBe('completed');
    expect(done.variants.length).toBeGreaterThanOrEqual(2);
    expect(done.completedAt).not.toBeNull();
  });

  it('says that the engine did not accept the actors or a scenario, without quoting the engine', async () => {
    const { start, withActors, finished } = await world({
      simulator: () => {
        // A real validation failure, as the engine's own check of the specification would raise it.
        return z.object({ traits: z.number() }).parse({ traits: 'zq-canary-4417' }) as never;
      },
    });
    withActors();
    const started = (await start({})).json().analysis as Analysis;
    const failed = await finished(started.id);
    expect(failed.status).toBe('failed');
    expect(failed.error!.code).toBe('SPEC_NOT_ACCEPTED');
    expect(failed.error!.message).toContain('did not accept the actors or one of the scenarios');
    expect(JSON.stringify(failed)).not.toContain('zq-canary-4417');
    expect(JSON.stringify(failed.error)).not.toContain('traits');
  });

  it('says the same of a specification the engine can read but cannot honour', async () => {
    const { start, withActors, finished } = await world({
      simulator: () => {
        throw new SimulationInputError('zq-canary-9921 is not in the cast.');
      },
    });
    withActors();
    const started = (await start({})).json().analysis as Analysis;
    const failed = await finished(started.id);
    expect(failed.status).toBe('failed');
    expect(failed.error!.code).toBe('SPEC_NOT_ACCEPTED');
    expect(JSON.stringify(failed)).not.toContain('zq-canary-9921');
  });

  it('shows an unexpected failure without what the engine said, and logs only a code', async () => {
    const lines: string[] = [];
    const instance = await buildApp({
      config: testConfig({ LOG_LEVEL: 'error' }),
      logStream: { write: (line) => void lines.push(line) },
      analysis: {
        simulator: () => {
          throw new Error('secret detail zq-canary-9931 from deep inside');
        },
      },
    });
    applications.push(instance);
    const project = instance.repository.create(fixtureInput({ workflow: 'guided' }));
    instance.repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
    const url = `/api/projects/${project.id}/analysis`;
    const started = (await instance.app.inject({ method: 'POST', url, payload: {} })).json()
      .analysis as Analysis;
    const failed = await until(
      async () => (await instance.app.inject(`${url}/${started.id}`)).json().analysis as Analysis,
      (value) => value.status === 'failed',
    );
    expect(failed.error!.code).toBe('ANALYSIS_FAILED');
    expect(JSON.stringify(failed)).not.toContain('zq-canary-9931');
    expect(failed.error!.message).toContain('Run it again');
    const logged = lines.join('');
    expect(logged).toContain('ANALYSIS_FAILED');
    expect(logged).not.toContain('zq-canary-9931');
  });
});

describe('reading comparisons', () => {
  it('answers 200 with nothing, and what the next one would use, for a project that never ran one', async () => {
    const { list, withActors } = await world();
    const none = await list();
    expect(none.analyses).toEqual([]);
    expect(none.readiness).toMatchObject({
      actors: null,
      suggestedVariants: [],
      perturbations: 0,
      may: { run: true },
    });
    withActors();
    const ready = await list();
    expect(ready.readiness.actors).toEqual({ count: 5, members: 43 });
    expect(ready.readiness.suggestedVariants.map((variant) => variant.id)).toEqual([
      'baseline',
      'proposed-change',
      'smaller-rise',
    ]);
    expect(ready.readiness.suggestedVariants.map((variant) => variant.intensity)).toEqual([
      0, 0.7, 0.5,
    ]);
    for (const variant of ready.readiness.suggestedVariants.slice(1)) {
      expect(variant.description).toContain('system assumption');
    }
    expect(ready.readiness.perturbations).toBeGreaterThan(10);
  });

  it('finds without a scenario a baseline and the proposed change only', async () => {
    const { list, repository, project } = await world();
    repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
    const { readiness } = await list();
    expect(readiness.suggestedVariants.map((variant) => variant.id)).toEqual([
      'baseline',
      'proposed-change',
    ]);
  });

  it('has no warning before the actors exist, or while someone is helped or harmed by the change', async () => {
    const { list, withActors } = await world();
    expect((await list()).readiness.warnings).toEqual([]);
    withActors();
    expect((await list()).readiness.warnings).toEqual([]);
  });

  it('warns, and does not refuse, when no stakeholder has an expected direction of impact', async () => {
    const { list, start, finished, repository, project, withActors } = await world();
    repository.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
    const cast = actorSetFixture();
    repository.artifacts.put(project.id, 'actors', 'default', {
      ...cast,
      actors: cast.actors.map((actor) => ({
        ...actor,
        traits: { ...actor.traits, impact: { ...actor.traits.impact, value: 0 } },
      })),
    });
    const { readiness } = await list();
    expect(readiness.warnings).toEqual([NO_DIRECTION_NOTICE]);
    expect(readiness.may.run).toBe(true);
    expect(readiness.suggestedVariants.length).toBeGreaterThan(1);

    // A comparison where nothing can move is a fair test of chance, so it still runs.
    const response = await start({ runsPerVariant: 3, sensitivity: false });
    expect(response.statusCode, response.body).toBe(202);
    const done = await finished((response.json().analysis as Analysis).id);
    expect(done.status).toBe('completed');

    // The warning goes away once the cast has a direction again.
    withActors();
    expect((await list()).readiness.warnings).toEqual([]);
  });

  it('is not found for a comparison that does not exist, or belongs to another project', async () => {
    const { read, app, repository, withActors, start, finished, project } = await world();
    withActors();
    const missing = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/analysis/nothing-here`,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('ANALYSIS_NOT_FOUND');
    const mine = (await start({ runsPerVariant: 3, sensitivity: false })).json()
      .analysis as Analysis;
    await finished(mine.id);
    const other = repository.create(fixtureInput({ workflow: 'guided' }));
    const crossed = await app.inject({
      method: 'GET',
      url: `/api/projects/${other.id}/analysis/${mine.id}`,
    });
    expect(crossed.statusCode).toBe(404);
    expect((await read(mine.id)).id).toBe(mine.id);
    const nothing = await app.inject({
      method: 'GET',
      url: '/api/projects/00000000-0000-4000-8000-000000000000/analysis',
    });
    expect(nothing.statusCode).toBe(404);
    expect(nothing.json().error.code).toBe('PROJECT_NOT_FOUND');
  });
});

describe('stopping a comparison', () => {
  it('stops at the next run, keeps the runs done, and marks it cancelled with no findings', async () => {
    const gate = gateAfter(3);
    const { start, withActors, cancel, read, finished, repository, project } = await world({
      yieldNow: gate.yieldNow,
    });
    withActors();
    const started = (await start({ runsPerVariant: 10, sensitivity: false })).json()
      .analysis as Analysis;
    await until(
      () => gate.reached(),
      (reached) => reached,
    );
    const response = await cancel(started.id);
    expect(response.statusCode).toBe(202);
    expect(response.json().analysis.status).toBe('running');
    gate.open();
    const stopped = await finished(started.id);
    expect(stopped.status).toBe('cancelled');
    expect(stopped.progress.completedRuns).toBe(3);
    expect(stopped.progress.totalRuns).toBe(30);
    expect(stopped.findings).toEqual([]);
    expect(stopped.variants).toEqual([]);
    expect(stopped.error).toBeNull();
    expect((await read(started.id)).status).toBe('cancelled');
    const entry = repository.audit
      .list({ projectId: project.id, limit: 200 })
      .find((item) => item.action === 'analysis.cancelled');
    expect(entry).toMatchObject({
      targetType: 'project',
      detail: { analysis: started.id, completedRuns: 3 },
    });
  });

  it('can be run again after it is stopped', async () => {
    const gate = gateAfter(2);
    const { start, withActors, cancel, finished } = await world({ yieldNow: gate.yieldNow });
    withActors();
    const first = (await start({ runsPerVariant: 5, sensitivity: false })).json()
      .analysis as Analysis;
    await until(
      () => gate.reached(),
      (reached) => reached,
    );
    await cancel(first.id);
    gate.open();
    expect((await finished(first.id)).status).toBe('cancelled');
    const second = await start({ runsPerVariant: 5, sensitivity: false });
    expect(second.statusCode).toBe(202);
    expect((await finished((second.json().analysis as Analysis).id)).status).toBe('completed');
  });

  it('says plainly when there is nothing running to stop', async () => {
    const { start, withActors, cancel, finished, app, project } = await world();
    withActors();
    const done = (await start({ runsPerVariant: 3, sensitivity: false })).json()
      .analysis as Analysis;
    await finished(done.id);
    const late = await cancel(done.id);
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('ANALYSIS_NOT_RUNNING');
    expect(late.json().error.message).toContain('already finished');
    const unknown = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/analysis/not-there/cancel`,
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('is marked interrupted when the server stops it, and can be run again', async () => {
    const repository = new Repository(':memory:');
    repositories.push(repository);
    const project = repository.create(fixtureInput({ workflow: 'guided' }));
    repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
    const gate = gateAfter(2);
    const service = new AnalysisService(repository, {
      simulator: stubSimulator,
      yieldNow: gate.yieldNow,
      progressEvery: EVERY_RUN,
    });
    const started = service.start(project.id, { runsPerVariant: 5, sensitivity: false }, 'someone');
    await until(
      () => gate.reached(),
      (reached) => reached,
    );
    const stopping = service.stop();
    gate.open();
    await stopping;
    const stored = service.get(project.id, started.id);
    expect(stored.status).toBe('interrupted');
    expect(stored.error?.code).toBe('INTERRUPTED');
    expect(stored.error?.message).toContain('reproduced exactly from its seeds');
    expect(stored.completedAt).toBeNull();
    expect(stored.progress.completedRuns).toBe(2);
  });
});

describe('after a restart', () => {
  it('marks a comparison that the stopped server left running as interrupted, in every project', async () => {
    const repository = new Repository(':memory:');
    const first = repository.create(fixtureInput({ workflow: 'guided' }));
    const second = repository.create(fixtureInput({ workflow: 'guided' }));
    const leave = (projectId: string, id: string, status: Analysis['status']) =>
      repository.artifacts.put(
        projectId,
        'analysis',
        id,
        analysisFixture({
          id,
          status,
          completedAt: status === 'completed' ? '2026-01-15T10:00:00.000Z' : null,
        }),
      );
    leave(first.id, 'left-running', 'running');
    leave(first.id, 'left-queued', 'queued');
    leave(first.id, 'was-finished', 'completed');
    leave(second.id, 'also-running', 'running');
    leave(second.id, 'was-cancelled', 'cancelled');

    const instance = await buildApp({
      config: testConfig({ LOG_LEVEL: 'silent' }),
      repository,
    });
    applications.push(instance);
    const status = (projectId: string, id: string) =>
      repository.artifacts.get(projectId, 'analysis', id)?.data;
    for (const [projectId, id] of [
      [first.id, 'left-running'],
      [first.id, 'left-queued'],
      [second.id, 'also-running'],
    ] as const) {
      const stored = status(projectId, id)!;
      expect(stored.status, id).toBe('interrupted');
      expect(stored.error).toMatchObject({ code: 'INTERRUPTED' });
      expect(stored.error?.message).toContain('run it again with the same settings');
      expect(stored.error?.message).toContain('reproduced exactly from its seeds');
      // What it had done is kept, and it is still a valid document.
      expect(() => analysisSchema.parse(stored)).not.toThrow();
      expect(stored.findings.length).toBeGreaterThan(0);
    }
    expect(status(first.id, 'was-finished')?.status).toBe('completed');
    expect(status(second.id, 'was-cancelled')?.status).toBe('cancelled');
  });

  it('leaves alone a document it cannot read, and still starts', async () => {
    const repository = new Repository(':memory:');
    const project = repository.create(fixtureInput({ workflow: 'guided' }));
    repository.artifacts.put(
      project.id,
      'analysis',
      'good',
      analysisFixture({ id: 'good', status: 'running', completedAt: null }),
    );
    const raw = (
      repository as unknown as {
        database: { prepare: (sql: string) => { run: (...values: unknown[]) => unknown } };
      }
    ).database;
    raw
      .prepare(
        `INSERT INTO project_artifacts (project_id, kind, artifact_key, revision, payload, created_at, updated_at)
         VALUES (?, 'analysis', 'broken', 1, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(project.id, '{"status":"running","id":7}');
    const instance = await buildApp({ config: testConfig({ LOG_LEVEL: 'silent' }), repository });
    applications.push(instance);
    expect(repository.artifacts.get(project.id, 'analysis', 'good')?.data.status).toBe(
      'interrupted',
    );
  });
});

describe('what is recorded', () => {
  it('records that a comparison started and was stopped, with identifiers and counts only', async () => {
    const gate = gateAfter(2);
    const CANARY = 'zq-canary-5513';
    const { start, withActors, cancel, finished, repository, project } = await world({
      yieldNow: gate.yieldNow,
    });
    withActors();
    const variants: Variant[] = [
      { ...FIXTURE_VARIANTS[0]!, label: `No change ${CANARY}`, description: `Text ${CANARY}` },
      { ...FIXTURE_VARIANTS[1]!, label: `Change ${CANARY}`, description: `Text ${CANARY}` },
    ];
    const started = (await start({ variants, runsPerVariant: 6, sensitivity: false })).json()
      .analysis as Analysis;
    await until(
      () => gate.reached(),
      (reached) => reached,
    );
    await cancel(started.id);
    gate.open();
    await finished(started.id);
    const entries = repository.audit
      .list({ projectId: project.id, limit: 200 })
      .filter((item) => item.action.startsWith('analysis.'));
    expect(entries.map((item) => item.action).sort()).toEqual([
      'analysis.cancelled',
      'analysis.started',
    ]);
    const begun = entries.find((item) => item.action === 'analysis.started')!;
    expect(begun).toMatchObject({
      targetType: 'project',
      targetId: project.id,
      detail: {
        analysis: started.id,
        scenarios: 2,
        runsPerVariant: 6,
        plannedRuns: 12,
        sensitivity: false,
      },
    });
    for (const entry of entries) {
      for (const value of Object.values(entry.detail)) {
        expect(['string', 'number', 'boolean']).toContain(typeof value);
      }
    }
    expect(JSON.stringify(entries)).not.toContain(CANARY);
  });
});

describe('comparing with the deep-dive run', () => {
  const finish = (repository: Repository, projectId: string, meanOpinion: number) =>
    repository.update(projectId, {
      status: 'completed',
      rounds: [
        {
          round: 1,
          meanOpinion: 0,
          supportShare: 0.3,
          oppositionShare: 0.3,
          undecidedShare: 0.4,
          polarization: 0.2,
          activityCount: 1,
          interactions: 1,
          opinions: [],
          actions: [],
          intervention: null,
        },
        {
          round: 2,
          meanOpinion,
          supportShare: 0.3,
          oppositionShare: 0.3,
          undecidedShare: 0.4,
          polarization: 0.2,
          activityCount: 1,
          interactions: 1,
          opinions: [],
          actions: [],
          intervention: null,
        },
      ],
    });

  it('says nothing when the project has no completed deep-dive run', async () => {
    const { start, withActors, finished } = await world();
    withActors();
    const done = await finished(
      ((await start({ runsPerVariant: 5, sensitivity: false })).json().analysis as Analysis).id,
    );
    expect(done.crossCheck).toBeNull();
  });

  it('says whether the deep-dive run’s final stance is within the p10 to p90 of the runs, and that the engines differ', async () => {
    const { start, withActors, finished, repository, project } = await world();
    withActors();
    const first = await finished(
      ((await start({ runsPerVariant: 10, sensitivity: false })).json().analysis as Analysis).id,
    );
    const band = first.variants
      .find((variant) => variant.variantId === 'proposed-change')!
      .trajectory.at(-1)!;

    finish(repository, project.id, band.p50);
    const inside = await finished(
      ((await start({ runsPerVariant: 10, sensitivity: false })).json().analysis as Analysis).id,
    );
    expect(inside.crossCheck).toMatchObject({
      primaryStanceMean: band.p50,
      withinEnsembleRange: true,
    });
    expect(inside.crossCheck!.note).toContain('inside');
    expect(inside.crossCheck!.note).toContain('different engines');
    expect(inside.crossCheck!.note).toContain('not a validation');

    finish(repository, project.id, 0.95);
    const outside = await finished(
      ((await start({ runsPerVariant: 10, sensitivity: false })).json().analysis as Analysis).id,
    );
    expect(outside.crossCheck).toMatchObject({
      primaryStanceMean: 0.95,
      withinEnsembleRange: false,
    });
    expect(outside.crossCheck!.note).toContain('outside');
  });
});

describe('what a project keeps', () => {
  it('removes its oldest finished comparisons beyond twelve, and never the one that has just started or one that is running', async () => {
    const { start, withActors, repository, project } = await world();
    withActors();
    for (let index = 1; index <= 13; index += 1) {
      const id = `old-${String(index).padStart(2, '0')}`;
      repository.artifacts.put(
        project.id,
        'analysis',
        id,
        analysisFixture({
          id,
          status: index === 2 ? 'running' : 'completed',
          completedAt: index === 2 ? null : '2026-01-15T10:00:00.000Z',
        }),
      );
    }
    const started = await start({ runsPerVariant: 3, sensitivity: false });
    const kept = repository.artifacts.list(project.id, 'analysis').map((record) => record.key);
    expect(kept).toHaveLength(12);
    expect(kept).toContain((started.json().analysis as Analysis).id);
    expect(kept).toContain('old-02');
    expect(kept).not.toContain('old-01');
    expect(kept).not.toContain('old-03');
    expect(kept).toContain('old-13');
  });
});

describe('a project that goes while its comparison runs', () => {
  it('stops the run, writes nothing for the gone project, and frees the server for the next one', async () => {
    const gate = gateAfter(2);
    const { start, withActors, repository, project, app } = await world({
      yieldNow: gate.yieldNow,
      maxConcurrent: 1,
    });
    withActors();
    await start({ runsPerVariant: 5, sensitivity: false });
    await until(
      () => gate.reached(),
      (reached) => reached,
    );
    repository.delete(project.id);
    gate.open();
    const other = repository.create(fixtureInput({ workflow: 'guided' }));
    repository.artifacts.put(other.id, 'actors', 'default', actorSetFixture());
    // The slot is taken until the run notices that its project has gone.
    const next = await until(
      () =>
        app.inject({
          method: 'POST',
          url: `/api/projects/${other.id}/analysis`,
          payload: { runsPerVariant: 3, sensitivity: false },
        }),
      (response) => response.statusCode !== 429,
    );
    expect(next.statusCode).toBe(202);
    expect(repository.ownership(project.id)).toBeNull();
  });
});

// Who may do what, for every kind of person: written out in full, as in membership.test.ts.
describe('who may use the comparison routes', () => {
  const ID = {
    owner: 'c0000001-0000-4000-8000-000000000001',
    lead: 'c0000003-0000-4000-8000-000000000003',
    analyst: 'c0000004-0000-4000-8000-000000000004',
    reviewer: 'c0000005-0000-4000-8000-000000000005',
    viewer: 'c0000006-0000-4000-8000-000000000006',
    member: 'c0000007-0000-4000-8000-000000000007',
    foreignOwner: 'd0000001-0000-4000-8000-000000000001',
  } as const;
  type Actor = keyof typeof ID | 'anonymous';
  const TOKENS: Record<keyof typeof ID, Minted> = {
    owner: { oid: ID.owner, roles: ['Swarm.User'] },
    lead: { oid: ID.lead, roles: ['Swarm.User'] },
    analyst: { oid: ID.analyst, roles: ['Swarm.User'] },
    reviewer: { oid: ID.reviewer, roles: ['Swarm.User'] },
    viewer: { oid: ID.viewer, roles: ['Swarm.User'] },
    member: { oid: ID.member, roles: ['Swarm.User'] },
    foreignOwner: { tid: TENANT_B, oid: ID.foreignOwner, roles: ['Swarm.User'] },
  };
  const CAN: Record<Actor, readonly ('read' | 'run')[]> = {
    owner: ['read', 'run'],
    lead: ['read', 'run'],
    analyst: ['read', 'run'],
    reviewer: ['read'],
    viewer: ['read'],
    member: [],
    foreignOwner: [],
    anonymous: [],
  };

  const routes = [
    {
      name: 'list the comparisons',
      policy: 'GET /api/projects/:id/analysis',
      capability: 'read',
      method: 'GET',
      url: (id: string) => `/api/projects/${id}/analysis`,
    },
    {
      name: 'read one comparison',
      policy: 'GET /api/projects/:id/analysis/:aid',
      capability: 'read',
      method: 'GET',
      url: (id: string) => `/api/projects/${id}/analysis/not-there`,
    },
    {
      name: 'start a comparison',
      policy: 'POST /api/projects/:id/analysis',
      capability: 'run',
      method: 'POST',
      url: (id: string) => `/api/projects/${id}/analysis`,
      // A request the handler refuses, so that nothing is started by checking who may.
      payload: { invalid: true },
    },
    {
      name: 'stop a comparison',
      policy: 'POST /api/projects/:id/analysis/:aid/cancel',
      capability: 'run',
      method: 'POST',
      url: (id: string) => `/api/projects/${id}/analysis/not-there/cancel`,
      payload: {},
    },
  ] as const;

  async function secured() {
    const config = testConfig({ ...entraEnvironment, LOG_LEVEL: 'silent' });
    const instance = await buildApp({
      config,
      tokenVerifier: new TokenVerifier(config.auth, idp.keys),
      analysis: { simulator: stubSimulator },
    });
    applications.push(instance);
    const { repository } = instance;
    const setup = { id: 'test-setup', workspaceRole: 'owner' as const };
    repository.members.setWorkspaceMember({
      tenantId: TENANT_A,
      principalId: ID.owner,
      role: 'owner',
      actor: setup,
    });
    repository.members.setWorkspaceMember({
      tenantId: TENANT_A,
      principalId: ID.member,
      role: 'member',
      actor: setup,
    });
    repository.members.setWorkspaceMember({
      tenantId: TENANT_B,
      principalId: ID.foreignOwner,
      role: 'owner',
      actor: setup,
    });
    const shared = repository.create(fixtureInput({ workflow: 'guided' }), {
      owner: { tenantId: TENANT_A, ownerId: ID.lead },
    });
    for (const [principalId, role] of [
      [ID.analyst, 'analyst'],
      [ID.reviewer, 'reviewer'],
      [ID.viewer, 'viewer'],
    ] as const) {
      repository.members.setProjectMember({
        projectId: shared.id,
        tenantId: TENANT_A,
        principalId,
        role,
        actor: { id: ID.lead },
      });
    }
    return { ...instance, shared: shared.id };
  }

  const call = async (
    instance: Awaited<ReturnType<typeof secured>>,
    as: Actor,
    route: (typeof routes)[number],
    projectId: string,
  ) =>
    instance.app.inject({
      method: route.method,
      url: route.url(projectId),
      headers: as === 'anonymous' ? {} : await authorization(TOKENS[as]),
      ...('payload' in route ? { payload: route.payload } : {}),
    });

  const outcome = (response: { statusCode: number; json: () => { error?: { code?: string } } }) => {
    if (response.statusCode === 401) return 'unauthenticated';
    const code = response.statusCode >= 400 ? response.json().error?.code : undefined;
    if (code === 'PROJECT_NOT_FOUND') return 'hidden';
    if (response.statusCode === 403 && code === 'FORBIDDEN') return 'forbidden';
    return 'allowed';
  };

  const expected = (actor: Actor, capability: 'read' | 'run') => {
    if (actor === 'anonymous') return 'unauthenticated';
    if (CAN[actor].length === 0) return 'hidden';
    return CAN[actor].includes(capability) ? 'allowed' : 'forbidden';
  };

  it('is the policy table: reading needs read, and starting and stopping need run', () => {
    for (const route of routes) {
      expect(ROUTE_POLICY[route.policy], route.policy).toEqual({
        kind: 'project',
        capability: route.capability,
      });
    }
  });

  it.each(Object.keys(CAN) as Actor[])('does what the table says for %s', async (actor) => {
    const instance = await secured();
    const seen: string[] = [];
    for (const route of routes) {
      const response = await call(instance, actor, route, instance.shared);
      const got = outcome(response);
      const want = expected(actor, route.capability);
      if (got !== want) seen.push(`${actor} may ${route.name}: expected ${want}, got ${got}`);
      if (want === 'hidden') {
        const absent = await call(instance, actor, route, '99999999-9999-4999-8999-999999999999');
        expect(response.json().error, `${actor} ${route.name}`).toMatchObject({
          code: absent.json().error.code,
          message: absent.json().error.message,
        });
      }
    }
    expect(seen).toEqual([]);
  });

  it('keeps another workspace out of the comparisons, and this one out of theirs', async () => {
    const instance = await secured();
    for (const route of routes) {
      expect(
        outcome(await call(instance, 'foreignOwner', route, instance.shared)),
        route.name,
      ).toBe('hidden');
    }
  });

  it('tells a person who may not run that they may not, in the list, so the page can say so', async () => {
    const instance = await secured();
    instance.repository.artifacts.put(instance.shared, 'actors', 'default', actorSetFixture());
    const asViewer = await instance.app.inject({
      method: 'GET',
      url: `/api/projects/${instance.shared}/analysis`,
      headers: await authorization(TOKENS.viewer),
    });
    expect(asViewer.json().readiness.may).toEqual({ run: false });
    const asAnalyst = await instance.app.inject({
      method: 'GET',
      url: `/api/projects/${instance.shared}/analysis`,
      headers: await authorization(TOKENS.analyst),
    });
    expect(asAnalyst.json().readiness.may).toEqual({ run: true });
  });
});
