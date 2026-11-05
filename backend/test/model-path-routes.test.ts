import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ConstraintsView } from '../../shared/constraints.js';
import { actorSetFixture, scenarioFixture } from '../../shared/lab-fixtures.js';
import type { StakeholdersView } from '../../shared/stakeholders.js';
import type { ProviderStatus } from '../../shared/types.js';
import { buildApp } from '../src/app.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { startFakeFoundry, type FakeFoundry } from './support/fake-foundry.js';
import { NOTES, SCENARIO, passagesOf, proposal } from './support/participants-world.js';

// The participants and the constraints, asked of a deployment that behaves the way the pilot's did: its
// hidden thinking is counted against the limit of the reply, so a reply that does not fit ends with
// `finish_reason: length`. Everything here goes through the real client, over HTTP, to a fake of Foundry
// (a double: it says nothing about how the live deployment behaves). What is checked is what the server
// asks for, what it keeps, and what it says when the reply was cut off or was not the JSON it asked for.

const CANARY = 'zq-canary-7740';
const LIMITS_TEXT = [
  'The fee rise needs the regulator’s approval before it can take effect.',
  'Spending on the notification campaign is capped at $40,000 by the finance office.',
].join('\n');
const CONSTRAINTS_REPLY = {
  constraints: [
    {
      category: 'regulatory',
      statement: 'The fee rise cannot take effect until the regulator approves it.',
      evidence: [] as { passageId: string; quote: string }[],
      hardness: 'hard',
      affectedActors: [] as string[],
      affectedAlternatives: [] as string[],
      window: '',
    },
  ],
  questions: [] as unknown[],
};

/** Thinks more than any limit a task is given, whatever effort it is asked at. */
const TOO_MUCH = {
  default: 30_000,
  minimal: 30_000,
  low: 30_000,
  medium: 30_000,
  high: 30_000,
};

let fake: FakeFoundry;
beforeAll(async () => {
  fake = await startFakeFoundry({
    deployments: {
      // Finishes at the effort a task asks for; left to its default effort it would use every token.
      'think-dep': { temperature: false, thinks: { ...TOO_MUCH, low: 700, minimal: 80 } },
      // Cannot finish at the effort a task asks for, and can once it is asked to think less.
      'edge-dep': { temperature: false, thinks: { ...TOO_MUCH, minimal: 80 } },
      // Cannot finish at any effort, in any budget a task may be given.
      'stuck-dep': { temperature: false, thinks: TOO_MUCH },
      'plain-dep': {},
    },
  });
});
afterEach(() => fake.reset());
afterAll(async () => fake.close());

const applications: Array<Awaited<ReturnType<typeof buildApp>>> = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function world(deployment: string) {
  const config = testConfig(
    fake.environment({
      AI_MODEL: deployment,
      FOUNDRY_DEPLOYMENT_PROFILES: JSON.stringify({ [deployment]: { reasoning: true } }),
    }),
  );
  const instance = await buildApp({ config });
  applications.push(instance);
  const participantsText = `${NOTES} Canary: ${CANARY}.`;
  const project = instance.repository.create(
    fixtureInput({
      workflow: 'guided',
      name: 'Night bus project',
      question: `What could happen if the night bus route moves? ${CANARY}`,
      documents: [{ name: 'notes.md', content: participantsText }],
      settings: { mode: 'llm', agentCount: 4, rounds: 3 },
    }),
  );
  instance.repository.artifacts.put(project.id, 'scenario', 'default', SCENARIO);
  const base = `/api/projects/${project.id}`;
  const view = async () =>
    (
      await instance.app.inject({ method: 'GET', url: `${base}/stakeholders` })
    ).json() as StakeholdersView;
  return {
    ...instance,
    project,
    view,
    reply: () => proposal(passagesOf(participantsText)),
    propose: (payload: unknown) =>
      instance.app.inject({
        method: 'POST',
        url: `${base}/stakeholders/propose`,
        payload: payload as object,
      }),
    status: async () =>
      (
        await instance.app.inject({ method: 'GET', url: '/api/provider/status' })
      ).json() as ProviderStatus,
  };
}

async function constraintsWorld(deployment: string) {
  const config = testConfig(
    fake.environment({
      AI_MODEL: deployment,
      FOUNDRY_DEPLOYMENT_PROFILES: JSON.stringify({ [deployment]: { reasoning: true } }),
    }),
  );
  const instance = await buildApp({ config });
  applications.push(instance);
  const project = instance.repository.create(
    fixtureInput({
      workflow: 'guided',
      question: `What could happen if the fee rises? ${CANARY}`,
      documents: [{ name: 'limits.md', content: LIMITS_TEXT }],
      settings: { mode: 'llm', agentCount: 4, rounds: 3, seed: 7, network: 'community' },
    }),
  );
  instance.repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
  instance.repository.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
  const passage = chunkDocuments([{ id: 'D1', name: 'limits.md', content: LIMITS_TEXT }]).find(
    (chunk) => chunk.text.includes('regulator'),
  )!;
  const quote = 'The fee rise needs the regulator’s approval before it can take effect.';
  const reply = {
    ...CONSTRAINTS_REPLY,
    constraints: [
      { ...CONSTRAINTS_REPLY.constraints[0]!, evidence: [{ passageId: passage.id, quote }] },
    ],
  };
  return {
    ...instance,
    reply,
    propose: () =>
      instance.app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/constraints/propose`,
        payload: { mode: 'model' },
      }),
  };
}

const sent = () =>
  fake.requests.map((request) => ({
    effort: request.body?.reasoning_effort,
    limit: request.body?.max_completion_tokens as number,
    format: request.body?.response_format?.type,
  }));

describe('the participants, asked of a deployment that thinks before it writes', () => {
  it('are asked at the effort a task asks for, with room to finish, and are kept when the reply is whole', async () => {
    // Left to its default effort this deployment thinks 30,000 tokens: more than any limit allows.
    const w = await world('think-dep');
    fake.respond(() => ({ kind: 'reply', value: w.reply() }));
    const response = await w.propose({ mode: 'model' });
    expect(response.statusCode, response.body).toBe(201);
    const set = (response.json() as StakeholdersView).stakeholders!;
    expect(set.proposal).toMatchObject({ source: 'model', failure: null });
    expect(set.discovery).toMatchObject({ mode: 'model' });
    expect(sent()).toEqual([{ effort: 'low', limit: expect.any(Number), format: 'json_schema' }]);
    // Room for the answer, and for what it thinks before it writes.
    expect(sent()[0]!.limit).toBeGreaterThan(5_000);
    expect(await w.status()).toMatchObject({
      counters: { calls: 1, truncated: 0, schemaInvalid: 0 },
    });
    expect(fake.problems).toEqual([]);
  });

  it('are asked again once, with more room and less thinking, when the first reply was cut off, and the answer is kept', async () => {
    const w = await world('edge-dep');
    fake.respond(() => ({ kind: 'reply', value: w.reply() }));
    const response = await w.propose({ mode: 'model' });
    expect(response.statusCode, response.body).toBe(201);
    expect((response.json() as StakeholdersView).stakeholders?.proposal).toMatchObject({
      source: 'model',
      failure: null,
    });
    const [first, again] = sent();
    expect(sent()).toHaveLength(2);
    expect(first).toMatchObject({ effort: 'low' });
    expect(again).toMatchObject({ effort: 'minimal' });
    expect(again!.limit).toBeGreaterThan(first!.limit);
    expect(await w.status()).toMatchObject({
      counters: { calls: 1, truncated: 1, schemaInvalid: 0 },
    });
  });

  it('stop, say what failed, and keep nothing, when no budget would do: the reply that ended at its limit is never read', async () => {
    const w = await world('stuck-dep');
    fake.respond(() => ({
      kind: 'truncated',
      partial: '{"version":1,"participants":[{"id":"city-council","name":"City counc',
      usage: { prompt: 900, completion: 16_000, reasoning: 15_900 },
    }));
    const response = await w.propose({ mode: 'model' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      stopped: {
        code: 'MODEL_TRUNCATED',
        detail: expect.stringContaining('cut short'),
        retryable: true,
      },
    });
    // Asked again once, and not for ever; nothing was kept, and no half-read list stands in its place.
    expect(sent()).toHaveLength(2);
    expect((await w.view()).stakeholders).toBeNull();
    const status = await w.status();
    expect(status.counters).toMatchObject({ truncated: 2, schemaInvalid: 0 });
    expect(status.lastError?.code).toBe('MODEL_TRUNCATED');
    // What is said of it is counts and words from a closed list: the limit, the thinking, the effort.
    const { detail } = (response.json() as { stopped: { detail: string } }).stopped;
    expect(detail).toContain('asked again once');
    expect(detail).toContain('15,900 of them hidden reasoning');
    expect(detail).toContain('reasoning effort minimal');
    expect(JSON.stringify([response.json(), status])).not.toContain(CANARY);
    expect(JSON.stringify([response.json(), status])).not.toContain('city-council');
  });

  it('stop on a deployment that thinks past every limit, with no text at all, in the same way', async () => {
    const w = await world('stuck-dep');
    fake.respond(() => ({ kind: 'reply', value: w.reply() }));
    const response = await w.propose({ mode: 'model' });
    expect(response.json()).toMatchObject({
      stopped: { code: 'MODEL_TRUNCATED', retryable: true },
    });
    expect(sent().map((one) => one.effort)).toEqual(['low', 'minimal']);
    expect((await w.view()).stakeholders).toBeNull();
  });

  it('stop when a whole reply is not the JSON that was asked for, and say that it was whole, not cut off', async () => {
    const w = await world('plain-dep');
    fake.respond(() => ({
      kind: 'text',
      text: JSON.stringify({ version: 1, participants: `not a list ${CANARY}` }),
    }));
    const response = await w.propose({ mode: 'model' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      stopped: { code: 'MODEL_OUTPUT_INVALID', retryable: true },
    });
    // The reply was whole: it is not counted as cut off, and it was asked for again no more than twice.
    expect(sent().length).toBeGreaterThanOrEqual(2);
    expect(sent().length).toBeLessThanOrEqual(3);
    const status = await w.status();
    expect(status.counters.schemaInvalid).toBeGreaterThan(0);
    expect(status.counters.truncated).toBe(0);
    expect(JSON.stringify([response.json(), status])).not.toContain(CANARY);
    expect((await w.view()).stakeholders).toBeNull();
  });

  it('continue with rules only when the person says so, and the list says that it is the rules’, not a model’s', async () => {
    const w = await world('stuck-dep');
    fake.respond(() => ({ kind: 'reply', value: w.reply() }));
    expect((await w.propose({ mode: 'model' })).json()).toHaveProperty('stopped');
    const asked = fake.requests.length;
    const response = await w.propose({ mode: 'rules', fallbackFrom: 'MODEL_TRUNCATED' });
    expect(response.statusCode, response.body).toBe(201);
    const set = (response.json() as StakeholdersView).stakeholders!;
    // Rules ask nobody.
    expect(fake.requests).toHaveLength(asked);
    expect(set.discovery.mode).toBe('rules');
    expect(set.proposal).toMatchObject({ source: 'rules', failure: { code: 'MODEL_TRUNCATED' } });
    expect(set.discovery.note).toMatch(/^Participants from the rules fallback\./u);
    expect(set.discovery.note).toContain('no model proposed these');
  });
});

describe('the constraints, asked of a deployment that thinks before it writes', () => {
  it('are proposed by the model and said to be, with nothing recorded as having failed', async () => {
    const w = await constraintsWorld('think-dep');
    fake.respond(() => ({ kind: 'reply', value: w.reply }));
    const response = await w.propose();
    expect(response.statusCode, response.body).toBe(201);
    const set = (response.json() as ConstraintsView).constraints!;
    expect(set.mode).toBe('model');
    expect(set.modelFailure).toBeNull();
    expect(set.constraints.some((item) => item.confidenceBasis.kind === 'model-quote')).toBe(true);
    expect(sent()).toEqual([{ effort: 'low', limit: expect.any(Number), format: 'json_schema' }]);
  });

  it('are read by rules when the model is cut off, and the set says that the model failed and why, not that it was never asked', async () => {
    const w = await constraintsWorld('stuck-dep');
    fake.respond(() => ({ kind: 'reply', value: w.reply }));
    const response = await w.propose();
    expect(response.statusCode, response.body).toBe(201);
    const set = (response.json() as ConstraintsView).constraints!;
    expect(set.mode).toBe('rules');
    expect(set.modelFailure).toMatchObject({ code: 'MODEL_TRUNCATED' });
    expect(set.modelFailure?.detail).toContain('asked again once');
    expect(set.note).toContain('Rules read the constraints instead, so no model proposed them');
    expect(set.constraints.every((item) => item.confidenceBasis.kind !== 'model-quote')).toBe(true);
    expect(sent().map((one) => one.effort)).toEqual(['low', 'minimal']);
  });

  it('are read by rules when a whole reply is not the JSON that was asked for, with that as the reason', async () => {
    const w = await constraintsWorld('plain-dep');
    fake.respond(() => ({ kind: 'text', text: JSON.stringify({ constraints: 'none' }) }));
    const set = ((await w.propose()).json() as ConstraintsView).constraints!;
    expect(set.mode).toBe('rules');
    expect(set.modelFailure).toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });
});
