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
  simulationOutputs,
} from './model-fixtures.js';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

describe('model-assisted checkpoint and resume (scripted provider, not live inference)', () => {
  it('resumes from the saved round without recomputing it, counts discarded work, and sends a scheduled intervention', async () => {
    const rounds = 4;
    const provider = new ScriptedProvider([
      ontology,
      graph,
      personas,
      prepared,
      ...simulationOutputs(rounds + 1),
    ]);
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

    // Pause while round 3 is in flight: both platform calls complete, but the round is never saved.
    provider.onCall = (index) => {
      if (index === 4 + 4) jobs.pause(id);
    };
    jobs.enqueueStep(id, 'simulation');
    await jobs.idle();
    const paused = repository.get(id);
    expect(paused.console?.steps.simulation).toBe('paused');
    expect(paused.rounds).toHaveLength(2);
    expect(paused.execution).toMatchObject({
      provider: 'openai',
      model: 'fixture-model',
      modelCalls: 10,
      inputTokens: 1_000,
      outputTokens: 200,
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

    provider.onCall = null;
    const callsBeforeResume = provider.calls.length;
    jobs.enqueueStep(id, 'simulation', true);
    await jobs.idle();
    const finished = repository.get(id);
    expect(finished.console?.steps.simulation).toBe('ready');
    expect(finished.rounds).toHaveLength(rounds);
    expect(provider.calls.length - callsBeforeResume).toBe(4);
    expect(finished.execution?.modelCalls).toBe(14);
    expect(finished.execution?.inputTokens).toBe(1_400);

    const sent = provider.calls
      .slice(callsBeforeResume)
      .map((call) => call.data as { round: number; intervention: { label: string } | null });
    expect(sent.map((payload) => payload.round)).toEqual([3, 3, 4, 4]);
    expect(sent.map((payload) => payload.intervention?.label)).toEqual([
      undefined,
      undefined,
      intervention.label,
      intervention.label,
    ]);
    expect(finished.rounds[3]?.intervention).toEqual(intervention);
  });

  it('refuses to resume into a different provider or model than the one that produced the saved rounds', async () => {
    const provider = new ScriptedProvider([
      ontology,
      graph,
      personas,
      prepared,
      ...simulationOutputs(3),
    ]);
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
    provider.onCall = (index) => {
      if (index === 4 + 2) first.jobs.pause(id);
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
