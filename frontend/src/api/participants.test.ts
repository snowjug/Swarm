import { afterEach, describe, expect, it, vi } from 'vitest';
import { actorSetFixture, stakeholderSetFixture } from '../../../shared/lab-fixtures';
import type { ActorsView, StakeholdersView } from '../../../shared/stakeholders';
import { ApiError } from '../api';
import { participantsApi, thenActors } from './participants';

afterEach(() => vi.unstubAllGlobals());

const MODEL = { available: false, reason: 'No model is configured here.' };
const MAY = { edit: true, run: true };

const viewOf = (revision: number): StakeholdersView => ({
  stakeholders: stakeholderSetFixture(),
  revision,
  model: MODEL,
  may: MAY,
});
const actorsOf = (): ActorsView => ({
  actors: actorSetFixture(),
  revision: 2,
  stale: false,
  model: MODEL,
  may: MAY,
});

interface Call {
  method: string;
  path: string;
  body: unknown;
  csrf: boolean;
}
type Reply = { status?: number; body: unknown };

function server(replies: Record<string, Reply>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({
        method,
        path,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        csrf: headers['X-Swarm-CSRF'] === '1',
      });
      const reply = replies[`${method} ${path}`];
      if (!reply) throw new Error(`Nothing is scripted for ${method} ${path}.`);
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

describe('the participant routes as the page calls them', () => {
  it('sends each change with the method, address, body and anti-forgery header the server expects', async () => {
    const base = '/api/projects/p%201/stakeholders';
    const calls = server({
      [`POST ${base}/propose`]: { body: viewOf(1) },
      [`GET ${base}/validation`]: { body: { review: null } },
      [`POST ${base}/accept`]: { body: viewOf(2) },
      [`PATCH ${base}/a%2Fb`]: { body: viewOf(3) },
      [`DELETE ${base}/a%2Fb?expectedRevision=3`]: { body: viewOf(4) },
      [`POST ${base}/a%2Fb/regenerate`]: { body: viewOf(5) },
      [`GET ${base}/a%2Fb/why`]: { body: { id: 'a/b' } },
      [`POST ${base}/merge-duplicates`]: { body: viewOf(6) },
      [`POST ${base}/add-missing`]: { body: viewOf(7) },
    });
    await participantsApi.propose('p 1', { mode: 'model', confirm: true });
    await participantsApi.validation('p 1');
    await participantsApi.accept('p 1', { expectedRevision: 1, ids: ['x'] });
    await participantsApi.edit('p 1', 'a/b', {
      expectedRevision: 2,
      changes: { objective: 'Keep the queue short.' },
    });
    await participantsApi.remove('p 1', 'a/b', 3);
    await participantsApi.regenerate('p 1', 'a/b', { expectedRevision: 4, mode: 'rules' });
    await participantsApi.why('p 1', 'a/b');
    await participantsApi.mergeDuplicates('p 1', { expectedRevision: 5 });
    await participantsApi.addMissing('p 1', {
      expectedRevision: 6,
      role: 'regulators-governance',
      name: 'The compliance reviewer',
    });
    expect(calls.map((call) => `${call.method} ${call.path.replace(base, '')}`)).toEqual([
      'POST /propose',
      'GET /validation',
      'POST /accept',
      'PATCH /a%2Fb',
      'DELETE /a%2Fb?expectedRevision=3',
      'POST /a%2Fb/regenerate',
      'GET /a%2Fb/why',
      'POST /merge-duplicates',
      'POST /add-missing',
    ]);
    expect(calls[0]?.body).toEqual({ mode: 'model', confirm: true });
    expect(calls[3]?.body).toEqual({
      expectedRevision: 2,
      changes: { objective: 'Keep the queue short.' },
    });
    expect(calls[4]?.body).toBeUndefined();
    expect(calls.filter((call) => call.method !== 'GET').every((call) => call.csrf)).toBe(true);
    expect(calls.filter((call) => call.method === 'GET').every((call) => !call.csrf)).toBe(true);
  });

  it('turns a refusal into an error that carries the server’s code and its sentence', async () => {
    server({
      'POST /api/projects/p/stakeholders/accept': {
        status: 409,
        body: {
          error: {
            code: 'ARTIFACT_CONFLICT',
            message: 'Someone changed this first.',
            requestId: 'r1',
          },
        },
      },
    });
    const failure = await participantsApi
      .accept('p', { expectedRevision: 1 })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code: 'ARTIFACT_CONFLICT',
      message: 'Someone changed this first.',
    });
  });

  it('reads the actors again after a change, since a changed list can leave them out of date', async () => {
    const calls = server({
      'POST /api/projects/p/stakeholders/propose': { body: viewOf(1) },
      'GET /api/projects/p/actors': { body: actorsOf() },
    });
    const shown = await thenActors(
      'p',
      participantsApi.propose('p', { mode: 'rules', confirm: false }),
    );
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/projects/p/stakeholders/propose',
      'GET /api/projects/p/actors',
    ]);
    expect(shown.view.revision).toBe(1);
    expect(shown.actors.revision).toBe(2);
  });
});
