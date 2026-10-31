import { afterEach, describe, expect, it } from 'vitest';
import type { StudioView } from '../../shared/studio.js';
import { buildApp } from '../src/app.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import { fixtureInput, testConfig } from './fixtures.js';
import {
  TENANT_A,
  TENANT_B,
  authorization,
  entraEnvironment,
  idp,
  type Minted,
} from './support/entra-idp.js';
import { CANARY, generatedReport } from './support/studio-world.js';

// What each role can do in Report Studio, with real sign-in: the author writes, the reviewer judges,
// and neither can do the other's part. The table of routes and capabilities is checked in
// membership.test.ts; this drives the workflow as each person would, and checks what a person who may
// not see the report is told.

const ID = {
  lead: 'e0000001-0000-4000-8000-000000000001',
  analyst: 'e0000002-0000-4000-8000-000000000002',
  reviewer: 'e0000003-0000-4000-8000-000000000003',
  viewer: 'e0000004-0000-4000-8000-000000000004',
  member: 'e0000005-0000-4000-8000-000000000005',
  foreign: 'f0000001-0000-4000-8000-000000000001',
  platform: 'e0000006-0000-4000-8000-000000000006',
} as const;

type Actor = keyof typeof ID | 'anonymous';
const TOKENS: Record<Exclude<Actor, 'anonymous'>, Minted> = {
  lead: { oid: ID.lead, roles: ['Swarm.User'] },
  analyst: { oid: ID.analyst, roles: ['Swarm.User'] },
  reviewer: { oid: ID.reviewer, roles: ['Swarm.User'] },
  viewer: { oid: ID.viewer, roles: ['Swarm.User'] },
  member: { oid: ID.member, roles: ['Swarm.User'] },
  foreign: { tid: TENANT_B, oid: ID.foreign, roles: ['Swarm.User'] },
  platform: { oid: ID.platform, roles: ['Swarm.PlatformAdmin'] },
};

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function world() {
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
  const make = (ownerId: string, tenantId: string) => {
    const created = repository.create(fixtureInput({ workflow: 'guided' }), {
      owner: { tenantId, ownerId },
    });
    repository.update(created.id, { status: 'completed', report: generatedReport() });
    return created.id;
  };
  const shared = make(ID.lead, TENANT_A);
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
  // A colleague's report that nobody on the first project was added to, and a foreign tenant's.
  const other = make(ID.member, TENANT_A);
  const foreign = make(ID.foreign, TENANT_B);

  const call = async (
    as: Actor,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    payload?: unknown,
    project = shared,
  ) =>
    app.inject({
      method,
      url: `/api/projects/${project}${path}`,
      headers: as === 'anonymous' ? {} : await authorization(TOKENS[as]),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const view = async (as: Actor, project = shared): Promise<StudioView> =>
    (await call(as, 'GET', '/studio', undefined, project)).json();
  const revision = async (as: Actor): Promise<number> => (await view(as)).document!.revision;
  return { ...instance, shared, other, foreign, call, view, revision };
}

const forbidden = (response: { statusCode: number; json: () => { error: { code: string } } }) => [
  response.statusCode,
  response.json().error.code,
];

describe('the author writes and the reviewer judges', () => {
  it('goes from an analyst’s edit through a reviewer’s decision, each doing only their part', async () => {
    const { call, view, revision } = await world();
    expect((await call('analyst', 'POST', '/studio', {})).statusCode).toBe(201);

    // The author writes and submits; the author cannot approve or leave a reviewer’s note.
    expect(
      (
        await call('analyst', 'PUT', '/studio/sections/S1', {
          body: 'The analyst’s chapter text.',
          expectedVersion: 1,
          reason: null,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call('analyst', 'POST', '/studio/submit', {
          expectedRevision: await revision('analyst'),
          note: null,
        })
      ).statusCode,
    ).toBe(200);
    for (const [path, payload] of [
      ['/studio/approve', { expectedRevision: await revision('analyst'), note: null }],
      [
        '/studio/request-changes',
        { expectedRevision: await revision('analyst'), note: 'Not good.' },
      ],
      ['/studio/sections/S1/notes', { text: 'My own review of my own text.' }],
    ] as const) {
      expect(forbidden(await call('analyst', 'POST', path, payload)), path).toEqual([
        403,
        'FORBIDDEN',
      ]);
    }

    // The reviewer reads, notes and decides; the reviewer cannot change what they review.
    for (const [method, path, payload] of [
      [
        'PUT',
        '/studio/sections/S1',
        { body: 'A reviewer’s rewrite.', expectedVersion: 2, reason: null },
      ],
      ['PUT', '/studio/sections/S1/lock', { locked: true }],
      ['POST', '/studio/sections/S1/restore', { version: 1, expectedVersion: 2, reason: null }],
      ['POST', '/studio/sections/S1/regenerate', { expectedVersion: 2, instruction: null }],
      [
        'POST',
        '/studio/sections/S1/proposal',
        { decision: 'accept', proposalId: 'x', expectedVersion: 2 },
      ],
      ['POST', '/studio/submit', { expectedRevision: await revision('reviewer'), note: null }],
      [
        'POST',
        '/studio/reopen',
        { expectedRevision: await revision('reviewer'), note: 'Reopening it.' },
      ],
      ['POST', '/studio', {}],
    ] as const) {
      expect(forbidden(await call('reviewer', method, path, payload)), `${method} ${path}`).toEqual(
        [403, 'FORBIDDEN'],
      );
    }
    expect(
      (await call('reviewer', 'POST', '/studio/sections/S1/notes', { text: 'Check this.' }))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await call('reviewer', 'POST', '/studio/request-changes', {
          expectedRevision: await revision('reviewer'),
          note: 'The chapter needs its sources.',
        })
      ).statusCode,
    ).toBe(200);
    expect((await view('reviewer')).document!.state).toBe('changes-requested');

    // The author fixes it, submits it again, and the reviewer approves it.
    await call('analyst', 'PUT', '/studio/sections/S1', {
      body: 'The analyst’s chapter text, with its sources.',
      expectedVersion: 2,
      reason: null,
    });
    await call('analyst', 'POST', '/studio/submit', {
      expectedRevision: await revision('analyst'),
      note: null,
    });
    const approved = await call('reviewer', 'POST', '/studio/approve', {
      expectedRevision: await revision('reviewer'),
      note: null,
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const doc = (await view('viewer')).document!;
    expect(doc).toMatchObject({
      state: 'approved',
      approval: { actor: ID.reviewer, alsoEdited: false },
    });
    // Who wrote what is on the record: the generated text is the system’s, the edits are the analyst’s.
    expect(doc.sections.find((s) => s.id === 'S1')!.versions.map((v) => v.actor)).toEqual([
      'system',
      ID.analyst,
      ID.analyst,
    ]);
    expect(doc.decisions.map((d) => [d.action, d.actor])).toEqual([
      ['started', ID.analyst],
      ['submitted', ID.analyst],
      ['changes-requested', ID.reviewer],
      ['submitted', ID.analyst],
      ['approved', ID.reviewer],
    ]);
  });

  it('records, rather than forbids, a lead who approves their own work', async () => {
    const { call, view, revision } = await world();
    await call('lead', 'POST', '/studio', {});
    await call('lead', 'PUT', '/studio/sections/S2', {
      body: 'The lead’s text.',
      expectedVersion: 1,
      reason: null,
    });
    await call('lead', 'POST', '/studio/submit', {
      expectedRevision: await revision('lead'),
      note: null,
    });
    expect(
      (
        await call('lead', 'POST', '/studio/approve', {
          expectedRevision: await revision('lead'),
          note: null,
        })
      ).statusCode,
    ).toBe(200);
    expect((await view('lead')).document!.approval).toMatchObject({
      actor: ID.lead,
      alsoEdited: true,
    });
  });

  it('tells each person what they may do, so that the page can show only that', async () => {
    const { call, view } = await world();
    await call('lead', 'POST', '/studio', {});
    const seen = Object.fromEntries(
      await Promise.all(
        (['lead', 'analyst', 'reviewer', 'viewer'] as const).map(
          async (as) => [as, (await view(as)).capabilities] as const,
        ),
      ),
    );
    expect(seen).toEqual({
      lead: { edit: true, review: true, export: true },
      analyst: { edit: true, review: false, export: true },
      reviewer: { edit: false, review: true, export: true },
      viewer: { edit: false, review: false, export: true },
    });
  });

  it('lets a viewer read and export, and nothing else', async () => {
    const { call, view } = await world();
    await call('lead', 'POST', '/studio', {});
    expect((await view('viewer')).document).not.toBeNull();
    for (const format of ['markdown', 'json', 'memo']) {
      expect(
        (await call('viewer', 'GET', `/studio/export?format=${format}`)).statusCode,
        format,
      ).toBe(200);
    }
    for (const [method, path, payload] of [
      ['POST', '/studio', {}],
      [
        'PUT',
        '/studio/sections/S1',
        { body: 'A viewer’s edit.', expectedVersion: 1, reason: null },
      ],
      ['POST', '/studio/sections/S1/notes', { text: 'A viewer’s note.' }],
      ['POST', '/studio/submit', { expectedRevision: 1, note: null }],
      ['POST', '/studio/approve', { expectedRevision: 1, note: null }],
    ] as const) {
      expect(forbidden(await call('viewer', method, path, payload)), `${method} ${path}`).toEqual([
        403,
        'FORBIDDEN',
      ]);
    }
  });

  it('records the person who exported, and what they exported, in the audit log', async () => {
    const { call, repository, shared } = await world();
    await call('lead', 'POST', '/studio', {});
    await call('viewer', 'GET', '/studio/export?format=memo');
    const exported = repository.audit
      .list({ projectId: shared, limit: 200 })
      .filter((event) => event.action === 'studio.exported');
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ actor: ID.viewer, detail: { format: 'memo' } });
  });
});

describe('who may not see the report at all', () => {
  const routes: [string, string, string, unknown?][] = [
    ['read it', 'GET', '/studio'],
    ['open it', 'POST', '/studio', {}],
    [
      'edit a section',
      'PUT',
      '/studio/sections/S1',
      { body: 'Text.', expectedVersion: 1, reason: null },
    ],
    ['lock a section', 'PUT', '/studio/sections/S1/lock', { locked: true }],
    ['add a note', 'POST', '/studio/sections/S1/notes', { text: 'A note.' }],
    [
      'restore a version',
      'POST',
      '/studio/sections/S1/restore',
      { version: 1, expectedVersion: 1, reason: null },
    ],
    [
      'regenerate',
      'POST',
      '/studio/sections/S1/regenerate',
      { expectedVersion: 1, instruction: null },
    ],
    [
      'decide on regenerated text',
      'POST',
      '/studio/sections/S1/proposal',
      { decision: 'reject', proposalId: 'p', expectedVersion: 1 },
    ],
    ['submit', 'POST', '/studio/submit', { expectedRevision: 1, note: null }],
    ['approve', 'POST', '/studio/approve', { expectedRevision: 1, note: null }],
    ['send back', 'POST', '/studio/request-changes', { expectedRevision: 1, note: 'No.' }],
    ['reopen', 'POST', '/studio/reopen', { expectedRevision: 1, note: 'Reopen.' }],
    ['export', 'GET', '/studio/export?format=json'],
  ];

  it('tells a colleague who was not added, another workspace and a platform administrator that it does not exist', async () => {
    const { call, repository, shared } = await world();
    await call('lead', 'POST', '/studio', {});
    const missing = await call(
      'lead',
      'GET',
      '/studio',
      undefined,
      '99999999-9999-4999-8999-999999999999',
    );
    for (const as of ['member', 'foreign', 'platform'] as const) {
      for (const [name, method, path, payload] of routes) {
        const response = await call(as, method as 'GET', path, payload);
        expect([response.statusCode, response.json().error.code], `${as} ${name}`).toEqual([
          404,
          'PROJECT_NOT_FOUND',
        ]);
        // The answer is the one a project that does not exist gives, word for word.
        expect(response.json().error.message, `${as} ${name}`).toBe(missing.json().error.message);
      }
    }
    // Nothing they tried changed anything.
    expect(repository.studio.get(shared)!.revision).toBe(1);
  });

  it('refuses a request with no sign-in, on every route', async () => {
    const { call } = await world();
    for (const [name, method, path, payload] of routes) {
      const response = await call('anonymous', method as 'GET', path, payload);
      expect([response.statusCode, response.json().error.code], name).toEqual([
        401,
        'UNAUTHENTICATED',
      ]);
    }
  });

  it('keeps one project’s studio out of another’s: a report is only ever reached through its own project', async () => {
    const { call, view, other, shared } = await world();
    await call('lead', 'POST', '/studio', {});
    await call('member', 'POST', '/studio', {}, other);
    await call(
      'member',
      'PUT',
      '/studio/sections/S1',
      { body: `The colleague’s private text ${CANARY}.`, expectedVersion: 1, reason: null },
      other,
    );
    // The reviewer of the first report asks for the second by every route there is.
    for (const [name, method, path, payload] of routes) {
      const response = await call('reviewer', method as 'GET', path, payload, other);
      expect(response.statusCode, name).toBe(404);
      expect(response.body, name).not.toContain(CANARY);
    }
    // And a section or a proposal of the second, named on the first, is the first’s own or nothing.
    const attempt = await call('analyst', 'POST', '/studio/sections/S1/proposal', {
      decision: 'accept',
      proposalId: other,
      expectedVersion: 1,
    });
    expect(attempt.statusCode).toBe(404);
    expect(attempt.json().error.code).toBe('PROPOSAL_NOT_FOUND');
    expect((await view('lead', shared)).document!.sections.find((s) => s.id === 'S1')!.body).toBe(
      'Body of the evidence chapter.',
    );
  });

  it('takes effect on the next request when someone is removed', async () => {
    const { call, shared } = await world();
    await call('lead', 'POST', '/studio', {});
    expect((await call('analyst', 'GET', '/studio')).statusCode).toBe(200);
    expect((await call('lead', 'DELETE', `/members/${ID.analyst}`)).statusCode).toBe(200);
    const after = await call('analyst', 'PUT', '/studio/sections/S1', {
      body: 'Text after removal.',
      expectedVersion: 1,
      reason: null,
    });
    expect([after.statusCode, after.json().error.code]).toEqual([404, 'PROJECT_NOT_FOUND']);
    expect(shared).toBeTruthy();
  });
});
