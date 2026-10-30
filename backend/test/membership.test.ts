import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ROUTE_POLICY } from '../src/auth/policy.js';
import {
  PROJECT_CAPABILITIES,
  PROJECT_ROLES,
  WORKSPACE_ROLES,
  capabilitiesOf,
  mayManageWorkspaceRole,
  projectAllows,
  workspaceAllows,
  type ProjectCapability,
} from '../src/auth/roles.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import { MAX_PROJECT_MEMBERS } from '../src/storage/members.js';
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

// Who may see and do what, as a table. The expectations below are written out in full, on purpose:
// they are a second description of the permissions, and the test fails when the code and the table
// disagree, in either direction.

const ID = {
  owner: 'c0000001-0000-4000-8000-000000000001',
  wsAdmin: 'c0000002-0000-4000-8000-000000000002',
  lead: 'c0000003-0000-4000-8000-000000000003',
  analyst: 'c0000004-0000-4000-8000-000000000004',
  reviewer: 'c0000005-0000-4000-8000-000000000005',
  viewer: 'c0000006-0000-4000-8000-000000000006',
  member: 'c0000007-0000-4000-8000-000000000007',
  stranger: 'c0000008-0000-4000-8000-000000000008',
  platform: 'c0000009-0000-4000-8000-000000000009',
  foreignOwner: 'd0000001-0000-4000-8000-000000000001',
  newcomer: 'c000000a-0000-4000-8000-00000000000a',
} as const;

type Actor = Exclude<keyof typeof ID, 'newcomer'> | 'anonymous';

const TOKENS: Record<Exclude<Actor, 'anonymous'>, Minted> = {
  owner: { oid: ID.owner, roles: ['Swarm.User'] },
  wsAdmin: { oid: ID.wsAdmin, roles: ['Swarm.User'] },
  lead: { oid: ID.lead, roles: ['Swarm.User'] },
  analyst: { oid: ID.analyst, roles: ['Swarm.User'] },
  reviewer: { oid: ID.reviewer, roles: ['Swarm.User'] },
  viewer: { oid: ID.viewer, roles: ['Swarm.User'] },
  member: { oid: ID.member, roles: ['Swarm.User'] },
  // Signed in, with a Swarm app role, and added to nothing.
  stranger: { oid: ID.stranger, roles: ['Swarm.Reader'] },
  platform: { oid: ID.platform, roles: ['Swarm.PlatformAdmin'] },
  foreignOwner: { tid: TENANT_B, oid: ID.foreignOwner, roles: ['Swarm.User'] },
};

const ALL: readonly ProjectCapability[] = [
  'read',
  'export',
  'review',
  'run',
  'chat',
  'delete',
  'members',
];

/** What each actor may do to project 1, written out. Everyone else may do nothing, and sees nothing. */
const CAN: Record<Actor, readonly ProjectCapability[]> = {
  owner: ALL,
  wsAdmin: ALL,
  lead: ALL,
  analyst: ['read', 'export', 'run', 'chat'],
  reviewer: ['read', 'export', 'review'],
  viewer: ['read', 'export'],
  member: [],
  stranger: [],
  platform: [],
  foreignOwner: [],
  anonymous: [],
};

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

type World = Awaited<ReturnType<typeof world>>;

/** A workspace with a person in every role, and two projects: one they share and one they do not. */
async function world(options: { enroll?: boolean } = {}) {
  const config = testConfig({ ...entraEnvironment, LOG_LEVEL: 'silent' });
  const instance = await buildApp({
    config,
    tokenVerifier: new TokenVerifier(config.auth, idp.keys),
  });
  applications.push(instance);
  const { repository } = instance;
  const setup = { id: 'test-setup', workspaceRole: 'owner' as const };
  const enroll = (tenantId: string, principalId: string, role: 'owner' | 'admin' | 'member') =>
    repository.members.setWorkspaceMember({ tenantId, principalId, role, actor: setup });
  if (options.enroll !== false) {
    enroll(TENANT_A, ID.owner, 'owner');
    enroll(TENANT_A, ID.wsAdmin, 'admin');
    enroll(TENANT_A, ID.member, 'member');
    enroll(TENANT_B, ID.foreignOwner, 'owner');
  }
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
  // A colleague's project, which the analyst, reviewer and viewer were never added to.
  const private_ = repository.create(fixtureInput({ workflow: 'guided' }), {
    owner: { tenantId: TENANT_A, ownerId: ID.member },
  });
  const foreign = repository.create(fixtureInput({ workflow: 'guided' }), {
    owner: { tenantId: TENANT_B, ownerId: ID.foreignOwner },
  });
  return { ...instance, shared: shared.id, private: private_.id, foreign: foreign.id };
}

async function call(
  instance: World,
  as: Actor | Minted,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  const claims = as === 'anonymous' ? null : typeof as === 'string' ? TOKENS[as] : as;
  return instance.app.inject({
    method,
    url,
    headers: claims ? await authorization(claims) : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

type Outcome = 'allowed' | 'forbidden' | 'hidden' | 'unauthenticated';

/** The part of a failure a caller can compare: the request id differs on every request. */
function shape(response: { json: () => { error: { code: string; message: string } } }) {
  const { code, message } = response.json().error;
  return { code, message };
}

/** What the guard did, whatever the handler went on to say. */
function outcome(response: {
  statusCode: number;
  json: () => { error?: { code?: string } };
}): Outcome {
  if (response.statusCode === 401) return 'unauthenticated';
  const code = response.statusCode >= 400 ? response.json().error?.code : undefined;
  if (code === 'PROJECT_NOT_FOUND') return 'hidden';
  if (response.statusCode === 403 && code === 'FORBIDDEN') return 'forbidden';
  return 'allowed';
}

function expected(actor: Actor, capability: ProjectCapability): Outcome {
  if (actor === 'anonymous') return 'unauthenticated';
  if (CAN[actor].length === 0) return 'hidden';
  return CAN[actor].includes(capability) ? 'allowed' : 'forbidden';
}

describe('the roles, as a table', () => {
  it('gives each project role exactly the capabilities written here', () => {
    expect(capabilitiesOf('viewer')).toEqual(['read', 'export']);
    expect(capabilitiesOf('reviewer')).toEqual(['read', 'export', 'review']);
    expect(capabilitiesOf('analyst')).toEqual(['read', 'export', 'run', 'chat']);
    expect(capabilitiesOf('lead')).toEqual(ALL);
    expect([...PROJECT_ROLES]).toEqual(['lead', 'analyst', 'reviewer', 'viewer']);
    expect([...WORKSPACE_ROLES]).toEqual(['owner', 'admin', 'member']);
    expect([...PROJECT_CAPABILITIES]).toEqual(ALL);
  });

  it('keeps reviewing apart from running: nobody below a lead can do both', () => {
    for (const role of ['viewer', 'reviewer', 'analyst'] as const) {
      const may = capabilitiesOf(role);
      expect(may.includes('run') && may.includes('review'), role).toBe(false);
    }
  });

  it('gives workspace owners and admins every capability on every project, and members none', () => {
    for (const capability of ALL) {
      for (const workspace of ['owner', 'admin'] as const) {
        expect(projectAllows(capability, { project: null, workspace })).toBe(true);
      }
      expect(projectAllows(capability, { project: null, workspace: 'member' })).toBe(false);
      expect(projectAllows(capability, { project: null, workspace: null })).toBe(false);
    }
  });

  it('lets any member create projects, and only owners and admins manage members', () => {
    expect(workspaceAllows('create-project', 'member')).toBe(true);
    expect(workspaceAllows('create-project', null)).toBe(false);
    expect(workspaceAllows('manage-members', 'member')).toBe(false);
    expect(workspaceAllows('manage-members', 'admin')).toBe(true);
    expect(workspaceAllows('manage-members', 'owner')).toBe(true);
  });

  it('lets only an owner grant, change or take away the owner role', () => {
    expect(mayManageWorkspaceRole('owner', 'owner')).toBe(true);
    expect(mayManageWorkspaceRole('admin', 'owner')).toBe(false);
    expect(mayManageWorkspaceRole('admin', 'admin')).toBe(true);
    expect(mayManageWorkspaceRole('admin', 'member')).toBe(true);
    expect(mayManageWorkspaceRole('member', 'member')).toBe(false);
    expect(mayManageWorkspaceRole(null, 'member')).toBe(false);
  });
});

describe('every project route, for every kind of person', () => {
  const routes: {
    name: string;
    policy: string;
    capability: ProjectCapability;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: (id: string) => string;
    payload?: unknown;
  }[] = [
    {
      name: 'read it',
      policy: 'GET /api/projects/:id',
      capability: 'read',
      method: 'GET',
      url: (id) => `/api/projects/${id}`,
    },
    {
      name: 'read its ledger',
      policy: 'GET /api/projects/:id/ledger',
      capability: 'read',
      method: 'GET',
      url: (id) => `/api/projects/${id}/ledger`,
    },
    {
      name: 'read one statement',
      policy: 'GET /api/projects/:id/claims/:claimId',
      capability: 'read',
      method: 'GET',
      url: (id) => `/api/projects/${id}/claims/C1`,
    },
    {
      name: 'read its passages',
      policy: 'GET /api/projects/:id/evidence',
      capability: 'read',
      method: 'GET',
      url: (id) => `/api/projects/${id}/evidence?query=transit`,
    },
    {
      name: 'read its memories',
      policy: 'GET /api/projects/:id/memories',
      capability: 'read',
      method: 'GET',
      url: (id) => `/api/projects/${id}/memories`,
    },
    {
      name: 'read its conversation',
      policy: 'GET /api/projects/:id/chat',
      capability: 'read',
      method: 'GET',
      url: (id) => `/api/projects/${id}/chat?target=report`,
    },
    {
      name: 'list who has access',
      policy: 'GET /api/projects/:id/members',
      capability: 'read',
      method: 'GET',
      url: (id) => `/api/projects/${id}/members`,
    },
    {
      name: 'export it as JSON',
      policy: 'GET /api/projects/:id/export',
      capability: 'export',
      method: 'GET',
      url: (id) => `/api/projects/${id}/export?format=json`,
    },
    {
      name: 'review a statement',
      policy: 'POST /api/projects/:id/claims/:claimId/review',
      capability: 'review',
      method: 'POST',
      url: (id) => `/api/projects/${id}/claims/C1/review`,
      payload: {},
    },
    {
      name: 'review a conflict',
      policy: 'POST /api/projects/:id/conflicts/:conflictId/review',
      capability: 'review',
      method: 'POST',
      url: (id) => `/api/projects/${id}/conflicts/X1/review`,
      payload: {},
    },
    {
      name: 'read its audit trail',
      policy: 'GET /api/projects/:id/audit',
      capability: 'review',
      method: 'GET',
      url: (id) => `/api/projects/${id}/audit`,
    },
    {
      name: 'start a stage',
      policy: 'POST /api/projects/:id/steps/:step',
      capability: 'run',
      method: 'POST',
      url: (id) => `/api/projects/${id}/steps/knowledge`,
      payload: { resume: 'not a boolean' },
    },
    {
      name: 'pause a run',
      policy: 'POST /api/projects/:id/pause',
      capability: 'run',
      method: 'POST',
      url: (id) => `/api/projects/${id}/pause`,
    },
    {
      name: 'cancel a run',
      policy: 'POST /api/projects/:id/cancel',
      capability: 'run',
      method: 'POST',
      url: (id) => `/api/projects/${id}/cancel`,
    },
    {
      name: 'schedule an intervention',
      policy: 'PUT /api/projects/:id/intervention',
      capability: 'run',
      method: 'PUT',
      url: (id) => `/api/projects/${id}/intervention`,
      payload: { invalid: true },
    },
    {
      name: 'edit the environment',
      policy: 'PATCH /api/projects/:id/environment',
      capability: 'run',
      method: 'PATCH',
      url: (id) => `/api/projects/${id}/environment`,
      payload: { invalid: true },
    },
    {
      name: 'branch it',
      policy: 'POST /api/projects/:id/branches',
      capability: 'run',
      method: 'POST',
      url: (id) => `/api/projects/${id}/branches`,
      payload: { invalid: true },
    },
    {
      name: 'ask the analyst or an actor',
      policy: 'POST /api/projects/:id/chat',
      capability: 'chat',
      method: 'POST',
      url: (id) => `/api/projects/${id}/chat`,
      payload: { invalid: true },
    },
    {
      name: 'survey every actor',
      policy: 'POST /api/projects/:id/surveys',
      capability: 'chat',
      method: 'POST',
      url: (id) => `/api/projects/${id}/surveys`,
      payload: { invalid: true },
    },
    {
      name: 'change who has access',
      policy: 'PUT /api/projects/:id/members/:principalId',
      capability: 'members',
      method: 'PUT',
      url: (id) => `/api/projects/${id}/members/${ID.newcomer}`,
      payload: { role: 'viewer' },
    },
    {
      name: 'take access away',
      policy: 'DELETE /api/projects/:id/members/:principalId',
      capability: 'members',
      method: 'DELETE',
      url: (id) => `/api/projects/${id}/members/${ID.newcomer}`,
    },
  ];

  it('is the policy table: each route needs the capability written beside it here', () => {
    for (const route of routes) {
      expect(ROUTE_POLICY[route.policy], route.policy).toEqual({
        kind: 'project',
        capability: route.capability,
      });
    }
    expect(ROUTE_POLICY['DELETE /api/projects/:id']).toEqual({
      kind: 'project',
      capability: 'delete',
    });
  });

  const actors = Object.keys(CAN) as Actor[];

  it.each(actors)('does what the table says for %s', async (actor) => {
    const instance = await world();
    const seen: string[] = [];
    for (const route of routes) {
      const response = await call(
        instance,
        actor,
        route.method,
        route.url(instance.shared),
        route.payload,
      );
      const got = outcome(response);
      const want = expected(actor, route.capability);
      if (got !== want)
        seen.push(
          `${actor} may ${route.name}: expected ${want}, got ${got} (${response.statusCode})`,
        );
      // A hidden project looks exactly like one that does not exist.
      if (want === 'hidden') {
        const absent = await call(
          instance,
          actor,
          route.method,
          route.url('99999999-9999-4999-8999-999999999999'),
          route.payload,
        );
        expect(shape(response), `${actor} ${route.name}`).toEqual(shape(absent));
      }
    }
    expect(seen).toEqual([]);
    await instance.jobs.idle();
  });

  it.each(actors)('deletes a project only if %s may', async (actor) => {
    const instance = await world();
    const response = await call(instance, actor, 'DELETE', `/api/projects/${instance.shared}`);
    expect(outcome(response)).toBe(expected(actor, 'delete'));
    const exists = instance.repository.ownership(instance.shared) !== null;
    expect(exists).toBe(expected(actor, 'delete') !== 'allowed');
  });

  it('keeps a person who is on one project out of another, whatever they are called there', async () => {
    const instance = await world();
    for (const actor of ['lead', 'analyst', 'reviewer', 'viewer'] as const) {
      for (const route of routes) {
        const response = await call(
          instance,
          actor,
          route.method,
          route.url(instance.private),
          route.payload,
        );
        expect(
          outcome(response),
          `${actor} may ${route.name} on a project they were not added to`,
        ).toBe('hidden');
      }
    }
  });

  it('keeps another workspace out of every project here, and this one out of theirs', async () => {
    const instance = await world();
    for (const route of routes) {
      const theirs = await call(
        instance,
        'foreignOwner',
        route.method,
        route.url(instance.shared),
        route.payload,
      );
      expect(outcome(theirs), `their owner may ${route.name} here`).toBe('hidden');
      const ours = await call(
        instance,
        'owner',
        route.method,
        route.url(instance.foreign),
        route.payload,
      );
      expect(outcome(ours), `our owner may ${route.name} there`).toBe('hidden');
    }
  });
});

describe('the other things people ask for', () => {
  it('lets only a platform administrator run the platform, and gives them no project', async () => {
    const instance = await world();
    for (const [method, url] of [
      ['POST', '/api/provider/check'],
      ['GET', '/api/audit/verify'],
    ] as const) {
      for (const actor of [
        'owner',
        'wsAdmin',
        'lead',
        'analyst',
        'viewer',
        'member',
        'stranger',
      ] as const) {
        const refused = await call(instance, actor, method, url);
        expect(outcome(refused), `${actor} ${method} ${url}`).toBe('forbidden');
      }
    }
    expect(outcome(await call(instance, 'platform', 'GET', '/api/audit/verify'))).toBe('allowed');
    expect((await call(instance, 'platform', 'GET', '/api/audit/verify')).statusCode).toBe(200);
    expect(
      outcome(await call(instance, 'platform', 'GET', `/api/projects/${instance.shared}`)),
    ).toBe('hidden');
    expect((await call(instance, 'platform', 'GET', '/api/projects')).json()).toMatchObject({
      projects: [],
      total: 0,
    });
  });

  it('lets only workspace members create projects or upload documents', async () => {
    const instance = await world();
    for (const actor of [
      'owner',
      'wsAdmin',
      'lead',
      'analyst',
      'reviewer',
      'viewer',
      'member',
    ] as const) {
      const created = await call(instance, actor, 'POST', '/api/projects', fixtureInput());
      expect(created.statusCode, `${actor}: ${created.body}`).toBe(201);
    }
    for (const actor of ['stranger', 'platform'] as const) {
      const refused = await call(instance, actor, 'POST', '/api/projects', fixtureInput());
      expect(outcome(refused), actor).toBe('forbidden');
      const upload = await call(instance, actor, 'POST', '/api/documents/extract', {});
      expect(outcome(upload), actor).toBe('forbidden');
    }
    expect(
      outcome(await call(instance, 'anonymous', 'POST', '/api/projects', fixtureInput())),
    ).toBe('unauthenticated');
  });

  it('shows each person the projects they were added to, and an owner or admin all of them', async () => {
    const instance = await world();
    const ids = async (actor: Actor) => {
      const body = (await call(instance, actor, 'GET', '/api/projects')).json<{
        projects: { id: string }[];
        total: number;
      }>();
      expect(body.total).toBe(body.projects.length);
      return body.projects.map((project) => project.id).sort();
    };
    const both = [instance.shared, instance.private].sort();
    expect(await ids('owner')).toEqual(both);
    expect(await ids('wsAdmin')).toEqual(both);
    expect(await ids('lead')).toEqual([instance.shared]);
    expect(await ids('analyst')).toEqual([instance.shared]);
    expect(await ids('viewer')).toEqual([instance.shared]);
    expect(await ids('member')).toEqual([instance.private]);
    expect(await ids('stranger')).toEqual([]);
    expect(await ids('foreignOwner')).toEqual([instance.foreign]);
  });

  it('does not let a comparison name a project the caller may not read', async () => {
    const instance = await world();
    const absent = '99999999-9999-4999-8999-999999999999';
    const compare = (actor: Actor, other: string) =>
      call(instance, actor, 'GET', `/api/projects/${instance.shared}/compare?with=${other}`);
    for (const other of [instance.private, instance.foreign]) {
      const hidden = await compare('analyst', other);
      const nothing = await compare('analyst', absent);
      expect(hidden.statusCode, other).toBe(404);
      expect(shape(hidden)).toEqual(shape(nothing));
    }
    // An owner of this workspace may read both, so may compare them.
    expect(outcome(await compare('owner', instance.private))).toBe('allowed');
  });

  it('cannot be used to reach another project through the path of one the caller leads', async () => {
    const instance = await world();
    // A lead of the shared project may not touch the membership of a project they are not in.
    const attempt = await call(
      instance,
      'lead',
      'PUT',
      `/api/projects/${instance.private}/members/${ID.lead}`,
      { role: 'lead' },
    );
    expect(outcome(attempt)).toBe('hidden');
    expect(instance.repository.members.projectRole(instance.private, ID.lead)).toBeNull();
    // Nor may they name a role that does not exist, or add anything to the body.
    for (const body of [{ role: 'owner' }, { role: 'lead', extra: true }, {}, { role: 7 }]) {
      const bad = await call(
        instance,
        'lead',
        'PUT',
        `/api/projects/${instance.shared}/members/${ID.newcomer}`,
        body,
      );
      expect(bad.statusCode, JSON.stringify(body)).toBe(400);
    }
    const notAnId = await call(
      instance,
      'lead',
      'PUT',
      `/api/projects/${instance.shared}/members/not-a-guid`,
      { role: 'viewer' },
    );
    expect(notAnId.statusCode).toBe(400);
  });
});

describe('who runs the workspace', () => {
  it('makes the first holder of the administrator app role the owner of a workspace that has none', async () => {
    const instance = await world({ enroll: false });
    const admin: Minted = { oid: ID.owner, roles: ['Swarm.Admin'] };
    // Nobody owns the workspace, and someone added to nothing cannot create anything…
    expect(outcome(await call(instance, 'stranger', 'POST', '/api/projects', fixtureInput()))).toBe(
      'forbidden',
    );
    expect(
      instance.repository.members.workspaceMembers(TENANT_A).filter((m) => m.role === 'owner'),
    ).toEqual([]);
    // …until an administrator arrives, who becomes its owner, once.
    const first = await call(instance, admin, 'GET', '/api/workspace');
    expect(first.json()).toEqual({ role: 'owner', platformAdmin: false });
    const owners = instance.repository.members
      .workspaceMembers(TENANT_A)
      .filter((m) => m.role === 'owner');
    expect(owners.map((member) => member.principalId)).toEqual([ID.owner]);
    const second = await call(
      instance,
      { oid: ID.wsAdmin, roles: ['Swarm.Admin'] },
      'GET',
      '/api/workspace',
    );
    expect(second.json()).toEqual({ role: null, platformAdmin: false });
    const audit = instance.repository.audit.list({ limit: 50 }).map((entry) => entry.action);
    expect(audit.filter((action) => action === 'workspace.bootstrapped')).toHaveLength(1);
  });

  it('does not let the administrator role bring back an owner who was removed', async () => {
    const instance = await world();
    const owner: Minted = { oid: ID.owner, roles: ['Swarm.Admin'] };
    // Make someone else an owner, then remove the first. Their token still says Swarm.Admin.
    expect(
      (
        await call(instance, owner, 'PUT', `/api/workspace/members/${ID.wsAdmin}`, {
          role: 'owner',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call(instance, owner, 'DELETE', `/api/workspace/members/${ID.owner}`)).statusCode,
    ).toBe(200);
    const after = await call(instance, owner, 'GET', '/api/workspace');
    expect(after.json()).toEqual({ role: null, platformAdmin: false });
    expect(outcome(await call(instance, owner, 'GET', '/api/workspace/members'))).toBe('forbidden');
  });

  it('never leaves a workspace without an owner, or a project without a lead', async () => {
    const instance = await world();
    const lastOwner = await call(instance, 'owner', 'DELETE', `/api/workspace/members/${ID.owner}`);
    expect(lastOwner.statusCode).toBe(409);
    expect(lastOwner.json().error.code).toBe('LAST_OWNER');
    const demote = await call(instance, 'owner', 'PUT', `/api/workspace/members/${ID.owner}`, {
      role: 'member',
    });
    expect(demote.json().error.code).toBe('LAST_OWNER');

    const lastLead = await call(
      instance,
      'lead',
      'DELETE',
      `/api/projects/${instance.shared}/members/${ID.lead}`,
    );
    expect(lastLead.statusCode).toBe(409);
    expect(lastLead.json().error.code).toBe('LAST_LEAD');
    const demoteLead = await call(
      instance,
      'lead',
      'PUT',
      `/api/projects/${instance.shared}/members/${ID.lead}`,
      { role: 'viewer' },
    );
    expect(demoteLead.json().error.code).toBe('LAST_LEAD');
    // With a second lead, the first may stand down.
    expect(
      (
        await call(
          instance,
          'lead',
          'PUT',
          `/api/projects/${instance.shared}/members/${ID.analyst}`,
          { role: 'lead' },
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call(instance, 'lead', 'PUT', `/api/projects/${instance.shared}/members/${ID.lead}`, {
          role: 'viewer',
        })
      ).statusCode,
    ).toBe(200);
  });

  it('lets an admin manage members, but never make or unmake an owner', async () => {
    const instance = await world();
    const grant = await call(instance, 'wsAdmin', 'PUT', `/api/workspace/members/${ID.newcomer}`, {
      role: 'member',
    });
    expect(grant.statusCode, grant.body).toBe(200);
    const promoteSelf = await call(
      instance,
      'wsAdmin',
      'PUT',
      `/api/workspace/members/${ID.wsAdmin}`,
      { role: 'owner' },
    );
    expect(outcome(promoteSelf)).toBe('forbidden');
    const promoteOther = await call(
      instance,
      'wsAdmin',
      'PUT',
      `/api/workspace/members/${ID.member}`,
      { role: 'owner' },
    );
    expect(outcome(promoteOther)).toBe('forbidden');
    const removeOwner = await call(
      instance,
      'wsAdmin',
      'DELETE',
      `/api/workspace/members/${ID.owner}`,
    );
    expect(outcome(removeOwner)).toBe('forbidden');
    const demoteOwner = await call(
      instance,
      'wsAdmin',
      'PUT',
      `/api/workspace/members/${ID.owner}`,
      { role: 'member' },
    );
    expect(outcome(demoteOwner)).toBe('forbidden');
    expect(instance.repository.members.workspaceRole(TENANT_A, ID.owner)).toBe('owner');
    // An owner may.
    expect(
      (
        await call(instance, 'owner', 'PUT', `/api/workspace/members/${ID.wsAdmin}`, {
          role: 'owner',
        })
      ).statusCode,
    ).toBe(200);
  });

  it('lets only an owner or admin list or change the workspace’s members', async () => {
    const instance = await world();
    for (const actor of [
      'lead',
      'analyst',
      'reviewer',
      'viewer',
      'member',
      'stranger',
      'platform',
    ] as const) {
      for (const [method, url, payload] of [
        ['GET', '/api/workspace/members', undefined],
        ['PUT', `/api/workspace/members/${ID.newcomer}`, { role: 'member' }],
        ['DELETE', `/api/workspace/members/${ID.member}`, undefined],
      ] as const) {
        expect(
          outcome(await call(instance, actor, method, url, payload)),
          `${actor} ${method} ${url}`,
        ).toBe('forbidden');
      }
    }
    // Owner, admin and member were enrolled; the lead, analyst, reviewer and viewer joined when they
    // were added to the shared project.
    expect(
      (await call(instance, 'owner', 'GET', '/api/workspace/members')).json().members,
    ).toHaveLength(7);
  });

  it('keeps one workspace’s members out of another’s', async () => {
    const instance = await world();
    const mine = (await call(instance, 'owner', 'GET', '/api/workspace/members')).json<{
      members: { principalId: string }[];
    }>();
    const theirs = (await call(instance, 'foreignOwner', 'GET', '/api/workspace/members')).json<{
      members: { principalId: string }[];
    }>();
    expect(mine.members.map((m) => m.principalId)).not.toContain(ID.foreignOwner);
    expect(theirs.members.map((m) => m.principalId)).toEqual([ID.foreignOwner]);
    // Changing a member in one's own workspace never touches the same person's seat in another.
    await call(instance, 'foreignOwner', 'PUT', `/api/workspace/members/${ID.member}`, {
      role: 'admin',
    });
    expect(instance.repository.members.workspaceRole(TENANT_A, ID.member)).toBe('member');
    expect(instance.repository.members.workspaceRole(TENANT_B, ID.member)).toBe('admin');
  });
});

describe('taking access away', () => {
  it('takes effect on the next request, whatever the person’s token still says', async () => {
    const instance = await world();
    expect(outcome(await call(instance, 'viewer', 'GET', `/api/projects/${instance.shared}`))).toBe(
      'allowed',
    );
    const removed = await call(
      instance,
      'lead',
      'DELETE',
      `/api/projects/${instance.shared}/members/${ID.viewer}`,
    );
    expect(removed.json()).toEqual({ removed: true });
    for (const route of [
      `/api/projects/${instance.shared}`,
      `/api/projects/${instance.shared}/export?format=json`,
    ]) {
      expect(outcome(await call(instance, 'viewer', 'GET', route)), route).toBe('hidden');
    }
    expect((await call(instance, 'viewer', 'GET', '/api/projects')).json()).toMatchObject({
      projects: [],
      total: 0,
    });
    // Removing someone who is not there says so, and changes nothing.
    expect(
      (
        await call(
          instance,
          'lead',
          'DELETE',
          `/api/projects/${instance.shared}/members/${ID.viewer}`,
        )
      ).json(),
    ).toEqual({ removed: false });
  });

  it('takes a person out of every project in the workspace when they leave it', async () => {
    const instance = await world();
    expect(instance.repository.members.projectRole(instance.shared, ID.analyst)).toBe('analyst');
    const removed = await call(instance, 'owner', 'DELETE', `/api/workspace/members/${ID.analyst}`);
    expect(removed.json()).toEqual({ removed: true });
    expect(instance.repository.members.projectRole(instance.shared, ID.analyst)).toBeNull();
    expect(
      outcome(await call(instance, 'analyst', 'GET', `/api/projects/${instance.shared}`)),
    ).toBe('hidden');
    expect(outcome(await call(instance, 'analyst', 'POST', '/api/projects', fixtureInput()))).toBe(
      'forbidden',
    );
    // Another workspace's seat for the same person is untouched.
    instance.repository.members.setWorkspaceMember({
      tenantId: TENANT_B,
      principalId: ID.analyst,
      role: 'member',
      actor: { id: 'x', workspaceRole: 'owner' },
    });
    await call(instance, 'owner', 'DELETE', `/api/workspace/members/${ID.analyst}`);
    expect(instance.repository.members.workspaceRole(TENANT_B, ID.analyst)).toBe('member');
  });

  it('goes with the project when it is deleted', async () => {
    const instance = await world();
    expect(
      (await call(instance, 'lead', 'DELETE', `/api/projects/${instance.shared}`)).statusCode,
    ).toBe(204);
    expect(instance.repository.members.projectMembers(instance.shared)).toEqual([]);
  });

  it('is how a newly added person gets in, in the role they were given', async () => {
    const instance = await world();
    const newcomer: Minted = { oid: ID.newcomer, roles: ['Swarm.User'] };
    expect(outcome(await call(instance, newcomer, 'GET', `/api/projects/${instance.shared}`))).toBe(
      'hidden',
    );
    const added = await call(
      instance,
      'lead',
      'PUT',
      `/api/projects/${instance.shared}/members/${ID.newcomer.toUpperCase()}`,
      { role: 'reviewer' },
    );
    expect(added.json()).toEqual({
      member: { principalId: ID.newcomer, role: 'reviewer' },
      previous: null,
    });
    expect(outcome(await call(instance, newcomer, 'GET', `/api/projects/${instance.shared}`))).toBe(
      'allowed',
    );
    expect(
      outcome(
        await call(instance, newcomer, 'POST', `/api/projects/${instance.shared}/steps/knowledge`, {
          resume: 'x',
        }),
      ),
    ).toBe('forbidden');
    // They can now create projects of their own, because a project member belongs to the workspace.
    expect(
      (await call(instance, newcomer, 'POST', '/api/projects', fixtureInput())).statusCode,
    ).toBe(201);
    const changed = await call(
      instance,
      'lead',
      'PUT',
      `/api/projects/${instance.shared}/members/${ID.newcomer}`,
      { role: 'analyst' },
    );
    expect(changed.json()).toMatchObject({ previous: 'reviewer' });
  });
});

describe('what is recorded about membership', () => {
  it('names who changed whose access, to what, and nothing else', async () => {
    const instance = await world();
    await call(instance, 'lead', 'PUT', `/api/projects/${instance.shared}/members/${ID.newcomer}`, {
      role: 'viewer',
    });
    await call(instance, 'lead', 'PUT', `/api/projects/${instance.shared}/members/${ID.newcomer}`, {
      role: 'analyst',
    });
    await call(
      instance,
      'lead',
      'DELETE',
      `/api/projects/${instance.shared}/members/${ID.newcomer}`,
    );
    await call(instance, 'owner', 'PUT', `/api/workspace/members/${ID.newcomer}`, {
      role: 'admin',
    });
    await call(instance, 'owner', 'DELETE', `/api/workspace/members/${ID.newcomer}`);
    const entries = instance.repository.audit
      .list({ limit: 500 })
      .filter((entry) => /^(project|workspace)\.member\./u.test(entry.action))
      .filter((entry) => entry.targetId === ID.newcomer);
    expect(entries.map((entry) => [entry.actor, entry.action, entry.detail])).toEqual([
      [ID.lead, 'project.member.added', { role: 'viewer', previous: null }],
      [ID.lead, 'project.member.changed', { role: 'analyst', previous: 'viewer' }],
      [ID.lead, 'project.member.removed', { previous: 'analyst' }],
      // Being added to a project made them a workspace member, so this is a change, not an addition.
      [ID.owner, 'workspace.member.changed', { role: 'admin', previous: 'member' }],
      [ID.owner, 'workspace.member.removed', { previous: 'admin', projects: 0, sessions: 0 }],
    ]);
    expect(instance.repository.audit.verify()).toMatchObject({ ok: true, brokenAt: null });
  });

  it('records a refusal to anyone who was told no, but never what they asked about', async () => {
    const instance = await world();
    await call(instance, 'viewer', 'DELETE', `/api/projects/${instance.shared}`);
    await call(instance, 'stranger', 'GET', `/api/projects/${instance.shared}`);
    const refused = instance.repository.audit
      .list({ limit: 500 })
      .filter((entry) => entry.action === 'access.refused')
      .map((entry) => [entry.actor, entry.detail.code, entry.detail.status]);
    expect(refused).toEqual([
      [ID.viewer, 'FORBIDDEN', 403],
      [ID.stranger, 'PROJECT_NOT_FOUND', 404],
    ]);
  });
});

describe('bounds on sharing', () => {
  it('stops a project from collecting members without limit', () => {
    const repository = new Repository(':memory:');
    const project = repository.create(fixtureInput(), {
      owner: { tenantId: TENANT_A, ownerId: ID.lead },
    });
    for (let index = 1; index < MAX_PROJECT_MEMBERS; index += 1) {
      repository.members.setProjectMember({
        projectId: project.id,
        tenantId: TENANT_A,
        principalId: `e${String(index).padStart(7, '0')}-0000-4000-8000-000000000000`,
        role: 'viewer',
        actor: { id: ID.lead },
      });
    }
    expect(repository.members.projectMembers(project.id)).toHaveLength(MAX_PROJECT_MEMBERS);
    expect(() =>
      repository.members.setProjectMember({
        projectId: project.id,
        tenantId: TENANT_A,
        principalId: ID.newcomer,
        role: 'viewer',
        actor: { id: ID.lead },
      }),
    ).toThrow(/at most/u);
    repository.close();
  });
});

describe('without sign-in', () => {
  it('treats the one local user as the owner of the workspace and the platform, as before', async () => {
    const instance = await buildApp({ config: testConfig() });
    applications.push(instance);
    const workspace = await instance.app.inject('/api/workspace');
    expect(workspace.json()).toEqual({ role: 'owner', platformAdmin: true });
    const created = await instance.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: fixtureInput(),
    });
    expect(created.statusCode).toBe(201);
    expect(instance.repository.members.projectRole(created.json().id, 'local-user')).toBe('lead');
    expect((await instance.app.inject('/api/projects')).json().total).toBe(1);
    expect((await instance.app.inject('/api/audit/verify')).statusCode).toBe(200);
  });
});
