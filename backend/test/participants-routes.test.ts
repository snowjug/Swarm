import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { scenarioFrameSchema } from '../../shared/scenario.js';
import {
  participantOf,
  stakeholderSetSchema,
  type ActorsView,
  type ParticipantValidationView,
  type ParticipantWhy,
  type Stakeholder,
  type StakeholdersView,
} from '../../shared/stakeholders.js';
import { buildApp } from '../src/app.js';
import { AUDIT_POLICY } from '../src/auth/audit-policy.js';
import { ROUTE_POLICY } from '../src/auth/policy.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import { AppError } from '../src/errors.js';
import type { JsonOptions, ModelGateway, ModelUsageSink } from '../src/models/client.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { NOTES, passagesOf, proposal } from './support/participants-world.js';
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

const CANARY = 'zq-canary-9931';
const modelEnvironment = {
  AI_PROVIDER: 'openai',
  AI_MODEL: 'fixture-model',
  OPENAI_API_KEY: 'test-placeholder-only',
};

/** A model that answers from a script and keeps a project's budget the way the real client does. */
class RouteModel {
  calls = 0;
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
      const reply = this.replies.shift();
      if (reply instanceof Error) throw reply;
      const parsed = schema.parse(reply);
      options?.validate?.(parsed);
      onUsage({ inputTokens: 100, outputTokens: 20 });
      return parsed;
    },
  });
}

async function world(options: { model?: RouteModel; scenario?: boolean } = {}) {
  const instance = await buildApp({
    config: testConfig(options.model ? modelEnvironment : {}),
    ...(options.model ? { modelFactory: options.model.factory } : {}),
  });
  applications.push(instance);
  const project = instance.repository.create(
    fixtureInput({
      workflow: 'guided',
      name: 'Night bus project',
      question: `What could happen if the night bus route moves? ${CANARY}`,
      documents: [{ name: 'notes.md', content: `${NOTES} Canary: ${CANARY}.` }],
      settings: options.model
        ? { mode: 'llm', agentCount: 4, rounds: 3 }
        : { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
    }),
  );
  if (options.scenario !== false) {
    instance.repository.artifacts.put(
      project.id,
      'scenario',
      'default',
      scenarioFrameSchema.parse({
        decision: 'Whether to move the night bus route to a new corridor next spring',
        system: 'Night bus network',
        baseline: 'The night bus stays on the old corridor.',
        likelyStakeholders: ['transit office'],
        origin: 'user',
      }),
    );
  }
  const base = `/api/projects/${project.id}`;
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
  ) =>
    instance.app.inject({
      method,
      url: `${base}${path}`,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const view = async () => (await call('GET', '/stakeholders')).json() as StakeholdersView;
  const propose = (payload: unknown = {}) => call('POST', '/stakeholders/propose', payload);
  const live = async (): Promise<Stakeholder[]> =>
    ((await view()).stakeholders?.stakeholders ?? []).filter((item) => item.status !== 'removed');
  const revision = async (): Promise<number> => (await view()).revision!;
  return { ...instance, project, base, call, view, propose, live, revision };
}
type World = Awaited<ReturnType<typeof world>>;

/** A change at the revision the page is looking at. */
async function change(
  w: World,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  payload: Record<string, unknown> = {},
) {
  const expectedRevision = await w.revision();
  return method === 'DELETE'
    ? w.call('DELETE', `${path}?expectedRevision=${expectedRevision}`)
    : w.call(method, path, { expectedRevision, ...payload });
}

const names = (items: readonly Stakeholder[]): string[] => items.map((item) => item.name);

describe('proposing the participants', () => {
  it('reads the text for roles with no model, stores a proposed set, and answers with the set and its review', async () => {
    const w = await world();
    const response = await w.propose();
    expect(response.statusCode, response.body).toBe(201);
    const view = response.json() as StakeholdersView;
    expect(view.revision).toBe(1);
    const set = view.stakeholders!;
    expect(set.discovery).toMatchObject({ mode: 'rules', model: null });
    expect(set.proposal).toMatchObject({ source: 'rules', version: 1, failure: null });
    expect(set.approvedAt).toBeNull();
    expect(view.review).toMatchObject({ valid: true, profile: 'strict' });
    expect(view.review?.summary).toMatch(/^Swarm proposes these \d+ participants because/u);
    expect(view.review?.coverage).toHaveLength(14);
    expect(await w.view()).toEqual(view);
    expect(stakeholderSetSchema.parse(set)).toEqual(set);
    for (const stakeholder of set.stakeholders.filter((item) => item.status !== 'removed')) {
      const participant = participantOf(stakeholder);
      expect(participant.synthetic).toBe(true);
      expect(participant.plausibleActions.length).toBeGreaterThan(0);
    }
  });

  it('does not call a model on the rules path, and refuses to ask for one that is not available, saying why', async () => {
    const model = new RouteModel([]);
    const w = await world({ model });
    expect((await w.propose({ mode: 'rules' })).statusCode).toBe(201);
    expect(model.calls).toBe(0);
    const plain = await world();
    const refused = await plain.propose({ mode: 'model' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'MODEL_NOT_AVAILABLE',
      message: expect.stringContaining('runs without a model'),
    });
    expect((await plain.view()).stakeholders).toBeNull();
  });

  it('asks the model when asked, counts the call, and keeps a reply that passes every check', async () => {
    const model = new RouteModel([proposal(passagesOf(`${NOTES} Canary: ${CANARY}.`))]);
    const w = await world({ model });
    const response = await w.propose({ mode: 'model' });
    expect(response.statusCode, response.body).toBe(201);
    const set = (response.json() as StakeholdersView).stakeholders!;
    expect(set.discovery).toMatchObject({ mode: 'model', model: 'fixture-model' });
    expect(set.proposal).toMatchObject({ source: 'model', failure: null });
    expect(names(set.stakeholders.filter((item) => item.status !== 'removed'))).toContain(
      'City council approving the new route',
    );
    expect(model.calls).toBe(1);
    expect(w.repository.usage.get(w.project.id)).toMatchObject({ calls: 1 });
  });

  describe('when the model could not be used', () => {
    /** A reply the server's checks refuse: it names a participant "Staff". */
    const unusable = () => {
      const bad = JSON.parse(
        JSON.stringify(proposal(passagesOf(`${NOTES} Canary: ${CANARY}.`))),
      ) as { participants: { name: string }[] };
      bad.participants[0]!.name = 'Staff';
      return bad;
    };

    it('stops and says what failed, instead of answering from rules, and keeps nothing', async () => {
      const bad = unusable();
      const model = new RouteModel([bad, bad]);
      const w = await world({ model });
      const response = await w.propose({ mode: 'model' });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        stopped: {
          code: 'MODEL_OUTPUT_INVALID',
          detail: 'The model replied, but its answer did not pass validation.',
          retryable: true,
        },
      });
      expect((await w.view()).stakeholders).toBeNull();
      expect(model.calls).toBe(1);
      expect(JSON.stringify(response.json())).not.toContain('Staff');
    });

    it('leaves a list that was there as it was', async () => {
      const bad = unusable();
      const model = new RouteModel([bad, bad]);
      const w = await world({ model });
      expect((await w.propose({ mode: 'rules' })).statusCode).toBe(201);
      const before = await w.view();
      const response = await w.propose({ mode: 'model', confirm: true });
      expect(response.json()).toHaveProperty('stopped.code', 'MODEL_OUTPUT_INVALID');
      expect(await w.view()).toEqual(before);
    });

    it.each([
      ['MODEL_TIMEOUT', true],
      ['MODEL_AUTH', false],
    ])(
      'says whether asking again may help after %s, without the provider’s words',
      async (code, retryable) => {
        const model = new RouteModel([new AppError(502, code, `provider said ${CANARY}`)]);
        const w = await world({ model });
        const response = await w.propose({ mode: 'model' });
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().stopped).toMatchObject({ code, retryable });
        expect(response.body).not.toContain(CANARY);
      },
    );

    it('goes on with rules when the person chooses them, and records the proposal as the rules fallback', async () => {
      const bad = unusable();
      const model = new RouteModel([bad, bad]);
      const w = await world({ model });
      expect((await w.propose({ mode: 'model' })).statusCode).toBe(200);
      const calls = model.calls;
      const response = await w.propose({ mode: 'rules', fallbackFrom: 'MODEL_OUTPUT_INVALID' });
      expect(response.statusCode, response.body).toBe(201);
      expect(model.calls).toBe(calls);
      const set = (response.json() as StakeholdersView).stakeholders!;
      expect(set.discovery).toMatchObject({ mode: 'rules', model: null });
      expect(set.discovery.note).toContain('Participants from the rules fallback');
      expect(set.proposal).toMatchObject({
        source: 'rules',
        failure: {
          code: 'MODEL_OUTPUT_INVALID',
          detail: 'The model replied, but its answer did not pass validation, so rules were used.',
        },
      });
      expect(JSON.stringify(set)).not.toContain('Staff');
    });

    it('records a rules run chosen from the start with no failure at all', async () => {
      const w = await world();
      const set = ((await w.propose({ mode: 'rules' })).json() as StakeholdersView).stakeholders!;
      expect(set.proposal?.failure).toBeNull();
      expect(set.discovery.note).not.toContain('rules fallback');
    });

    it('accepts a reason for choosing rules only from the closed list, and only with the rules', async () => {
      const w = await world();
      expect((await w.propose({ mode: 'rules', fallbackFrom: 'ZQ_SOMETHING' })).statusCode).toBe(
        400,
      );
      expect((await w.propose({ mode: 'model', fallbackFrom: 'MODEL_TIMEOUT' })).statusCode).toBe(
        400,
      );
      expect((await w.view()).stakeholders).toBeNull();
    });

    it('still asks for a confirmation before it replaces a reviewed list, so a model is not called for nothing', async () => {
      const model = new RouteModel([]);
      const w = await world({ model });
      await w.propose({ mode: 'rules' });
      const first = (await w.live())[0]!;
      await change(w, 'POST', '/stakeholders/accept', { ids: [first.id] });
      const refused = await w.propose({ mode: 'model' });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.code).toBe('STAKEHOLDERS_REVIEWED');
      expect(model.calls).toBe(0);
    });
  });

  it('answers a model’s refusal as a refusal, and stores nothing', async () => {
    const model = new RouteModel([new AppError(409, 'MODEL_REFUSED', 'The model declined.')]);
    const w = await world({ model });
    const response = await w.propose({ mode: 'model' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('MODEL_REFUSED');
    expect((await w.view()).stakeholders).toBeNull();
  });

  it('refuses to replace what a person has reviewed unless they confirm, and keeps the ids when they do', async () => {
    const w = await world();
    await w.propose();
    const before = names(await w.live());
    const first = (await w.live())[0]!;
    expect((await change(w, 'POST', '/stakeholders/accept', { ids: [first.id] })).statusCode).toBe(
      200,
    );
    const refused = await w.propose();
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('STAKEHOLDERS_REVIEWED');
    expect(names(await w.live())).toEqual(before);
    const confirmed = await w.propose({ confirm: true });
    expect(confirmed.statusCode).toBe(201);
    expect((await w.live()).every((item) => item.status === 'proposed')).toBe(true);
    expect((await w.live())[0]!.id).toBe(first.id);
  });

  it('refuses a body with something it does not know', async () => {
    const w = await world();
    expect((await w.propose({ mode: 'psychic' })).statusCode).toBe(400);
    expect((await w.propose({ extra: true })).statusCode).toBe(400);
  });

  it('is rate limited, as finding stakeholders is, because it may use a model', async () => {
    const w = await world();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push((await w.propose({ confirm: true })).statusCode);
    }
    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('the validation that gates approval', () => {
  it('reads the same review as the view, with the revision it is about', async () => {
    const w = await world();
    await w.propose();
    const answer = (
      await w.call('GET', '/stakeholders/validation')
    ).json() as ParticipantValidationView;
    const view = await w.view();
    expect(answer).toEqual({ revision: view.revision, review: view.review });
    const empty = await world();
    expect((await empty.call('GET', '/stakeholders/validation')).json()).toEqual({
      revision: null,
      review: null,
    });
  });

  it('refuses approval while a blocking issue remains, saying which and what to do, and approves once it is fixed', async () => {
    const w = await world();
    await w.propose();
    const target = (await w.live())[0]!;
    const renamed = await change(w, 'PATCH', `/stakeholders/${target.id}`, {
      changes: { name: 'Staff' },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const view = renamed.json() as StakeholdersView;
    expect(view.review?.valid).toBe(false);
    expect(view.review?.issues[0]).toMatchObject({
      code: 'generic-name',
      severity: 'blocking',
      participantId: target.id,
    });
    const refused = await change(w, 'POST', '/stakeholders/approve');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('PARTICIPANTS_INVALID');
    expect(refused.json().error.message).toContain('“Staff”');
    expect(refused.json().error.message).toContain('Rename it to the specific role');
    expect((await w.view()).stakeholders?.approvedAt).toBeNull();
    const made = await w.call('POST', '/actors/generate', {});
    expect(made.json().error.code).toBe('STAKEHOLDERS_NOT_APPROVED');

    const fixed = await change(w, 'PATCH', `/stakeholders/${target.id}`, {
      changes: { name: 'Night shift mechanics at the depot' },
    });
    expect((fixed.json() as StakeholdersView).review?.valid).toBe(true);
    const approved = await change(w, 'POST', '/stakeholders/approve');
    expect(approved.statusCode, approved.body).toBe(200);
    expect((approved.json() as StakeholdersView).stakeholders?.approvedAt).not.toBeNull();
  });

  it('holds making actors to the same checks, for a list that no longer passes them after it was approved', async () => {
    const w = await world();
    await w.propose();
    expect((await change(w, 'POST', '/stakeholders/approve')).statusCode).toBe(200);
    // The stored list is changed from outside the routes, so that a check fails while the approval stands.
    const record = w.repository.artifacts.get(w.project.id, 'stakeholders')!;
    const data = structuredClone(record.data);
    data.stakeholders[0]!.name = 'Staff';
    w.repository.artifacts.put(w.project.id, 'stakeholders', 'default', data, {
      expectedRevision: record.revision,
    });
    expect((await w.view()).stakeholders?.approvedAt).not.toBeNull();
    const refused = await w.call('POST', '/actors/generate', {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('PARTICIPANTS_INVALID');
    expect((await w.call('GET', '/actors')).json().actors).toBeNull();
  });

  it('makes actors from an approved proposal that carry what each participant is, could do and must never be said to be', async () => {
    const w = await world();
    await w.propose();
    expect((await change(w, 'POST', '/stakeholders/approve')).statusCode).toBe(200);
    const made = await w.call('POST', '/actors/generate', {});
    expect(made.statusCode, made.body).toBe(201);
    const { actors } = (made.json() as ActorsView).actors!;
    expect(actors.length).toBeGreaterThanOrEqual(2);
    for (const actor of actors) {
      expect(actor.synthetic).toBe(true);
      expect(actor.participantRole).toBeTruthy();
      expect(actor.plausibleActions?.length).toBeGreaterThan(0);
      expect(actor.prohibitedClaims?.join(' ')).toContain('real, identified person');
      expect(actor.objectives.length).toBeGreaterThan(0);
    }
  });

  it('holds a set the proposal made to every rule, and a set found by the older route to its older ones', async () => {
    const strict = await world();
    await strict.propose();
    const set = (await strict.view()).stakeholders!;
    const generic = (name: string) => ({
      ...structuredClone(set.stakeholders[0]!),
      id: 'staff-group',
      name,
      status: 'added' as const,
      origin: 'user' as const,
      evidence: [],
      mergedFrom: [],
    });
    const added = await change(strict, 'POST', '/stakeholders/add-missing', {
      role: 'implementers',
      name: 'Staff',
    });
    expect(added.statusCode, added.body).toBe(200);
    expect((await change(strict, 'POST', '/stakeholders/approve')).json().error.code).toBe(
      'PARTICIPANTS_INVALID',
    );

    const older = await world();
    const legacy = stakeholderSetSchema.parse({
      stakeholders: [
        generic('Staff'),
        { ...generic('Customers'), id: 'customers', category: 'end-user' },
      ].map(
        ({
          participantRole: _a,
          objective: _b,
          plausibleActions: _c,
          prohibitedClaims: _d,
          confidenceBasis: _e,
          influence: _f,
          decisionAuthority: _g,
          synthetic: _h,
          incentives: _i,
          pressures: _j,
          constraints: _k,
          concerns: _l,
          informationAccess: _m,
          ...rest
        }) => rest,
      ),
      discovery: { mode: 'rules', generatedAt: '2026-03-01T09:00:00.000Z' },
    });
    older.repository.artifacts.put(older.project.id, 'stakeholders', 'default', legacy, {
      expectedRevision: 0,
    });
    const view = await older.view();
    expect(view.review?.profile).toBe('legacy');
    expect(view.review?.valid).toBe(true);
    expect(
      view.review?.issues.some(
        (issue) => issue.code === 'generic-name' && issue.severity === 'advisory',
      ),
    ).toBe(true);
    expect((await change(older, 'POST', '/stakeholders/approve')).statusCode).toBe(200);
  });

  it('keeps the old refusal for fewer than two, which says what to do', async () => {
    const w = await world();
    await w.propose();
    for (const item of (await w.live()).slice(1)) {
      await change(w, 'DELETE', `/stakeholders/${item.id}`);
    }
    const refused = await change(w, 'POST', '/stakeholders/approve');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('STAKEHOLDERS_TOO_FEW');
  });
});

describe('reviewing participants', () => {
  it('accepts one, some or every participant that is only proposed, and nothing else', async () => {
    const w = await world();
    await w.propose();
    const [first, second] = await w.live();
    const one = await change(w, 'POST', '/stakeholders/accept', { ids: [first!.id] });
    expect(one.statusCode, one.body).toBe(200);
    const statuses = async () =>
      Object.fromEntries((await w.live()).map((item) => [item.id, item.status]));
    expect((await statuses())[first!.id]).toBe('accepted');
    expect((await statuses())[second!.id]).toBe('proposed');
    const all = await change(w, 'POST', '/stakeholders/accept');
    expect(all.statusCode).toBe(200);
    expect((await w.live()).every((item) => item.status === 'accepted')).toBe(true);
    const unknown = await change(w, 'POST', '/stakeholders/accept', { ids: ['nobody'] });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('PARTICIPANT_NOT_FOUND');
    expect((await change(w, 'POST', '/stakeholders/accept', { ids: [] })).statusCode).toBe(400);
  });

  it('edits only what a person may edit, marks it as theirs, and takes the approval away', async () => {
    const w = await world();
    await w.propose();
    await change(w, 'POST', '/stakeholders/approve');
    const target = (await w.live()).find((item) => item.evidence.length > 0)!;
    const response = await change(w, 'PATCH', `/stakeholders/${target.id}`, {
      changes: {
        objective: 'Keep the late service running.',
        incentives: ['Keep late travel possible.', 'Keep late travel possible.'],
        plausibleActions: ['Ask for a hearing.'],
        influence: 'low',
        impact: { direction: 'harmed', rationale: 'Set by me.' },
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const view = response.json() as StakeholdersView;
    const after = view.stakeholders!.stakeholders.find((item) => item.id === target.id)!;
    expect(after).toMatchObject({
      status: 'edited',
      objective: 'Keep the late service running.',
      incentives: ['Keep late travel possible.'],
      influence: 'low',
      origin: target.origin,
    });
    expect(after.expectedImpact).toMatchObject({ direction: 'harmed', origin: 'user' });
    expect(after.evidence).toEqual(target.evidence);
    expect(view.stakeholders?.approvedAt).toBeNull();
  });

  it('refuses a change to what is not a person’s to change, a role that does not suit the party, and a participant that is removed', async () => {
    const w = await world();
    await w.propose();
    const target = (await w.live())[0]!;
    const patch = (changes: unknown) =>
      change(w, 'PATCH', `/stakeholders/${target.id}`, { changes });
    for (const changes of [
      { evidence: [] },
      { origin: 'user' },
      { status: 'accepted' },
      { synthetic: false },
      {},
    ]) {
      expect((await patch(changes)).statusCode, JSON.stringify(changes)).toBe(400);
    }
    const mismatch = await patch({ participantRole: 'decision-owner', category: 'competitor' });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe('ROLE_CATEGORY_MISMATCH');
    await change(w, 'DELETE', `/stakeholders/${target.id}`);
    const removed = await patch({ objective: 'Anything.' });
    expect(removed.statusCode).toBe(409);
    expect(removed.json().error.code).toBe('PARTICIPANT_REMOVED');
    expect(
      (await change(w, 'PATCH', '/stakeholders/nobody', { changes: { objective: 'x' } }))
        .statusCode,
    ).toBe(404);
  });

  it('never lets the standing prohibitions be taken away', async () => {
    const w = await world();
    await w.propose();
    const target = (await w.live())[0]!;
    const response = await change(w, 'PATCH', `/stakeholders/${target.id}`, {
      changes: { prohibitedClaims: ['That it has agreed to anything.'] },
    });
    const after = (response.json() as StakeholdersView).stakeholders!.stakeholders.find(
      (item) => item.id === target.id,
    )!;
    expect(after.prohibitedClaims).toContain('That it is a real, identified person.');
    expect(after.prohibitedClaims).toContain('That it has agreed to anything.');
  });

  it('removes a participant into the record, so that it can be read back and restored', async () => {
    const w = await world();
    await w.propose();
    const target = (await w.live())[0]!;
    const removed = await change(w, 'DELETE', `/stakeholders/${target.id}`);
    expect(removed.statusCode, removed.body).toBe(200);
    const stored = (removed.json() as StakeholdersView).stakeholders!.stakeholders.find(
      (item) => item.id === target.id,
    )!;
    expect(stored.status).toBe('removed');
    expect((await w.live()).map((item) => item.id)).not.toContain(target.id);
    expect((await w.call('DELETE', `/stakeholders/${target.id}`)).statusCode).toBe(400);
  });

  it('adds a participant for a role nobody holds: the person’s own, with no evidence, said to be an assumption, started from its role', async () => {
    const w = await world();
    await w.propose();
    const gap = (await w.view()).review!.issues.find((issue) => issue.code === 'missing-role');
    const response = await change(w, 'POST', '/stakeholders/add-missing', {
      role: gap?.role ?? 'missing-voices',
      name: 'Night shift riders without a car',
    });
    expect(response.statusCode, response.body).toBe(200);
    const added = (response.json() as StakeholdersView).stakeholders!.stakeholders.find(
      (item) => item.name === 'Night shift riders without a car',
    )!;
    expect(added).toMatchObject({
      origin: 'user',
      status: 'added',
      evidence: [],
      confidenceBasis: 'user-assertion',
      synthetic: true,
    });
    expect(added.plausibleActions?.length).toBeGreaterThan(0);
    expect(added.prohibitedClaims).toContain('That it is a real, identified person.');
    expect(added.expectedImpact.origin).toBe('user');
    const view = response.json() as StakeholdersView;
    expect(
      view.review?.issues.some(
        (issue) => issue.code === 'missing-role' && issue.role === gap?.role,
      ),
    ).toBe(false);
    for (const body of [
      { role: 'staff', name: 'Someone here' },
      { role: 'implementers' },
      { role: 'implementers', name: 'ab' },
      { role: 'implementers', name: 'Valid name', extra: 1 },
    ]) {
      expect(
        (await change(w, 'POST', '/stakeholders/add-missing', body)).statusCode,
        JSON.stringify(body),
      ).toBe(400);
    }
  });

  it('merges participants that are one: the copy stays under Removed, named by the one it went into, with the evidence of both', async () => {
    const w = await world();
    await w.propose();
    expect((await change(w, 'POST', '/stakeholders/merge-duplicates')).json().error.code).toBe(
      'NO_DUPLICATES',
    );
    const stored = w.repository.artifacts.get(w.project.id, 'stakeholders')!;
    const [a, b] = stored.data.stakeholders.filter(
      (item) => item.status !== 'removed' && item.evidence.length > 0,
    );
    const twin = {
      ...structuredClone(b!),
      id: 'twin',
      name: a!.name,
      evidence: b!.evidence.slice(0, 1),
    };
    w.repository.artifacts.put(
      w.project.id,
      'stakeholders',
      'default',
      { ...stored.data, stakeholders: [...stored.data.stakeholders, twin] },
      { expectedRevision: stored.revision },
    );
    const before = await w.view();
    expect(before.review?.issues.some((issue) => issue.code === 'duplicate-participant')).toBe(
      true,
    );
    expect(before.review?.valid).toBe(false);
    const merged = await change(w, 'POST', '/stakeholders/merge-duplicates');
    expect(merged.statusCode, merged.body).toBe(200);
    const view = merged.json() as StakeholdersView;
    const keeper = view.stakeholders!.stakeholders.find((item) => item.id === a!.id)!;
    expect(keeper.mergedFrom).toContain('twin');
    expect(view.stakeholders!.stakeholders.find((item) => item.id === 'twin')?.status).toBe(
      'removed',
    );
    expect(view.review?.issues.some((issue) => issue.code === 'duplicate-participant')).toBe(false);
    for (const ref of twin.evidence) {
      expect(
        keeper.evidence.some(
          (have) => have.passageId === ref.passageId && have.quote === ref.quote,
        ),
      ).toBe(true);
    }
  });

  it('merges the groups a person chooses, and refuses a merge that names itself, a stranger or a participant twice', async () => {
    const w = await world();
    await w.propose();
    const [a, b, c] = await w.live();
    const bad = async (groups: unknown) =>
      (await change(w, 'POST', '/stakeholders/merge-duplicates', { groups })).statusCode;
    expect(await bad([{ keep: a!.id, merge: [a!.id] }])).toBe(400);
    expect(await bad([{ keep: a!.id, merge: ['nobody'] }])).toBe(404);
    expect(
      await bad([
        { keep: a!.id, merge: [b!.id] },
        { keep: c!.id, merge: [b!.id] },
      ]),
    ).toBe(400);
    expect(await bad([])).toBe(400);
    const done = await change(w, 'POST', '/stakeholders/merge-duplicates', {
      groups: [{ keep: a!.id, merge: [b!.id] }],
    });
    expect(done.statusCode, done.body).toBe(200);
    const view = done.json() as StakeholdersView;
    expect(view.stakeholders!.stakeholders.find((item) => item.id === b!.id)?.status).toBe(
      'removed',
    );
    expect(view.stakeholders!.stakeholders.find((item) => item.id === a!.id)?.mergedFrom).toEqual([
      b!.id,
    ]);
  });

  it('explains a participant from what it holds, without asking a model or adding a fact', async () => {
    const model = new RouteModel([]);
    const w = await world({ model });
    await w.propose();
    const target = (await w.live()).find((item) => item.evidence.length > 0)!;
    const answer = await w.call('GET', `/stakeholders/${target.id}/why`);
    expect(answer.statusCode, answer.body).toBe(200);
    const why = answer.json() as ParticipantWhy;
    expect(why).toMatchObject({
      id: target.id,
      name: target.name,
      basis: { kind: 'source-quote' },
    });
    expect(why.evidence.map((item) => item.quote)).toEqual(
      target.evidence.map((ref) => ref.quote ?? ''),
    );
    expect(why.limits.join(' ')).toContain('synthetic role, not a person');
    expect((await w.call('GET', `/stakeholders/${target.id}/why`)).json()).toEqual(why);
    expect(model.calls).toBe(0);
    expect((await w.call('GET', '/stakeholders/nobody/why')).statusCode).toBe(404);
    const empty = await world();
    expect((await empty.call('GET', '/stakeholders/anyone/why')).statusCode).toBe(404);
  });
});

describe('proposing one participant again', () => {
  it('resets it from the sources with no model, asks for confirmation before it replaces edits, and takes the approval away', async () => {
    const w = await world();
    await w.propose();
    const target = (await w.live()).find((item) => item.evidence.length > 0)!;
    await change(w, 'PATCH', `/stakeholders/${target.id}`, {
      changes: { objective: 'Changed by hand.' },
    });
    const refused = await change(w, 'POST', `/stakeholders/${target.id}/regenerate`, {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('PARTICIPANT_EDITED');
    const done = await change(w, 'POST', `/stakeholders/${target.id}/regenerate`, {
      confirm: true,
    });
    expect(done.statusCode, done.body).toBe(200);
    const after = (done.json() as StakeholdersView).stakeholders!.stakeholders.find(
      (item) => item.id === target.id,
    )!;
    expect(after.status).toBe('proposed');
    expect(after.objective).not.toBe('Changed by hand.');
    expect(after.id).toBe(target.id);
    // The passage that names it is cited once however many times it is proposed again.
    expect(after.relevance.match(/A cited passage reads/gu)).toHaveLength(1);
    expect((await w.live()).length).toBeGreaterThanOrEqual(2);
  });

  it('is not for a participant the person added, or one that is removed, or one that does not exist', async () => {
    const w = await world();
    await w.propose();
    const added = await change(w, 'POST', '/stakeholders/add-missing', {
      role: 'missing-voices',
      name: 'Riders without a car',
    });
    const mine = (added.json() as StakeholdersView).stakeholders!.stakeholders.find(
      (item) => item.origin === 'user',
    )!;
    const refused = await change(w, 'POST', `/stakeholders/${mine.id}/regenerate`, {});
    expect(refused.json().error.code).toBe('PARTICIPANT_NOT_REGENERABLE');
    const other = (await w.live()).find((item) => item.origin !== 'user')!;
    await change(w, 'DELETE', `/stakeholders/${other.id}`);
    expect(
      (await change(w, 'POST', `/stakeholders/${other.id}/regenerate`, {})).json().error.code,
    ).toBe('PARTICIPANT_REMOVED');
    expect((await change(w, 'POST', '/stakeholders/nobody/regenerate', {})).statusCode).toBe(404);
  });

  it('asks the model for one replacement when it is chosen and available, stops when it cannot be used, and uses the sources only when the person chooses rules', async () => {
    const passages = passagesOf(`${NOTES} Canary: ${CANARY}.`);
    const all = proposal(passages);
    const replacement = JSON.parse(JSON.stringify(all)) as typeof all;
    replacement.relations = [];
    const model = new RouteModel([all]);
    const w = await world({ model });
    await w.propose({ mode: 'model' });
    const target = (await w.live()).find((item) => item.id === 'old-corridor-residents')!;
    replacement.participants = [
      {
        ...replacement.participants[2]!,
        id: target.id,
        name: 'Late-evening riders of the old corridor',
      },
    ];
    model.calls = 0;
    (model as unknown as { replies: unknown[] }).replies.push(replacement);
    const done = await change(w, 'POST', `/stakeholders/${target.id}/regenerate`, {
      mode: 'model',
    });
    expect(done.statusCode, done.body).toBe(200);
    expect((await w.live()).find((item) => item.id === target.id)?.name).toBe(
      'Late-evening riders of the old corridor',
    );
    expect(model.calls).toBe(1);

    (model as unknown as { replies: unknown[] }).replies.push(
      new AppError(502, 'MODEL_UNREACHABLE', 'down'),
    );
    const before = await w.view();
    const stopped = await change(w, 'POST', `/stakeholders/${target.id}/regenerate`, {
      mode: 'model',
      confirm: true,
    });
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(stopped.json()).toEqual({
      stopped: {
        code: 'MODEL_UNREACHABLE',
        detail: 'The model could not be reached.',
        retryable: true,
      },
    });
    expect(await w.view()).toEqual(before);

    const rules = await change(w, 'POST', `/stakeholders/${target.id}/regenerate`, {
      mode: 'rules',
      confirm: true,
      fallbackFrom: 'MODEL_UNREACHABLE',
    });
    expect(rules.statusCode, rules.body).toBe(200);
    const after = (rules.json() as StakeholdersView).stakeholders!;
    expect(after.proposal?.notes.at(-1)).toContain('rules fallback');
    expect((await w.live()).find((item) => item.id === target.id)?.origin).not.toBe('model');
    const plain = await world();
    await plain.propose();
    const first = (await plain.live())[0]!;
    const unavailable = await change(plain, 'POST', `/stakeholders/${first.id}/regenerate`, {
      mode: 'model',
    });
    expect(unavailable.json().error.code).toBe('MODEL_NOT_AVAILABLE');
  });
});

describe('revisions', () => {
  it.each([
    ['accept', 'POST', '/stakeholders/accept', {}],
    ['edit', 'PATCH', '/stakeholders/ID', { changes: { objective: 'x' } }],
    ['remove', 'DELETE', '/stakeholders/ID', null],
    ['regenerate', 'POST', '/stakeholders/ID/regenerate', {}],
    ['merge', 'POST', '/stakeholders/merge-duplicates', {}],
    [
      'add a missing participant',
      'POST',
      '/stakeholders/add-missing',
      { role: 'missing-voices', name: 'Riders without a car' },
    ],
    ['approve', 'POST', '/stakeholders/approve', {}],
  ] as const)(
    'refuses to %s against a revision that is not the current one, and changes nothing',
    async (_name, method, path, body) => {
      const w = await world();
      await w.propose();
      const target = (await w.live())[0]!;
      const url = path.replace('ID', target.id);
      const stale = (await w.revision()) + 5;
      const before = JSON.stringify(await w.view());
      const response =
        body === null
          ? await w.call('DELETE', `${url}?expectedRevision=${stale}`)
          : await w.call(method, url, { ...body, expectedRevision: stale });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('ARTIFACT_CONFLICT');
      expect(JSON.stringify(await w.view())).toBe(before);
    },
  );

  it('refuses a change when no participants have been proposed, saying what to do', async () => {
    const w = await world();
    const response = await w.call('POST', '/stakeholders/accept', { expectedRevision: 1 });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('STAKEHOLDERS_NOT_FOUND');
  });
});

describe('what the audit log is told', () => {
  it('holds counts and fixed labels only, never a name, a quote or a person’s words', async () => {
    const w = await world();
    await w.propose();
    const [first, second] = await w.live();
    await change(w, 'POST', '/stakeholders/accept', { ids: [first!.id] });
    await change(w, 'PATCH', `/stakeholders/${second!.id}`, {
      changes: { objective: `Keep it going ${CANARY}` },
    });
    await change(w, 'DELETE', `/stakeholders/${(await w.live())[2]!.id}`);
    await change(w, 'POST', '/stakeholders/add-missing', {
      role: 'missing-voices',
      name: `Riders ${CANARY}`,
    });
    await change(w, 'POST', `/stakeholders/${first!.id}/regenerate`, {});
    await change(w, 'POST', '/stakeholders/approve');
    const entries = w.repository.audit.list({ projectId: w.project.id, limit: 500 });
    const actions = entries
      .map((entry) => entry.action)
      .filter((action) => action.startsWith('stakeholders.'));
    expect(actions).toEqual([
      'stakeholders.discovered',
      'stakeholders.edited',
      'stakeholders.edited',
      'stakeholders.edited',
      'stakeholders.edited',
      'stakeholders.edited',
      'stakeholders.approved',
    ]);
    const text = JSON.stringify(entries);
    expect(text).not.toContain(CANARY);
    for (const stakeholder of (await w.view()).stakeholders!.stakeholders) {
      expect(text).not.toContain(stakeholder.name);
      for (const ref of stakeholder.evidence) expect(text).not.toContain(ref.quote ?? '\u0000');
    }
    const edit = entries.find((entry) => entry.detail.operation === 'edit');
    expect(edit?.detail).toMatchObject({ operation: 'edit', fields: 1, approvalCleared: false });
    const proposed = entries.find((entry) => entry.action === 'stakeholders.discovered');
    expect(proposed?.detail).toMatchObject({
      via: 'propose',
      mode: 'rules',
      asked: 'rules',
      failure: null,
      replaced: false,
    });
  });

  it('writes the change and its audit entry together, and nothing when the change is refused', async () => {
    const w = await world();
    await w.propose();
    const count = () => w.repository.audit.list({ projectId: w.project.id, limit: 500 }).length;
    const before = count();
    const refused = await w.call('PATCH', `/stakeholders/${(await w.live())[0]!.id}`, {
      expectedRevision: 99,
      changes: { objective: 'x' },
    });
    expect(refused.statusCode).toBe(409);
    expect(count()).toBe(before);
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

describe('who may propose, review and approve participants', () => {
  const routes = [
    {
      name: 'propose',
      policy: 'POST /api/projects/:id/stakeholders/propose',
      capability: 'run',
      method: 'POST',
      path: '/stakeholders/propose',
      payload: {},
    },
    {
      name: 'validate',
      policy: 'GET /api/projects/:id/stakeholders/validation',
      capability: 'read',
      method: 'GET',
      path: '/stakeholders/validation',
    },
    {
      name: 'accept',
      policy: 'POST /api/projects/:id/stakeholders/accept',
      capability: 'edit',
      method: 'POST',
      path: '/stakeholders/accept',
      payload: { invalid: true },
    },
    {
      name: 'edit',
      policy: 'PATCH /api/projects/:id/stakeholders/:participantId',
      capability: 'edit',
      method: 'PATCH',
      path: '/stakeholders/someone',
      payload: { invalid: true },
    },
    {
      name: 'remove',
      policy: 'DELETE /api/projects/:id/stakeholders/:participantId',
      capability: 'edit',
      method: 'DELETE',
      path: '/stakeholders/someone?expectedRevision=1',
    },
    {
      name: 'regenerate',
      policy: 'POST /api/projects/:id/stakeholders/:participantId/regenerate',
      capability: 'run',
      method: 'POST',
      path: '/stakeholders/someone/regenerate',
      payload: { invalid: true },
    },
    {
      name: 'ask why',
      policy: 'GET /api/projects/:id/stakeholders/:participantId/why',
      capability: 'read',
      method: 'GET',
      path: '/stakeholders/someone/why',
    },
    {
      name: 'merge',
      policy: 'POST /api/projects/:id/stakeholders/merge-duplicates',
      capability: 'edit',
      method: 'POST',
      path: '/stakeholders/merge-duplicates',
      payload: { invalid: true },
    },
    {
      name: 'add missing',
      policy: 'POST /api/projects/:id/stakeholders/add-missing',
      capability: 'edit',
      method: 'POST',
      path: '/stakeholders/add-missing',
      payload: { invalid: true },
    },
  ] as const;

  it('is the policy table: each route needs the capability written beside it here, and the audit log has a rule for each', () => {
    for (const route of routes) {
      expect(ROUTE_POLICY[route.policy], route.policy).toEqual({
        kind: 'project',
        capability: route.capability,
      });
      expect(AUDIT_POLICY[route.policy], route.policy).toBeDefined();
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
    repository.members.setWorkspaceMember({
      tenantId: TENANT_A,
      principalId: ID.lead,
      role: 'member',
      actor: { id: 'test-setup', workspaceRole: 'owner' as const },
    });
    const project = repository.create(
      fixtureInput({ workflow: 'guided', documents: [{ name: 'notes.md', content: NOTES }] }),
      {
        owner: { tenantId: TENANT_A, ownerId: ID.lead },
      },
    );
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

  it.each(Object.keys(MAY) as Person[])('does what the table says for %s', async (person) => {
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
      } else {
        expect(response.statusCode, `${person} ${route.name}`).toBe(403);
        expect(body.error?.code).toBe('FORBIDDEN');
      }
    }
  });

  it('keeps one tenant’s participants from another: a stranger is told there is no such project, and reads nothing', async () => {
    const w = await secured();
    const proposed = await w.app.inject({
      method: 'POST',
      url: `/api/projects/${w.id}/stakeholders/propose`,
      headers: await authorization(TOKENS.lead),
      payload: {},
    });
    expect(proposed.statusCode, proposed.body).toBe(201);
    for (const path of ['/stakeholders', '/stakeholders/validation']) {
      const response = await w.app.inject({
        method: 'GET',
        url: `/api/projects/${w.id}${path}`,
        headers: await authorization(TOKENS.stranger),
      });
      expect(response.statusCode, path).toBe(404);
      expect(response.body).not.toContain('Swarm proposes');
    }
  });
});
