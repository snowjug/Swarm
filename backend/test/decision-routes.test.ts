import { afterEach, describe, expect, it } from 'vitest';
import { ANALYSIS_INPUTS } from '../../shared/analysis.js';
import { ARTIFACT_KINDS } from '../../shared/artifacts.js';
import { SCOPE_NOTICE, type DecisionView } from '../../shared/decision.js';
import {
  actorSetFixture,
  analysisFixture,
  scenarioFixture,
  stakeholderSetFixture,
} from '../../shared/lab-fixtures.js';
import { buildApp } from '../src/app.js';
import { AUDIT_POLICY } from '../src/auth/audit-policy.js';
import { ROUTE_POLICY, policyFor } from '../src/auth/policy.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import type { Repository } from '../src/storage/repository.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { constraintOf, setOf } from './support/constraint-fixtures.js';
import {
  TENANT_A,
  TENANT_B,
  authorization,
  entraEnvironment,
  idp,
  type Minted,
} from './support/entra-idp.js';

// The route that serves the decision canvas. The canvas itself is tested in decision-build.test.ts;
// here: what the route answers at each stage of a project, that nothing is stored, who may read it,
// and that another workspace cannot tell a project is there.

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

const revisionsOf = (repository: Repository, projectId: string): Record<string, number> =>
  Object.fromEntries(
    ANALYSIS_INPUTS.map((kind) => [kind, repository.artifacts.get(projectId, kind)?.revision ?? 0]),
  );

/** What a project holds once a comparison has run, recording what it was made from. */
function holdComparison(repository: Repository, projectId: string, overrides = {}): void {
  const { artifacts } = repository;
  artifacts.put(projectId, 'scenario', 'default', scenarioFixture());
  artifacts.put(projectId, 'stakeholders', 'default', stakeholderSetFixture());
  artifacts.put(projectId, 'actors', 'default', actorSetFixture());
  artifacts.put(
    projectId,
    'analysis',
    'analysis-1',
    analysisFixture({ inputRevisions: revisionsOf(repository, projectId), ...overrides }),
  );
}

async function localWorld(scale = '1000', input: Record<string, unknown> = {}) {
  const instance = await buildApp({
    config: testConfig({ LOG_LEVEL: 'silent', RATE_LIMIT_SCALE: scale }),
  });
  applications.push(instance);
  const project = instance.repository.create(fixtureInput(input));
  const get = async (id = project.id) =>
    instance.app.inject({ method: 'GET', url: `/api/projects/${id}/decision` });
  const view = async () => (await get()).json() as DecisionView;
  return { ...instance, project, get, view };
}

describe('the canvas of a project that cannot have one yet', () => {
  it('says what is missing and which step supplies it, at each stage, and that the status is insufficient evidence', async () => {
    const { view, repository, project } = await localWorld();
    const first = await view();
    expect(first.canvas).toBeNull();
    expect(first.readiness).toMatchObject({
      state: 'no-analysis',
      next: 'ask',
      missing: ['The question has not been turned into a scenario yet.'],
    });
    expect(first.readiness.status).toMatchObject({
      status: 'insufficient-evidence',
      rule: 'no-analysis',
    });
    expect(first.may).toEqual({ run: true, export: true });

    repository.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
    expect((await view()).readiness).toMatchObject({ next: 'map' });
    expect((await view()).readiness.missing[0]).toMatch(/stakeholders have not been reviewed/u);

    repository.artifacts.put(project.id, 'stakeholders', 'default', stakeholderSetFixture());
    expect((await view()).readiness.missing[0]).toMatch(/actors have not been made/u);

    repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
    expect((await view()).readiness).toMatchObject({
      next: 'simulate',
      missing: ['No comparison has been run yet.'],
    });
  });

  it('says a comparison is running, or that the last one did not finish, and has no canvas for either', async () => {
    const { view, repository, project } = await localWorld();
    holdComparison(repository, project.id, { status: 'running', completedAt: null });
    expect(await view()).toMatchObject({
      canvas: null,
      readiness: { state: 'running', next: 'simulate' },
    });
    holdComparison(repository, project.id, { status: 'failed', completedAt: null });
    expect(await view()).toMatchObject({ canvas: null, readiness: { state: 'failed' } });
    expect((await view()).readiness.missing[0]).toMatch(/did not finish/u);
  });

  it('does not take a finished comparison that recorded no runs for one that can be read', async () => {
    const { view, repository, project } = await localWorld();
    holdComparison(repository, project.id, { variants: [], findings: [], sensitivity: [] });
    expect((await view()).canvas).toBeNull();
  });
});

describe('a question that Swarm does not decide, at each stage of a project', () => {
  it('says so before there is any comparison, and the status is a human decision, not a lack of evidence', async () => {
    const { view } = await localWorld('1000', {
      question: 'Should we fire this employee?',
    });
    const body = await view();
    expect(body.canvas).toBeNull();
    expect(body.readiness.missing).toEqual([
      'The question has not been turned into a scenario yet.',
    ]);
    expect(body.readiness.status).toMatchObject({
      status: 'needs-human-decision',
      rule: 'individual-decision',
    });
    expect(body.readiness.scope).toMatchObject({
      notice: SCOPE_NOTICE,
      domains: ['employment'],
      aboutIndividual: true,
    });
  });

  it('says it on the canvas of a finished comparison, and names no option', async () => {
    const { view, repository, project } = await localWorld('1000', {
      question: 'Should the bank approve John Smith’s mortgage application?',
    });
    holdComparison(repository, project.id);
    const body = await view();
    expect(body.canvas?.status).toMatchObject({
      status: 'needs-human-decision',
      rule: 'individual-decision',
    });
    expect(body.canvas?.answer.preferredAlternativeId).toBeNull();
    expect(body.canvas?.answer.recommendation.kind).toBe('decide');
    expect(body.canvas?.scope).toMatchObject({ domains: ['credit'], aboutIndividual: true });
    expect(body.readiness.scope).toEqual(body.canvas?.scope);
  });

  it('says only the notice for a matter of policy, and nothing for a question about none of the five', async () => {
    const policy = await localWorld('1000', {
      question: 'What happens if we change our hiring policy?',
    });
    expect((await policy.view()).readiness.scope).toMatchObject({
      domains: ['employment'],
      aboutIndividual: false,
    });
    expect((await policy.view()).readiness.status).toMatchObject({ rule: 'no-analysis' });
    const plain = await localWorld();
    expect((await plain.view()).readiness.scope).toMatchObject({ notice: null, domains: [] });
  });
});

describe('the canvas of a project with a finished comparison', () => {
  it('answers with the canvas, the readiness and what the caller may do, and stores nothing', async () => {
    const { view, repository, project, get } = await localWorld();
    holdComparison(repository, project.id);
    const before = ARTIFACT_KINDS.flatMap((kind) =>
      repository.artifacts
        .list(project.id, kind)
        .map((record) => `${kind}/${record.key}/${record.revision}`),
    );
    const body = await view();
    expect(body.canvas).not.toBeNull();
    expect(body.canvas?.notice).toBe('Explore scenarios, not predictions.');
    expect(body.canvas?.freshness).toMatchObject({
      analysisId: 'analysis-1',
      stale: false,
      changedSince: [],
      newerRunning: false,
    });
    expect(body.readiness.state).toBe('ready');
    expect(body.readiness.missing).toEqual(
      expect.arrayContaining(['The constraints have not been reviewed.']),
    );
    expect(body.may).toEqual({ run: true, export: true });
    expect((await get()).headers['cache-control']).toBe('no-store');
    const after = ARTIFACT_KINDS.flatMap((kind) =>
      repository.artifacts
        .list(project.id, kind)
        .map((record) => `${kind}/${record.key}/${record.revision}`),
    );
    expect(after).toEqual(before);
    expect(repository.artifacts.get(project.id, 'brief')).toBeNull();
  });

  it('is worked out again at every read: a change to the scenario makes it say so at once, with no step in between', async () => {
    const { view, repository, project } = await localWorld();
    holdComparison(repository, project.id);
    expect((await view()).canvas?.freshness.stale).toBe(false);
    repository.artifacts.put(
      project.id,
      'scenario',
      'default',
      scenarioFixture({ decision: 'Whether to hold the fee' }),
      {
        expectedRevision: 1,
      },
    );
    const stale = (await view()).canvas;
    expect(stale?.freshness).toMatchObject({ stale: true, changedSince: ['scenario'] });
    expect(stale?.status.status).not.toBe('robust-option');
    expect(stale?.question.decision.text).toBe('Whether to hold the fee');
    expect((await view()).readiness.missing.join(' ')).toMatch(
      /run before something it is made from changed/u,
    );
  });

  it('works the constraint gate out again too: a constraint set to a blocking state blocks the answer at once', async () => {
    const { view, repository, project } = await localWorld();
    holdComparison(repository, project.id);
    expect((await view()).canvas?.constraints.gate).toBe('none');
    repository.artifacts.put(
      project.id,
      'constraints',
      'default',
      setOf([
        constraintOf({
          id: 'c-0001',
          category: 'legal',
          hardness: 'hard',
          statement: 'A licence is needed.',
          validation: 'unvalidated',
        }),
      ]),
    );
    const blocked = (await view()).canvas;
    expect(blocked?.status.status).toBe('blocked-by-hard-constraint');
    expect(blocked?.constraints.gate).toBe('blocked');
    expect(blocked?.constraints.hard[0]).toMatchObject({ id: 'c-0001', provisional: true });
  });

  it('shows a newer comparison that is still running without replacing the finished one', async () => {
    const { view, repository, project } = await localWorld();
    holdComparison(repository, project.id);
    repository.artifacts.put(
      project.id,
      'analysis',
      'analysis-2',
      analysisFixture({
        id: 'analysis-2',
        status: 'running',
        completedAt: null,
        createdAt: '2026-02-01T10:00:00.000Z',
      }),
    );
    const body = await view();
    expect(body.canvas?.freshness).toMatchObject({ analysisId: 'analysis-1', newerRunning: true });
  });

  it('reads a brief-less project the same: the canvas does not depend on the brief', async () => {
    const { view, repository, project } = await localWorld();
    holdComparison(repository, project.id);
    const without = JSON.stringify((await view()).canvas);
    repository.artifacts.put(
      project.id,
      'brief',
      'default',
      (await import('../../shared/brief.js')).decisionBriefSchema.parse({
        generatedAt: '2026-01-15T10:00:00.000Z',
        analysisId: 'analysis-1',
        question: 'Q',
        headline: 'A simulated headline.',
        sections: [],
        recommendations: [],
        validationPlan: [],
        limitations: [],
        fidelity: analysisFixture().fidelity,
        methodology: { runsPerVariant: 10, variants: [], baseSeed: 100, rounds: 8, notes: [] },
        openCritiques: 0,
        generatedBy: 'rules',
      }),
    );
    expect(JSON.stringify((await view()).canvas)).toBe(without);
  });

  it('records nothing in the audit log, because it changes nothing', async () => {
    const { get, repository, project } = await localWorld();
    holdComparison(repository, project.id);
    await get();
    await get();
    expect(
      repository.audit
        .list({ projectId: project.id, limit: 500 })
        .filter((entry) => entry.action.includes('decision')),
    ).toEqual([]);
  });

  it('answers 404, in the same words as for any project that is not there, for an unknown project', async () => {
    const { get } = await localWorld();
    const response = await get('99999999-9999-4999-8999-999999999999');
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('PROJECT_NOT_FOUND');
    expect((await get('not-a-uuid')).statusCode).toBe(400);
  });

  it('limits how often it may be read, because it works the answer out each time', async () => {
    const { get } = await localWorld('1');
    for (let attempt = 0; attempt < 120; attempt += 1) {
      expect((await get()).statusCode).toBe(200);
    }
    const limited = await get();
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
  });
});

describe('the policy tables', () => {
  it('lets whoever may read the project read the canvas, and records nothing about it', () => {
    expect(ROUTE_POLICY['GET /api/projects/:id/decision']).toEqual({
      kind: 'project',
      capability: 'read',
    });
    expect(policyFor('HEAD', '/api/projects/:id/decision')).toBe(
      policyFor('GET', '/api/projects/:id/decision'),
    );
    expect(AUDIT_POLICY['GET /api/projects/:id/decision']).toMatchObject({ kind: 'none' });
  });
});

// ---- Who may read it, with real sign-in

const ID = {
  lead: 'e1000001-0000-4000-8000-000000000001',
  analyst: 'e1000002-0000-4000-8000-000000000002',
  reviewer: 'e1000003-0000-4000-8000-000000000003',
  viewer: 'e1000004-0000-4000-8000-000000000004',
  member: 'e1000005-0000-4000-8000-000000000005',
  foreign: 'f1000001-0000-4000-8000-000000000001',
} as const;
type Caller = keyof typeof ID | 'anonymous';
const TOKENS: Record<keyof typeof ID, Minted> = {
  lead: { oid: ID.lead, roles: ['Swarm.User'] },
  analyst: { oid: ID.analyst, roles: ['Swarm.User'] },
  reviewer: { oid: ID.reviewer, roles: ['Swarm.User'] },
  viewer: { oid: ID.viewer, roles: ['Swarm.User'] },
  member: { oid: ID.member, roles: ['Swarm.User'] },
  foreign: { tid: TENANT_B, oid: ID.foreign, roles: ['Swarm.User'] },
};

async function securedWorld() {
  const config = testConfig({ ...entraEnvironment, LOG_LEVEL: 'silent' });
  const instance = await buildApp({
    config,
    tokenVerifier: new TokenVerifier(config.auth, idp.keys),
  });
  applications.push(instance);
  const { app, repository } = instance;
  repository.members.setWorkspaceMember({
    tenantId: TENANT_A,
    principalId: ID.member,
    role: 'member',
    actor: { id: 'test-setup', workspaceRole: 'owner' },
  });
  const shared = repository.create(fixtureInput(), {
    owner: { tenantId: TENANT_A, ownerId: ID.lead },
  }).id;
  for (const [principalId, role] of [
    [ID.analyst, 'analyst'],
    [ID.reviewer, 'reviewer'],
    [ID.viewer, 'viewer'],
  ] as const) {
    repository.members.setProjectMember({
      projectId: shared,
      tenantId: TENANT_A,
      principalId,
      role,
      actor: { id: ID.lead },
    });
  }
  holdComparison(repository, shared);
  const call = async (as: Caller, project = shared) =>
    app.inject({
      method: 'GET',
      url: `/api/projects/${project}/decision`,
      headers: as === 'anonymous' ? {} : await authorization(TOKENS[as]),
    });
  return { call };
}

describe('who may read the canvas', () => {
  it('lets everyone who may read the project read it, and tells each whether they may run a comparison', async () => {
    const { call } = await securedWorld();
    for (const [caller, run] of [
      ['lead', true],
      ['analyst', true],
      ['reviewer', false],
      ['viewer', false],
    ] as const) {
      const response = await call(caller);
      expect(response.statusCode, caller).toBe(200);
      const body = response.json() as DecisionView;
      expect(body.canvas, caller).not.toBeNull();
      expect(body.may, caller).toEqual({ run, export: true });
    }
  });

  it('keeps it from anyone who was not added, and from another workspace, as if the project were not there', async () => {
    const { call } = await securedWorld();
    const absent = '99999999-9999-4999-8999-999999999999';
    for (const caller of ['member', 'foreign'] as const) {
      const hidden = await call(caller);
      expect(hidden.statusCode, caller).toBe(404);
      const missing = await call(caller, absent);
      expect([hidden.statusCode, hidden.json().error.code, hidden.json().error.message]).toEqual([
        missing.statusCode,
        missing.json().error.code,
        missing.json().error.message,
      ]);
      expect(hidden.body).not.toContain('canvas');
    }
  });

  it('refuses a caller who is not signed in', async () => {
    const { call } = await securedWorld();
    expect((await call('anonymous')).statusCode).toBe(401);
  });
});
