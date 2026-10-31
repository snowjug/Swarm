import { afterEach, describe, expect, it } from 'vitest';
import { MAX_BUDGET_LIMIT } from '../../shared/budget.js';
import type { BudgetView } from '../../shared/budget.js';
import { buildApp } from '../src/app.js';
import { fixtureInput, testConfig } from './fixtures.js';

// The routes that show what a project has used of its model budget and let a workspace owner or
// administrator change it. Who may call them, for every kind of person, is in membership.test.ts.

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function world(environment: Record<string, string> = {}) {
  const instance = await buildApp({ config: testConfig({ LOG_LEVEL: 'silent', ...environment }) });
  applications.push(instance);
  const project = instance.repository.create(
    fixtureInput({ settings: { mode: 'llm', agentCount: 4, rounds: 3 } }),
  );
  const url = `/api/projects/${project.id}/budget`;
  const get = async () =>
    (await instance.app.inject({ method: 'GET', url })).json().budget as BudgetView;
  const put = (payload: unknown) =>
    instance.app.inject({ method: 'PUT', url, payload: payload as object });
  return { ...instance, project, url, get, put };
}

describe('reading a budget', () => {
  it('shows nothing used and no limit on a deployment that sets none', async () => {
    const { get } = await world();
    expect(await get()).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      callLimit: 0,
      tokenLimit: 0,
      own: { callLimit: null, tokenLimit: null },
      defaults: { callLimit: 0, tokenLimit: 0 },
      state: 'none',
      may: { edit: true },
    });
  });

  it('shows the deployment’s default as what applies, and where it comes from', async () => {
    const { get } = await world({
      PROJECT_MODEL_CALL_LIMIT: '500',
      PROJECT_MODEL_TOKEN_LIMIT: '2000000',
    });
    expect(await get()).toMatchObject({
      callLimit: 500,
      tokenLimit: 2_000_000,
      own: { callLimit: null, tokenLimit: null },
      defaults: { callLimit: 500, tokenLimit: 2_000_000 },
      state: 'ok',
    });
  });

  it('shows what has been used, and how near the limit it is', async () => {
    const { get, repository, project, put } = await world();
    repository.update(project.id, {
      execution: { provider: 'azure', model: 'm', modelCalls: 0, inputTokens: 0, outputTokens: 0 },
    });
    await put({ callLimit: 10, tokenLimit: null });
    for (let call = 0; call < 8; call++) repository.recordUsage(project.id, 100, 50);
    expect(await get()).toMatchObject({
      calls: 8,
      inputTokens: 800,
      outputTokens: 400,
      callLimit: 10,
      state: 'warning',
    });
    for (let call = 0; call < 2; call++) repository.recordUsage(project.id, 100, 50);
    expect((await get()).state).toBe('exhausted');
  });

  it('is not found for a project that is not there', async () => {
    const { app } = await world();
    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/00000000-0000-4000-8000-000000000000/budget',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('changing a budget', () => {
  it('sets the limits of one project, shows them straight away, and says so in the audit log', async () => {
    const { put, get, repository, project } = await world();
    const response = await put({ callLimit: 200, tokenLimit: 1_000_000 });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().budget).toMatchObject({
      callLimit: 200,
      tokenLimit: 1_000_000,
      own: { callLimit: 200, tokenLimit: 1_000_000 },
    });
    expect(await get()).toMatchObject({ callLimit: 200, tokenLimit: 1_000_000 });
    const entry = repository.audit
      .list({ projectId: project.id, limit: 500 })
      .filter((candidate) => candidate.action === 'project.budget.changed')
      .at(-1);
    expect(entry).toMatchObject({
      targetType: 'project',
      targetId: project.id,
      detail: { callLimit: 200, tokenLimit: 1_000_000 },
    });
  });

  it('gives back the deployment’s default with null, and lifts every limit with 0', async () => {
    const { put, get } = await world({ PROJECT_MODEL_CALL_LIMIT: '50' });
    await put({ callLimit: 5, tokenLimit: 100 });
    expect(await get()).toMatchObject({ callLimit: 5, tokenLimit: 100 });
    await put({ callLimit: null, tokenLimit: null });
    expect(await get()).toMatchObject({
      callLimit: 50,
      tokenLimit: 0,
      own: { callLimit: null, tokenLimit: null },
    });
    await put({ callLimit: 0, tokenLimit: 0 });
    expect(await get()).toMatchObject({ callLimit: 0, tokenLimit: 0, state: 'none' });
  });

  it('keeps what was used when the limits change', async () => {
    const { put, get, repository, project } = await world();
    repository.update(project.id, {
      execution: { provider: 'azure', model: 'm', modelCalls: 0, inputTokens: 0, outputTokens: 0 },
    });
    repository.recordUsage(project.id, 30, 20);
    await put({ callLimit: 3, tokenLimit: null });
    await put({ callLimit: 9, tokenLimit: null });
    expect(await get()).toMatchObject({ calls: 1, inputTokens: 30, outputTokens: 20 });
  });

  it('refuses a limit that is not a whole number within bounds, a missing field and an unknown one, and changes nothing', async () => {
    const { put, get } = await world();
    await put({ callLimit: 7, tokenLimit: 70 });
    const bad: unknown[] = [
      { callLimit: -1, tokenLimit: null },
      { callLimit: 1.5, tokenLimit: null },
      { callLimit: '5', tokenLimit: null },
      { callLimit: MAX_BUDGET_LIMIT + 1, tokenLimit: null },
      { callLimit: null },
      { tokenLimit: null },
      { callLimit: null, tokenLimit: null, extra: 1 },
      {},
      null,
    ];
    for (const payload of bad) {
      const response = await put(payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(await get()).toMatchObject({ callLimit: 7, tokenLimit: 70 });
    expect((await put({ callLimit: MAX_BUDGET_LIMIT, tokenLimit: 0 })).statusCode).toBe(200);
  });

  it('does not touch another project’s budget', async () => {
    const { put, repository, app } = await world();
    const other = repository.create(fixtureInput());
    await put({ callLimit: 1, tokenLimit: 1 });
    const view = (
      await app.inject({ method: 'GET', url: `/api/projects/${other.id}/budget` })
    ).json().budget as BudgetView;
    expect(view.own).toEqual({ callLimit: null, tokenLimit: null });
  });
});
