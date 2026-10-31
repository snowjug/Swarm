import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import type { GroundingReview } from '../../shared/grounding.js';
import { buildApp } from '../src/app.js';
import { policyFor, ROUTE_POLICY } from '../src/auth/policy.js';
import { parseAppRoles } from '../src/auth/roles.js';
import { TokenVerifier, bearerToken } from '../src/auth/tokens.js';
import { loadConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { MIGRATIONS } from '../src/storage/migrations.js';
import { Repository } from '../src/storage/repository.js';
import { fixtureInput, testConfig } from './fixtures.js';
import {
  TENANT_A,
  TENANT_B,
  TENANT_C,
  authorization,
  entraEnvironment,
  idp,
  mint,
  verifier,
  type Minted,
} from './support/entra-idp.js';

const AUDIENCE = 'api://swarm-test';
const ANALYST_1 = 'aaaaaaa1-0000-4000-8000-000000000001';
const ANALYST_2 = 'aaaaaaa2-0000-4000-8000-000000000002';
const READER = 'aaaaaaa3-0000-4000-8000-000000000003';
const REVIEWER = 'aaaaaaa4-0000-4000-8000-000000000004';
const ADMIN = 'aaaaaaa5-0000-4000-8000-000000000005';
const PLATFORM = 'aaaaaaa6-0000-4000-8000-000000000006';
const OUTSIDER = 'bbbbbbb1-0000-4000-8000-000000000001';

const now = () => Math.floor(Date.now() / 1000);

async function refusal(token: string | null): Promise<AppError> {
  try {
    await verifier().verify(token);
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('The token was accepted.');
}

describe('configuration', () => {
  it('defaults to no sign-in, with one local user', () => {
    const config = loadConfig({});
    expect(config.auth).toEqual({
      mode: 'none',
      tenants: new Set(),
      audience: null,
      jwksUri: null,
      session: null,
    });
  });

  it('reads an Entra setup, lower-casing tenants and defaulting to Microsoft’s key endpoint', () => {
    const config = testConfig({
      ...entraEnvironment,
      AUTH_ENTRA_TENANT_ID: TENANT_A.toUpperCase(),
    });
    expect(config.auth.mode).toBe('entra');
    expect([...config.auth.tenants].sort()).toEqual([TENANT_A, TENANT_B]);
    expect(config.auth.audience).toBe(AUDIENCE);
    expect(config.auth.jwksUri).toBe(
      'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    );
  });

  it('refuses to start in Entra mode with anything missing, rather than accepting everyone', () => {
    const without = (key: string) => {
      const environment: Record<string, string | undefined> = { ...entraEnvironment };
      delete environment[key];
      return environment;
    };
    expect(() => testConfig(without('AUTH_ENTRA_TENANT_ID'))).not.toThrow();
    expect(() => testConfig({ AUTH_MODE: 'entra', AUTH_ENTRA_AUDIENCE: AUDIENCE })).toThrow(
      /AUTH_ENTRA_TENANT_ID/u,
    );
    expect(() => testConfig(without('AUTH_ENTRA_AUDIENCE'))).toThrow(/AUTH_ENTRA_AUDIENCE/u);
    expect(() =>
      testConfig({ ...entraEnvironment, AUTH_ENTRA_JWKS_URI: 'http://keys.example.test/jwks' }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      testConfig({ ...entraEnvironment, AUTH_ENTRA_ALLOWED_TENANTS: 'not-a-guid' }),
    ).toThrow(/tenant GUIDs/u);
    expect(() => testConfig({ ...entraEnvironment, AUTH_ENTRA_TENANT_ID: 'contoso' })).toThrow(
      /Invalid server configuration/u,
    );
  });

  it('tells the client which kind of sign-in applies, and nothing else about it', async () => {
    const instance = await buildApp({ config: testConfig() });
    try {
      const body = (await instance.app.inject('/api/config')).json();
      expect(body.capabilities.authentication).toBe('local-single-user');
      expect(JSON.stringify(body)).not.toContain(TENANT_A);
    } finally {
      await instance.app.close();
    }
  });
});

describe('app roles', () => {
  it('lets anyone with a Swarm app role in, and says which of them may do more', () => {
    expect(parseAppRoles(['Swarm.User'])).toEqual({
      user: true,
      platformAdmin: false,
      bootstrapAdmin: false,
    });
    // The roles of the first release still let a person in; membership decides what they may see.
    for (const legacy of ['Swarm.Reader', 'swarm.ANALYST', 'Swarm.Reviewer']) {
      expect(parseAppRoles([legacy])).toMatchObject({ user: true, platformAdmin: false });
    }
    expect(parseAppRoles(['Swarm.Admin'])).toEqual({
      user: true,
      platformAdmin: false,
      bootstrapAdmin: true,
    });
    expect(parseAppRoles(['Swarm.PlatformAdmin'])).toEqual({
      user: true,
      platformAdmin: true,
      bootstrapAdmin: false,
    });
  });

  it('ignores anything else, including values that are not strings', () => {
    for (const values of [[], ['Other.Admin', 7, null], ['SwarmAdmin', 'Swarm.', ' Swarm.User']]) {
      expect(parseAppRoles(values)).toEqual({
        user: false,
        platformAdmin: false,
        bootstrapAdmin: false,
      });
    }
  });
});

describe('bearerToken', () => {
  it('reads only a well-formed Authorization: Bearer header', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    for (const header of [
      undefined,
      '',
      'bearer abc.def.ghi',
      'Basic abc',
      'Bearer ',
      'Bearer abc def',
      'Bearer abc.def.ghi, Bearer other',
      'Bearer abc\ndef',
    ]) {
      expect(bearerToken(header)).toBeNull();
    }
  });
});

describe('token verification', () => {
  it('accepts a valid token from the configured tenant and builds a principal from it', async () => {
    const principal = await verifier().verify(await mint({ oid: ANALYST_1.toUpperCase() }));
    expect(principal).toEqual({
      id: ANALYST_1,
      tenantId: TENANT_A,
      platformAdmin: false,
      bootstrapAdmin: false,
    });
  });

  it('accepts a tenant that is on the allow-list, and keeps it apart from the first', async () => {
    const principal = await verifier().verify(await mint({ tid: TENANT_B, oid: OUTSIDER }));
    expect(principal).toMatchObject({ tenantId: TENANT_B, id: OUTSIDER });
  });

  it('reads the platform and bootstrap roles from among several', async () => {
    const principal = await verifier().verify(
      await mint({ roles: ['Swarm.Reader', 'Swarm.PlatformAdmin', 'Swarm.Admin'] }),
    );
    expect(principal).toMatchObject({ platformAdmin: true, bootstrapAdmin: true });
  });

  it('says a signed-in person with no Swarm role has no role, which is not the same as signed out', async () => {
    for (const roles of [[], ['Contoso.Admin'], null]) {
      const error = await refusal(await mint({ roles }));
      expect(error).toMatchObject({ statusCode: 403, code: 'NO_ROLE' });
    }
  });

  it('refuses every other kind of bad token with the same answer, so none is an oracle', async () => {
    const hs256 = await new SignJWT({ tid: TENANT_A, oid: ANALYST_1, roles: ['Swarm.Admin'] })
      .setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
      .setIssuer(`https://login.microsoftonline.com/${TENANT_A}/v2.0`)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('10m')
      // The classic confusion attack: sign with the public key as if it were a shared secret.
      .sign(new TextEncoder().encode(JSON.stringify(idp.jwk)));
    const unsigned = [
      Buffer.from('{"alg":"none"}').toString('base64url'),
      Buffer.from(
        JSON.stringify({
          tid: TENANT_A,
          oid: ANALYST_1,
          roles: ['Swarm.Admin'],
          aud: AUDIENCE,
          iss: `https://login.microsoftonline.com/${TENANT_A}/v2.0`,
          exp: now() + 600,
          iat: now(),
        }),
      ).toString('base64url'),
      '',
    ].join('.');
    const good = await mint();
    const [head, body, signature] = good.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body!, 'base64url').toString()),
        roles: ['Swarm.Admin'],
      }),
    ).toString('base64url');

    const bad: Record<string, string | null> = {
      'no token': null,
      'not a token': 'not-a-token',
      'two parts': 'aaa.bbb',
      oversized: `${head}.${'a'.repeat(9_000)}.${signature}`,
      expired: await mint({ iat: now() - 7_200, exp: now() - 3_600 }),
      'wrong audience': await mint({ aud: 'api://something-else' }),
      'wrong issuer': await mint({ iss: 'https://sts.windows.net/' + TENANT_A + '/' }),
      'issuer of another tenant': await mint({
        iss: `https://login.microsoftonline.com/${TENANT_B}/v2.0`,
      }),
      'tenant not accepted': await mint({ tid: TENANT_C }),
      'no tenant': await mint({ tid: 'not-a-guid' }),
      'no object id': await mint({ oid: null }),
      'no issued-at': await mint({ iat: null }),
      'signed by someone else': await mint({ key: idp.attackerKey }),
      'tampered claims': `${head}.${forged}.${signature}`,
      'algorithm confusion': hs256,
      'no signature at all': unsigned,
    };
    const answers = new Map<string, string>();
    for (const [label, token] of Object.entries(bad)) {
      const error = await refusal(token);
      expect(error.statusCode, label).toBe(401);
      expect(error.code, label).toBe('UNAUTHENTICATED');
      answers.set(label, `${error.code}|${error.message}`);
    }
    expect(new Set(answers.values()).size).toBe(1);
  });

  it('allows a few seconds of clock drift, and no more', async () => {
    expect(
      (await verifier().verify(await mint({ iat: now() - 400, exp: now() - 30 }))).tenantId,
    ).toBe(TENANT_A);
    await expect(
      verifier().verify(await mint({ iat: now() - 400, exp: now() - 120 })),
    ).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('reports an unreachable key service as the server’s problem, not a bad token', async () => {
    const { errors } = await import('jose');
    const unreachable = new TokenVerifier(testConfig(entraEnvironment).auth, () => {
      throw new errors.JWKSTimeout();
    });
    await expect(unreachable.verify(await mint())).rejects.toMatchObject({
      statusCode: 503,
      code: 'IDENTITY_UNAVAILABLE',
    });
  });

  it('cannot be built without sign-in configured', () => {
    expect(() => new TokenVerifier(loadConfig({}).auth)).toThrow(/AUTH_MODE=entra/u);
  });
});

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function secured(logStream?: { write(message: string): void }, level = 'silent') {
  const config = testConfig({ ...entraEnvironment, LOG_LEVEL: level });
  const instance = await buildApp({
    config,
    tokenVerifier: new TokenVerifier(config.auth, idp.keys),
    ...(logStream ? { logStream } : {}),
  });
  applications.push(instance);
  // Who belongs to which workspace is set up directly; the membership tests drive it through the
  // API. The administrators own their workspaces, and everyone else is a member who may create
  // projects. What anyone may see beyond that is up to each project.
  const setup = { id: 'test-setup', workspaceRole: 'owner' as const };
  const enroll = (tenantId: string, principalId: string, role: 'owner' | 'member') =>
    instance.repository.members.setWorkspaceMember({ tenantId, principalId, role, actor: setup });
  enroll(TENANT_A, ADMIN, 'owner');
  for (const member of [ANALYST_1, ANALYST_2, READER, REVIEWER]) enroll(TENANT_A, member, 'member');
  enroll(TENANT_B, OUTSIDER, 'owner');
  return instance;
}

type Secured = Awaited<ReturnType<typeof secured>>;

const call = async (
  instance: Secured,
  as: Minted | null,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) =>
  instance.app.inject({
    method,
    url,
    headers: as ? await authorization(as) : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const users = {
  analyst1: { oid: ANALYST_1, roles: ['Swarm.Analyst'] },
  analyst2: { oid: ANALYST_2, roles: ['Swarm.Analyst'] },
  reader: { oid: READER, roles: ['Swarm.Reader'] },
  reviewer: { oid: REVIEWER, roles: ['Swarm.Reviewer'] },
  admin: { oid: ADMIN, roles: ['Swarm.Admin'] },
  platform: { oid: PLATFORM, roles: ['Swarm.PlatformAdmin'] },
  outsider: { tid: TENANT_B, oid: OUTSIDER, roles: ['Swarm.Admin'] },
} satisfies Record<string, Minted>;

function claim(id: string, text: string, kind: 'source-fact' | 'ai-hypothesis') {
  return {
    id,
    section: 'Findings',
    text,
    kind,
    sourceIds: kind === 'source-fact' ? ['S1'] : [],
    memoryIds: [],
    quote: null,
    verdict: kind === 'source-fact' ? ('supported' as const) : ('unchecked' as const),
    checks: { quote: null, overlap: 0.9, numbers: null, entailment: null },
    reason: 'Checked against the cited passage.',
  };
}

const grounding: GroundingReview = {
  checkedAt: '2026-01-01T00:00:00.000Z',
  method: 'deterministic',
  claims: [
    claim('C1', 'Neighborhood groups ask for accessible stops.', 'source-fact'),
    claim('C2', 'Residents may switch to transit if fares fall.', 'ai-hypothesis'),
  ],
  counts: { supported: 1, partial: 0, unsupported: 0, contradicted: 0, unchecked: 1 },
  unverifiedFigures: [],
  notes: [],
};

/** A project led by analyst 1, with a report so that there is something to read and review. */
async function ownedProject(instance: Secured): Promise<string> {
  const created = await call(instance, users.analyst1, 'POST', '/api/projects', fixtureInput());
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json<{ id: string }>().id;
  // A viewer and a reviewer have been added to it; analyst 2 and everyone else have not.
  for (const [principalId, role] of [
    [READER, 'viewer'],
    [REVIEWER, 'reviewer'],
  ] as const) {
    instance.repository.members.setProjectMember({
      projectId: id,
      tenantId: TENANT_A,
      principalId,
      role,
      actor: { id: ANALYST_1 },
    });
  }
  instance.repository.update(id, {
    status: 'completed',
    report: {
      generatedBy: 'llm',
      title: 'Transit report',
      executiveSummary: 'Summary of the transit scenario.',
      sections: [{ title: 'Findings', body: 'Body.', sourceIds: ['S1'] }],
      limitations: [],
      grounding,
      metrics: {
        initialMean: 0,
        finalMean: 0,
        finalSupport: 0.5,
        finalOpposition: 0.3,
        polarization: 0.2,
        totalInteractions: 1,
      },
    },
  });
  return id;
}

describe('every API route has an authorization policy', () => {
  it('covers all routes the server registers, and lists none that it does not', async () => {
    const instance = await secured();
    const registered = instance.routes
      .filter(({ url }) => url.startsWith('/api'))
      .filter(({ method }) => method !== 'HEAD')
      .map(({ method, url }) => `${method} ${url}`);
    expect(registered.length).toBeGreaterThan(25);
    const missing = registered.filter((key) => !(key in ROUTE_POLICY));
    expect(missing, 'routes with no policy are refused').toEqual([]);
    const stale = Object.keys(ROUTE_POLICY).filter((key) => !registered.includes(key));
    expect(stale, 'policy entries for routes that do not exist').toEqual([]);
  });

  it('treats HEAD like GET', () => {
    expect(policyFor('HEAD', '/api/projects/:id')).toBe(policyFor('GET', '/api/projects/:id'));
  });

  it('refuses a route it has no policy for, instead of allowing it', async () => {
    const config = testConfig(entraEnvironment);
    const instance = await buildApp({
      config,
      tokenVerifier: new TokenVerifier(config.auth, idp.keys),
    });
    applications.push(instance);
    delete (ROUTE_POLICY as Record<string, unknown>)['GET /api/projects'];
    try {
      const response = await call(instance, users.admin, 'GET', '/api/projects');
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('ROUTE_NOT_AUTHORIZED');
    } finally {
      (ROUTE_POLICY as Record<string, unknown>)['GET /api/projects'] = { kind: 'signed-in' };
    }
  });
});

// The guard vouches only for the experiment named in the path. A route that is handed another
// experiment's identifier anywhere else must check that the caller may read it with
// `requireReadable`, which is easy to forget and was forgotten once (compare). This is a tripwire and
// not a proof: it lists every UUID field that any route accepts, so that a new one cannot arrive
// unnoticed. If it fails, decide whether the new field names an experiment. If it does, call
// `requireReadable` on it, add a case to "comparing two experiments" above, and then add the field
// here.
describe('identifiers a route accepts outside the path', () => {
  const routesDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes');
  const uuidFields = (): string[] =>
    readdirSync(routesDirectory)
      .filter((file) => file.endsWith('.ts'))
      .flatMap((file) =>
        [
          ...readFileSync(join(routesDirectory, file), 'utf8').matchAll(
            /(\w+)\s*:\s*z\s*\.(?:string\(\)\s*\.)?uuid\(\)/gu,
          ),
        ].map((match) => `${file}: ${match[1]}`),
      )
      .sort();

  it('are exactly the ones that have been looked at', () => {
    expect(uuidFields()).toEqual([
      // In the path: vouched for by the guard. A comparison is named by `aid`, an id that is not a
      // UUID, and is only ever looked up inside the project in the path.
      'analysis.ts: id',
      // In the path: vouched for by the guard.
      'budget.ts: id',
      // In the path: vouched for by the guard.
      'guided.ts: id',
      // In the path: a survey of that experiment, always looked up within it.
      'guided.ts: surveyId',
      // In the query: another experiment, checked by requireReadable in the handler.
      'guided.ts: with',
      'ledger.ts: id',
      // In the path: the person a membership change is about. It names no experiment, and the
      // store only ever writes it beside the experiment the guard vouched for.
      'members.ts: id',
      'members.ts: id',
      'members.ts: principalId',
      'members.ts: principalId',
      'projects.ts: id',
      // In the path: vouched for by the guard. A section is named by a short id and a proposal by an
      // id, and both are only ever looked up inside the studio document of that experiment.
      'studio.ts: id',
    ]);
  });

  it('has the comparison check that the caller may read the experiment it is asked to compare with', () => {
    const source = readFileSync(join(routesDirectory, 'guided.ts'), 'utf8');
    expect(source).toMatch(
      /requireReadable\(\s*repository,\s*principalOf\(request\),\s*otherId\s*\)/u,
    );
  });
});

describe('signing in', () => {
  it('refuses every API call without a valid token, and answers the same whatever is wrong', async () => {
    const instance = await secured();
    const id = await ownedProject(instance);
    const bad = await call(instance, { aud: 'api://elsewhere' }, 'GET', `/api/projects/${id}`);
    const none = await call(instance, null, 'GET', `/api/projects/${id}`);
    expect(none.statusCode).toBe(401);
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.message).toBe(none.json().error.message);
    for (const [method, url] of [
      ['GET', '/api/projects'],
      ['GET', '/api/config'],
      ['GET', '/api/provider/status'],
      ['POST', '/api/provider/check'],
      ['GET', '/api/audit/verify'],
      ['GET', `/api/projects/${id}/ledger`],
      ['GET', `/api/projects/${id}/export?format=json`],
    ] as const) {
      expect((await call(instance, null, method, url)).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('keeps health public but shows an unauthenticated caller no counts', async () => {
    const instance = await secured();
    await ownedProject(instance);
    const health = await instance.app.inject('/api/health');
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({
      status: 'ok',
      service: 'swarm-lab',
      version: expect.any(String),
    });
  });

  it('serves the app’s own files without a token, so a person can load it and sign in', async () => {
    const instance = await secured();
    const page = await instance.app.inject({
      method: 'GET',
      url: '/',
      headers: { accept: 'text/html' },
    });
    expect(page.statusCode).not.toBe(401);
  });

  it('refuses before the request body is read, so a stranger cannot make the server parse one', async () => {
    const instance = await secured();
    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      payload: '{this is not json',
    });
    expect(response.statusCode).toBe(401);
  });

  it('never writes a token to the logs, even one that is refused', async () => {
    const lines: string[] = [];
    const instance = await secured({ write: (line) => lines.push(line) }, 'info');
    const marker = 'SECRETTOKENMARKER';
    const response = await instance.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { authorization: `Bearer ${marker}.payload.signature` },
    });
    expect(response.statusCode).toBe(401);
    const real = await mint();
    await instance.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { authorization: `Bearer ${real}` },
    });
    const logged = lines.join('\n');
    expect(logged.length).toBeGreaterThan(0);
    expect(logged).not.toContain(marker);
    expect(logged).not.toContain(real);
    expect(logged).not.toContain(real.split('.')[1]!);
  });
});

describe('tenant isolation', () => {
  it('shows each tenant only its own experiments, and counts only those', async () => {
    const instance = await secured();
    const mine = await ownedProject(instance);
    const theirs = await call(instance, users.outsider, 'POST', '/api/projects', fixtureInput());
    expect(theirs.statusCode).toBe(201);

    const seenByA = (await call(instance, users.analyst1, 'GET', '/api/projects')).json();
    expect(seenByA.projects.map((p: { id: string }) => p.id)).toEqual([mine]);
    expect(seenByA.total).toBe(1);
    const seenByB = (await call(instance, users.outsider, 'GET', '/api/projects')).json();
    expect(seenByB.projects.map((p: { id: string }) => p.id)).toEqual([theirs.json().id]);
    expect(seenByB.total).toBe(1);
  });

  it('answers another tenant’s experiment exactly as it answers one that does not exist', async () => {
    const instance = await secured();
    const id = await ownedProject(instance);
    const absent = '99999999-9999-4999-8999-999999999999';
    const routes = [
      ['GET', (p: string) => `/api/projects/${p}`],
      ['GET', (p: string) => `/api/projects/${p}/ledger`],
      ['GET', (p: string) => `/api/projects/${p}/claims/C1`],
      ['GET', (p: string) => `/api/projects/${p}/export?format=json`],
      ['GET', (p: string) => `/api/projects/${p}/evidence?query=transit`],
      ['GET', (p: string) => `/api/projects/${p}/chat?target=report`],
      ['GET', (p: string) => `/api/projects/${p}/audit`],
      ['GET', (p: string) => `/api/projects/${p}/memories`],
      ['POST', (p: string) => `/api/projects/${p}/run`],
      ['POST', (p: string) => `/api/projects/${p}/chat`],
      ['POST', (p: string) => `/api/projects/${p}/claims/C1/review`],
      ['POST', (p: string) => `/api/projects/${p}/conflicts/X1/review`],
      ['POST', (p: string) => `/api/projects/${p}/branches`],
      ['DELETE', (p: string) => `/api/projects/${p}`],
    ] as const;
    for (const [method, url] of routes) {
      // The other tenant's administrator can do nothing to it, and cannot tell it exists.
      const theirs = await call(instance, users.outsider, method, url(id), {});
      const nothing = await call(instance, users.outsider, method, url(absent), {});
      expect(theirs.statusCode, `${method} ${url(id)}`).toBe(404);
      expect(theirs.json().error.code).toBe(nothing.json().error.code);
      expect(theirs.json().error.message).toBe(nothing.json().error.message);
    }
    // And nothing changed.
    expect(instance.repository.get(id).name).toBe('Community transit pilot');
  });

  // The guard checks the experiment named in the path. A second experiment named in the query is
  // the caller's to prove, and it was once read without any tenant check at all.
  describe('comparing two experiments', () => {
    async function guidedRun(
      instance: Secured,
      owner: { tenantId: string; ownerId: string },
    ): Promise<string> {
      const created = instance.repository.create(
        fixtureInput({
          workflow: 'guided',
          settings: { mode: 'local', agentCount: 4, rounds: 3, seed: 5, network: 'community' },
        }),
        { owner },
      );
      for (const step of ['knowledge', 'environment', 'simulation'] as const) {
        instance.jobs.enqueueStep(created.id, step);
        await instance.jobs.idle();
      }
      expect(instance.repository.get(created.id).rounds).toHaveLength(3);
      return created.id;
    }

    it('answers a comparison with another tenant’s experiment exactly as with one that does not exist', async () => {
      const instance = await secured();
      const mine = await guidedRun(instance, { tenantId: TENANT_A, ownerId: ANALYST_1 });
      const theirs = await guidedRun(instance, { tenantId: TENANT_B, ownerId: OUTSIDER });
      const absent = '99999999-9999-4999-8999-999999999999';

      const foreign = await call(
        instance,
        users.admin,
        'GET',
        `/api/projects/${mine}/compare?with=${theirs}`,
      );
      const nothing = await call(
        instance,
        users.admin,
        'GET',
        `/api/projects/${mine}/compare?with=${absent}`,
      );
      expect(foreign.statusCode, foreign.body).toBe(404);
      expect(foreign.json().error.code).toBe('PROJECT_NOT_FOUND');
      expect(foreign.json().error.code).toBe(nothing.json().error.code);
      expect(foreign.json().error.message).toBe(nothing.json().error.message);
      // Nothing of the other tenant's experiment is in the answer.
      expect(foreign.body).not.toContain('Community transit pilot');

      // The same is true in the other direction, for the other tenant's administrator.
      const reverse = await call(
        instance,
        users.outsider,
        'GET',
        `/api/projects/${theirs}/compare?with=${mine}`,
      );
      expect(reverse.statusCode, reverse.body).toBe(404);
      expect(reverse.json().error.code).toBe(nothing.json().error.code);
      expect(reverse.json().error.message).toBe(nothing.json().error.message);
    });

    it('still compares two experiments of the same tenant', async () => {
      const instance = await secured();
      const mine = await guidedRun(instance, { tenantId: TENANT_A, ownerId: ANALYST_1 });
      const colleague = await guidedRun(instance, { tenantId: TENANT_A, ownerId: ANALYST_2 });
      const compared = await call(
        instance,
        users.admin,
        'GET',
        `/api/projects/${mine}/compare?with=${colleague}`,
      );
      expect(compared.statusCode, compared.body).toBe(200);
      expect(compared.json().lineage).toBe('unrelated');
    });
  });

  it('keeps the audit trail of one tenant’s project from another tenant', async () => {
    const instance = await secured();
    const id = await ownedProject(instance);
    expect(
      (await call(instance, users.reviewer, 'GET', `/api/projects/${id}/audit`)).statusCode,
    ).toBe(200);
    expect(
      (await call(instance, users.outsider, 'GET', `/api/projects/${id}/audit`)).statusCode,
    ).toBe(404);
  });

  it('applies the project limit to each tenant separately', async () => {
    const instance = await secured();
    const config = (await import('../../shared/types.js')).MAX_PROJECTS;
    for (let i = 0; i < config; i += 1) {
      instance.repository.create(fixtureInput(), {
        owner: { tenantId: TENANT_B, ownerId: OUTSIDER },
      });
    }
    const other = await call(instance, users.outsider, 'POST', '/api/projects', fixtureInput());
    expect(other.statusCode).toBe(409);
    const mine = await call(instance, users.analyst1, 'POST', '/api/projects', fixtureInput());
    expect(mine.statusCode).toBe(201);
  });
});

describe('what each kind of person may do to a project', () => {
  const allowedOnOthers = (status: number) => ![401, 403, 404].includes(status);

  it('lets a viewer look but not touch', async () => {
    const instance = await secured();
    const id = await ownedProject(instance);
    for (const url of [
      `/api/projects/${id}`,
      `/api/projects/${id}/ledger`,
      `/api/projects/${id}/claims/C1`,
      `/api/projects/${id}/export?format=json`,
      `/api/projects/${id}/evidence?query=transit`,
      '/api/projects',
      '/api/config',
    ]) {
      expect((await call(instance, users.reader, 'GET', url)).statusCode, url).toBe(200);
    }
    for (const [method, url] of [
      ['POST', `/api/projects/${id}/run`],
      ['POST', `/api/projects/${id}/chat`],
      ['POST', `/api/projects/${id}/claims/C1/review`],
      ['DELETE', `/api/projects/${id}`],
      ['GET', `/api/projects/${id}/audit`],
      ['GET', '/api/audit/verify'],
      ['POST', '/api/provider/check'],
    ] as const) {
      const response = await call(instance, users.reader, method, url, {});
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    }
  });

  it('shows a project only to the people it was shared with', async () => {
    const instance = await secured();
    const id = await ownedProject(instance);
    // A colleague in the same workspace who was not added cannot tell that it exists.
    const absent = '99999999-9999-4999-8999-999999999999';
    for (const [method, url] of [
      ['GET', (p: string) => `/api/projects/${p}`],
      ['GET', (p: string) => `/api/projects/${p}/export?format=json`],
      ['POST', (p: string) => `/api/projects/${p}/run`],
      ['POST', (p: string) => `/api/projects/${p}/chat`],
      ['DELETE', (p: string) => `/api/projects/${p}`],
    ] as const) {
      const hidden = await call(instance, users.analyst2, method, url(id), {});
      const nothing = await call(instance, users.analyst2, method, url(absent), {});
      expect(hidden.statusCode, `${method} ${url(id)}`).toBe(404);
      // The request id differs on every request; what the caller can compare is the rest.
      expect(hidden.json().error).toMatchObject({
        code: nothing.json().error.code,
        message: nothing.json().error.message,
      });
    }
    const listed = (await call(instance, users.analyst2, 'GET', '/api/projects')).json();
    expect(listed).toMatchObject({ projects: [], total: 0 });

    // Once added as an analyst, they can run it but not delete it or share it.
    instance.repository.members.setProjectMember({
      projectId: id,
      tenantId: TENANT_A,
      principalId: ANALYST_2,
      role: 'analyst',
      actor: { id: ANALYST_1 },
    });
    const run = await call(instance, users.analyst2, 'POST', `/api/projects/${id}/run`);
    expect(allowedOnOthers(run.statusCode)).toBe(true);
    for (const [method, url, payload] of [
      ['DELETE', `/api/projects/${id}`, undefined],
      ['PUT', `/api/projects/${id}/members/${ANALYST_2}`, { role: 'lead' }],
    ] as const) {
      const refused = await call(instance, users.analyst2, method, url, payload ?? {});
      expect(refused.statusCode, `${method} ${url}`).toBe(403);
      expect(refused.json().error.code).toBe('FORBIDDEN');
    }
  });

  it('lets an owner of the workspace act on any project in it, but not in another', async () => {
    const instance = await secured();
    const id = await ownedProject(instance);
    const run = await call(instance, users.admin, 'POST', `/api/projects/${id}/run`);
    expect(allowedOnOthers(run.statusCode)).toBe(true);
    expect((await call(instance, users.admin, 'GET', `/api/projects/${id}/audit`)).statusCode).toBe(
      200,
    );
    // Owning a workspace is not running the platform.
    expect((await call(instance, users.admin, 'GET', '/api/audit/verify')).statusCode).toBe(403);
    expect((await call(instance, users.admin, 'DELETE', `/api/projects/${id}`)).statusCode).toBe(
      204,
    );
  });

  it('lets a reviewer review anyone’s work, but not run it', async () => {
    const instance = await secured();
    const id = await ownedProject(instance);
    const review = await call(
      instance,
      users.reviewer,
      'POST',
      `/api/projects/${id}/claims/C2/review`,
      {
        result: 'accepted',
        note: 'Looks right.',
      },
    );
    expect(review.statusCode, review.body).toBe(200);
    expect(
      (await call(instance, users.reviewer, 'POST', `/api/projects/${id}/run`)).statusCode,
    ).toBe(403);
    // An analyst on the project, who runs it, cannot review it: reviewing is a separate duty.
    instance.repository.members.setProjectMember({
      projectId: id,
      tenantId: TENANT_A,
      principalId: ANALYST_2,
      role: 'analyst',
      actor: { id: ANALYST_1 },
    });
    expect(
      (
        await call(instance, users.analyst2, 'POST', `/api/projects/${id}/claims/C2/review`, {
          result: 'rejected',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('records who reviewed a statement, by their object id and nothing about them', async () => {
    const instance = await secured();
    const id = await ownedProject(instance);
    await call(instance, users.reviewer, 'POST', `/api/projects/${id}/claims/C2/review`, {
      result: 'rejected',
      note: 'Not supported.',
    });
    await call(instance, users.reviewer, 'POST', `/api/projects/${id}/conflicts/X1/review`, {
      status: 'dismissed',
    });
    const audit = (await call(instance, users.reviewer, 'GET', `/api/projects/${id}/audit`)).json();
    const reviewed = audit.events.find(
      (event: { action: string }) => event.action === 'claim.reviewed',
    );
    expect(reviewed.actor).toBe(REVIEWER);
    expect(JSON.stringify(audit)).not.toContain('Not supported.');
  });

  it('records who deleted an experiment', async () => {
    const instance = await secured();
    const id = await ownedProject(instance);
    expect((await call(instance, users.analyst1, 'DELETE', `/api/projects/${id}`)).statusCode).toBe(
      204,
    );
    const verified = await call(instance, users.platform, 'GET', '/api/audit/verify');
    expect(verified.json()).toMatchObject({ ok: true });
    const entries = instance.repository.audit.list({ projectId: id, limit: 50 });
    expect(entries.find((entry) => entry.action === 'project.deleted')?.actor).toBe(ANALYST_1);
  });
});

describe('ownership of what people create', () => {
  it('records the signed-in analyst as leader of a new experiment, in their tenant', async () => {
    const instance = await secured();
    const created = await call(instance, users.analyst2, 'POST', '/api/projects', fixtureInput());
    expect(instance.repository.ownership(created.json().id)).toEqual({
      tenantId: TENANT_A,
      ownerId: ANALYST_2,
    });
    expect(instance.repository.members.projectRole(created.json().id, ANALYST_2)).toBe('lead');
  });

  it('gives a branch to whoever branched it, not to the owner of its parent', async () => {
    const instance = await secured();
    const created = await call(
      instance,
      users.analyst1,
      'POST',
      '/api/projects',
      fixtureInput({ workflow: 'guided' }),
    );
    const id = created.json<{ id: string }>().id;
    for (const step of ['knowledge', 'environment'] as const) {
      instance.jobs.enqueueStep(id, step);
      await instance.jobs.idle();
    }
    instance.repository.members.setProjectMember({
      projectId: id,
      tenantId: TENANT_A,
      principalId: ANALYST_2,
      role: 'analyst',
      actor: { id: ANALYST_1 },
    });
    const branch = await call(instance, users.analyst2, 'POST', `/api/projects/${id}/branches`, {
      fromRound: 0,
      name: 'A colleague’s what-if',
    });
    expect(branch.statusCode, branch.body).toBe(201);
    expect(instance.repository.ownership(branch.json().id)).toEqual({
      tenantId: TENANT_A,
      ownerId: ANALYST_2,
    });
    expect(instance.repository.members.projectRole(branch.json().id, ANALYST_2)).toBe('lead');
    // The parent's leader was not added to their colleague's branch, so cannot even see it.
    expect(
      (await call(instance, users.analyst1, 'POST', `/api/projects/${branch.json().id}/run`))
        .statusCode,
    ).toBe(404);
    // And the outsider cannot branch it at all.
    expect(
      (
        await call(instance, users.outsider, 'POST', `/api/projects/${id}/branches`, {
          fromRound: 0,
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('refusals are recorded for a signed-in caller', () => {
  it('keeps who was refused, where and why, and nothing for a caller who was never signed in', async () => {
    const instance = await secured();
    const project = instance.repository.create(fixtureInput({ workflow: 'guided' }), {
      owner: { tenantId: TENANT_A, ownerId: ANALYST_1 },
    });
    instance.repository.members.setProjectMember({
      projectId: project.id,
      tenantId: TENANT_A,
      principalId: READER,
      role: 'viewer',
      actor: { id: ANALYST_1 },
    });
    const step = `/api/projects/${project.id}/steps/knowledge`;

    const forbidden = await call(instance, users.reader, 'POST', step);
    const notShared = await call(instance, users.analyst2, 'POST', step);
    const otherTenant = await call(instance, users.outsider, 'GET', `/api/projects/${project.id}`);
    const anonymous = await call(instance, null, 'GET', `/api/projects/${project.id}`);
    expect([forbidden, notShared, otherTenant, anonymous].map((r) => r.statusCode)).toEqual([
      403, 404, 404, 401,
    ]);

    const refused = instance.repository.audit
      .list({ limit: 500 })
      .filter((entry) => entry.action === 'access.refused');
    expect(refused.map((entry) => [entry.actor, entry.detail.code, entry.detail.status])).toEqual([
      [READER, 'FORBIDDEN', 403],
      [ANALYST_2, 'PROJECT_NOT_FOUND', 404],
      [OUTSIDER, 'PROJECT_NOT_FOUND', 404],
    ]);
    expect(refused[0]!.detail).toMatchObject({ method: 'POST', experiment: project.id });
    expect(refused.every((entry) => entry.targetType === 'route')).toBe(true);
    // The route pattern, never the caller's own path or token.
    expect(refused[0]!.targetId).toBe('/api/projects/:id/steps/:step');
    expect(instance.repository.audit.verify().ok).toBe(true);
  });

  it('does not record a request that was allowed', async () => {
    const instance = await secured();
    const project = instance.repository.create(fixtureInput({ workflow: 'guided' }), {
      owner: { tenantId: TENANT_A, ownerId: ANALYST_1 },
    });
    const allowed = await call(instance, users.analyst1, 'GET', `/api/projects/${project.id}`);
    expect(allowed.statusCode).toBe(200);
    expect(
      instance.repository.audit.list({ limit: 500 }).filter((e) => e.action === 'access.refused'),
    ).toEqual([]);
  });
});

describe('the local mode is unchanged', () => {
  it('needs no token, treats the caller as the local user and owner, and shows full health', async () => {
    const instance = await buildApp({ config: testConfig() });
    applications.push(instance);
    const created = await instance.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: fixtureInput(),
    });
    expect(created.statusCode).toBe(201);
    expect(instance.repository.ownership(created.json().id)).toEqual({
      tenantId: 'local',
      ownerId: 'local-user',
    });
    expect((await instance.app.inject('/api/projects')).json().total).toBe(1);
    const health = (await instance.app.inject('/api/health')).json();
    expect(health).toMatchObject({ storage: instance.repository.dialect, experiments: 1 });
  });

  it('ignores a token it does not need, rather than failing on it', async () => {
    const instance = await buildApp({ config: testConfig() });
    applications.push(instance);
    const response = await instance.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { authorization: 'Bearer garbage' },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('upgrading a database that has no owners', () => {
  it('gives every existing experiment to the local user, keeps it readable, and backs up first', () => {
    const directory = mkdtempSync(join(tmpdir(), 'swarm-owners-'));
    directories.push(directory);
    const path = join(directory, 'swarm.sqlite');
    const first = new Repository(path);
    const project = first.create(fixtureInput());
    first.close();

    // Make it what the previous release wrote: schema version 2, no ownership columns, no members,
    // no sign-in state.
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      DROP INDEX projects_tenant;
      ALTER TABLE projects DROP COLUMN tenant_id;
      ALTER TABLE projects DROP COLUMN owner_id;
      DROP TABLE project_members;
      DROP TABLE workspace_members;
      DROP TABLE sessions;
      DROP TABLE login_attempts;
      DROP TABLE jobs;
      PRAGMA user_version = 2;
    `);
    legacy.close();

    const upgraded = new Repository(path);
    expect(upgraded.migration.from).toBe(2);
    // Every migration after the one it was at, in order: this must not need editing for each new one.
    expect(upgraded.migration.applied.map((step) => step.slice(0, step.indexOf(':') + 1))).toEqual(
      MIGRATIONS.filter((migration) => migration.version > 2).map(
        (migration) => `${migration.version}:`,
      ),
    );
    expect(upgraded.ownership(project.id)).toEqual({ tenantId: 'local', ownerId: 'local-user' });
    expect(upgraded.get(project.id).name).toBe(project.name);
    expect(upgraded.list(100, 0, 'local').projects).toHaveLength(1);
    // The owner leads their project and belongs to the workspace; nobody is made an administrator.
    expect(upgraded.members.projectRole(project.id, 'local-user')).toBe('lead');
    expect(upgraded.members.workspaceRole('local', 'local-user')).toBe('member');
    expect(upgraded.members.workspaceMembers('local').map((member) => member.role)).toEqual([
      'member',
    ]);
    // Nobody else's tenant sees it.
    expect(upgraded.list(100, 0, TENANT_A)).toEqual({ projects: [], total: 0 });
    expect(upgraded.ownership('99999999-9999-4999-8999-999999999999')).toBeNull();
    expect(existsSync(`${path}.v2.bak`)).toBe(true);
    upgraded.close();
  });
});
