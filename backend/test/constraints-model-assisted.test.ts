import type { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConstraintsView, CounterfactualsView, GateView } from '../../shared/constraints.js';
import { actorSetFixture, scenarioFixture } from '../../shared/lab-fixtures.js';
import { buildApp } from '../src/app.js';
import { readConstraints } from '../src/decision/constraints.js';
import { AppError } from '../src/errors.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import type { JsonOptions, ModelGateway } from '../src/models/client.js';
import type { ModelFactory } from '../src/models/factory.js';
import { fixtureInput, testConfig } from './fixtures.js';

// A project that was made to use a model: what the model's constraints become, where they show, and what
// the gate and the counterfactual views do with them. A project with no constraints reads "not reviewed"
// on the decision; once a model has proposed some it must not, and each of them says where it came from.

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

const REGULATOR = 'The fee rise needs the regulator’s approval before it can take effect.';
const BUDGET = 'Spending on the notification campaign is capped at $40,000 by the finance office.';
const LIMITS = [
  REGULATOR,
  BUDGET,
  'Resellers cannot absorb more than ten extra cases a week.',
  'Counsel has not yet said whether the contract allows a mid-term change.',
].join('\n');

/** The passages the project will hold: the same chunker, so the model's script can cite them by id. */
const PASSAGES = chunkDocuments([{ id: 'D1', name: 'limits.md', content: LIMITS }]);
const passageOf = (quote: string): string => {
  const found = PASSAGES.find((chunk) => chunk.text.includes(quote));
  if (!found) throw new Error(`No passage holds: ${quote}`);
  return found.id;
};

const REPLY = {
  constraints: [
    {
      category: 'regulatory',
      statement: 'The fee rise cannot take effect until the regulator approves it.',
      evidence: [{ passageId: passageOf(REGULATOR), quote: REGULATOR }],
      hardness: 'hard',
      affectedActors: [],
      affectedAlternatives: [],
      window: '',
    },
    {
      category: 'budget',
      statement: 'The notification campaign is capped at $40,000.',
      evidence: [{ passageId: passageOf(BUDGET), quote: BUDGET }],
      hardness: 'soft',
      affectedActors: [],
      affectedAlternatives: [],
      window: '',
    },
  ],
  questions: [
    {
      category: 'contractual',
      question: 'Does the contract allow a change in the middle of its term?',
      why: 'If it does not, the fee rise could only start at renewal.',
    },
  ],
};

/** A scripted model that answers as the real client does: against the schema, then the server's own check. */
function scripted(reply: unknown, calls: { count: number } = { count: 0 }): ModelFactory {
  return (onUsage): ModelGateway => ({
    json: async <T>(
      schema: z.ZodType<T>,
      _instructions: string,
      _data: unknown,
      _signal: AbortSignal,
      _maxTokens?: number,
      options?: JsonOptions<T>,
    ): Promise<T> => {
      onUsage.admit?.();
      calls.count += 1;
      if (reply instanceof Error) throw reply;
      const parsed = schema.safeParse(reply);
      if (!parsed.success) throw new AppError(502, 'MODEL_OUTPUT_INVALID', 'Not the contract.');
      options?.validate?.(parsed.data);
      onUsage({ inputTokens: 100, outputTokens: 20 });
      return parsed.data;
    },
  });
}

async function world(modelFactory: ModelFactory, mode: 'llm' | 'local' = 'llm') {
  const instance = await buildApp({
    config: testConfig({
      LOG_LEVEL: 'silent',
      RATE_LIMIT_SCALE: '50',
      AI_PROVIDER: 'openai',
      AI_MODEL: 'fixture-model',
      OPENAI_API_KEY: 'sk-test-not-a-real-key',
    }),
    modelFactory,
  });
  applications.push(instance);
  const { app, repository } = instance;
  const project = repository.create(
    fixtureInput({
      workflow: 'guided',
      settings: { mode, agentCount: 4, rounds: 3, seed: 7, network: 'community' },
      documents: [{ name: 'limits.md', content: LIMITS }],
    }),
  );
  repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
  repository.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
  const base = `/api/projects/${project.id}`;
  const read = async <T>(path: string): Promise<T> =>
    (await app.inject({ method: 'GET', url: `${base}${path}` })).json() as T;
  return {
    ...instance,
    project,
    propose: (asked: 'rules' | 'model') =>
      app.inject({
        method: 'POST',
        url: `${base}/constraints/propose`,
        payload: { mode: asked },
      }),
    gate: () => read<GateView>('/constraints/gate'),
    runViews: () =>
      app.inject({ method: 'POST', url: `${base}/constraints/counterfactuals`, payload: {} }),
    views: () => read<CounterfactualsView>('/constraints/counterfactuals'),
  };
}

describe('a model-assisted project’s constraints', () => {
  it('has the model propose them, says which came from a model, and leaves each for a person to review', async () => {
    const instance = await world(scripted(REPLY));
    const response = await instance.propose('model');
    expect(response.statusCode).toBe(201);
    const view = response.json() as ConstraintsView;
    expect(view.constraints?.mode).toBe('model');
    expect(view.constraints?.model).toBe('fixture-model');
    const held = view.constraints!.constraints;
    const fromModel = held.filter((item) => item.confidenceBasis.kind === 'model-quote');
    expect(fromModel.map((item) => item.category).sort()).toEqual(['budget', 'regulatory']);
    for (const constraint of fromModel) {
      expect(constraint.confidenceBasis.note).toContain('Proposed by a model');
      // Its quote was found in the passage it cited, word for word.
      expect(constraint.evidenceRefs[0]?.quote).toBe(
        constraint.category === 'regulatory' ? REGULATOR : BUDGET,
      );
    }
    // Nothing is confirmed, validated or applied by being proposed.
    for (const constraint of held) {
      expect(constraint.review).toBe('proposed');
      expect(constraint.validation).toBe('unvalidated');
    }
    expect(view.open.some((question) => question.category === 'contractual')).toBe(true);
  });

  it('is reached by the gate, so that the decision no longer reads "not reviewed", and shows who proposed each row', async () => {
    const instance = await world(scripted(REPLY));
    expect((await instance.propose('model')).statusCode).toBe(201);
    const { gate } = await instance.gate();
    // A hard regulatory limit nobody has settled stops a simulation until a person settles it.
    expect(gate?.status).toBe('blocked');
    const stored = instance.repository.artifacts.get(instance.project.id, 'constraints')!.data;
    const reading = readConstraints(stored, {});
    expect(reading.gate).toBe('blocked');
    expect(reading.section.gate).not.toBe('none');
    const proposed = reading.rows.filter((row) => row.source === 'Proposed by a model');
    expect(proposed.map((row) => row.category).sort()).toEqual(['budget', 'regulatory']);
    // Each row carries an epistemic label of its own: a source says it, nobody has verified it.
    expect(proposed.every((row) => row.label === 'source-claim')).toBe(true);
  });

  it('shows "not reviewed" on the decision only where nobody has read for constraints at all', () => {
    const empty = readConstraints(null, {});
    expect(empty.gate).toBe('none');
    expect(empty.section.note).toContain('open the Map, choose Constraints');
  });

  it('runs the counterfactual views under them once the actors and the proposed change are there', async () => {
    const instance = await world(scripted(REPLY));
    expect((await instance.propose('model')).statusCode).toBe(201);
    expect((await instance.views()).counterfactuals).toBeNull();
    expect((await instance.runViews()).statusCode).toBe(201);
    const after = await instance.views();
    expect(after.counterfactuals?.views.length).toBeGreaterThan(0);
    expect(after.current).toBe(true);
  });

  it('falls back to reading the text by rules, and says it did, when the model fails', async () => {
    const instance = await world(scripted(new AppError(502, 'MODEL_TIMEOUT', 'slow')));
    const response = await instance.propose('model');
    expect(response.statusCode).toBe(201);
    const set = (response.json() as ConstraintsView).constraints!;
    expect(set.mode).toBe('rules');
    expect(set.note).toContain('rules were used');
    expect(set.constraints.some((item) => item.confidenceBasis.kind === 'model-quote')).toBe(false);
  });

  it('will not ask a model for a project that was made to run without one', async () => {
    const calls = { count: 0 };
    const local = await world(scripted(REPLY, calls), 'local');
    const response = await local.propose('model');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('MODEL_NOT_AVAILABLE');
    expect(calls.count).toBe(0);
  });
});
