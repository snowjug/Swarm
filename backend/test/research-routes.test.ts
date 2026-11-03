import { afterEach, describe, expect, it } from 'vitest';
import {
  discoveryStatusSchema,
  researchRunSchema,
  type ResearchView,
} from '../../shared/research.js';
import { buildApp } from '../src/app.js';
import { AUDIT_POLICY } from '../src/auth/audit-policy.js';
import { ROUTE_POLICY } from '../src/auth/policy.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import { Repository } from '../src/storage/repository.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { HARBOUR, QUESTION, harbourWeb } from './support/research-web.js';
import {
  TENANT_A,
  TENANT_B,
  authorization,
  entraEnvironment,
  idp,
  type Minted,
} from './support/entra-idp.js';
import { FakeNetwork, VirtualClock, drive } from './support/research-world.js';

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

const CANARY = 'zq-canary-9041';

/** Text that a person adds to a project of their own: a name, and what it says. */
const pasted = (name = 'notes.txt', canary = 'Note') => ({
  documents: [
    {
      name,
      content: `${canary}: the harbour board reviews the berthing fee each spring, and coastal vessels pay by the metre of hull.`,
    },
  ],
});

/** The application as a deployment runs it, with research reading a web of fake pages on a clock of its own. */
function research(
  config: ReturnType<typeof testConfig>,
  options: Partial<Parameters<typeof buildApp>[0]> = {},
) {
  const clock = new VirtualClock();
  const network = new FakeNetwork(clock, harbourWeb());
  return {
    clock,
    network,
    options: {
      config,
      jobs: { timers: false },
      research: {
        fetcher: network,
        now: clock.now,
        crawl: {
          now: clock.now,
          sleep: clock.sleep,
          random: () => 0.5,
          extractLimits: {
            sliceMs: Number.POSITIVE_INFINITY,
            maxParseMs: Number.POSITIVE_INFINITY,
          },
        },
      },
      ...options,
    } satisfies Parameters<typeof buildApp>[0],
  };
}

const failure = (response: { json(): unknown }) =>
  (response.json() as { error: { code: string; message: string } }).error;

// ---------------------------------------------------------------------------------------------
// Who may call what, with sign-in
// ---------------------------------------------------------------------------------------------

const ID = {
  owner: 'c1000001-0000-4000-8000-000000000001',
  wsAdmin: 'c1000002-0000-4000-8000-000000000002',
  lead: 'c1000003-0000-4000-8000-000000000003',
  analyst: 'c1000004-0000-4000-8000-000000000004',
  reviewer: 'c1000005-0000-4000-8000-000000000005',
  viewer: 'c1000006-0000-4000-8000-000000000006',
  member: 'c1000007-0000-4000-8000-000000000007',
  stranger: 'c1000008-0000-4000-8000-000000000008',
  platform: 'c1000009-0000-4000-8000-000000000009',
  foreignOwner: 'd1000001-0000-4000-8000-000000000001',
} as const;

type Actor = keyof typeof ID | 'anonymous';

const TOKENS: Record<keyof typeof ID, Minted> = {
  owner: { oid: ID.owner, roles: ['Swarm.User'] },
  wsAdmin: { oid: ID.wsAdmin, roles: ['Swarm.User'] },
  lead: { oid: ID.lead, roles: ['Swarm.User'] },
  analyst: { oid: ID.analyst, roles: ['Swarm.User'] },
  reviewer: { oid: ID.reviewer, roles: ['Swarm.User'] },
  viewer: { oid: ID.viewer, roles: ['Swarm.User'] },
  member: { oid: ID.member, roles: ['Swarm.User'] },
  stranger: { oid: ID.stranger, roles: ['Swarm.Reader'] },
  platform: { oid: ID.platform, roles: ['Swarm.PlatformAdmin'] },
  foreignOwner: { tid: TENANT_B, oid: ID.foreignOwner, roles: ['Swarm.User'] },
};

/** May this person read the research of the shared project, and may they start, add to, pause, finish or cancel it? */
const MAY: Record<Actor, { read: boolean; run: boolean }> = {
  owner: { read: true, run: true },
  wsAdmin: { read: true, run: true },
  lead: { read: true, run: true },
  analyst: { read: true, run: true },
  reviewer: { read: true, run: false },
  viewer: { read: true, run: false },
  member: { read: false, run: false },
  stranger: { read: false, run: false },
  platform: { read: false, run: false },
  foreignOwner: { read: false, run: false },
  anonymous: { read: false, run: false },
};

async function signedIn() {
  const config = testConfig({
    ...entraEnvironment,
    LOG_LEVEL: 'silent',
    RESEARCH_DOMAIN_DELAY_MS: '250',
  });
  const world = research(config, { tokenVerifier: new TokenVerifier(config.auth, idp.keys) });
  const instance = await buildApp(world.options);
  applications.push(instance);
  const { repository } = instance;
  const setup = { id: 'test-setup', workspaceRole: 'owner' as const };
  const enroll = (tenantId: string, principalId: string, role: 'owner' | 'admin' | 'member') =>
    repository.members.setWorkspaceMember({ tenantId, principalId, role, actor: setup });
  enroll(TENANT_A, ID.owner, 'owner');
  enroll(TENANT_A, ID.wsAdmin, 'admin');
  enroll(TENANT_A, ID.member, 'member');
  enroll(TENANT_B, ID.foreignOwner, 'owner');
  const shared = repository.create(
    fixtureInput({
      workflow: 'guided',
      documents: [],
      research: { auto: true },
      question: QUESTION,
    }),
    { owner: { tenantId: TENANT_A, ownerId: ID.lead } },
  );
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
  return { ...instance, ...world, shared: shared.id };
}

async function call(
  instance: Application,
  actor: Actor,
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  return instance.app.inject({
    method,
    url,
    headers: { ...(actor === 'anonymous' ? {} : await authorization(TOKENS[actor])), ...headers },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

describe('who may use the research routes', () => {
  it('has them in the authorisation table, with the capabilities written out here, and in the audit table', () => {
    expect(ROUTE_POLICY['GET /api/projects/:id/research']).toEqual({
      kind: 'project',
      capability: 'read',
    });
    for (const path of ['', '/sources', '/pause', '/resume', '/finish', '/cancel']) {
      expect(ROUTE_POLICY[`POST /api/projects/:id/research${path}`], path).toEqual({
        kind: 'project',
        capability: 'run',
      });
    }
    expect(AUDIT_POLICY['POST /api/projects/:id/research']).toEqual({
      kind: 'inside',
      action: 'research.started',
    });
    expect(AUDIT_POLICY['POST /api/projects/:id/research/sources']).toEqual({
      kind: 'inside',
      action: 'research.source.added',
    });
    for (const verb of ['paused', 'resumed', 'finished', 'cancelled']) {
      const path = { paused: 'pause', resumed: 'resume', finished: 'finish', cancelled: 'cancel' }[
        verb
      ];
      expect(AUDIT_POLICY[`POST /api/projects/:id/research/${path}`], verb).toEqual({
        kind: 'request',
        action: `research.${verb}`,
      });
    }
    expect(AUDIT_POLICY['GET /api/projects/:id/research']).toMatchObject({ kind: 'none' });
    // The text a person adds is evidence of the project: whoever may edit it, and it queues the stage that grounds it.
    expect(ROUTE_POLICY['POST /api/projects/:id/evidence/documents']).toEqual({
      kind: 'project',
      capability: 'edit',
    });
    expect(AUDIT_POLICY['POST /api/projects/:id/evidence/documents']).toEqual({
      kind: 'inside',
      action: 'evidence.documents.added',
    });
  });

  const actors = Object.keys(MAY) as Actor[];

  it.each(actors)('does what the table says for %s', async (actor) => {
    const instance = await signedIn();
    const base = `/api/projects/${instance.shared}/research`;
    const hidden = !MAY[actor].read;
    const refusal = actor === 'anonymous' ? 401 : hidden ? 404 : 403;
    const allowed = MAY[actor].run;

    const read = await call(instance, actor, 'GET', base);
    expect(read.statusCode, `${actor} reads it`).toBe(MAY[actor].read ? 200 : refusal);
    // The routes that act on a run in progress are allowed to those who may run the project: they find none.
    for (const path of ['/pause', '/resume', '/finish', '/cancel']) {
      const response = await call(instance, actor, 'POST', `${base}${path}`);
      expect(response.statusCode, `${actor} ${path}: ${response.body}`).toBe(
        allowed ? 409 : refusal,
      );
    }
    const added = await call(instance, actor, 'POST', `${base}/sources`, {
      url: 'harbour.example.org',
    });
    expect(added.statusCode, `${actor} adds a site: ${added.body}`).toBe(allowed ? 202 : refusal);
    const started = await call(instance, actor, 'POST', base, { intake: { url: `${HARBOUR}/` } });
    // Allowed, and refused for a reason of its own: adding the site has started a run, and it is live.
    expect(started.statusCode, `${actor} starts a run: ${started.body}`).toBe(
      allowed ? 409 : refusal,
    );
    if (allowed) expect(failure(started).code).toBe('RESEARCH_ACTIVE');

    if (!allowed) {
      // A refusal changes nothing: no run, no job, nothing in the audit trail.
      expect(instance.research.store.count(instance.shared)).toBe(0);
      expect(instance.repository.jobs.recent(instance.shared)).toEqual([]);
      expect(
        instance.repository.audit
          .list({ projectId: instance.shared, limit: 100 })
          .filter((entry) => entry.action.startsWith('research.')),
      ).toEqual([]);
    }
  });

  it.each(actors)(
    'does what the table says for %s when they add text of their own',
    async (actor) => {
      const instance = await signedIn();
      const hidden = !MAY[actor].read;
      const refusal = actor === 'anonymous' ? 401 : hidden ? 404 : 403;
      const added = await call(
        instance,
        actor,
        'POST',
        `/api/projects/${instance.shared}/evidence/documents`,
        pasted(),
      );
      // Who may edit the project may run it, and adding the text queues the stage that grounds the project.
      expect(added.statusCode, `${actor} adds text: ${added.body}`).toBe(
        MAY[actor].run ? 202 : refusal,
      );
      const entries = instance.repository.audit
        .list({ projectId: instance.shared, limit: 100 })
        .filter((entry) => entry.action === 'evidence.documents.added');
      if (MAY[actor].run) {
        expect(instance.repository.get(instance.shared).documents).toHaveLength(1);
        expect(instance.repository.jobs.recent(instance.shared)).toHaveLength(1);
        // The person who did it is the one on record, and nothing of the text is.
        expect(entries.map((entry) => entry.actor)).toEqual([ID[actor as keyof typeof ID]]);
        expect(JSON.stringify(entries)).not.toContain('berthing');
      } else {
        // A refusal changes nothing: no source, no passage, no job, nothing in the audit trail.
        expect(instance.repository.get(instance.shared).documents).toEqual([]);
        expect(instance.repository.chunks(instance.shared)).toEqual([]);
        expect(instance.repository.jobs.recent(instance.shared)).toEqual([]);
        expect(entries).toEqual([]);
      }
    },
  );

  it('shows a project that someone may not see exactly as one that is not there, when they add text to it', async () => {
    const instance = await signedIn();
    const absent = '99999999-9999-4999-8999-999999999999';
    for (const actor of ['member', 'stranger', 'foreignOwner'] as const) {
      const hiddenResponse = await call(
        instance,
        actor,
        'POST',
        `/api/projects/${instance.shared}/evidence/documents`,
        pasted(),
      );
      const missing = await call(
        instance,
        actor,
        'POST',
        `/api/projects/${absent}/evidence/documents`,
        pasted(),
      );
      expect(hiddenResponse.statusCode, actor).toBe(404);
      const shape = (response: typeof hiddenResponse) => {
        const { code, message } = failure(response);
        return { code, message };
      };
      expect(shape(hiddenResponse)).toEqual(shape(missing));
    }
    expect(instance.repository.get(instance.shared).documents).toEqual([]);
  });

  it('shows a project that someone may not see exactly as one that is not there', async () => {
    const instance = await signedIn();
    const absent = '99999999-9999-4999-8999-999999999999';
    const bodies: Record<string, unknown> = { '': {}, '/sources': { url: 'harbour.example.org' } };
    for (const actor of ['member', 'stranger', 'foreignOwner'] as const) {
      for (const [method, path] of [
        ['GET', ''],
        ['POST', ''],
        ['POST', '/sources'],
        ['POST', '/pause'],
        ['POST', '/cancel'],
      ] as const) {
        const payload = method === 'POST' ? bodies[path] : undefined;
        const hiddenResponse = await call(
          instance,
          actor,
          method,
          `/api/projects/${instance.shared}/research${path}`,
          payload,
        );
        const missing = await call(
          instance,
          actor,
          method,
          `/api/projects/${absent}/research${path}`,
          payload,
        );
        expect(hiddenResponse.statusCode, `${actor} ${method} ${path}`).toBe(404);
        const shape = (response: typeof hiddenResponse) => {
          const { code, message } = failure(response);
          return { code, message };
        };
        expect(shape(hiddenResponse)).toEqual(shape(missing));
      }
    }
  });

  it('keeps the research of a project out of reach of another workspace, and of the people who share another project', async () => {
    const instance = await signedIn();
    const other = instance.repository.create(
      fixtureInput({ workflow: 'guided', documents: [], research: { auto: true } }),
      { owner: { tenantId: TENANT_A, ownerId: ID.member } },
    );
    const started = await call(instance, 'member', 'POST', `/api/projects/${other.id}/research`, {
      intake: { url: `${HARBOUR}/`, guidance: CANARY },
    });
    expect(started.statusCode, started.body).toBe(202);
    for (const actor of ['lead', 'analyst', 'reviewer', 'viewer', 'foreignOwner'] as const) {
      const response = await call(instance, actor, 'GET', `/api/projects/${other.id}/research`);
      expect(response.statusCode, actor).toBe(404);
      expect(response.body).not.toContain(CANARY);
    }
    // The shared project has no run of its own, and does not show the other's.
    const mine = (
      await call(instance, 'lead', 'GET', `/api/projects/${instance.shared}/research`)
    ).json<ResearchView>();
    expect(mine.run).toBeNull();
    // The same key on two projects is two requests, not one: a key is a project's own.
    const key = { 'idempotency-key': 'shared-key-0001' };
    const first = await call(
      instance,
      'lead',
      'POST',
      `/api/projects/${instance.shared}/research`,
      { intake: { url: `${HARBOUR}/` } },
      key,
    );
    const second = await call(
      instance,
      'foreignOwner',
      'POST',
      `/api/projects/${other.id}/research`,
      {},
      key,
    );
    expect(first.statusCode, first.body).toBe(202);
    expect(second.statusCode).toBe(404);
    expect(instance.research.store.count(instance.shared)).toBe(1);
  });

  it('keeps the text a person adds out of reach of another workspace, and of the people who share another project', async () => {
    const instance = await signedIn();
    const own = (tenantId: string, ownerId: string) =>
      instance.repository.create(
        fixtureInput({ workflow: 'guided', documents: [], research: { auto: true } }),
        { owner: { tenantId, ownerId } },
      ).id;
    const mine = own(TENANT_A, ID.member);
    const theirs = own(TENANT_B, ID.foreignOwner);
    const url = (id: string) => `/api/projects/${id}/evidence/documents`;
    const key = { 'idempotency-key': 'shared-key-0002' };
    // The same key on two projects is two requests: a key is a project's own, and a workspace's.
    const first = await call(
      instance,
      'member',
      'POST',
      url(mine),
      pasted('mine.txt', CANARY),
      key,
    );
    const second = await call(
      instance,
      'foreignOwner',
      'POST',
      url(theirs),
      pasted('theirs.txt', 'Other'),
      key,
    );
    expect(first.statusCode, first.body).toBe(202);
    expect(second.statusCode, second.body).toBe(202);

    for (const actor of ['lead', 'analyst', 'reviewer', 'viewer', 'foreignOwner'] as const) {
      const response = await call(instance, actor, 'POST', url(mine), pasted('theirs.txt'));
      expect(response.statusCode, actor).toBe(404);
      expect(response.body).not.toContain(CANARY);
    }
    for (const actor of ['lead', 'member', 'owner'] as const) {
      const response = await call(instance, actor, 'POST', url(theirs), pasted('mine.txt'));
      expect(response.statusCode, actor).toBe(404);
    }
    expect(instance.repository.get(mine).documents.map((document) => document.name)).toEqual([
      'mine.txt',
    ]);
    expect(instance.repository.get(theirs).documents.map((document) => document.name)).toEqual([
      'theirs.txt',
    ]);
    expect(instance.repository.get(instance.shared).documents).toEqual([]);
    expect(instance.repository.jobs.recent(instance.shared)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// What a response is, and what the audit trail keeps
// ---------------------------------------------------------------------------------------------

describe('the research routes', () => {
  async function local(environment: Record<string, string> = {}) {
    const world = research(
      testConfig({ LOG_LEVEL: 'silent', RESEARCH_DOMAIN_DELAY_MS: '250', ...environment }),
    );
    const instance = await buildApp(world.options);
    applications.push(instance);
    const project = instance.repository.create(
      fixtureInput({
        workflow: 'guided',
        documents: [],
        research: { auto: true },
        question: QUESTION,
      }),
    );
    return {
      ...instance,
      ...world,
      project: project.id,
      base: `/api/projects/${project.id}/research`,
    };
  }

  it('answers with the shape the frontend reads, in every state of a run', async () => {
    const app = await local();
    const parsed = (view: ResearchView): ResearchView => {
      expect(Object.keys(view).sort()).toEqual(['discovery', 'may', 'revision', 'run']);
      expect(discoveryStatusSchema.parse(view.discovery)).toEqual(view.discovery);
      if (view.run) expect(researchRunSchema.parse(view.run)).toEqual(view.run);
      return view;
    };
    const empty = parsed((await app.app.inject({ url: app.base })).json<ResearchView>());
    expect(empty).toMatchObject({
      run: null,
      revision: 0,
      may: { start: true, pause: false, cancel: false },
    });

    // Waiting for a worker, then cancelled before it began.
    const started = await app.app.inject({
      method: 'POST',
      url: app.base,
      payload: { intake: { url: `${HARBOUR}/` } },
    });
    expect(started.statusCode).toBe(202);
    const queued = parsed(started.json<ResearchView>());
    expect(queued.run?.status).toBe('queued');
    expect(queued.revision).toBeGreaterThan(0);
    const cancelled = await app.app.inject({ method: 'POST', url: `${app.base}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    expect(parsed(cancelled.json<ResearchView>()).run?.status).toBe('cancelled');
    await drive(app.clock, app.jobs.idle());

    // Blocked for want of a search provider, and finished with sources.
    const blocked = await app.app.inject({ method: 'POST', url: app.base, payload: {} });
    expect(blocked.statusCode).toBe(202);
    await drive(app.clock, app.jobs.idle());
    expect(parsed((await app.app.inject({ url: app.base })).json<ResearchView>()).run?.status).toBe(
      'blocked',
    );
    const site = await app.app.inject({
      method: 'POST',
      url: `${app.base}/sources`,
      payload: { url: 'harbour.example.org' },
    });
    expect(site.statusCode).toBe(202);
    await drive(app.clock, app.jobs.idle());
    const done = parsed((await app.app.inject({ url: app.base })).json<ResearchView>());
    expect(done.run).toMatchObject({ status: 'completed', stage: 'ready' });
    expect(done.may).toEqual({ start: false, pause: false, cancel: false });
  });

  it('records what was done in counts and words, and never an address, a title, a question or what a person typed', async () => {
    const app = await local();
    const started = await app.app.inject({
      method: 'POST',
      url: app.base,
      payload: {
        intake: {
          url: `https://${CANARY}.example.org/${CANARY}?token=${CANARY}`,
          guidance: `${CANARY} guidance`,
          horizon: `${CANARY} horizon`,
          geography: `${CANARY} place`,
        },
        budget: { maxPages: 3 },
      },
    });
    expect(started.statusCode, started.body).toBe(202);
    await app.app.inject({ method: 'POST', url: `${app.base}/cancel` });
    const entries = app.repository.audit.list({ projectId: app.project, limit: 100 });
    expect(entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['research.started', 'research.cancelled']),
    );
    const started_ = entries.find((entry) => entry.action === 'research.started');
    expect(started_?.detail).toEqual({
      mode: 'url',
      pages: 3,
      sites: 4,
      depth: 1,
      seconds: 120,
      model: false,
    });
    expect(JSON.stringify(entries)).not.toContain(CANARY);
    expect(JSON.stringify(entries)).not.toContain('example');
  });

  it('records a request that was refused for what it is: nothing was done, so nothing is recorded', async () => {
    const app = await local();
    for (const path of ['/pause', '/resume', '/finish', '/cancel']) {
      expect((await app.app.inject({ method: 'POST', url: `${app.base}${path}` })).statusCode).toBe(
        409,
      );
    }
    expect(
      (await app.app.inject({ method: 'POST', url: app.base, payload: { intake: 5 } })).statusCode,
    ).toBe(400);
    expect(
      app.repository.audit
        .list({ projectId: app.project, limit: 100 })
        .map((entry) => entry.action),
    ).toEqual(['project.created']);
  });

  it('refuses a body that is too large before it reads it', async () => {
    const app = await local();
    const large = { intake: { guidance: 'x'.repeat(20_000) } };
    const response = await app.app.inject({ method: 'POST', url: app.base, payload: large });
    expect(response.statusCode).toBe(413);
    expect(
      (
        await app.app.inject({
          method: 'POST',
          url: `${app.base}/sources`,
          payload: { url: 'a'.repeat(9_000) },
        })
      ).statusCode,
    ).toBe(413);
    expect(app.research.store.count(app.project)).toBe(0);
  });

  it.each([
    ['', { intake: 5 }, 6],
    ['/sources', {}, 10],
    ['/pause', undefined, 20],
    ['/cancel', undefined, 20],
  ] as const)(
    'limits how often %s may be called, because each call is work for the server',
    async (path, payload, limit) => {
      const app = await local();
      const send = () =>
        app.app.inject({
          method: 'POST',
          url: `${app.base}${path}`,
          ...(payload === undefined ? {} : { payload: payload as object }),
        });
      for (let attempt = 0; attempt < limit; attempt += 1) {
        expect((await send()).statusCode, `call ${attempt + 1}`).not.toBe(429);
      }
      const limited = await send();
      expect(limited.statusCode).toBe(429);
      expect(failure(limited).code).toBe('RATE_LIMITED');
    },
  );

  it('limits how often text may be added, because each call is work for the server', async () => {
    const app = await local();
    const send = () =>
      app.app.inject({
        method: 'POST',
        url: `/api/projects/${app.project}/evidence/documents`,
        payload: {},
      });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await send()).statusCode, `call ${attempt + 1}`).toBe(400);
    }
    const limited = await send();
    expect(limited.statusCode).toBe(429);
    expect(failure(limited).code).toBe('RATE_LIMITED');
    expect(app.repository.get(app.project).documents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// With a browser's cookie
// ---------------------------------------------------------------------------------------------

describe('a change made with a browser session', () => {
  const HOST = 'swarm.example.test';
  const PERSON = 'c2000001-0000-4000-8000-000000000001';

  async function withCookie() {
    const config = testConfig({
      ...entraEnvironment,
      AUTH_ENTRA_CLIENT_ID: 'cccccccc-0000-4000-8000-0000000000aa',
      AUTH_ENTRA_REDIRECT_URI: `https://${HOST}/auth/callback`,
      ALLOWED_HOSTS: `${HOST},localhost`,
      ALLOWED_ORIGINS: `https://${HOST}`,
      LOG_LEVEL: 'silent',
      RESEARCH_DOMAIN_DELAY_MS: '250',
    });
    const repository = new Repository(':memory:');
    const world = research(config, {
      repository,
      tokenVerifier: new TokenVerifier(config.auth, idp.keys),
    });
    const instance = await buildApp(world.options);
    applications.push(instance);
    const { token } = repository.sessions.create(
      { id: PERSON, tenantId: TENANT_A, platformAdmin: false, bootstrapAdmin: false },
      { idleMs: 60_000, absoluteMs: 3_600_000 },
    );
    repository.members.setWorkspaceMember({
      tenantId: TENANT_A,
      principalId: PERSON,
      role: 'owner',
      actor: { id: 'test-setup', workspaceRole: 'owner' },
    });
    const project = repository.create(
      fixtureInput({
        workflow: 'guided',
        documents: [],
        research: { auto: true },
        question: QUESTION,
      }),
      { owner: { tenantId: TENANT_A, ownerId: PERSON } },
    );
    return {
      ...instance,
      ...world,
      base: `/api/projects/${project.id}/research`,
      cookie: `__Host-swarm_session=${token}`,
    };
  }

  it('needs the anti-forgery header on every route that changes research, and not on one that only reads', async () => {
    const app = await withCookie();
    const headers = (extra: Record<string, string> = {}) => ({
      host: HOST,
      cookie: app.cookie,
      origin: `https://${HOST}`,
      ...extra,
    });
    for (const path of ['', '/sources', '/pause', '/resume', '/finish', '/cancel']) {
      const response = await app.app.inject({
        method: 'POST',
        url: `${app.base}${path}`,
        headers: headers(),
        payload: path === '/sources' ? { url: 'harbour.example.org' } : {},
      });
      expect(response.statusCode, path).toBe(403);
      expect(failure(response).code, path).toBe('CSRF_REQUIRED');
    }
    expect(app.research.store.count(app.base.split('/')[3] ?? '')).toBe(0);
    expect(
      (
        await app.app.inject({
          method: 'GET',
          url: app.base,
          headers: { host: HOST, cookie: app.cookie },
        })
      ).statusCode,
    ).toBe(200);
    const forged = await app.app.inject({
      method: 'POST',
      url: app.base,
      headers: headers({ 'x-swarm-csrf': '1', origin: 'https://evil.example' }),
      payload: {},
    });
    expect(forged.statusCode).toBe(403);
    expect(failure(forged).code).toBe('ORIGIN_NOT_ALLOWED');
    const sent = await app.app.inject({
      method: 'POST',
      url: app.base,
      headers: headers({ 'x-swarm-csrf': '1' }),
      payload: { intake: { url: `${HARBOUR}/` } },
    });
    expect(sent.statusCode, sent.body).toBe(202);
  });

  it('needs the anti-forgery header to add text, as every route that changes a project does', async () => {
    const app = await withCookie();
    const id = app.base.split('/')[3] ?? '';
    const url = `/api/projects/${id}/evidence/documents`;
    const headers = (extra: Record<string, string> = {}) => ({
      host: HOST,
      cookie: app.cookie,
      origin: `https://${HOST}`,
      ...extra,
    });
    const bare = await app.app.inject({
      method: 'POST',
      url,
      headers: headers(),
      payload: pasted(),
    });
    expect(bare.statusCode).toBe(403);
    expect(failure(bare).code).toBe('CSRF_REQUIRED');
    const forged = await app.app.inject({
      method: 'POST',
      url,
      headers: headers({ 'x-swarm-csrf': '1', origin: 'https://evil.example' }),
      payload: pasted(),
    });
    expect(forged.statusCode).toBe(403);
    expect(failure(forged).code).toBe('ORIGIN_NOT_ALLOWED');
    expect(app.repository.get(id).documents).toEqual([]);
    expect(app.repository.jobs.recent(id)).toEqual([]);

    const sent = await app.app.inject({
      method: 'POST',
      url,
      headers: headers({ 'x-swarm-csrf': '1' }),
      payload: pasted(),
    });
    expect(sent.statusCode, sent.body).toBe(202);
    expect(app.repository.get(id).documents).toHaveLength(1);
  });
});
