import { afterEach, describe, expect, it } from 'vitest';
import {
  analysisFixture,
  actorSetFixture,
  scenarioFixture,
  stakeholderSetFixture,
} from '../../shared/lab-fixtures.js';
import type { BriefView } from '../../shared/brief.js';
import { decisionBriefSchema } from '../../shared/brief.js';
import { APP_VERSION } from '../../shared/types.js';
import { buildApp } from '../src/app.js';
import { policyFor, ROUTE_POLICY } from '../src/auth/policy.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import type { Repository } from '../src/storage/repository.js';
import { BRIEF_CSP } from '../src/brief/export.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { critiquesFixture } from './support/brief-world.js';
import {
  TENANT_A,
  TENANT_B,
  authorization,
  entraEnvironment,
  idp,
  type Minted,
} from './support/entra-idp.js';

// The routes that make, read and hand over the decision brief. What each kind of person may do is
// checked here with real sign-in; the table of every route is in membership.test.ts.

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

/** What a project holds once an analysis has run: a scenario, stakeholders, actors and the analysis. */
function holdAnalysis(repository: Repository, projectId: string, analysisId = 'analysis-1'): void {
  const { artifacts } = repository;
  artifacts.put(projectId, 'scenario', 'default', scenarioFixture());
  artifacts.put(projectId, 'stakeholders', 'default', stakeholderSetFixture());
  artifacts.put(projectId, 'actors', 'default', actorSetFixture());
  artifacts.put(projectId, 'analysis', analysisId, analysisFixture({ id: analysisId }));
}

async function localWorld() {
  const instance = await buildApp({ config: testConfig({ LOG_LEVEL: 'silent' }) });
  applications.push(instance);
  const project = instance.repository.create(fixtureInput());
  const url = `/api/projects/${project.id}/brief`;
  const get = async (path = '') => instance.app.inject({ method: 'GET', url: `${url}${path}` });
  const post = async (payload: unknown = {}) =>
    instance.app.inject({ method: 'POST', url, payload: payload as object });
  const view = async () => (await get()).json() as BriefView;
  return { ...instance, project, url, get, post, view };
}

describe('reading the brief of a project that has none', () => {
  it('answers 200 with no brief, and says whether an analysis is there to make one from', async () => {
    const { get, view, project, repository } = await localWorld();
    const empty = await get();
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      brief: null,
      visuals: null,
      latestAnalysis: null,
      changedSince: [],
      may: { generate: true, export: true },
    });
    holdAnalysis(repository, project.id);
    expect((await view()).latestAnalysis).toEqual({
      id: 'analysis-1',
      completedAt: analysisFixture().completedAt,
    });
    expect((await view()).brief).toBeNull();
  });

  it('answers 409 in plain words when asked to make one without a completed analysis', async () => {
    const { post, repository, project } = await localWorld();
    const refused = await post();
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({ code: 'NO_ANALYSIS' });
    expect(refused.json().error.message).toBe(
      'There is no completed analysis to write a brief from. Run the analysis in the Simulation stage first.',
    );
    // One that has not finished is not one to write from.
    repository.artifacts.put(
      project.id,
      'analysis',
      'analysis-1',
      analysisFixture({ status: 'running', completedAt: null }),
    );
    expect((await post()).statusCode).toBe(409);
    expect((await post()).json().error.code).toBe('NO_ANALYSIS');
    expect((await post({ analysisId: 'analysis-1' })).json().error.code).toBe(
      'ANALYSIS_NOT_COMPLETED',
    );
  });

  it('answers 409 when exporting a brief that was never made, and 404 for a project that is not there', async () => {
    const { get, app } = await localWorld();
    const none = await get('/export');
    expect(none.statusCode).toBe(409);
    expect(none.json().error.code).toBe('BRIEF_NOT_GENERATED');
    for (const [method, suffix] of [
      ['GET', ''],
      ['POST', ''],
      ['GET', '/export'],
    ] as const) {
      const absent = await app.inject({
        method,
        url: `/api/projects/00000000-0000-4000-8000-000000000000/brief${suffix}`,
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect(absent.statusCode, `${method} ${suffix}`).toBe(404);
      expect(absent.json().error.code).toBe('PROJECT_NOT_FOUND');
    }
  });

  it('refuses a malformed analysis id and an unknown export format, and one that names an analysis that is not there', async () => {
    const { get, post, repository, project } = await localWorld();
    holdAnalysis(repository, project.id);
    expect((await post({ analysisId: 'Not An Id!' })).statusCode).toBe(400);
    const missing = await post({ analysisId: 'other-analysis' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('ANALYSIS_NOT_FOUND');
    expect((await post()).statusCode).toBe(201);
    expect((await get('/export?format=pdf')).statusCode).toBe(400);
  });
});

describe('making the brief', () => {
  it('makes it from the newest completed analysis, stores it with the revisions it came from, and answers with the page as it now is', async () => {
    const { post, view, repository, project } = await localWorld();
    holdAnalysis(repository, project.id);
    const made = await post();
    expect(made.statusCode, made.body).toBe(201);
    const body = made.json() as BriefView;
    expect(body.brief?.analysisId).toBe('analysis-1');
    expect(body.brief?.sections).toHaveLength(17);
    expect(body.brief?.question).toBe(fixtureInput().question);
    expect(body.visuals?.analysisId).toBe('analysis-1');
    expect(body.changedSince).toEqual([]);
    expect(body.may).toEqual({ generate: true, export: true });
    const stored = repository.artifacts.get(project.id, 'brief');
    expect(stored?.revision).toBe(1);
    expect(decisionBriefSchema.safeParse(stored?.data).success).toBe(true);
    expect(stored?.data.inputRevisions).toEqual({
      scenario: 1,
      stakeholders: 1,
      actors: 1,
      analysis: 1,
      critiques: 0,
    });
    expect(await view()).toEqual(body);
    // Making it again replaces it.
    expect((await post()).statusCode).toBe(201);
    expect(repository.artifacts.get(project.id, 'brief')?.revision).toBe(2);
  });

  it('uses the sources the project holds: their provenance and any conflict between them', async () => {
    const { post, repository, project } = await localWorld();
    holdAnalysis(repository, project.id);
    const made = (await post()).json() as BriefView;
    const sources = made.brief!.sections.find((section) => section.id === 'sources')!.statements;
    expect(sources[0]?.text).toContain('transit-notes.md');
    expect(sources[0]?.text).toContain('Supplied by the person.');
    expect(sources[0]?.origin).toBe('supplied-evidence');
    expect(made.visuals?.lookups.documents[0]).toMatchObject({
      name: 'transit-notes.md',
      origin: 'supplied-evidence',
    });
    const base = made.brief!.sections.find((section) => section.id === 'evidence-base')!.statements;
    expect(base.map((statement) => statement.text).join(' ')).toMatch(
      /conflict between the supplied sources was detected|Open conflict between sources/u,
    );
  });

  it('can be made from an older analysis by naming it, and says when a newer one exists', async () => {
    const { post, view, repository, project } = await localWorld();
    holdAnalysis(repository, project.id);
    repository.artifacts.put(
      project.id,
      'analysis',
      'analysis-2',
      analysisFixture({ id: 'analysis-2', completedAt: '2026-03-01T10:00:00.000Z' }),
    );
    expect((await view()).latestAnalysis?.id).toBe('analysis-2');
    expect(((await post()).json() as BriefView).brief?.analysisId).toBe('analysis-2');
    const older = (await post({ analysisId: 'analysis-1' })).json() as BriefView;
    expect(older.brief?.analysisId).toBe('analysis-1');
    expect(older.changedSince).toEqual(['a newer analysis exists']);
  });

  it('says which inputs changed since the brief was made', async () => {
    const { post, view, repository, project } = await localWorld();
    holdAnalysis(repository, project.id);
    await post();
    expect((await view()).changedSince).toEqual([]);
    repository.artifacts.put(project.id, 'stakeholders', 'default', stakeholderSetFixture());
    repository.artifacts.put(project.id, 'critiques', 'default', critiquesFixture());
    expect((await view()).changedSince).toEqual(['stakeholders', 'critiques']);
    repository.artifacts.delete(project.id, 'analysis', 'analysis-1');
    const gone = await view();
    expect(gone.changedSince).toContain('analysis (no longer stored)');
    expect(gone.visuals).toBeNull();
    expect(gone.brief).not.toBeNull();
  });

  it('never reads an analysis of another project', async () => {
    const { post, repository, app } = await localWorld();
    const other = repository.create(fixtureInput({ name: 'Another project' }));
    holdAnalysis(repository, other.id, 'their-analysis');
    const refused = await post({ analysisId: 'their-analysis' });
    expect(refused.statusCode).toBe(404);
    expect(refused.json().error.code).toBe('ANALYSIS_NOT_FOUND');
    expect(app).toBeDefined();
  });
});

describe('handing the brief over', () => {
  async function made() {
    const world = await localWorld();
    holdAnalysis(world.repository, world.project.id);
    world.repository.artifacts.put(world.project.id, 'critiques', 'default', critiquesFixture());
    await world.post();
    return world;
  }

  it('gives Markdown by default, with a download name, and refuses to be sniffed or cached', async () => {
    const { get } = await made();
    for (const response of [await get('/export'), await get('/export?format=md')]) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/markdown');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="swarm-decision-brief.md"',
      );
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.startsWith('# Decision brief: Community transit pilot')).toBe(true);
      expect(response.body).toContain('Synthetic actors are not real people');
    }
  });

  it('gives JSON with its provenance, and the brief reads back as the one that is stored', async () => {
    const { get, repository, project } = await made();
    const response = await get('/export?format=json');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="swarm-decision-brief.json"',
    );
    const json = response.json();
    expect(json.provenance).toMatchObject({
      appVersion: APP_VERSION,
      analysisId: 'analysis-1',
      generatedBy: 'rules',
      inputRevisions: { scenario: 1, stakeholders: 1, actors: 1, analysis: 1, critiques: 1 },
    });
    expect(json.provenance.generatedAt).toBe(
      repository.artifacts.get(project.id, 'brief')?.data.generatedAt,
    );
    expect(json.provenance.exportedAt).toMatch(/^\d{4}-\d\d-\d\dT/u);
    expect(decisionBriefSchema.parse(json.brief)).toEqual(
      repository.artifacts.get(project.id, 'brief')?.data,
    );
    expect(json.data.scenarioComparison).toHaveLength(1);
  });

  it('gives a printable page with the strict policy, no script and no resource to load', async () => {
    const { get } = await made();
    const response = await get('/export?format=html');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-security-policy']).toBe(BRIEF_CSP);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toBe(
      'inline; filename="swarm-decision-brief.html"',
    );
    expect(response.body).not.toMatch(/<script/iu);
    expect(response.body).not.toMatch(/\b(?:src|href)=/u);
    expect(response.body).toContain('Decision brief: Community transit pilot');
  });
});

describe('what the audit log keeps', () => {
  it('records that a brief was made and in which format it left, and never a word of it', async () => {
    const { post, get, repository, project } = await localWorld();
    holdAnalysis(repository, project.id);
    const made = (await post()).json() as BriefView;
    await get('/export');
    await get('/export?format=json');
    await get('/export?format=html');
    await get('/export?format=pdf');
    await get('');
    const entries = repository.audit
      .list({ projectId: project.id, limit: 500 })
      .filter((entry) => entry.action.startsWith('brief.'));
    expect(entries.map((entry) => [entry.action, entry.detail])).toEqual([
      ['brief.generated', {}],
      ['brief.exported', { format: 'md' }],
      ['brief.exported', { format: 'json' }],
      ['brief.exported', { format: 'html' }],
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        targetType: 'project',
        targetId: project.id,
        projectId: project.id,
      });
    }
    const everything = JSON.stringify(repository.audit.list({ projectId: project.id, limit: 500 }));
    expect(everything).not.toContain(fixtureInput().question);
    expect(everything).not.toContain(made.brief!.headline);
    expect(everything).not.toContain('Synthetic actors');
    expect(everything).not.toContain('Subscribers');
    expect(repository.audit.verify().ok).toBe(true);
  });

  it('records nothing for a request that was refused', async () => {
    const { post, get, repository, project } = await localWorld();
    await post();
    await get('/export');
    expect(
      repository.audit
        .list({ projectId: project.id, limit: 500 })
        .filter((entry) => entry.action.startsWith('brief.')),
    ).toEqual([]);
  });
});

describe('the policy table', () => {
  it('needs edit to make it, read to see it and export to hand it over', () => {
    expect(ROUTE_POLICY['GET /api/projects/:id/brief']).toEqual({
      kind: 'project',
      capability: 'read',
    });
    expect(ROUTE_POLICY['POST /api/projects/:id/brief']).toEqual({
      kind: 'project',
      capability: 'edit',
    });
    expect(ROUTE_POLICY['GET /api/projects/:id/brief/export']).toEqual({
      kind: 'project',
      capability: 'export',
    });
    expect(policyFor('HEAD', '/api/projects/:id/brief')).toBe(
      policyFor('GET', '/api/projects/:id/brief'),
    );
  });
});

// ---- Who may do what, with real sign-in

const ID = {
  lead: 'e1000001-0000-4000-8000-000000000001',
  analyst: 'e1000002-0000-4000-8000-000000000002',
  reviewer: 'e1000003-0000-4000-8000-000000000003',
  viewer: 'e1000004-0000-4000-8000-000000000004',
  member: 'e1000005-0000-4000-8000-000000000005',
  foreign: 'f1000001-0000-4000-8000-000000000001',
} as const;

type Actor = keyof typeof ID | 'anonymous';
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
  const setup = { id: 'test-setup', workspaceRole: 'owner' as const };
  repository.members.setWorkspaceMember({
    tenantId: TENANT_A,
    principalId: ID.member,
    role: 'member',
    actor: setup,
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
  holdAnalysis(instance.repository, shared);
  const call = async (as: Actor, method: 'GET' | 'POST', path: string, project = shared) =>
    app.inject({
      method,
      url: `/api/projects/${project}/brief${path}`,
      headers: as === 'anonymous' ? {} : await authorization(TOKENS[as]),
      ...(method === 'POST' ? { payload: {} } : {}),
    });
  return { ...instance, shared, call };
}

const shape = (response: {
  statusCode: number;
  json: () => { error?: { code: string; message: string } };
}) => [response.statusCode, response.json().error?.code, response.json().error?.message];

describe('who may make, read and hand over a brief', () => {
  const read: Actor[] = ['lead', 'analyst', 'reviewer', 'viewer'];

  it.each([
    ['lead', 201],
    ['analyst', 201],
    ['reviewer', 403],
    ['viewer', 403],
  ] as const)('lets %s make one: %i', async (actor, status) => {
    const { call, repository, shared } = await securedWorld();
    const response = await call(actor, 'POST', '');
    expect(response.statusCode, response.body).toBe(status);
    if (status === 403) {
      expect(response.json().error.code).toBe('FORBIDDEN');
      expect(repository.artifacts.get(shared, 'brief')).toBeNull();
    } else {
      expect(repository.artifacts.get(shared, 'brief')).not.toBeNull();
    }
  });

  it('lets everyone who may read the project read it, and tells each what they may do with it', async () => {
    const { call } = await securedWorld();
    await call('lead', 'POST', '');
    for (const actor of read) {
      const response = await call(actor, 'GET', '');
      expect(response.statusCode, actor).toBe(200);
      const body = response.json() as BriefView;
      expect(body.brief, actor).not.toBeNull();
      expect(body.may, actor).toEqual({
        generate: actor === 'lead' || actor === 'analyst',
        export: true,
      });
    }
  });

  it('lets everyone who may read the project hand it over, in every format', async () => {
    const { call, repository, shared } = await securedWorld();
    await call('lead', 'POST', '');
    for (const actor of read) {
      for (const format of ['md', 'json', 'html']) {
        const response = await call(actor, 'GET', `/export?format=${format}`);
        expect(response.statusCode, `${actor} ${format}`).toBe(200);
      }
    }
    const exported = repository.audit
      .list({ projectId: shared, limit: 500 })
      .filter((entry) => entry.action === 'brief.exported');
    expect(exported).toHaveLength(read.length * 3);
    for (const entry of exported) expect(['md', 'json', 'html']).toContain(entry.detail.format);
  });

  it('keeps it from anyone who was not added to the project, and from another workspace, as if it were not there', async () => {
    const { call } = await securedWorld();
    await call('lead', 'POST', '');
    const absent = '99999999-9999-4999-8999-999999999999';
    for (const actor of ['member', 'foreign'] as const) {
      for (const [method, path] of [
        ['GET', ''],
        ['POST', ''],
        ['GET', '/export'],
      ] as const) {
        const hidden = await call(actor, method, path);
        expect(hidden.statusCode, `${actor} ${method} ${path}`).toBe(404);
        expect(shape(hidden)).toEqual(shape(await call(actor, method, path, absent)));
      }
    }
  });

  it('refuses a caller who is not signed in', async () => {
    const { call } = await securedWorld();
    for (const [method, path] of [
      ['GET', ''],
      ['POST', ''],
      ['GET', '/export'],
    ] as const) {
      const response = await call('anonymous', method, path);
      expect(response.statusCode, `${method} ${path}`).toBe(401);
    }
  });
});
