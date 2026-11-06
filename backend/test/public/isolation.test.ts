import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PublicGuard } from '../../src/auth/guard.js';
import { policyFor } from '../../src/auth/policy.js';
import type { Principal } from '../../src/auth/principal.js';
import { PUBLIC_REFUSED_ROUTES, PUBLIC_ROUTE_POLICY } from '../../src/public/guard.js';
import { fixtureInput, sourceText } from '../fixtures.js';
import { publicApp, type PublicHarness } from '../support/public-idp.js';

/**
 * Whether one person can reach another's data through any route. Run against the real guard, and then again with every
 * application-level check taken away, so that what is left is the database. Generated from the registry of the routes
 * the server registered: a route that is added is checked without anyone remembering to.
 */

const CANARY = 'CANARY-OF-BOB-7f3a9c41';
const json = { 'content-type': 'application/json' };
const csrf = { 'x-swarm-csrf': '1' };

let attack: { on: boolean; as: Principal | null } = { on: false, as: null };
let h: PublicHarness;
let alice: { cookie: string; projectId: string; workspace: string; id: string };
let bob: { cookie: string; projectId: string; workspace: string; id: string };
let admin: { cookie: string };

/** The guard with the application's checks removed: any caller is `attack.as`, and every route is "signed in". */
const wrap = (real: PublicGuard): PublicGuard => ({
  policy: (method, url) => (attack.on ? { kind: 'signed-in' } : real.policy(method, url)),
  refuses: (method, url) => (attack.on ? null : real.refuses(method, url)),
  authenticate: async (request) => {
    if (!attack.on || !attack.as) return real.authenticate(request);
    return {
      principal: attack.as,
      session: { idleExpiresAt: Date.now() + 60_000, expiresAt: Date.now() + 60_000 },
    };
  },
});

async function userOf(
  cookie: string,
  email: string,
  provider: 'google' | 'github',
  subject: string,
) {
  const row = h.built.repository.asSystem(() =>
    h.built.publicEdition!.context.users.find(provider, subject)!,
  );
  return { cookie, id: row.id, workspace: row.workspaceId, email };
}

async function create(cookie: string, name: string, marker: string): Promise<string> {
  const response = await h.app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { cookie, ...csrf, ...json },
    payload: fixtureInput({
      name,
      question: `What could happen next? ${marker}`,
      documents: [{ name: 'notes.md', content: `${sourceText}\n${marker}` }],
    }),
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

async function settle(cookie: string, id: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const response = await h.app.inject({
      method: 'GET',
      url: `/api/projects/${id}`,
      headers: { cookie },
    });
    const status = response.json().status as string;
    if (status === 'completed' || status === 'failed') return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the run did not settle');
}

beforeAll(async () => {
  h = await publicApp({}, { public: { wrapGuard: wrap } });
  const a = await h.signIn({ provider: 'google', subject: 'g-alice', email: 'alice@example.com' });
  const b = await h.signIn({ provider: 'github', subject: '2002', email: 'bob@example.com' });
  const adm = await h.signIn({
    provider: 'google',
    subject: 'g-admin',
    email: 'admin@example.com',
  });
  admin = { cookie: adm.cookie };
  const alicePart = await userOf(a.cookie, 'alice@example.com', 'google', 'g-alice');
  const bobPart = await userOf(b.cookie, 'bob@example.com', 'github', '2002');
  alice = { ...alicePart, projectId: await create(a.cookie, 'Alice project', 'CANARY-OF-ALICE') };
  bob = { ...bobPart, projectId: await create(b.cookie, `Bob project ${CANARY}`, CANARY) };
  // Give Bob's project a history: a finished run (chunks, events, claims, jobs, usage), a report and a budget.
  await h.app.inject({
    method: 'POST',
    url: `/api/projects/${bob.projectId}/run`,
    headers: { cookie: b.cookie, ...csrf, ...json },
    payload: {},
  });
  await settle(b.cookie, bob.projectId);
  await h.app.inject({
    method: 'POST',
    url: `/api/projects/${bob.projectId}/studio`,
    headers: { cookie: b.cookie, ...csrf, ...json },
    payload: {},
  });
  await h.app.inject({
    method: 'PUT',
    url: `/api/projects/${bob.projectId}/budget`,
    headers: { cookie: b.cookie, ...csrf, ...json },
    payload: { callLimit: 77, tokenLimit: 7777 },
  });
}, 120_000);

afterAll(async () => {
  await h.close();
});

const principalOf = (user: { id: string; workspace: string }): Principal => ({
  id: user.id,
  tenantId: user.workspace,
  platformAdmin: false,
  bootstrapAdmin: false,
});

/** Every parameter a route can name, filled with something of Bob's (or something that fits). */
function fill(url: string): string {
  const values: Record<string, string> = {
    id: bob.projectId,
    claimId: 'C1',
    conflictId: 'K1',
    sectionId: 'summary',
    participantId: '00000000-0000-4000-8000-0000000000aa',
    aid: '00000000-0000-4000-8000-0000000000bb',
    cid: '00000000-0000-4000-8000-0000000000cc',
    surveyId: '00000000-0000-4000-8000-0000000000dd',
    step: 'knowledge',
    principalId: bob.id,
  };
  return url.replace(/:([A-Za-z]+)/gu, (_match, name: string) => values[name] ?? 'x');
}

const kindOf = (method: string, url: string) =>
  (PUBLIC_ROUTE_POLICY[`${method} ${url}`] ?? policyFor(method, url))?.kind;

function apiRoutes() {
  return h.built.routes.filter(({ url, method }) => url.startsWith('/api') && method !== 'HEAD');
}

describe('the data of one person, and every route', () => {
  it('has something of Bob’s in the tables the routes read, so that the matrix is not vacuous', () => {
    const counts = h.built.repository.asSystem(() =>
      h.built.repository.extend((db) =>
        Object.fromEntries(
          [
            'projects',
            'chunks',
            'events',
            'messages',
            'jobs',
            'project_members',
            'project_usage',
            'studio_documents',
            'claim_records',
            'workspace_members',
          ].map((table) => [
            table,
            Number(
              db
                .prepare(
                  `SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'projects' ? 'tenant_id' : table === 'workspace_members' ? 'tenant_id' : 'project_id'} ${table === 'projects' || table === 'workspace_members' ? '= ?' : 'IN (SELECT id FROM projects WHERE tenant_id = ?)'}`,
                )
                .get(bob.workspace)?.n ?? 0,
            ),
          ]),
        ),
      ),
    );
    expect(counts.projects).toBe(1);
    expect(counts.chunks).toBeGreaterThan(0);
    expect(counts.events).toBeGreaterThan(0);
    expect(counts.project_members).toBeGreaterThan(0);
    expect(counts.workspace_members).toBe(1);
    expect(counts.jobs).toBeGreaterThan(0);
  });

  it('covers the routes the server registers, and the registry is not small', () => {
    expect(apiRoutes().length).toBeGreaterThan(100);
    const unclassified = apiRoutes().filter(({ method, url }) => kindOf(method, url) === undefined);
    expect(unclassified).toEqual([]);
  });

  it('answers every project route of Bob’s as if it did not exist, when Alice is the caller', async () => {
    const failures: string[] = [];
    let checked = 0;
    for (const { method, url } of apiRoutes()) {
      if (kindOf(method, url) !== 'project') continue;
      const response = await h.app.inject({
        method: method as 'GET',
        url: fill(url),
        headers: { cookie: alice.cookie, ...csrf, ...json },
        ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
      });
      checked += 1;
      const body = response.body;
      const expected = PUBLIC_REFUSED_ROUTES.has(`${method} ${url}`)
        ? 'NOT_AVAILABLE'
        : 'PROJECT_NOT_FOUND';
      if (response.statusCode !== 404 || response.json().error?.code !== expected)
        failures.push(`${method} ${url} → ${response.statusCode} ${body.slice(0, 120)}`);
      if (body.includes(CANARY) || body.includes(bob.projectId) || body.includes(bob.workspace))
        failures.push(`${method} ${url} leaked something of Bob's`);
    }
    expect(checked).toBeGreaterThan(80);
    expect(failures).toEqual([]);
  }, 120_000);

  it('answers the same for a project of Bob’s as for one that does not exist, so that an identifier reveals nothing', async () => {
    const shape = async (id: string) => {
      const response = await h.app.inject({
        method: 'GET',
        url: `/api/projects/${id}`,
        headers: { cookie: alice.cookie },
      });
      const { code, message } = response.json().error as { code: string; message: string };
      return { status: response.statusCode, code, message };
    };
    expect(await shape(bob.projectId)).toEqual(await shape('99999999-9999-4999-8999-999999999999'));
  });

  it('keeps Bob’s project out of every list, and out of the other project’s comparisons', async () => {
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie: alice.cookie },
    });
    expect(list.json().projects.map((project: { id: string }) => project.id)).toEqual([
      alice.projectId,
    ]);
    expect(list.body).not.toContain(CANARY);
    const compare = await h.app.inject({
      method: 'GET',
      url: `/api/projects/${alice.projectId}/compare?with=${bob.projectId}`,
      headers: { cookie: alice.cookie },
    });
    expect(compare.statusCode).toBe(404);
    expect(compare.body).not.toContain(CANARY);
  });

  it('gives a platform administrator the platform, and no one’s projects', async () => {
    const got = await h.app.inject({
      method: 'GET',
      url: `/api/projects/${bob.projectId}`,
      headers: { cookie: admin.cookie },
    });
    expect(got.statusCode).toBe(404);
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie: admin.cookie },
    });
    expect(list.json().projects).toEqual([]);
    expect(list.body).not.toContain(CANARY);
  });

  it('does not let a caller choose a workspace: whatever the body says, a new project is the caller’s', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: alice.cookie, ...csrf, ...json },
      payload: {
        ...fixtureInput({ name: 'Alice again' }),
        tenantId: bob.workspace,
        ownerId: bob.id,
        tenant_id: bob.workspace,
      },
    });
    expect(response.statusCode).toBe(201);
    const owner = h.built.repository.asSystem(() =>
      h.built.repository.ownership(response.json().id),
    );
    expect(owner).toEqual({ tenantId: alice.workspace, ownerId: alice.id });
  });

  it('shows Alice only her own account, usage and audit trail', async () => {
    const account = await h.app.inject({
      method: 'GET',
      url: '/api/account',
      headers: { cookie: alice.cookie },
    });
    expect(account.body).not.toContain('bob@example.com');
    const audit = await h.app.inject({
      method: 'GET',
      url: `/api/projects/${alice.projectId}/audit`,
      headers: { cookie: alice.cookie },
    });
    expect(audit.body).not.toContain(bob.id);
    expect(audit.body).not.toContain(bob.projectId);
  });
});

describe('the same attacks, with every application-level check taken away', () => {
  it('still reaches nothing of Bob’s: the database refuses', async () => {
    attack = { on: true, as: principalOf(alice) };
    try {
      const leaks: string[] = [];
      let reached = 0;
      for (const { method, url } of apiRoutes()) {
        if (kindOf(method, url) !== 'project') continue;
        const response = await h.app.inject({
          method: method as 'GET',
          url: fill(url),
          headers: { cookie: alice.cookie, ...csrf, ...json },
          ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
        });
        reached += 1;
        const body = response.body;
        if (body.includes(CANARY))
          leaks.push(`${method} ${url} → ${response.statusCode} leaked the canary`);
        if (
          response.statusCode === 200 ||
          response.statusCode === 201 ||
          response.statusCode === 202 ||
          response.statusCode === 204
        ) {
          // A route that answers is allowed to answer with nothing; it must not answer with Bob's.
          if (body.includes(bob.projectId) && !/"error"/u.test(body) && method === 'GET')
            leaks.push(`${method} ${url} → ${response.statusCode} named Bob's project`);
        }
      }
      expect(reached).toBeGreaterThan(80);
      expect(leaks).toEqual([]);
      // And nothing of Bob's was changed: his project, his budget and his rows are as they were.
      const intact = h.built.repository.asSystem(() =>
        h.built.repository.extend((db) => ({
          projects: Number(
            db.prepare('SELECT COUNT(*) AS n FROM projects WHERE tenant_id = ?').get(bob.workspace)
              ?.n,
          ),
          budget: db
            .prepare('SELECT call_limit, token_limit FROM project_usage WHERE project_id = ?')
            .get(bob.projectId),
          members: Number(
            db
              .prepare('SELECT COUNT(*) AS n FROM project_members WHERE project_id = ?')
              .get(bob.projectId)?.n,
          ),
        })),
      );
      expect(intact.projects).toBe(1);
      expect(intact.budget).toMatchObject({ call_limit: 77, token_limit: 7777 });
      expect(intact.members).toBe(1);
    } finally {
      attack = { on: false, as: null };
    }
  }, 120_000);

  it('cannot list, count or read Bob’s project through the routes that do not name one', async () => {
    attack = { on: true, as: principalOf(alice) };
    try {
      for (const { method, url } of apiRoutes()) {
        if (method !== 'GET' || url.includes(':')) continue;
        if (
          !['project', 'signed-in', 'workspace', 'platform', 'public'].includes(
            String(kindOf(method, url)),
          )
        )
          continue;
        const response = await h.app.inject({
          method: 'GET',
          url,
          headers: { cookie: alice.cookie },
        });
        expect(response.body, `GET ${url}`).not.toContain(CANARY);
        expect(response.body, `GET ${url}`).not.toContain(bob.projectId);
      }
    } finally {
      attack = { on: false, as: null };
    }
  });
});
