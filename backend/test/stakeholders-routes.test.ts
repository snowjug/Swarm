import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { actorFixture } from '../../shared/lab-fixtures.js';
import { scenarioFrameSchema } from '../../shared/scenario.js';
import type { ActorsView, StakeholderSet, StakeholdersView } from '../../shared/stakeholders.js';
import { buildApp } from '../src/app.js';
import { ROUTE_POLICY } from '../src/auth/policy.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import type { ModelUsageSink } from '../src/models/client.js';
import type { JsonOptions, ModelGateway } from '../src/models/client.js';
import { fixtureInput, testConfig } from './fixtures.js';
import {
  TENANT_A,
  authorization,
  entraEnvironment,
  idp,
  type Minted,
} from './support/entra-idp.js';

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

const CANARY = 'zq-canary-7421';
const ROLLOUT_NOTES = [
  'Rollout notes (synthetic). Administrators asked for a pause until the next review.',
  'Regulators in several regions require notice before new data processing begins.',
  'Customers pay a higher fee each month. The new charge falls on customers. Support teams expect more tickets.',
].join(' ');
const QUOTE = 'Regulators in several regions require notice before new data processing begins.';

/** A model that answers from a script and keeps a project's budget the way the real client does. */
class RouteModel {
  calls = 0;
  /** While set, every call waits for it: a test holds the model in the middle of its answer. */
  gate: Promise<void> | null = null;
  constructor(private replies: unknown[]) {}

  readonly factory = (onUsage: ModelUsageSink): ModelGateway => ({
    json: async <T>(
      schema: z.ZodType<T>,
      _instructions: string,
      _data: unknown,
      _signal: AbortSignal,
      _maxTokens?: number,
      options?: JsonOptions<T>,
    ): Promise<T> => {
      onUsage.admit?.();
      this.calls += 1;
      if (this.gate) await this.gate;
      const reply = this.replies.shift();
      if (reply instanceof Error) throw reply;
      const parsed = schema.parse(reply);
      options?.validate?.(parsed);
      onUsage({ inputTokens: 100, outputTokens: 20 });
      return parsed;
    },
  });
}

const modelEnvironment = {
  AI_PROVIDER: 'openai',
  AI_MODEL: 'fixture-model',
  OPENAI_API_KEY: 'test-placeholder-only',
};

const proposal = (overrides: Record<string, unknown> = {}) => ({
  stakeholders: [
    {
      id: 'regulators',
      name: 'Regulators',
      category: 'regulator',
      priority: 'key',
      directness: 'indirect',
      description: 'Public bodies.',
      relevance: 'Their notice rule applies.',
      populationSize: 1,
      expectedImpact: { direction: 'unclear', rationale: 'No direction in the text.' },
      evidence: [{ passageId: 'S1', quote: QUOTE }],
      uncertainty: { level: 'high', reason: 'One sentence.' },
    },
    {
      id: 'customers',
      name: 'Customers',
      category: 'cost-bearer',
      priority: 'standard',
      populationSize: 300,
      expectedImpact: { direction: 'harmed', rationale: 'They pay more.' },
      evidence: [],
    },
  ],
  ...overrides,
});

async function world(
  options: {
    model?: RouteModel;
    mode?: 'local' | 'llm';
    environment?: Record<string, string>;
    scenario?: string[];
  } = {},
) {
  const config = testConfig({
    ...(options.model ? modelEnvironment : {}),
    ...(options.environment ?? {}),
  });
  const instance = await buildApp({
    config,
    ...(options.model ? { modelFactory: options.model.factory } : {}),
  });
  applications.push(instance);
  const project = instance.repository.create(
    fixtureInput({
      workflow: 'guided',
      name: 'Notes project',
      question: `How might groups respond to the rollout? ${CANARY}`,
      documents: [{ name: 'notes.md', content: ROLLOUT_NOTES }],
      settings:
        options.mode === 'llm'
          ? { mode: 'llm', agentCount: 4, rounds: 3 }
          : { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
    }),
  );
  if (options.scenario) {
    instance.repository.artifacts.put(
      project.id,
      'scenario',
      'default',
      scenarioFrameSchema.parse({
        decision: 'Whether to pause the rollout',
        system: 'A service',
        baseline: 'The rollout continues.',
        likelyStakeholders: options.scenario,
        origin: 'user',
      }),
    );
  }
  const base = `/api/projects/${project.id}`;
  const call = (method: 'GET' | 'POST' | 'PUT', path: string, payload?: unknown) =>
    instance.app.inject({
      method,
      url: `${base}${path}`,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const stakeholders = async () => (await call('GET', '/stakeholders')).json() as StakeholdersView;
  const actors = async () => (await call('GET', '/actors')).json() as ActorsView;
  const discover = (payload: unknown = {}) => call('POST', '/stakeholders/discover', payload);
  return { ...instance, project, base, call, stakeholders, actors, discover };
}

type World = Awaited<ReturnType<typeof world>>;

/** The set as a person would send it back, with `change` applied. */
async function edited(
  w: World,
  change: (set: StakeholderSet) => void,
  revision?: number,
): Promise<{
  stakeholders: StakeholderSet['stakeholders'];
  relations: StakeholderSet['relations'];
  expectedRevision: number;
}> {
  const view = await w.stakeholders();
  const set = structuredClone(view.stakeholders!);
  change(set);
  return {
    stakeholders: set.stakeholders,
    relations: set.relations,
    expectedRevision: revision ?? view.revision!,
  };
}

const userStakeholder = (name: string) => ({
  id: name.toLowerCase().replaceAll(' ', '-'),
  name,
  category: 'beneficiary',
  description: '',
  relevance: '',
  directness: 'direct',
  priority: 'standard',
  populationSize: 20,
  expectedImpact: { direction: 'unclear', rationale: '' },
  evidence: [],
  assumptions: [],
  uncertainty: { level: 'high', reason: 'Added by hand.' },
  origin: 'user',
  status: 'added',
  mergedFrom: [],
});

describe('reading before anything was found', () => {
  it('answers 200 with nothing, so that a page of a project that never used this makes no failing call', async () => {
    const w = await world();
    const stakeholders = await w.call('GET', '/stakeholders');
    expect(stakeholders.statusCode).toBe(200);
    expect(stakeholders.json()).toEqual({
      stakeholders: null,
      revision: null,
      model: {
        available: false,
        reason: expect.stringContaining('runs without a model'),
      },
      may: { edit: true, run: true },
    });
    const actors = await w.call('GET', '/actors');
    expect(actors.statusCode).toBe(200);
    expect(actors.json()).toMatchObject({ actors: null, revision: null, stale: false });
  });

  it('says a model is available only for a model-assisted project of a server that has one', async () => {
    const local = await world({ model: new RouteModel([]) });
    expect((await local.stakeholders()).model.available).toBe(false);
    const noProvider = await world({ mode: 'llm' });
    expect((await noProvider.stakeholders()).model).toEqual({
      available: false,
      reason: expect.any(String),
    });
    const both = await world({ model: new RouteModel([]), mode: 'llm' });
    expect((await both.stakeholders()).model).toEqual({ available: true, reason: null });
  });

  it('reports a project that is not there, on every route', async () => {
    const w = await world();
    const missing = '/api/projects/00000000-0000-4000-8000-000000000000';
    for (const [method, path, payload] of [
      ['GET', '/stakeholders', undefined],
      ['POST', '/stakeholders/discover', {}],
      ['PUT', '/stakeholders', { stakeholders: [], relations: [], expectedRevision: 0 }],
      ['POST', '/stakeholders/approve', { expectedRevision: 1 }],
      ['GET', '/actors', undefined],
      ['POST', '/actors/generate', {}],
      ['PUT', '/actors', { actors: [actorFixture('someone', 'other')], expectedRevision: 1 }],
    ] as const) {
      const response = await w.app.inject({
        method,
        url: `${missing}${path}`,
        ...(payload === undefined ? {} : { payload }),
      });
      expect(response.statusCode, `${method} ${path}`).toBe(404);
    }
  });
});

describe('finding stakeholders', () => {
  it('reads the project’s text for roles with no model, stores the set, and answers with it', async () => {
    const w = await world({ scenario: ['customers', 'the provider'] });
    const response = await w.discover();
    expect(response.statusCode, response.body).toBe(201);
    const view = response.json() as StakeholdersView;
    expect(view.revision).toBe(1);
    const set = view.stakeholders!;
    expect(set.discovery).toMatchObject({ mode: 'rules', model: null });
    expect(set.discovery.note).toContain('not by a model');
    const names = set.stakeholders.map((stakeholder) => stakeholder.name);
    expect(names).toEqual(
      expect.arrayContaining(['Administrators', 'Regulators', 'Customers', 'Provider']),
    );
    expect(set.stakeholders.find((s) => s.name === 'Provider')?.origin).toBe('scenario');
    expect(await w.stakeholders()).toEqual(view);
    expect(w.repository.artifacts.get(w.project.id, 'stakeholders')?.revision).toBe(1);
  });

  it('refuses to ask a model for a project that cannot, saying why, and stores nothing', async () => {
    const w = await world();
    const response = await w.discover({ mode: 'model' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({
      code: 'MODEL_NOT_AVAILABLE',
      message: expect.stringContaining('runs without a model'),
    });
    expect((await w.stakeholders()).stakeholders).toBeNull();
  });

  it('asks the model when asked and available, counts the call against the project’s budget, and checks its quotes', async () => {
    const model = new RouteModel([proposal()]);
    const w = await world({ model, mode: 'llm' });
    const response = await w.discover({ mode: 'model' });
    expect(response.statusCode, response.body).toBe(201);
    const set = (response.json() as StakeholdersView).stakeholders!;
    expect(set.discovery).toMatchObject({ mode: 'model', model: 'fixture-model' });
    expect(set.stakeholders.map((s) => [s.name, s.origin, s.evidence.length])).toEqual([
      ['Regulators', 'model', 1],
      ['Customers', 'model', 0],
    ]);
    expect(set.stakeholders[0]?.evidence[0]?.quote).toBe(QUOTE);
    expect(model.calls).toBe(1);
    expect(w.repository.usage.get(w.project.id)).toMatchObject({
      calls: 1,
      inputTokens: 100,
      outputTokens: 20,
    });
  });

  it('counts the call on the project’s own record too, when it has one', async () => {
    const model = new RouteModel([proposal()]);
    const w = await world({ model, mode: 'llm' });
    w.repository.update(w.project.id, {
      execution: {
        provider: 'openai',
        model: 'fixture-model',
        modelCalls: 5,
        inputTokens: 10,
        outputTokens: 10,
      },
    });
    await w.discover({ mode: 'model' });
    expect(w.repository.get(w.project.id).execution).toMatchObject({
      modelCalls: 6,
      inputTokens: 110,
      outputTokens: 30,
    });
  });

  it('falls back to reading for roles when the model fails, and says so in the stored note', async () => {
    const { AppError } = await import('../src/errors.js');
    const model = new RouteModel([
      new AppError(502, 'MODEL_OUTPUT_INVALID', 'The provider returned invalid JSON.'),
    ]);
    const w = await world({ model, mode: 'llm' });
    const response = await w.discover({ mode: 'model' });
    expect(response.statusCode).toBe(201);
    const set = (response.json() as StakeholdersView).stakeholders!;
    expect(set.discovery.mode).toBe('rules');
    expect(set.discovery.note).toContain(
      'The model could not be used (The provider returned invalid JSON.)',
    );
  });

  it('is held back by the project’s model budget, and says that it was', async () => {
    const model = new RouteModel([proposal()]);
    const w = await world({ model, mode: 'llm' });
    w.repository.usage.setLimits(w.project.id, { callLimit: 1, tokenLimit: null });
    w.repository.usage.record(w.project.id, 1, 1);
    const response = await w.discover({ mode: 'model' });
    expect(response.statusCode).toBe(201);
    const set = (response.json() as StakeholdersView).stakeholders!;
    expect(set.discovery.mode).toBe('rules');
    expect(set.discovery.note).toContain('has used its model budget');
    expect(model.calls).toBe(0);
    expect(w.repository.usage.get(w.project.id).calls).toBe(1);
  });

  it('does one thing at a time for a project: a second request while the first waits is refused', async () => {
    const model = new RouteModel([proposal()]);
    let release: () => void = () => undefined;
    model.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = await world({ model, mode: 'llm' });
    const first = w.discover({ mode: 'model' });
    for (let waited = 0; model.calls === 0 && waited < 200; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(model.calls).toBe(1);
    const second = await w.discover({ mode: 'model' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('STAKEHOLDERS_BUSY');
    release();
    expect((await first).statusCode).toBe(201);
    expect((await w.discover()).statusCode).toBe(201);
  });

  it('replaces a list the person has not touched, and asks first about one they have reviewed', async () => {
    const w = await world();
    await w.discover();
    expect((await w.discover()).statusCode).toBe(201);
    expect((await w.stakeholders()).revision).toBe(2);
    const reviewed = await w.call(
      'PUT',
      '/stakeholders',
      await edited(w, (set) => {
        set.stakeholders[0]!.status = 'accepted';
      }),
    );
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    const refused = await w.discover();
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('STAKEHOLDERS_REVIEWED');
    expect((await w.stakeholders()).stakeholders?.stakeholders[0]?.status).toBe('accepted');
    const confirmed = await w.discover({ confirm: true });
    expect(confirmed.statusCode).toBe(201);
    expect(
      (await w.stakeholders()).stakeholders?.stakeholders.every((s) => s.status === 'proposed'),
    ).toBe(true);
  });

  it('refuses a body with something it does not know', async () => {
    const w = await world();
    expect((await w.discover({ mode: 'psychic' })).statusCode).toBe(400);
    expect((await w.discover({ extra: true })).statusCode).toBe(400);
  });

  it('is rate limited, because finding stakeholders may use a model', async () => {
    const w = await world();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push((await w.discover({ confirm: true })).statusCode);
    }
    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('reviewing', () => {
  it('saves a change under the next revision, and refuses one made against an old one', async () => {
    const w = await world();
    await w.discover();
    const first = await edited(w, (set) => {
      set.stakeholders[0]!.status = 'accepted';
    });
    const saved = await w.call('PUT', '/stakeholders', first);
    expect(saved.statusCode, saved.body).toBe(200);
    expect((saved.json() as StakeholdersView).revision).toBe(2);
    const stale = await w.call('PUT', '/stakeholders', first);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({
      code: 'ARTIFACT_CONFLICT',
      message: expect.stringContaining('Reload them'),
    });
    expect((await w.stakeholders()).revision).toBe(2);
  });

  it('applies the rules of review: nothing deleted, evidence not added, a status that fits', async () => {
    const w = await world();
    await w.discover();
    const dropped = await w.call(
      'PUT',
      '/stakeholders',
      await edited(w, (set) => {
        set.stakeholders.pop();
      }),
    );
    expect(dropped.statusCode).toBe(400);
    expect(dropped.json().error.code).toBe('STAKEHOLDER_MISSING');
    const forged = await w.call(
      'PUT',
      '/stakeholders',
      await edited(w, (set) => {
        set.stakeholders[0]!.origin = 'user';
      }),
    );
    expect(forged.json().error.code).toBe('STAKEHOLDER_ORIGIN_LOCKED');
    const unknown = await w.call('PUT', '/stakeholders', {
      ...(await edited(w, () => undefined)),
      extra: 1,
    });
    expect(unknown.statusCode).toBe(400);
    expect((await w.stakeholders()).revision).toBe(1);
  });

  it('lets a person build the list by hand, from nothing, once', async () => {
    const w = await world();
    const none = await w.call('PUT', '/stakeholders', {
      stakeholders: [],
      relations: [],
      expectedRevision: 1,
    });
    expect(none.statusCode).toBe(409);
    expect(none.json().error.code).toBe('STAKEHOLDERS_NOT_FOUND');
    const built = await w.call('PUT', '/stakeholders', {
      stakeholders: [userStakeholder('First group'), userStakeholder('Second group')],
      relations: [],
      expectedRevision: 0,
    });
    expect(built.statusCode, built.body).toBe(200);
    expect((built.json() as StakeholdersView).stakeholders?.discovery.mode).toBe('user');
    const again = await w.call('PUT', '/stakeholders', {
      stakeholders: [userStakeholder('First group'), userStakeholder('Second group')],
      relations: [],
      expectedRevision: 0,
    });
    expect(again.statusCode).toBe(409);
  });

  it('approves with at least two stakeholders left, accepts what was proposed, and takes the approval away on a change', async () => {
    const w = await world();
    await w.discover();
    const few = await w.call(
      'PUT',
      '/stakeholders',
      await edited(w, (set) => {
        for (const stakeholder of set.stakeholders.slice(1)) stakeholder.status = 'removed';
      }),
    );
    expect(few.statusCode, few.body).toBe(200);
    const tooFew = await w.call('POST', '/stakeholders/approve', { expectedRevision: 2 });
    expect(tooFew.statusCode).toBe(409);
    expect(tooFew.json().error.code).toBe('STAKEHOLDERS_TOO_FEW');
    await w.call(
      'PUT',
      '/stakeholders',
      await edited(w, (set) => {
        for (const stakeholder of set.stakeholders) stakeholder.status = 'proposed';
      }),
    );
    const stale = await w.call('POST', '/stakeholders/approve', { expectedRevision: 2 });
    expect(stale.json().error.code).toBe('ARTIFACT_CONFLICT');
    const approved = await w.call('POST', '/stakeholders/approve', { expectedRevision: 3 });
    expect(approved.statusCode, approved.body).toBe(200);
    const view = approved.json() as StakeholdersView;
    expect(view.revision).toBe(4);
    expect(view.stakeholders?.approvedAt).toEqual(expect.any(String));
    expect(view.stakeholders?.stakeholders.every((s) => s.status === 'accepted')).toBe(true);
    const changed = await w.call(
      'PUT',
      '/stakeholders',
      await edited(w, (set) => {
        set.stakeholders[0]!.priority = 'background';
      }),
    );
    expect((changed.json() as StakeholdersView).stakeholders?.approvedAt).toBeNull();
  });

  it('says there is nothing to approve when nothing was found, and refuses an unknown body', async () => {
    const w = await world();
    expect(
      (await w.call('POST', '/stakeholders/approve', { expectedRevision: 1 })).statusCode,
    ).toBe(409);
    await w.discover();
    expect((await w.call('POST', '/stakeholders/approve', {})).statusCode).toBe(400);
    expect(
      (await w.call('POST', '/stakeholders/approve', { expectedRevision: 1, extra: 1 })).statusCode,
    ).toBe(400);
  });
});

async function approvedWorld(options: Parameters<typeof world>[0] = {}) {
  const w = await world(options);
  await w.discover();
  const approved = await w.call('POST', '/stakeholders/approve', { expectedRevision: 1 });
  expect(approved.statusCode, approved.body).toBe(200);
  return w;
}

describe('actors', () => {
  it('are made only from approved stakeholders', async () => {
    const w = await world();
    await w.discover();
    const early = await w.call('POST', '/actors/generate', {});
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('STAKEHOLDERS_NOT_APPROVED');
    expect((await w.actors()).actors).toBeNull();
  });

  it('are made from an approved set, with every trait labelled, and kept with the revision they came from', async () => {
    const w = await approvedWorld();
    const made = await w.call('POST', '/actors/generate', {});
    expect(made.statusCode, made.body).toBe(201);
    const view = made.json() as ActorsView;
    expect(view).toMatchObject({ revision: 1, stale: false });
    const set = view.actors!;
    expect(set.stakeholderRevision).toBe(2);
    expect(set.mode).toBe('rules');
    expect(set.actors.length).toBeGreaterThanOrEqual(3);
    const stakeholders = (await w.stakeholders()).stakeholders!;
    expect(set.actors.map((actor) => actor.id)).toEqual(stakeholders.stakeholders.map((s) => s.id));
    for (const actor of set.actors) {
      for (const trait of Object.values(actor.traits)) {
        expect(trait.rationale.length).toBeGreaterThan(0);
        expect(['system-assumption', 'user', 'model', 'evidence']).toContain(trait.origin);
      }
    }
    expect(await w.actors()).toEqual(view);
  });

  it('are said to be out of date when the stakeholders change after they were made', async () => {
    const w = await approvedWorld();
    await w.call('POST', '/actors/generate', {});
    expect((await w.actors()).stale).toBe(false);
    await w.call(
      'PUT',
      '/stakeholders',
      await edited(w, (set) => {
        set.stakeholders[0]!.description = 'A new description.';
      }),
    );
    expect((await w.actors()).stale).toBe(true);
  });

  it('keep the changes a person made unless they confirm making them again', async () => {
    const w = await approvedWorld();
    await w.call('POST', '/actors/generate', {});
    const view = await w.actors();
    const actors = structuredClone(view.actors!.actors);
    actors[0]!.traits.sensitivity.value = 0.05;
    const saved = await w.call('PUT', '/actors', { actors, expectedRevision: view.revision });
    expect(saved.statusCode, saved.body).toBe(200);
    const after = saved.json() as ActorsView;
    expect(after.revision).toBe(2);
    expect(after.actors?.actors[0]).toMatchObject({ edited: true });
    expect(after.actors?.actors[0]?.traits.sensitivity).toMatchObject({
      value: 0.05,
      origin: 'user',
    });
    const refused = await w.call('POST', '/actors/generate', {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('ACTORS_EDITED');
    expect((await w.actors()).actors?.actors[0]?.traits.sensitivity.value).toBe(0.05);
    const again = await w.call('POST', '/actors/generate', { confirm: true });
    expect(again.statusCode).toBe(201);
    expect((await w.actors()).actors?.actors[0]?.edited).toBe(false);
  });

  it('refuse a stale change, an added actor and a value out of range', async () => {
    const w = await approvedWorld();
    await w.call('POST', '/actors/generate', {});
    const view = await w.actors();
    const send = (actors: unknown, expectedRevision = 1) =>
      w.call('PUT', '/actors', { actors, expectedRevision });
    expect((await send(view.actors!.actors, 7)).json().error.code).toBe('ARTIFACT_CONFLICT');
    expect((await send(view.actors!.actors.slice(1))).json().error.code).toBe('ACTORS_CHANGED');
    const wild = structuredClone(view.actors!.actors);
    wild[0]!.traits.trust.value = 4;
    expect((await send(wild)).statusCode).toBe(400);
    expect(
      (await w.call('PUT', '/actors', { actors: wild, expectedRevision: 1, extra: 1 })).statusCode,
    ).toBe(400);
    expect((await w.actors()).revision).toBe(1);
  });

  it('say there is nothing to change before they are made', async () => {
    const w = await world();
    const response = await w.call('PUT', '/actors', { actors: [], expectedRevision: 1 });
    expect(response.statusCode).toBe(400);
    const w2 = await approvedWorld();
    const none = await w2.call('PUT', '/actors', {
      actors: (await w2.stakeholders()).stakeholders!.stakeholders.length ? [{}] : [],
      expectedRevision: 1,
    });
    expect(none.statusCode).toBe(400);
  });

  it('are refined by a model only when one is asked for and available, and say when it failed', async () => {
    const plain = await approvedWorld();
    const unavailable = await plain.call('POST', '/actors/generate', { model: true });
    expect(unavailable.statusCode).toBe(409);
    expect(unavailable.json().error.code).toBe('MODEL_NOT_AVAILABLE');

    const { AppError } = await import('../src/errors.js');
    const model = new RouteModel([
      proposal(),
      new AppError(502, 'MODEL_OUTPUT_INVALID', 'The provider returned invalid JSON.'),
    ]);
    const w = await approvedWorld({ model, mode: 'llm' });
    const first = await w.discover({ mode: 'model', confirm: true });
    expect(first.statusCode, first.body).toBe(201);
    expect(
      (await w.call('POST', '/stakeholders/approve', { expectedRevision: 3 })).statusCode,
    ).toBe(200);
    const made = await w.call('POST', '/actors/generate', { model: true });
    expect(made.statusCode, made.body).toBe(201);
    const set = (made.json() as ActorsView).actors!;
    expect(set.mode).toBe('rules');
    expect(set.note).toContain('A model could not refine the key actors');
  });
});

describe('what the audit log is told', () => {
  it('records each change with counts only, in the order it happened, and never a name, a quote or the question', async () => {
    const w = await world({ scenario: [CANARY] });
    await w.discover();
    await w.call(
      'PUT',
      '/stakeholders',
      await edited(w, (set) => {
        set.stakeholders.push(userStakeholder(`Group ${CANARY}`) as never);
      }),
    );
    await w.call('POST', '/stakeholders/approve', { expectedRevision: 2 });
    await w.call('POST', '/actors/generate', {});
    const view = await w.actors();
    const actors = structuredClone(view.actors!.actors);
    actors[0]!.traits.trust.value = 0.9;
    actors[0]!.traits.trust.rationale = `About ${CANARY}`;
    await w.call('PUT', '/actors', { actors, expectedRevision: 1 });

    const events = w.repository.audit
      .list({ projectId: w.project.id, limit: 500 })
      .filter((event) => /^(stakeholders|actors)\./u.test(event.action));
    expect(events.map((event) => event.action)).toEqual([
      'stakeholders.discovered',
      'stakeholders.edited',
      'stakeholders.approved',
      'actors.generated',
      'actors.edited',
    ]);
    for (const event of events) {
      expect(event).toMatchObject({
        actor: expect.any(String),
        targetType: 'project',
        targetId: w.project.id,
      });
      for (const value of Object.values(event.detail))
        expect(['number', 'boolean', 'string']).toContain(typeof value);
    }
    expect(events[0]?.detail).toMatchObject({ mode: 'rules', asked: 'rules', replaced: false });
    expect(events[0]?.detail.stakeholders).toEqual(expect.any(Number));
    expect(events[3]?.detail).toMatchObject({ mode: 'rules', asked: 'rules' });
    expect(events[4]?.detail).toMatchObject({ edited: 1 });
    const everything = JSON.stringify(w.repository.audit.list({ limit: 500 }));
    expect(everything).not.toContain(CANARY);
    for (const name of ['Administrators', 'Regulators', 'Customers'])
      expect(everything).not.toContain(name);
    expect(w.repository.audit.verify().ok).toBe(true);
  });

  it('does not record a change that was refused', async () => {
    const w = await world();
    await w.discover();
    const before = w.repository.audit.list({ projectId: w.project.id, limit: 500 }).length;
    const refused = await w.call('PUT', '/stakeholders', {
      ...(await edited(w, () => undefined)),
      expectedRevision: 9,
    });
    expect(refused.statusCode).toBe(409);
    expect(w.repository.audit.list({ projectId: w.project.id, limit: 500 })).toHaveLength(before);
  });
});

// ---------------------------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------------------------

const ID = {
  lead: 'c0000003-0000-4000-8000-000000000003',
  analyst: 'c0000004-0000-4000-8000-000000000004',
  reviewer: 'c0000005-0000-4000-8000-000000000005',
  viewer: 'c0000006-0000-4000-8000-000000000006',
  stranger: 'c0000008-0000-4000-8000-000000000008',
} as const;
type Person = keyof typeof ID | 'anonymous';
const TOKENS: Record<keyof typeof ID, Minted> = {
  lead: { oid: ID.lead, roles: ['Swarm.User'] },
  analyst: { oid: ID.analyst, roles: ['Swarm.User'] },
  reviewer: { oid: ID.reviewer, roles: ['Swarm.User'] },
  viewer: { oid: ID.viewer, roles: ['Swarm.User'] },
  stranger: { oid: ID.stranger, roles: ['Swarm.Reader'] },
};
const MAY: Record<Person, readonly string[]> = {
  lead: ['read', 'run', 'edit'],
  analyst: ['read', 'run', 'edit'],
  reviewer: ['read'],
  viewer: ['read'],
  stranger: [],
  anonymous: [],
};

describe('who may find, review and change stakeholders and actors', () => {
  const routes = [
    {
      name: 'read the stakeholders',
      policy: 'GET /api/projects/:id/stakeholders',
      capability: 'read',
      method: 'GET',
      path: '/stakeholders',
    },
    {
      name: 'find stakeholders',
      policy: 'POST /api/projects/:id/stakeholders/discover',
      capability: 'run',
      method: 'POST',
      path: '/stakeholders/discover',
      payload: {},
    },
    {
      name: 'review stakeholders',
      policy: 'PUT /api/projects/:id/stakeholders',
      capability: 'edit',
      method: 'PUT',
      path: '/stakeholders',
      payload: { invalid: true },
    },
    {
      name: 'approve stakeholders',
      policy: 'POST /api/projects/:id/stakeholders/approve',
      capability: 'edit',
      method: 'POST',
      path: '/stakeholders/approve',
      payload: { invalid: true },
    },
    {
      name: 'read the actors',
      policy: 'GET /api/projects/:id/actors',
      capability: 'read',
      method: 'GET',
      path: '/actors',
    },
    {
      name: 'make actors',
      policy: 'POST /api/projects/:id/actors/generate',
      capability: 'run',
      method: 'POST',
      path: '/actors/generate',
      payload: {},
    },
    {
      name: 'change actors',
      policy: 'PUT /api/projects/:id/actors',
      capability: 'edit',
      method: 'PUT',
      path: '/actors',
      payload: { invalid: true },
    },
  ] as const;

  it('is the policy table: each route needs the capability written beside it here', () => {
    for (const route of routes) {
      expect(ROUTE_POLICY[route.policy], route.policy).toEqual({
        kind: 'project',
        capability: route.capability,
      });
    }
  });

  async function secured() {
    const config = testConfig({ ...entraEnvironment, LOG_LEVEL: 'silent' });
    const instance = await buildApp({
      config,
      tokenVerifier: new TokenVerifier(config.auth, idp.keys),
    });
    applications.push(instance);
    const { repository } = instance;
    const setup = { id: 'test-setup', workspaceRole: 'owner' as const };
    repository.members.setWorkspaceMember({
      tenantId: TENANT_A,
      principalId: ID.lead,
      role: 'member',
      actor: setup,
    });
    const project = repository.create(fixtureInput({ workflow: 'guided' }), {
      owner: { tenantId: TENANT_A, ownerId: ID.lead },
    });
    for (const [principalId, role] of [
      [ID.analyst, 'analyst'],
      [ID.reviewer, 'reviewer'],
      [ID.viewer, 'viewer'],
    ] as const) {
      repository.members.setProjectMember({
        projectId: project.id,
        tenantId: TENANT_A,
        principalId,
        role,
        actor: { id: ID.lead },
      });
    }
    return { ...instance, id: project.id };
  }

  const people = Object.keys(MAY) as Person[];
  it.each(people)('does what the table says for %s', async (person) => {
    const w = await secured();
    for (const route of routes) {
      const response = await w.app.inject({
        method: route.method,
        url: `/api/projects/${w.id}${route.path}`,
        headers: person === 'anonymous' ? {} : await authorization(TOKENS[person]),
        ...('payload' in route ? { payload: route.payload } : {}),
      });
      const body =
        response.statusCode >= 400 ? (response.json() as { error?: { code?: string } }) : {};
      const allowed = MAY[person].includes(route.capability);
      if (person === 'anonymous') {
        expect(response.statusCode, route.name).toBe(401);
      } else if (MAY[person].length === 0) {
        expect(body.error?.code, `${person} ${route.name}`).toBe('PROJECT_NOT_FOUND');
      } else if (allowed) {
        expect(body.error?.code ?? '', `${person} ${route.name}`).not.toMatch(
          /^(FORBIDDEN|PROJECT_NOT_FOUND)$/u,
        );
        expect(response.statusCode).not.toBe(401);
      } else {
        expect(response.statusCode, `${person} ${route.name}`).toBe(403);
        expect(body.error?.code).toBe('FORBIDDEN');
      }
    }
  });

  it('tells each person what they may do, on the answer itself', async () => {
    const w = await secured();
    const read = async (person: keyof typeof ID) =>
      (
        await w.app.inject({
          method: 'GET',
          url: `/api/projects/${w.id}/stakeholders`,
          headers: await authorization(TOKENS[person]),
        })
      ).json() as StakeholdersView;
    expect((await read('viewer')).may).toEqual({ edit: false, run: false });
    expect((await read('reviewer')).may).toEqual({ edit: false, run: false });
    expect((await read('analyst')).may).toEqual({ edit: true, run: true });
  });
});
