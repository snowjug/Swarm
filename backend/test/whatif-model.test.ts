import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { Orchestrator } from '../src/orchestration/runner.js';
import { fixtureInput, testConfig } from './fixtures.js';
import {
  graph,
  modelEnvironment,
  ontology,
  personas,
  prepared,
  ScriptedProvider,
} from './model-fixtures.js';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

// One decision per proxy per platform per round.
const PER_ROUND = 4 * 2;

describe('model-assisted checkpoint and resume (scripted provider, not live inference)', () => {
  it('resumes from the saved round without recomputing it, counts discarded work, and sends a scheduled intervention', async () => {
    const rounds = 4;
    const provider = new ScriptedProvider([ontology, graph, personas, prepared]);
    const harness = await buildApp({
      config: testConfig(modelEnvironment),
      modelFactory: provider.factory,
    });
    applications.push(harness);
    const { repository, jobs, app } = harness;
    const { id } = repository.create(
      fixtureInput({
        workflow: 'guided',
        settings: { mode: 'llm', agentCount: 4, rounds, seed: 7, network: 'community' },
      }),
    );
    for (const step of ['knowledge', 'environment'] as const) {
      jobs.enqueueStep(id, step);
      await jobs.idle();
    }
    expect(provider.calls).toHaveLength(4);

    // Pause as round 3 starts: rounds 1-2 are saved, the in-flight round is discarded.
    provider.onActorCall = (index) => {
      if (index === 2 * PER_ROUND) jobs.pause(id);
    };
    jobs.enqueueStep(id, 'simulation');
    await jobs.idle();
    const paused = repository.get(id);
    expect(paused.console?.steps.simulation).toBe('paused');
    expect(paused.rounds).toHaveLength(2);
    // Calls queued behind the pause never start, so less than a full round was wasted.
    const startedInRoundThree = provider.actorCalls.length - 2 * PER_ROUND;
    expect(startedInRoundThree).toBeGreaterThanOrEqual(1);
    expect(startedInRoundThree).toBeLessThan(PER_ROUND);
    expect(paused.execution).toMatchObject({
      provider: 'openai',
      model: 'fixture-model',
      modelCalls: provider.calls.length,
      inputTokens: provider.calls.length * 100,
      outputTokens: provider.calls.length * 20,
    });

    const intervention = {
      round: 4,
      label: 'Assumed public announcement before round four',
      stance: 0.9,
      strength: 0.7,
    };
    const scheduled = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}/intervention`,
      payload: intervention,
    });
    expect(scheduled.statusCode, scheduled.body).toBe(200);

    provider.onActorCall = null;
    const callsBeforeResume = provider.calls.length;
    const actorCallsBeforeResume = provider.actorCalls.length;
    jobs.enqueueStep(id, 'simulation', true);
    await jobs.idle();
    const finished = repository.get(id);
    expect(finished.console?.steps.simulation).toBe('ready');
    expect(finished.rounds).toHaveLength(rounds);
    // Only rounds 3 and 4 are simulated; rounds 1-2 are not recomputed.
    expect(provider.calls.length - callsBeforeResume).toBe(2 * PER_ROUND);
    expect(finished.execution?.modelCalls).toBe(provider.calls.length);

    const sent = provider.actorCalls.slice(actorCallsBeforeResume).map((call) => call.data);
    const roundThree = sent.filter((context) => context.round === 3);
    const roundFour = sent.filter((context) => context.round === 4);
    expect(roundThree).toHaveLength(PER_ROUND);
    expect(roundFour).toHaveLength(PER_ROUND);
    expect(roundThree.every((context) => context.event === null)).toBe(true);
    expect(roundFour.every((context) => context.event?.label === intervention.label)).toBe(true);
    expect(finished.rounds[3]?.intervention).toEqual(intervention);
  });

  it('refuses to resume into a different provider or model than the one that produced the saved rounds', async () => {
    const provider = new ScriptedProvider([ontology, graph, personas, prepared]);
    const first = await buildApp({
      config: testConfig(modelEnvironment),
      modelFactory: provider.factory,
    });
    applications.push(first);
    const { id } = first.repository.create(
      fixtureInput({
        workflow: 'guided',
        settings: { mode: 'llm', agentCount: 4, rounds: 3, seed: 7, network: 'community' },
      }),
    );
    for (const step of ['knowledge', 'environment'] as const) {
      first.jobs.enqueueStep(id, step);
      await first.jobs.idle();
    }
    provider.onActorCall = (index) => {
      if (index === PER_ROUND) first.jobs.pause(id);
    };
    first.jobs.enqueueStep(id, 'simulation');
    await first.jobs.idle();
    expect(first.repository.get(id).console?.steps.simulation).toBe('paused');

    const other = new Orchestrator(
      first.repository,
      testConfig({ ...modelEnvironment, AI_MODEL: 'a-different-model' }),
      () => undefined,
      provider.factory,
    );
    expect(() => other.enqueueStep(id, 'simulation', true)).toThrow('Restore the provider/model');
  });
});
