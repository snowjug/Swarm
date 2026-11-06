import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { InjectOptions } from 'fastify';
import { scenarioFrameSchema } from '../../../shared/scenario.js';
import type { Job } from '../../src/storage/jobs.js';
import { currentFunding } from '../../src/public/funding.js';
import { AppError } from '../../src/errors.js';
import { modelIdentity } from '../../src/models/identity.js';
import { BYOK_BLOCKED_WORDS } from '../../src/public/models.js';
import { tablesOf } from '../../src/storage/postgres/row-security.js';
import { forgetAllSecrets } from '../../src/public/byok/secrets.js';
import { fixtureInput } from '../fixtures.js';
import { FakeGemini, googleError } from '../support/fake-gemini.js';
import { FakeFoundry, foundryEnvironment } from '../support/public-foundry.js';
import { publicApp, type PublicHarness } from '../support/public-idp.js';
import { NOTES, passagesOf, proposal } from '../support/participants-world.js';

const KEY = 'AIzaSyD-canary0123456789abcdefghijklmn_';
const PLAIN = 'canary-plain-key-0123456789-abcdefghij';
const UNKNOWN = 'AIzaSyUnknownUnknownUnknownUnknownUn_00';
const MODEL = 'gemini-2.5-flash';
const csrf = { 'x-swarm-csrf': '1', 'content-type': 'application/json' };
const own = (key = KEY, model: string | null = MODEL) => ({
  'x-swarm-provider': 'gemini',
  'x-swarm-provider-key': key,
  ...(model ? { 'x-swarm-provider-model': model } : {}),
});

const open: PublicHarness[] = [];
afterEach(() => forgetAllSecrets());
afterAll(async () => {
  await Promise.all(open.splice(0).map((made) => made.close()));
});

interface Options {
  environment?: Record<string, string>;
  log?: boolean;
}

/** An app with the operator's model set up, a fake Azure behind it and a fake Google for a person's own key. */
async function world(options: Options = {}) {
  const gemini = new FakeGemini();
  gemini.keys.add(KEY);
  gemini.keys.add(PLAIN);
  const foundry = new FakeFoundry();
  const logs: string[] = [];
  const h = await publicApp(
    {
      ...foundryEnvironment,
      PUBLIC_SIGNUPS_PER_IP_PER_DAY: '1000',
      PUBLIC_SIGNUPS_PER_HOUR: '1000',
      ...options.environment,
    },
    {
      public: { modelFetcher: foundry.fetch, byokFetcher: gemini.fetch },
      ...(options.log
        ? {
            log: {
              stream: { write: (chunk: string) => logs.push(chunk) },
              level: 'debug' as const,
            },
          }
        : {}),
    },
  );
  open.push(h);
  const context = h.built.publicEdition!.context;
  /** Every answer the server gave, in full, for the tests that look for what must not be in one. */
  const answers: string[] = [];
  const send = async (request: InjectOptions | string) => {
    const response = await h.app.inject(request);
    answers.push(`${response.statusCode} ${JSON.stringify(response.headers)} ${response.body}`);
    return response;
  };
  let counter = 0;
  const person = async (name = `person${(counter += 1)}`) => {
    const who = await h.signIn({
      provider: 'google',
      subject: `g-${name}`,
      email: `${name}@example.com`,
    });
    const user = h.built.repository.asSystem(() => context.users.find('google', `g-${name}`)!);
    return { ...who, workspaceId: user.workspaceId, userId: user.id, name };
  };
  type Person = Awaited<ReturnType<typeof person>>;
  const reset = () => {
    gemini.seen.length = 0;
    gemini.chats = 0;
    gemini.refuses.clear();
    gemini.listing = null;
    gemini.reply = () => gemini.ok('{"ok":true}');
    gemini.models = [...gemini.models];
    foundry.seen.length = 0;
  };

  const passages = passagesOf(NOTES);
  const good = () => JSON.stringify(proposal(passages));
  /** A model-assisted project with a scenario, ready for the participants to be proposed. */
  const project = async (who: Person): Promise<string> => {
    const made = await send({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: who.cookie, ...csrf },
      payload: fixtureInput({
        workflow: 'guided',
        name: 'Night bus',
        question: 'What could happen if the night bus route moves to a new corridor?',
        documents: [{ name: 'notes.md', content: NOTES }],
        settings: { mode: 'llm', agentCount: 4, rounds: 3 },
      }),
    });
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json().id as string;
    h.built.repository.asTenant(who.workspaceId, () =>
      h.built.repository.artifacts.put(
        id,
        'scenario',
        'default',
        scenarioFrameSchema.parse({
          decision: 'Whether to move the night bus route to a new corridor next spring',
          system: 'Night bus network',
          baseline: 'The night bus stays on the old corridor.',
          likelyStakeholders: ['transit office'],
          origin: 'user',
        }),
      ),
    );
    return id;
  };
  const propose = (
    who: Person,
    id: string,
    headers: Record<string, string> = own(),
    mode = 'model',
  ) =>
    send({
      method: 'POST',
      url: `/api/projects/${id}/stakeholders/propose`,
      headers: { cookie: who.cookie, ...csrf, ...headers },
      payload: { mode },
    });
  const call = (
    who: Person,
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    headers: Record<string, string> = {},
    payload?: object,
  ) =>
    send({
      method,
      url,
      headers: {
        cookie: who.cookie,
        // A body that is JSON is sent with the JSON header, and one with no body is not sent with it.
        ...(method === 'GET' ? {} : method === 'POST' ? csrf : { 'x-swarm-csrf': '1' }),
        ...headers,
      },
      ...(payload ? { payload } : method === 'POST' ? { payload: {} } : {}),
    });
  /** What the funding of a run of this project would be, as the job queue would set it when it picked the run up. */
  const fundingOfRun = async (id: string) => {
    const jobs = h.built.jobs as unknown as {
      enterRun(job: Job, run: () => Promise<unknown>): Promise<unknown>;
    };
    let seen: {
      funding: string | undefined;
      key: boolean;
      workspace: string | undefined;
      identity: string;
      /** What a model made for the run would be: the code of the refusal, or "a model" that is paid for as `funding`. */
      model: string;
    } | null = null;
    await jobs.enterRun({ projectId: id } as Job, async () => {
      const now = currentFunding();
      const decided = h.built.publicEdition!.funding();
      seen = {
        funding: now?.funding,
        key: Boolean(now?.byok),
        workspace: now?.workspaceId,
        identity: JSON.stringify(modelIdentity({ name: 'foundry', model: 'operator-deployment' })),
        model: decided instanceof AppError ? decided.code : 'a model',
      };
    });
    return seen!;
  };
  return {
    h,
    context,
    gemini,
    foundry,
    logs,
    answers,
    send,
    person,
    project,
    propose,
    call,
    good,
    reset,
    passages,
    fundingOfRun,
  };
}
type World = Awaited<ReturnType<typeof world>>;

describe('a person’s own Gemini key', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  beforeEach(() => w.reset());

  describe('trying a key', () => {
    it('lists what the key can use and chooses a default by rule, and says nothing of the key', async () => {
      const alice = await w.person();
      const response = await w.call(alice, 'POST', '/api/byok/connect', own());
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ status: 'valid', defaultModel: 'gemini-2.5-flash' });
      expect(body.models.map((model: { id: string }) => model.id)).toContain('gemini-2.5-pro');
      expect(response.body).not.toContain(KEY);
      expect(JSON.stringify(response.headers)).not.toContain(KEY);
      expect(w.gemini.seen).toHaveLength(1);
      expect(w.gemini.seen[0]).toMatchObject({
        method: 'GET',
        path: '/v1beta/openai/models',
        authorization: `Bearer ${KEY}`,
      });
      expect(w.gemini.strays).toEqual([]);
      // A key that works is held for the person's runs, in memory.
      expect(w.context.keys.has(alice.workspaceId)).toBe(true);
    });

    it('says plainly when the key is not accepted, and does not keep it', async () => {
      const alice = await w.person();
      w.gemini.keys.delete(KEY);
      const response = await w.call(alice, 'POST', '/api/byok/connect', own());
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'invalid',
        message:
          'Google did not accept this key. Check that you copied all of it, or make a new one in AI Studio.',
        models: [],
        defaultModel: null,
      });
      expect(response.body).not.toContain(KEY);
      expect(w.context.keys.has(alice.workspaceId)).toBe(false);
      w.gemini.keys.add(KEY);
    });

    it.each([
      [
        'rate-limited',
        () =>
          googleError(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted (e.g. check quota).'),
      ],
      [
        'quota',
        () =>
          googleError(
            429,
            'RESOURCE_EXHAUSTED',
            'You exceeded your current quota, please check your plan and billing details. per day',
          ),
      ],
      [
        'region',
        () =>
          googleError(
            400,
            'FAILED_PRECONDITION',
            'User location is not supported for the API use.',
          ),
      ],
      ['unreachable', () => googleError(503, 'UNAVAILABLE', 'The service is overloaded.')],
    ])('answers %s with that status and our words, never Google’s', async (status, listing) => {
      const alice = await w.person();
      w.gemini.listing = listing;
      const response = await w.call(alice, 'POST', '/api/byok/connect', own());
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status, models: [], defaultModel: null });
      expect(response.body).not.toMatch(
        /RESOURCE_EXHAUSTED|FAILED_PRECONDITION|UNAVAILABLE|overloaded|User location/u,
      );
    });

    it('is for a signed-in person on the page itself, and refuses what is not a key', async () => {
      const alice = await w.person();
      const anonymous = await w.h.app.inject({
        method: 'POST',
        url: '/api/byok/connect',
        headers: { ...csrf, ...own() },
        payload: {},
      });
      expect(anonymous.statusCode).toBe(401);
      const noHeader = await w.h.app.inject({
        method: 'POST',
        url: '/api/byok/connect',
        headers: { cookie: alice.cookie, ...own() },
        payload: {},
      });
      expect(noHeader.statusCode).toBe(403);
      const none = await w.call(alice, 'POST', '/api/byok/connect');
      expect(none.statusCode).toBe(400);
      expect(none.json().error.code).toBe('INVALID_INPUT');
      for (const headers of [
        own('short'),
        own(KEY, 'not a model'),
        { ...own(), 'x-swarm-provider': 'openai' },
      ]) {
        const bad = await w.call(alice, 'POST', '/api/byok/connect', headers);
        expect(bad.statusCode, bad.body).toBe(400);
        expect(bad.body).not.toContain(KEY);
        expect(bad.body).not.toContain('short');
      }
      expect(w.gemini.seen).toHaveLength(0);
    });

    it('is not a way to find out whether keys are valid: a few an hour, for each person', async () => {
      const alice = await w.person();
      const bob = await w.person();
      for (let i = 0; i < 10; i++)
        expect((await w.call(alice, 'POST', '/api/byok/connect', own())).statusCode).toBe(200);
      const eleventh = await w.call(alice, 'POST', '/api/byok/connect', own());
      expect(eleventh.statusCode).toBe(429);
      expect(eleventh.json().error.code).toBe('RATE_LIMITED');
      expect((await w.call(bob, 'POST', '/api/byok/connect', own())).statusCode).toBe(200);
      // And the model chip's check counts against the same.
      expect((await w.call(alice, 'POST', '/api/provider/check', own())).statusCode).toBe(429);
    });
  });

  describe('running on it', () => {
    it('proposes the participants with Gemini, to Google’s host, with the key in a header and nowhere else', async () => {
      const alice = await w.person();
      const id = await w.project(alice);
      w.gemini.reply = () => w.gemini.ok(w.good());
      const response = await w.propose(alice, id);
      expect(response.statusCode, response.body).toBe(201);
      const set = response.json().stakeholders;
      expect(set.discovery).toMatchObject({ mode: 'model', model: MODEL });
      expect(set.proposal).toMatchObject({ source: 'model', failure: null });
      expect(w.gemini.strays).toEqual([]);
      const chats = w.gemini.seen.filter((entry) => entry.method === 'POST');
      expect(chats).toHaveLength(1);
      const sent = chats[0]!;
      expect(sent.authorization).toBe(`Bearer ${KEY}`);
      expect(sent.url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      );
      expect(sent.body).toMatchObject({
        model: MODEL,
        response_format: { type: 'json_schema', json_schema: { strict: true } },
      });
      expect(typeof sent.body!.max_completion_tokens).toBe('number');
      expect(sent.body).not.toHaveProperty('temperature');
      expect(['minimal', 'low']).toContain(sent.body!.reasoning_effort);
      // The key is in the header and not in anything that was sent as the request's content.
      expect(JSON.stringify(sent.body)).not.toContain(KEY);
      // It never touched the operator's deployment, nor the free tier's counts.
      expect(w.foundry.seen).toHaveLength(0);
      expect(w.context.ledger.userState(alice.workspaceId).free.calls).toBe(0);
      expect(w.context.ledger.globalState().calls).toBe(0);
      expect(w.context.ledger.userState(alice.workspaceId).byok).toMatchObject({
        calls: 1,
        inputTokens: 120,
        outputTokens: 80,
      });
      // What it made is labelled as Gemini's, not as the operator's model.
      expect(JSON.stringify(set)).not.toContain('gpt-4.1-mini');
    });

    it('asks again with more room when a reply was cut off, as it does on Azure, and then keeps it', async () => {
      const alice = await w.person();
      const id = await w.project(alice);
      w.gemini.reply = (call) =>
        call === 1 ? w.gemini.ok('{"participants":[', undefined, 'length') : w.gemini.ok(w.good());
      const response = await w.propose(alice, id);
      expect(response.statusCode, response.body).toBe(201);
      const chats = w.gemini.seen.filter((entry) => entry.method === 'POST');
      expect(chats).toHaveLength(2);
      expect(Number(chats[1]!.body!.max_completion_tokens)).toBeGreaterThan(
        Number(chats[0]!.body!.max_completion_tokens),
      );
      // A reply that ended at its limit was never read.
      expect(response.json().stakeholders.proposal.source).toBe('model');
    });

    it('stops and says so when it is cut off again, and keeps nothing', async () => {
      const alice = await w.person();
      const id = await w.project(alice);
      w.gemini.reply = () => w.gemini.ok('{"participants":[', undefined, 'length');
      const response = await w.propose(alice, id);
      expect(response.statusCode).toBe(200);
      expect(response.json().stopped).toMatchObject({ code: 'MODEL_TRUNCATED' });
      expect(w.gemini.chats).toBe(2);
      const view = (await w.call(alice, 'GET', `/api/projects/${id}/stakeholders`)).json();
      expect(view.stakeholders).toBeNull();
    });

    it('stops when the reply is not what the schema asks for, after the one correction, as on Azure', async () => {
      const alice = await w.person();
      const id = await w.project(alice);
      w.gemini.reply = () => w.gemini.ok('{"participants":"nobody"}');
      const response = await w.propose(alice, id);
      expect(response.statusCode).toBe(200);
      expect(response.json().stopped).toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
      expect(w.gemini.chats).toBe(2);
      expect(
        (await w.call(alice, 'GET', `/api/projects/${id}/stakeholders`)).json().stakeholders,
      ).toBeNull();
    });

    it('asks for no thinking effort of a model that has none, once', async () => {
      const alice = await w.person();
      const id = await w.project(alice);
      w.gemini.reply = () => w.gemini.ok(w.good());
      w.gemini.refuses.add('reasoning_effort');
      expect((await w.propose(alice, id, own(KEY, 'gemini-2.0-flash'))).statusCode).toBe(201);
      const chats = w.gemini.seen.filter((entry) => entry.method === 'POST');
      expect(chats[0]!.body).toHaveProperty('reasoning_effort');
      expect(chats[1]!.body).not.toHaveProperty('reasoning_effort');
      expect(chats[1]!.body).not.toHaveProperty('temperature');
    });

    it.each([
      [
        'a key Google does not accept',
        () =>
          googleError(
            400,
            'INVALID_ARGUMENT',
            'API key not valid. Please pass a valid API key.',
            'API_KEY_INVALID',
          ),
        'BYOK_KEY_REJECTED',
        false,
        1,
      ],
      [
        'a quota that is used up for the day',
        () => googleError(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota. per day'),
        'BYOK_QUOTA',
        false,
        1,
      ],
      [
        'a region Google does not serve',
        () =>
          googleError(
            400,
            'FAILED_PRECONDITION',
            'User location is not supported for the API use.',
          ),
        'BYOK_REGION',
        false,
        1,
      ],
      [
        'a model the key cannot use',
        () => googleError(404, 'NOT_FOUND', 'models/gemini-9 is not found for API version v1beta.'),
        'BYOK_MODEL_NOT_FOUND',
        false,
        1,
      ],
    ])(
      'stops in plain words for %s, with no retry that cannot help',
      async (_what, reply, code, retryable, requests) => {
        const alice = await w.person();
        const id = await w.project(alice);
        w.gemini.reply = reply;
        const response = await w.propose(alice, id);
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().stopped).toMatchObject({ code, retryable });
        expect(w.gemini.seen.filter((entry) => entry.method === 'POST')).toHaveLength(requests);
        expect(response.body).not.toMatch(
          /INVALID_ARGUMENT|RESOURCE_EXHAUSTED|FAILED_PRECONDITION|API_KEY_INVALID|\bNOT_FOUND\b/u,
        );
        expect(response.body).not.toContain(KEY);
      },
    );

    it('waits and asks again when Google says to slow down, and goes on', async () => {
      const alice = await w.person();
      const id = await w.project(alice);
      w.gemini.reply = (call) =>
        call === 1
          ? googleError(
              429,
              'RESOURCE_EXHAUSTED',
              'Resource has been exhausted (e.g. check quota).',
            )
          : w.gemini.ok(w.good());
      const response = await w.propose(alice, id);
      expect(response.statusCode, response.body).toBe(201);
      expect(w.gemini.chats).toBe(2);
    });

    it('says a block is Google’s, and is never answered from rules', async () => {
      const alice = await w.person();
      const id = await w.project(alice);
      w.gemini.reply = () => w.gemini.ok('', undefined, 'content_filter');
      const response = await w.propose(alice, id);
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error).toMatchObject({
        code: 'BYOK_BLOCKED',
        message: BYOK_BLOCKED_WORDS,
      });
      expect(
        (await w.call(alice, 'GET', `/api/projects/${id}/stakeholders`)).json().stakeholders,
      ).toBeNull();
    });

    it('sends no setting that names another host, and reaches only Google’s', async () => {
      const alice = await w.person();
      const id = await w.project(alice);
      w.gemini.reply = () => w.gemini.ok(w.good());
      const response = await w.h.app.inject({
        method: 'POST',
        url: `/api/projects/${id}/stakeholders/propose?baseUrl=https://evil.example&host=evil.example`,
        headers: {
          cookie: alice.cookie,
          ...csrf,
          ...own(),
          'x-swarm-provider-base-url': 'https://evil.example/v1',
          'x-forwarded-host': 'evil.example',
          'x-swarm-provider-host': 'evil.example',
        },
        payload: { mode: 'model' },
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(w.gemini.seen.length).toBeGreaterThan(0);
      expect(w.gemini.strays).toEqual([]);
      expect(w.foundry.seen).toHaveLength(0);
    });

    it('needs a model to be chosen, and says so in one sentence', async () => {
      const alice = await w.person();
      const id = await w.project(alice);
      const response = await w.propose(alice, id, own(KEY, null));
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().stopped.code).toBe('BYOK_MODEL_NOT_FOUND');
      expect(w.gemini.seen).toHaveLength(0);
    });
  });

  describe('what it shows of itself', () => {
    it('is told which funding a request would use, and counts its own use apart from the free tier’s', async () => {
      const alice = await w.person();
      const id = await w.project(alice);
      w.gemini.reply = () => w.gemini.ok(w.good());
      const free = (await w.call(alice, 'GET', '/api/usage')).json();
      expect(free.funding).toBe('free');
      expect((await w.call(alice, 'GET', '/api/usage', own())).json().funding).toBe('byok');
      expect((await w.propose(alice, id)).statusCode).toBe(201);
      const after = (await w.call(alice, 'GET', '/api/usage', own())).json();
      expect(after.byok.today).toMatchObject({ calls: 1, tokens: 200 });
      expect(after.free.today).toMatchObject({ calls: 0, tokens: 0 });
    });

    it('answers the model chip about the key, and checks it with the one request that uses no tokens', async () => {
      const alice = await w.person();
      const status = (await w.call(alice, 'GET', '/api/provider/status', own())).json();
      expect(status).toMatchObject({
        mode: 'real-model',
        provider: 'gemini',
        model: MODEL,
        connectivity: 'unverified',
        auth: 'none',
      });
      expect(JSON.stringify(status)).not.toContain(KEY);
      const checked = (await w.call(alice, 'POST', '/api/provider/check', own())).json();
      expect(checked).toMatchObject({ provider: 'gemini', connectivity: 'ok', lastError: null });
      expect(w.gemini.seen).toHaveLength(1);
      expect(w.gemini.seen[0]).toMatchObject({ method: 'GET', path: '/v1beta/openai/models' });
      w.gemini.keys.delete(KEY);
      const refused = (await w.call(alice, 'POST', '/api/provider/check', own())).json();
      expect(refused).toMatchObject({
        connectivity: 'failing',
        lastError: { code: 'BYOK_KEY_REJECTED' },
      });
      expect(JSON.stringify(refused)).not.toContain(KEY);
      w.gemini.keys.add(KEY);
    });
  });

  describe('where a key lives', () => {
    it('is forgotten when the person says so, when they sign out, and when they delete their account', async () => {
      const alice = await w.person();
      await w.call(alice, 'POST', '/api/byok/connect', own());
      expect(w.context.keys.has(alice.workspaceId)).toBe(true);
      const forget = await w.call(alice, 'DELETE', '/api/byok');
      expect(forget.statusCode).toBe(204);
      expect(w.context.keys.has(alice.workspaceId)).toBe(false);

      await w.call(alice, 'POST', '/api/byok/connect', own());
      expect(w.context.keys.has(alice.workspaceId)).toBe(true);
      const out = await w.h.app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { cookie: alice.cookie, ...csrf },
        payload: {},
      });
      expect(out.statusCode).toBe(204);
      expect(w.context.keys.has(alice.workspaceId)).toBe(false);

      const bob = await w.person();
      await w.call(bob, 'POST', '/api/byok/connect', own());
      expect(w.context.keys.has(bob.workspaceId)).toBe(true);
      const gone = await w.call(
        bob,
        'DELETE',
        '/api/account',
        {},
        { confirm: 'delete my account' },
      );
      expect(gone.statusCode, gone.body).toBe(204);
      expect(w.context.keys.has(bob.workspaceId)).toBe(false);
    });

    it('makes a run on a person’s own key stop when the key is gone, and never moves it to the free tier', async () => {
      const alice = await w.person();
      const id = await w.project(alice);
      w.gemini.reply = () => w.gemini.ok(w.good());
      expect((await w.propose(alice, id)).statusCode).toBe(201);
      // A run of this project is paid for as the project says, with the person's key, and labelled as theirs.
      expect(await w.fundingOfRun(id)).toMatchObject({
        funding: 'byok',
        key: true,
        model: 'a model',
        workspace: alice.workspaceId,
      });
      expect(JSON.parse((await w.fundingOfRun(id)).identity)).toEqual({
        provider: 'gemini',
        model: MODEL,
      });
      // The key goes: the run has no model, and is not given the free tier's.
      await w.call(alice, 'DELETE', '/api/byok');
      expect(await w.fundingOfRun(id)).toMatchObject({
        funding: 'byok',
        key: false,
        model: 'BYOK_KEY_NEEDED',
      });
      // And nothing of that touched the operator's deployment.
      expect(w.foundry.seen).toHaveLength(0);
    });

    it('lets a person choose again, for a project that is not working, and not for one that is', async () => {
      const alice = await w.person();
      const id = await w.project(alice);
      w.gemini.reply = () => w.gemini.ok(w.good());
      expect((await w.propose(alice, id)).statusCode).toBe(201);
      expect(await w.fundingOfRun(id)).toMatchObject({ funding: 'byok' });
      // A change with no key moves an idle project to the free tier, because the person did that.
      expect((await w.propose(alice, id, {}, 'rules')).statusCode).toBe(201);
      expect(await w.fundingOfRun(id)).toMatchObject({ funding: 'free', key: false });
      // Back on a key, and then a run is queued: a later change cannot move a queued run to another payer.
      expect((await w.propose(alice, id)).statusCode).toBe(201);
      const queued = await w.call(alice, 'POST', `/api/projects/${id}/run`, own(), {});
      expect([202, 409, 429, 503]).toContain(queued.statusCode);
      if (queued.statusCode === 202) {
        await w.call(
          alice,
          'POST',
          `/api/projects/${id}/stakeholders/propose`,
          {},
          { mode: 'rules' },
        );
        expect(await w.fundingOfRun(id)).toMatchObject({ funding: 'byok' });
      }
    });
  });
});

describe('a key that is not sent over an encrypted connection', () => {
  it('is refused, and used when the platform says it arrived over https', async () => {
    const w = await world({
      environment: {
        PUBLIC_BASE_URL: 'https://swarm.example.com',
        ALLOWED_HOSTS: 'localhost,swarm.example.com',
        TRUST_PROXY: '1',
      },
    });
    const alice = await w.person();
    const plain = await w.call(alice, 'POST', '/api/byok/connect', own());
    expect(plain.statusCode).toBe(400);
    expect(plain.json().error.code).toBe('INSECURE_TRANSPORT');
    expect(plain.body).not.toContain(KEY);
    expect(w.gemini.seen).toHaveLength(0);
    const secure = await w.call(alice, 'POST', '/api/byok/connect', {
      ...own(),
      'x-forwarded-proto': 'https',
    });
    expect(secure.statusCode, secure.body).toBe(200);
    expect(secure.json().status).toBe('valid');
    // The free tier is not held to it: there is no key to protect.
    expect((await w.call(alice, 'GET', '/api/usage')).statusCode).toBe(200);
  });
});

describe('with bringing a key switched off', () => {
  it('says so, and does not take a key silently as the free tier', async () => {
    const w = await world({ environment: { BYOK_ENABLED: 'false' } });
    const alice = await w.person();
    const connect = await w.call(alice, 'POST', '/api/byok/connect', own());
    expect(connect.json()).toMatchObject({ status: 'disabled', models: [], defaultModel: null });
    const id = await w.project(alice);
    const refused = await w.propose(alice, id);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('NOT_AVAILABLE');
    expect(w.gemini.seen).toHaveLength(0);
    expect(w.foundry.seen).toHaveLength(0);
    expect(
      (await w.h.app.inject({ method: 'GET', url: '/api/public/session' })).json().byokEnabled,
    ).toBe(false);
  });
});

describe('the free tier used up, or switched off', () => {
  it('never blocks a person who brought a key, and the free tier says why it is not available', async () => {
    const w = await world({
      environment: {
        PUBLIC_ADMIN_EMAILS: 'admin@example.com',
        FREE_GLOBAL_DAILY_TOKENS: '12000',
        FREE_TOKENS_PER_RUN: '5000',
      },
    });
    w.gemini.reply = () => w.gemini.ok(w.good());
    const alice = await w.person();
    const id = await w.project(alice);
    // Use up the whole tier for today, as other people's runs would.
    w.context.ledger.reserve({
      workspaceId: 'someone-else',
      funding: 'free',
      tokens: 12_000,
      microUsd: 0,
    });
    const onFree = await w.propose(alice, id, {});
    expect(onFree.statusCode, onFree.body).toBe(200);
    expect(onFree.json().stopped).toMatchObject({ code: 'FREE_TIER_GLOBAL_CAP' });
    expect(w.foundry.seen).toHaveLength(0);
    const onKey = await w.propose(alice, id);
    expect(onKey.statusCode, onKey.body).toBe(201);
    expect(w.gemini.chats).toBe(1);
    expect(w.context.ledger.userState(alice.workspaceId).byok.calls).toBe(1);

    // Switched off by the administrator: the same, for everyone, at once.
    const bob = await w.person();
    const other = await w.project(bob);
    const admin = await w.person('admin');
    const off = await w.h.app.inject({
      method: 'POST',
      url: '/api/admin/free-tier',
      headers: { cookie: admin.cookie, ...csrf },
      payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);
    expect((await w.propose(bob, other, {})).json().stopped).toMatchObject({
      code: 'FREE_TIER_DISABLED',
    });
    expect((await w.propose(bob, other)).statusCode).toBe(201);
    expect(w.foundry.seen).toHaveLength(0);
  });

  it('holds a person’s own key to a few calls at once, so that it cannot take the service down', async () => {
    const w = await world();
    const alice = await w.person();
    const factory = (await import('../../src/models/factory.js')).createModelFactory(
      w.h.config,
      new (await import('../../src/models/telemetry.js')).ProviderTelemetry(w.h.config.provider),
      null,
      w.h.built.publicEdition!.funding,
    );
    const { z } = await import('zod');
    const { runWithFunding } = await import('../../src/public/funding.js');
    w.gemini.reply = async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return w.gemini.ok('{"ok":true}');
    };
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        runWithFunding(
          { workspaceId: alice.workspaceId, funding: 'byok', byok: { key: KEY, model: MODEL } },
          () =>
            factory(() => undefined).json(
              z.object({ ok: z.boolean() }),
              'Say ok.',
              { question: 'q' },
              new AbortController().signal,
              500,
            ),
        ),
      ),
    );
    const done = results.filter((result) => result.status === 'fulfilled').length;
    const busy = results.filter(
      (result) =>
        result.status === 'rejected' &&
        (result.reason as { code?: string }).code === 'RUN_IN_PROGRESS',
    ).length;
    expect(done).toBeGreaterThan(0);
    expect(busy).toBeGreaterThan(0);
    expect(done + busy).toBe(8);
    expect(w.context.ledger.userState(alice.workspaceId).byok.reservedCalls).toBe(0);
    expect(w.context.ledger.globalState().calls).toBe(0);
  });
});

describe('a provider that does not know max_completion_tokens', () => {
  it('is asked again with max_tokens, once, and then asked that way', async () => {
    const w = await world();
    const alice = await w.person();
    const id = await w.project(alice);
    w.gemini.reply = () => w.gemini.ok(w.good());
    w.gemini.refuses.add('max_completion_tokens');
    expect((await w.propose(alice, id)).statusCode).toBe(201);
    const chats = w.gemini.seen.filter((entry) => entry.method === 'POST');
    expect(chats).toHaveLength(2);
    expect(chats[0]!.body).toHaveProperty('max_completion_tokens');
    expect(chats[1]!.body).not.toHaveProperty('max_completion_tokens');
    expect(chats[1]!.body).toHaveProperty('max_tokens');
    // The next call goes straight to the name Google takes.
    const bob = await w.person();
    const other = await w.project(bob);
    expect((await w.propose(bob, other)).statusCode).toBe(201);
    const later = w.gemini.seen.filter((entry) => entry.method === 'POST').slice(2);
    expect(later).toHaveLength(1);
    expect(later[0]!.body).toHaveProperty('max_tokens');
    expect(later[0]!.body).not.toHaveProperty('max_completion_tokens');
  });
});

/** Every column of every table, as text: where a key must never be. */
function everyStoredRow(w: World): string {
  return w.h.built.repository.asSystem(() =>
    w.h.built.repository.extend((database) =>
      tablesOf(database)
        .map(
          (table) =>
            `${table}: ${JSON.stringify(database.prepare(`SELECT * FROM "${table}"`).all())}`,
        )
        .join('\n'),
    ),
  );
}

const forms = (secret: string): string[] => [
  secret,
  encodeURIComponent(secret),
  Buffer.from(secret).toString('base64'),
];
const holding = (text: string, secrets: string[]): string[] =>
  secrets.filter((secret) => forms(secret).some((form) => text.includes(form)));

describe('a key is never anywhere it should not be', () => {
  it('is in no log, response, export, audit entry or stored row after a whole session', async () => {
    const w = await world({ log: true, environment: { PUBLIC_ADMIN_EMAILS: 'admin@example.com' } });
    w.gemini.reply = () => w.gemini.ok(w.good());
    const alice = await w.person('alice');
    const admin = await w.person('admin');
    const id = await w.project(alice);
    await w.call(alice, 'POST', '/api/byok/connect', own(KEY));
    expect((await w.propose(alice, id, own(KEY))).statusCode).toBe(201);
    expect((await w.propose(alice, id, own(PLAIN))).statusCode).toBeLessThan(500);
    await w.call(alice, 'GET', '/api/usage', own(KEY));
    await w.call(alice, 'GET', '/api/provider/status', own(PLAIN));
    await w.call(alice, 'POST', '/api/provider/check', own(KEY));
    // A key Google refuses, a key our own checks refuse, and a key on a request that has nothing to do with a model.
    const refused = await w.propose(alice, id, own(UNKNOWN));
    expect(refused.json().stopped.code).toBe('BYOK_KEY_REJECTED');
    await w.call(alice, 'POST', '/api/byok/connect', own('has space inside it 0123456789'));
    await w.call(alice, 'POST', '/api/projects', own(KEY), fixtureInput({ name: 'Another' }));
    // What leaves the server about a project.
    for (const url of [
      `/api/projects/${id}`,
      `/api/projects/${id}/export`,
      `/api/projects/${id}/stakeholders`,
      `/api/projects/${id}/brief/export`,
      '/api/projects',
      '/api/config',
      '/api/workspace',
      '/api/account',
    ]) {
      await w.call(alice, 'GET', url, own(KEY));
    }
    await w.call(alice, 'DELETE', '/api/byok');
    await w.h.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: alice.cookie, ...csrf },
      payload: {},
    });
    const audit = await w.call(admin, 'GET', '/api/admin/audit');
    expect(audit.statusCode).toBe(200);

    const secrets = [KEY, PLAIN, UNKNOWN];
    // The capture sees the server, so that nothing in it is nothing to see.
    expect(w.logs.length).toBeGreaterThan(10);
    expect(holding(w.logs.join(''), secrets)).toEqual([]);
    expect(w.answers.length).toBeGreaterThan(18);
    expect(holding(w.answers.join('\n'), secrets)).toEqual([]);
    const events = w.h.built.repository.asSystem(() =>
      w.h.built.repository.audit.list({ limit: 1_000 }),
    );
    expect(events.some((event) => event.action === 'public.byok.connect')).toBe(true);
    expect(holding(JSON.stringify(events), secrets)).toEqual([]);
    const rows = everyStoredRow(w);
    expect(rows.length).toBeGreaterThan(2_000);
    expect(holding(rows, secrets)).toEqual([]);
    // After signing out, nothing holds a key at all.
    expect(w.context.keys.size).toBe(0);

    // The scan can find a key: planted where it must not be, it is found; and a key written to the log is removed from it.
    w.h.built.repository.asSystem(() =>
      w.h.built.repository.audit.record({
        actor: 'test',
        action: 'planted',
        targetType: 'test',
        targetId: 'x',
        detail: { note: PLAIN },
      }),
    );
    expect(holding(everyStoredRow(w), secrets)).toEqual([PLAIN]);
    w.h.app.log.error({ detail: KEY }, `planted ${PLAIN} and ${UNKNOWN}`);
    const written = w.logs.join('');
    expect(written).toContain('planted [key removed] and [key removed]');
    expect(holding(written, secrets)).toEqual([]);
  });

  it('is removed from a response that would repeat it, whatever wrote it there', async () => {
    const w = await world();
    const alice = await w.person();
    // The server has been handed the key, so it recognises it in what it sends back: here a name a person chose.
    await w.call(alice, 'POST', '/api/byok/connect', own(PLAIN));
    const made = await w.call(
      alice,
      'POST',
      '/api/projects',
      {},
      fixtureInput({ name: `about ${PLAIN}` }),
    );
    expect(made.statusCode, made.body).toBe(201);
    expect(made.body).not.toContain(PLAIN);
    expect(made.body).toContain('[key removed]');
  });

  it('is taken out of a request before anything can read it, and an error that names it does not', async () => {
    const w = await world({ log: true });
    const alice = await w.person();
    // A key that turns up in an address (which is logged before anything can be done about it) is still known by its
    // shape; the one in the header was never in the request that the rest of the server sees.
    const wrong = await w.call(alice, 'GET', `/api/projects/not-a-project-${KEY}`, own(PLAIN));
    expect(wrong.statusCode).toBeGreaterThanOrEqual(400);
    expect(wrong.body).not.toContain(KEY);
    expect(wrong.body).not.toContain(PLAIN);
    expect(w.logs.join('')).not.toContain(KEY);
    expect(w.logs.join('')).not.toContain(PLAIN);
    expect(w.logs.join('')).toContain('/api/projects/not-a-project-[key removed]');
    expect(JSON.stringify(wrong.headers)).not.toContain(KEY);
  });
});
