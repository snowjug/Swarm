import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actorFixture,
  actorSetFixture,
  stakeholderFixture,
  stakeholderSetFixture,
} from '../../../shared/lab-fixtures';
import type { ActorsView, StakeholdersView } from '../../../shared/stakeholders';
import { ApiError } from '../api';
import { approveFlow, discoverFlow, saveFlow } from './stakeholderFlows';
import { stakeholdersApi } from './stakeholders';

afterEach(() => vi.unstubAllGlobals());

const MODEL = { available: false, reason: 'No model is configured here.' };
const MAY = { edit: true, run: true };

const viewOf = (revision: number | null, approved = false): StakeholdersView => ({
  stakeholders:
    revision === null
      ? null
      : { ...stakeholderSetFixture(), approvedAt: approved ? '2026-01-15T10:00:00.000Z' : null },
  revision,
  model: MODEL,
  may: MAY,
});

const actorsOf = (edited = false): ActorsView => {
  const set = actorSetFixture();
  return {
    actors: {
      ...set,
      actors: set.actors.map((actor, index) =>
        index === 0 ? actorFixture(actor.id, actor.category, { ...actor, edited }) : actor,
      ),
    },
    revision: 2,
    stale: false,
    model: MODEL,
    may: MAY,
  };
};

interface Call {
  method: string;
  path: string;
  body: unknown;
  csrf: boolean;
}
type Reply = { status?: number; body: unknown };

/** A server that answers each `METHOD path` from a script and remembers what it was asked. */
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

describe('the stakeholder routes as the page calls them', () => {
  it('reads a project that has no stakeholders as a normal answer with nothing in it', async () => {
    const calls = server({
      'GET /api/projects/p%201/stakeholders': { body: viewOf(null) },
      'GET /api/projects/p%201/actors': {
        body: { actors: null, revision: null, stale: false, model: MODEL, may: MAY },
      },
    });
    const view = await stakeholdersApi.get('p 1');
    const actors = await stakeholdersApi.actors('p 1');
    expect(view.stakeholders).toBeNull();
    expect(actors.actors).toBeNull();
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/projects/p%201/stakeholders',
      'GET /api/projects/p%201/actors',
    ]);
    expect(calls.every((call) => !call.csrf)).toBe(true);
  });

  it('sends each change with the method, body and anti-forgery header the server expects', async () => {
    const calls = server({
      'POST /api/projects/p/stakeholders/discover': { body: viewOf(1) },
      'PUT /api/projects/p/stakeholders': { body: viewOf(2) },
      'POST /api/projects/p/stakeholders/approve': { body: viewOf(3, true) },
      'POST /api/projects/p/actors/generate': { body: actorsOf() },
      'PUT /api/projects/p/actors': { body: actorsOf() },
    });
    const set = stakeholderSetFixture();
    await stakeholdersApi.discover('p', { mode: 'rules', confirm: true });
    await stakeholdersApi.save('p', {
      stakeholders: set.stakeholders,
      relations: set.relations,
      expectedRevision: 1,
    });
    await stakeholdersApi.approve('p', 2);
    await stakeholdersApi.makeActors('p', { model: false, confirm: false });
    await stakeholdersApi.saveActors('p', {
      actors: actorSetFixture().actors,
      expectedRevision: 2,
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/projects/p/stakeholders/discover',
      'PUT /api/projects/p/stakeholders',
      'POST /api/projects/p/stakeholders/approve',
      'POST /api/projects/p/actors/generate',
      'PUT /api/projects/p/actors',
    ]);
    expect(calls[0]?.body).toEqual({ mode: 'rules', confirm: true });
    expect(calls[2]?.body).toEqual({ expectedRevision: 2 });
    expect(calls[3]?.body).toEqual({ model: false, confirm: false });
    expect(calls.every((call) => call.csrf)).toBe(true);
  });

  it('turns a refusal into an error that carries the server’s code and its sentence', async () => {
    server({
      'PUT /api/projects/p/stakeholders': {
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
    const failure = await stakeholdersApi
      .save('p', { stakeholders: [], relations: [], expectedRevision: 1 })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code: 'ARTIFACT_CONFLICT',
      message: 'Someone changed this first.',
    });
  });
});

describe('what the page does for each change', () => {
  it('finds stakeholders and then reads the actors again, since a replaced list can leave them out of date', async () => {
    const calls = server({
      'POST /api/projects/p/stakeholders/discover': { body: viewOf(1) },
      'GET /api/projects/p/actors': { body: actorsOf() },
    });
    const shown = await discoverFlow('p', 'model', true);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/projects/p/stakeholders/discover',
      'GET /api/projects/p/actors',
    ]);
    expect(calls[0]?.body).toEqual({ mode: 'model', confirm: true });
    expect(shown.view.revision).toBe(1);
    expect(shown.actors.actors?.actors.length).toBeGreaterThan(0);
  });

  it('saves a list against the revision the person saw, and a list built by hand against revision 0', async () => {
    const calls = server({
      'PUT /api/projects/p/stakeholders': { body: viewOf(5) },
      'GET /api/projects/p/actors': { body: actorsOf() },
    });
    const list = [stakeholderFixture('neighbours', 'risk-bearer')];
    await saveFlow('p', viewOf(4), list, []);
    await saveFlow('p', viewOf(null), list, []);
    const bodies = calls.filter((call) => call.method === 'PUT').map((call) => call.body);
    expect(bodies).toMatchObject([{ expectedRevision: 4 }, { expectedRevision: 0 }]);
  });

  it('approves the list the person saw and then makes the actors, without replacing any they changed', async () => {
    const calls = server({
      'POST /api/projects/p/stakeholders/approve': { body: viewOf(4, true) },
      'POST /api/projects/p/actors/generate': { body: actorsOf() },
    });
    const told: [number | null, boolean][] = [];
    const shown = await approveFlow('p', viewOf(3), null, { model: true }, (view, making) =>
      told.push([view.revision, making]),
    );
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/projects/p/stakeholders/approve',
      'POST /api/projects/p/actors/generate',
    ]);
    expect(calls[0]?.body).toEqual({ expectedRevision: 3 });
    expect(calls[1]?.body).toEqual({ model: true, confirm: false });
    expect(told).toEqual([[4, true]]);
    expect(shown.view.stakeholders?.approvedAt).not.toBeNull();
  });

  it('approves but leaves actors the person changed as they are, and reads them again to show they are out of date', async () => {
    const calls = server({
      'POST /api/projects/p/stakeholders/approve': { body: viewOf(4, true) },
      'GET /api/projects/p/actors': { body: { ...actorsOf(true), stale: true } },
    });
    const told: boolean[] = [];
    const shown = await approveFlow(
      'p',
      viewOf(3),
      actorsOf(true),
      { model: true },
      (_view, making) => told.push(making),
    );
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/projects/p/stakeholders/approve',
      'GET /api/projects/p/actors',
    ]);
    expect(told).toEqual([false]);
    expect(shown.actors.stale).toBe(true);
    expect(shown.actors.actors?.actors[0]?.edited).toBe(true);
  });

  it('has told the page about the approval before the actors fail to be made', async () => {
    server({
      'POST /api/projects/p/stakeholders/approve': { body: viewOf(4, true) },
      'POST /api/projects/p/actors/generate': {
        status: 429,
        body: { error: { code: 'BUDGET_EXHAUSTED', message: 'The model budget is used up.' } },
      },
    });
    const told: number[] = [];
    await expect(
      approveFlow('p', viewOf(3), null, { model: true }, (view) => told.push(view.revision ?? -1)),
    ).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    expect(told).toEqual([4]);
  });

  it('asks nothing of the server when there is no list to approve', async () => {
    const calls = server({});
    await expect(
      approveFlow('p', viewOf(null), null, { model: false }, () => undefined),
    ).rejects.toThrow('There are no stakeholders to approve.');
    expect(calls).toEqual([]);
  });
});
