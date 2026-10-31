import { afterEach, describe, expect, it } from 'vitest';
import { ANALYSIS_STATUSES, type Analysis } from '../../shared/analysis.js';
import type { BriefView } from '../../shared/brief.js';
import { critiqueSetSchema } from '../../shared/critique.js';
import {
  FIXTURE_TIME,
  actorSetFixture,
  analysisFixture,
  scenarioFixture,
  stakeholderSetFixture,
} from '../../shared/lab-fixtures.js';
import { labProgressSchema, type LabProgress } from '../../shared/lab.js';
import type { ActorsView, StakeholdersView } from '../../shared/stakeholders.js';
import type { ProjectDetail } from '../../shared/types.js';
import { buildApp } from '../src/app.js';
import { labProgress } from '../src/lab/progress.js';
import { Repository } from '../src/storage/repository.js';
import type { SqlDatabase } from '../src/storage/sql.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { briefFixture } from './support/critic-world.js';

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
const repositories: Repository[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
  for (const repository of repositories.splice(0)) repository.close();
});

const NOTHING: LabProgress = {
  scenario: false,
  stakeholders: 'none',
  actors: 0,
  analysis: 'none',
  critiques: false,
  brief: false,
};

const rawOf = (value: Repository): SqlDatabase =>
  (value as unknown as { database: SqlDatabase }).database;

function made() {
  const repository = new Repository(':memory:');
  repositories.push(repository);
  const project = repository.create(fixtureInput({ workflow: 'guided' }));
  const progress = () => labProgress(repository.artifacts, project.id);
  const put = repository.artifacts.put.bind(repository.artifacts);
  // A comparison is newer when it was saved later, which a test sets, so that it does not depend on
  // how many of them are saved within the same millisecond.
  const comparison = (id: string, status: Analysis['status'], savedAt: string) => {
    put(project.id, 'analysis', id, analysisFixture({ id, status, createdAt: savedAt }));
    rawOf(repository)
      .prepare(
        'UPDATE project_artifacts SET created_at = ? WHERE project_id = ? AND kind = ? AND artifact_key = ?',
      )
      .run(savedAt, project.id, 'analysis', id);
  };
  const damage = (kind: string, key: string) =>
    rawOf(repository)
      .prepare(
        'UPDATE project_artifacts SET payload = ? WHERE project_id = ? AND kind = ? AND artifact_key = ?',
      )
      .run('{"damaged": true}', project.id, kind, key);
  return { repository, project, progress, put, comparison, damage };
}

const critiques = () =>
  critiqueSetSchema.parse({
    analysisId: null,
    generatedAt: FIXTURE_TIME,
    mode: 'rules',
    critiques: [],
  });

describe('how far a project has come', () => {
  it('says there is nothing yet for a project that holds nothing', () => {
    const { progress } = made();
    expect(progress()).toEqual(NOTHING);
  });

  it('follows the scenario, the stakeholders, the actors, the review and the brief as they are saved', () => {
    const { project, progress, put } = made();
    put(project.id, 'scenario', 'default', scenarioFixture());
    expect(progress()).toEqual({ ...NOTHING, scenario: true });

    put(project.id, 'stakeholders', 'default', {
      ...stakeholderSetFixture(),
      approvedAt: null,
    });
    expect(progress()).toEqual({ ...NOTHING, scenario: true, stakeholders: 'proposed' });

    put(project.id, 'stakeholders', 'default', stakeholderSetFixture());
    put(project.id, 'actors', 'default', actorSetFixture());
    expect(progress()).toEqual({
      ...NOTHING,
      scenario: true,
      stakeholders: 'approved',
      actors: actorSetFixture().actors.length,
    });

    const analysis = analysisFixture();
    put(project.id, 'analysis', analysis.id, analysis);
    put(project.id, 'critiques', 'default', critiques());
    put(project.id, 'brief', 'default', briefFixture(analysis));
    expect(progress()).toEqual({
      scenario: true,
      stakeholders: 'approved',
      actors: 5,
      analysis: 'completed',
      critiques: true,
      brief: true,
    });
  });

  it('counts the actors that are there, and none when the list is gone', () => {
    const { project, progress, put, repository } = made();
    const cast = actorSetFixture();
    put(project.id, 'actors', 'default', { ...cast, actors: cast.actors.slice(0, 3) });
    expect(progress().actors).toBe(3);
    repository.artifacts.delete(project.id, 'actors');
    expect(progress().actors).toBe(0);
  });

  it('maps every state a comparison can be in to what a person is shown', () => {
    const expected: Record<Analysis['status'], LabProgress['analysis']> = {
      queued: 'running',
      running: 'running',
      completed: 'completed',
      failed: 'failed',
      cancelled: 'failed',
      interrupted: 'failed',
    };
    expect(Object.keys(expected).sort()).toEqual([...ANALYSIS_STATUSES].sort());
    for (const status of ANALYSIS_STATUSES) {
      const { comparison, progress } = made();
      comparison('only', status, '2026-02-01T10:00:00.000Z');
      expect(progress().analysis, status).toBe(expected[status]);
    }
  });

  it('keeps a comparison that finished when a later one was stopped, and shows one that is running', () => {
    const { comparison, progress } = made();
    comparison('first', 'completed', '2026-02-01T10:00:00.000Z');
    comparison('second', 'cancelled', '2026-02-01T11:00:00.000Z');
    expect(progress().analysis).toBe('completed');
    comparison('third', 'failed', '2026-02-01T12:00:00.000Z');
    expect(progress().analysis).toBe('completed');
    comparison('fourth', 'running', '2026-02-01T13:00:00.000Z');
    expect(progress().analysis).toBe('running');
  });

  it('says failed only when none of the comparisons produced a result', () => {
    const { comparison, progress } = made();
    comparison('a', 'interrupted', '2026-02-01T10:00:00.000Z');
    comparison('b', 'cancelled', '2026-02-01T11:00:00.000Z');
    expect(progress().analysis).toBe('failed');
  });

  it('reads the newest comparisons first, and no more than it needs to', () => {
    const { comparison, damage, progress } = made();
    comparison('old', 'completed', '2026-02-01T09:00:00.000Z');
    comparison('new', 'completed', '2026-02-01T10:00:00.000Z');
    // The older one is never read, so that a project with a dozen large ones is not read in full.
    damage('analysis', 'old');
    expect(progress().analysis).toBe('completed');
  });

  it('passes over a comparison that cannot be read', () => {
    const { comparison, damage, progress } = made();
    comparison('old', 'completed', '2026-02-01T09:00:00.000Z');
    comparison('new', 'completed', '2026-02-01T10:00:00.000Z');
    damage('analysis', 'new');
    expect(progress().analysis).toBe('completed');
    damage('analysis', 'old');
    expect(progress().analysis).toBe('none');
  });

  it('counts a list or a cast that cannot be read as missing, and still answers', () => {
    const { project, progress, put, damage } = made();
    const analysis = analysisFixture();
    put(project.id, 'stakeholders', 'default', stakeholderSetFixture());
    put(project.id, 'actors', 'default', actorSetFixture());
    put(project.id, 'analysis', analysis.id, analysis);
    expect(progress()).toMatchObject({
      stakeholders: 'approved',
      actors: 5,
      analysis: 'completed',
    });

    damage('stakeholders', 'default');
    damage('actors', 'default');
    damage('analysis', analysis.id);
    expect(progress()).toEqual(NOTHING);
  });

  it('counts a scenario, a review or a brief as there when it is stored, and lists nothing it cannot find', () => {
    const { project, progress, put, damage, repository } = made();
    const analysis = analysisFixture();
    put(project.id, 'scenario', 'default', scenarioFixture());
    put(project.id, 'critiques', 'default', critiques());
    put(project.id, 'brief', 'default', briefFixture(analysis));
    damage('scenario', 'default');
    damage('critiques', 'default');
    damage('brief', 'default');
    expect(progress()).toEqual({ ...NOTHING, scenario: true, critiques: true, brief: true });
    for (const kind of ['scenario', 'critiques', 'brief'] as const) {
      repository.artifacts.delete(project.id, kind);
    }
    expect(progress()).toEqual(NOTHING);
  });

  it('keeps one project’s work out of another’s', () => {
    const { repository, project, put } = made();
    const other = repository.create(fixtureInput({ workflow: 'guided', name: 'Another project' }));
    put(project.id, 'scenario', 'default', scenarioFixture());
    put(project.id, 'actors', 'default', actorSetFixture());
    expect(labProgress(repository.artifacts, other.id)).toEqual(NOTHING);
  });
});

describe('the keys of a kind', () => {
  it('are listed newest first without reading the documents', () => {
    const { repository, project, comparison, damage } = made();
    expect(repository.artifacts.keys(project.id, 'analysis')).toEqual([]);
    comparison('first', 'completed', '2026-02-01T09:00:00.000Z');
    comparison('second', 'failed', '2026-02-01T10:00:00.000Z');
    comparison('third', 'running', '2026-02-01T11:00:00.000Z');
    damage('analysis', 'second');
    expect(repository.artifacts.keys(project.id, 'analysis')).toEqual(['third', 'second', 'first']);
    expect(repository.artifacts.keys(project.id, 'brief')).toEqual([]);
  });
});

async function world() {
  const instance = await buildApp({
    config: testConfig({ LOG_LEVEL: 'silent', RATE_LIMIT_SCALE: '100' }),
  });
  applications.push(instance);
  const project = instance.repository.create(fixtureInput({ workflow: 'guided' }));
  const base = `/api/projects/${project.id}`;
  const read = async () => (await instance.app.inject(base)).json() as ProjectDetail;
  return { ...instance, project, base, read };
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The condition was not reached in time.');
}

describe('the route that reads one project', () => {
  it('adds how far it has come, in the shape the pages read', async () => {
    const { read, repository, project } = await world();
    const before = await read();
    expect(labProgressSchema.parse(before.lab)).toEqual(NOTHING);
    // The rest of the record is what the repository holds, unchanged.
    const record: Partial<ProjectDetail> = { ...before };
    delete record.lab;
    expect(record).toEqual(JSON.parse(JSON.stringify(repository.get(project.id))));

    repository.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
    repository.artifacts.put(project.id, 'stakeholders', 'default', stakeholderSetFixture());
    repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
    expect((await read()).lab).toEqual({
      ...NOTHING,
      scenario: true,
      stakeholders: 'approved',
      actors: 5,
    });
  });

  it('is the only place that adds it: not the repository, a list, an export or a new project', async () => {
    const { app, repository, project, base } = await world();
    repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());

    expect(repository.get(project.id)).not.toHaveProperty('lab');
    const listed = (await app.inject('/api/projects')).json() as { projects: object[] };
    expect(listed.projects.length).toBeGreaterThan(0);
    for (const item of listed.projects) expect(item).not.toHaveProperty('lab');
    const exported = (await app.inject(`${base}/export?format=json`)).json() as {
      project: object;
    };
    expect(exported.project).not.toHaveProperty('lab');
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: fixtureInput({ workflow: 'guided', name: 'A copy of the project' }),
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).not.toHaveProperty('lab');
  });

  it('follows a project through the routes the pages use, from the stakeholders to the brief', async () => {
    const { app, read, base, repository, project } = await world();
    repository.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
    expect((await read()).lab).toEqual({ ...NOTHING, scenario: true });

    const found = await app.inject({
      method: 'POST',
      url: `${base}/stakeholders/discover`,
      payload: { mode: 'rules' },
    });
    expect(found.statusCode, found.body).toBe(201);
    expect((await read()).lab).toMatchObject({ stakeholders: 'proposed', actors: 0 });

    const approved = await app.inject({
      method: 'POST',
      url: `${base}/stakeholders/approve`,
      payload: { expectedRevision: (found.json() as StakeholdersView).revision },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect((await read()).lab).toMatchObject({ stakeholders: 'approved', actors: 0 });

    const cast = await app.inject({ method: 'POST', url: `${base}/actors/generate`, payload: {} });
    expect(cast.statusCode, cast.body).toBe(201);
    const actors = (cast.json() as ActorsView).actors?.actors.length ?? 0;
    expect(actors).toBeGreaterThanOrEqual(3);
    expect((await read()).lab).toMatchObject({ actors, analysis: 'none' });

    const started = await app.inject({
      method: 'POST',
      url: `${base}/analysis`,
      payload: { runsPerVariant: 3, sensitivity: false },
    });
    expect(started.statusCode, started.body).toBe(202);
    const after = await until(read, (value) => value.lab?.analysis !== 'running');
    expect(after.lab).toMatchObject({ analysis: 'completed', critiques: false, brief: false });

    const review = await app.inject({ method: 'POST', url: `${base}/critiques/run`, payload: {} });
    expect(review.statusCode, review.body).toBeLessThan(300);
    expect((await read()).lab).toMatchObject({ analysis: 'completed', critiques: true });

    const written = await app.inject({ method: 'POST', url: `${base}/brief`, payload: {} });
    expect(written.statusCode, written.body).toBe(201);
    expect((written.json() as BriefView).brief).not.toBeNull();
    expect((await read()).lab).toEqual({
      scenario: true,
      stakeholders: 'approved',
      actors,
      analysis: 'completed',
      critiques: true,
      brief: true,
    });
  });
});
