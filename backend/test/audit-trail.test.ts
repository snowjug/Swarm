import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { AUDIT_POLICY } from '../src/auth/audit-policy.js';
import { ROUTE_POLICY } from '../src/auth/policy.js';
import { fixtureInput, testConfig } from './fixtures.js';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
async function setup() {
  const instance = await buildApp({ config: testConfig() });
  applications.push(instance);
  return instance;
}
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

// Planted in everything a person types or a source says. The log may hold identifiers, counts and
// short labels, so this must never turn up in it.
const CANARY = 'zq-canary-7421';

describe('what the audit log is told about', () => {
  it('decides what is recorded for every route, and for no route that does not exist', async () => {
    const { routes } = await setup();
    const registered = new Set(
      routes
        .filter((route) => route.url.startsWith('/api') && route.method !== 'HEAD')
        .map((route) => `${route.method} ${route.url}`),
    );
    expect([...registered].filter((key) => !(key in AUDIT_POLICY))).toEqual([]);
    expect(Object.keys(AUDIT_POLICY).filter((key) => !registered.has(key))).toEqual([]);
    expect(Object.keys(AUDIT_POLICY).sort()).toEqual(Object.keys(ROUTE_POLICY).sort());
  });

  it('records every route that changes something, or says why it does not', () => {
    for (const [route, rule] of Object.entries(AUDIT_POLICY)) {
      if (rule.kind === 'none') {
        expect(rule.reason.length, route).toBeGreaterThan(10);
        // Changing something and recording nothing needs a reason that is spelled out here.
        if (!route.startsWith('GET ')) {
          expect(route).toBe('POST /api/documents/extract');
        }
      } else {
        expect(rule.action, route).toMatch(/^[a-z]+(?:\.[a-z]+){1,2}$/u);
      }
    }
  });

  it('writes who did what, in order, without any of the content', async () => {
    const { app, repository, jobs } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: fixtureInput({
        workflow: 'guided',
        name: `Scenario ${CANARY}`,
        question: `How might people respond to ${CANARY}?`,
        settings: { mode: 'local', agentCount: 6, rounds: 6, seed: 42, network: 'community' },
        documents: [
          {
            name: 'notes.md',
            content: `A fictional note about transit. ${CANARY} appears here. Commuters support reliable transit, but some worry about route changes.`,
          },
        ],
      }),
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { id: string }).id;

    for (const step of ['knowledge', 'environment'] as const) {
      expect(
        (await app.inject({ method: 'POST', url: `/api/projects/${id}/steps/${step}` })).statusCode,
      ).toBe(202);
      await jobs.idle();
    }
    // An intervention can only be scheduled on a paused run, so: start, pause, schedule, resume.
    expect(
      (await app.inject({ method: 'POST', url: `/api/projects/${id}/steps/simulation` }))
        .statusCode,
    ).toBe(202);
    for (let attempt = 0; repository.get(id).rounds.length < 1; attempt += 1) {
      if (attempt > 20_000) throw new Error('The simulation never saved a round.');
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(
      (await app.inject({ method: 'POST', url: `/api/projects/${id}/pause` })).statusCode,
    ).toBe(202);
    await jobs.idle();
    const scheduled = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}/intervention`,
      payload: { round: 6, label: `Assumed announcement ${CANARY}`, stance: 0.5, strength: 0.5 },
    });
    expect(scheduled.statusCode, scheduled.body).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/projects/${id}/steps/simulation`,
          payload: { resume: true },
        })
      ).statusCode,
    ).toBe(202);
    await jobs.idle();
    expect(
      (await app.inject({ method: 'POST', url: `/api/projects/${id}/steps/report` })).statusCode,
    ).toBe(202);
    await jobs.idle();
    const asked = await app.inject({
      method: 'POST',
      url: `/api/projects/${id}/chat`,
      payload: { target: 'report', message: `What about ${CANARY}?` },
    });
    expect(asked.statusCode, asked.body).toBe(200);
    expect((await app.inject(`/api/projects/${id}/export?format=json`)).statusCode).toBe(200);
    expect((await app.inject(`/api/projects/${id}/export?format=markdown`)).statusCode).toBe(200);
    const branched = await app.inject({
      method: 'POST',
      url: `/api/projects/${id}/branches`,
      payload: { name: `Branch ${CANARY}`, fromRound: 1 },
    });
    expect(branched.statusCode, branched.body).toBe(201);
    const child = (branched.json() as { id: string }).id;
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${child}` })).statusCode).toBe(
      204,
    );

    const entries = repository.audit.list({ limit: 500 });
    // The ledger is built the first time something reads it, which is not what this test is about.
    expect(
      entries.map((entry) => entry.action).filter((action) => action !== 'ledger.built'),
    ).toEqual([
      'project.created',
      'step.started',
      'step.started',
      'step.started',
      'run.paused',
      'intervention.set',
      'step.started',
      'step.started',
      'chat.asked',
      'export.downloaded',
      'export.downloaded',
      'project.created',
      'branch.created',
      'project.deleted',
    ]);
    const byAction = (action: string) => entries.filter((entry) => entry.action === action);
    expect(byAction('step.started').map((entry) => entry.detail)).toEqual([
      { step: 'knowledge', resume: false },
      { step: 'environment', resume: false },
      { step: 'simulation', resume: false },
      { step: 'simulation', resume: true },
      { step: 'report', resume: false },
    ]);
    expect(byAction('intervention.set')[0]!.detail).toEqual({ removed: false, round: 6 });
    expect(byAction('chat.asked')[0]!.detail).toEqual({ target: 'analyst' });
    expect(byAction('export.downloaded').map((entry) => entry.detail)).toEqual([
      { format: 'json' },
      { format: 'markdown' },
    ]);
    expect(byAction('project.created').map((entry) => entry.detail.branch)).toEqual([false, true]);
    expect(byAction('branch.created')[0]!.detail).toMatchObject({
      parentId: id,
      fromRound: 1,
      intervention: 'inherited',
    });
    expect(
      entries
        .filter((entry) => entry.action !== 'ledger.built')
        .every((e) => e.actor === 'local-user'),
    ).toBe(true);
    expect(byAction('ledger.built').every((entry) => entry.actor === 'system')).toBe(true);
    expect(JSON.stringify(entries)).not.toContain(CANARY);
    expect(repository.audit.verify()).toMatchObject({ ok: true, brokenAt: null });
  });

  it('records nothing for a request that failed, however it failed', async () => {
    const { app, repository } = await setup();
    const draft = repository.create(fixtureInput({ workflow: 'guided' }));
    const before = repository.audit.list({ limit: 500 }).length;
    const attempts = [
      // Not finished, so there is no Markdown to hand over.
      await app.inject(`/api/projects/${draft.id}/export?format=markdown`),
      // A project that does not exist.
      await app.inject({
        method: 'POST',
        url: '/api/projects/de300001-0000-4000-8000-0000000000ff/chat',
        payload: { target: 'report', message: 'Anyone there?' },
      }),
      // A step whose earlier stages have not run.
      await app.inject({ method: 'POST', url: `/api/projects/${draft.id}/steps/simulation` }),
      // An invalid body.
      await app.inject({
        method: 'PUT',
        url: `/api/projects/${draft.id}/intervention`,
        payload: { round: 'soon' },
      }),
    ];
    expect(attempts.map((attempt) => attempt.statusCode >= 400)).toEqual([true, true, true, true]);
    expect(repository.audit.list({ limit: 500 })).toHaveLength(before);
  });
});
