import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectDetail } from '../../shared/types.js';
import { buildApp } from '../src/app.js';
import { storedProjectSchema } from '../src/storage/codec.js';
import { fixtureInput, testConfig } from './fixtures.js';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
type Harness = Awaited<ReturnType<typeof buildApp>>;
async function setup(): Promise<Harness> {
  const instance = await buildApp({ config: testConfig() });
  applications.push(instance);
  return instance;
}
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

const ROUNDS = 6;

async function prepared({ repository, jobs }: Harness, seed = 42): Promise<string> {
  const created = repository.create(
    fixtureInput({
      workflow: 'guided',
      settings: { mode: 'local', agentCount: 6, rounds: ROUNDS, seed, network: 'community' },
    }),
  );
  jobs.enqueueStep(created.id, 'knowledge');
  await jobs.idle();
  jobs.enqueueStep(created.id, 'environment');
  await jobs.idle();
  return created.id;
}

async function runToEnd({ jobs }: Harness, id: string, resume = false): Promise<void> {
  jobs.enqueueStep(id, 'simulation', resume);
  await jobs.idle();
}

async function pauseAfter({ repository, jobs }: Harness, id: string, rounds: number) {
  jobs.enqueueStep(id, 'simulation');
  for (let attempt = 0; attempt < 20_000; attempt += 1) {
    if (repository.get(id).rounds.length >= rounds) {
      jobs.pause(id);
      await jobs.idle();
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('The simulation never reached the requested round.');
}

function history(project: ProjectDetail) {
  const state = project.console!;
  return {
    rounds: project.rounds,
    agents: project.agents,
    memories: state.memories,
    platforms: state.platforms.map(
      ({ platform, rounds, agents, currentRound, elapsedMinutes }) => ({
        platform,
        rounds,
        agents,
        currentRound,
        elapsedMinutes,
      }),
    ),
  };
}

async function reference(harness: Harness): Promise<ProjectDetail> {
  const id = await prepared(harness);
  await runToEnd(harness, id);
  return harness.repository.get(id);
}

describe('pause, resume and checkpoint recovery', () => {
  it('pauses on a saved round boundary as a non-error state and resumes to the exact uninterrupted result', async () => {
    const harness = await setup();
    const expected = await reference(harness);
    const id = await prepared(harness);
    await pauseAfter(harness, id, 2);

    const paused = harness.repository.get(id);
    expect(paused.console?.steps.simulation).toBe('paused');
    expect(paused.status).toBe('ready');
    expect(paused.error).toBeNull();
    expect(paused.rounds).toHaveLength(2);
    expect(paused.console?.platforms.every((run) => run.status === 'paused')).toBe(true);
    expect(paused.console?.platforms.every((run) => run.rounds.length === 2)).toBe(true);
    expect(paused.events.at(-1)?.message).toContain('paused after round 2');

    await runToEnd(harness, id, true);
    const resumed = harness.repository.get(id);
    expect(resumed.console?.steps.simulation).toBe('ready');
    expect(resumed.rounds).toHaveLength(ROUNDS);
    expect(history(resumed)).toEqual(history(expected));
  });

  it('discards a pause requested before any round was saved and allows a clean restart', async () => {
    const harness = await setup();
    const id = await prepared(harness);
    harness.jobs.enqueueStep(id, 'simulation');
    harness.jobs.pause(id);
    await harness.jobs.idle();
    const stopped = harness.repository.get(id);
    expect(stopped.console?.steps.simulation).toBe('cancelled');
    expect(stopped.status).toBe('cancelled');
    expect(stopped.error).toContain('Paused before any round was saved');
    expect(() => harness.jobs.enqueueStep(id, 'simulation', true)).toThrow('no saved');
    await runToEnd(harness, id);
    expect(harness.repository.get(id).rounds).toHaveLength(ROUNDS);
  });

  it('refuses to resume without a consistent checkpoint, and restart from pause discards it', async () => {
    const harness = await setup();
    const id = await prepared(harness);
    expect(() => harness.jobs.enqueueStep(id, 'simulation', true)).toThrow('no saved');
    await pauseAfter(harness, id, 3);
    const paused = harness.repository.get(id);
    const tampered = {
      ...paused.console!,
      platforms: paused.console!.platforms.map((run, index) =>
        index === 0 ? { ...run, rounds: run.rounds.slice(0, 2) } : run,
      ),
    };
    harness.repository.update(id, { console: tampered });
    expect(() => harness.jobs.enqueueStep(id, 'simulation', true)).toThrow('no saved');
    harness.repository.update(id, { console: paused.console! });
    await runToEnd(harness, id);
    expect(harness.repository.get(id).rounds).toHaveLength(ROUNDS);
    expect(() => harness.jobs.pause(id)).toThrow('queued or running simulation');
  });

  it('recovers from a crash mid-simulation by resuming from the last saved round', async () => {
    const harness = await setup();
    const expected = await reference(harness);
    const id = await prepared(harness);
    await pauseAfter(harness, id, 3);
    const paused = harness.repository.get(id);
    harness.repository.update(id, {
      status: 'running',
      console: { ...paused.console!, steps: { ...paused.console!.steps, simulation: 'running' } },
    });
    harness.repository.recoverInterrupted();
    const recovered = harness.repository.get(id);
    expect(recovered.console?.steps.simulation).toBe('failed');
    expect(recovered.error).toContain('resume from round 4');
    await runToEnd(harness, id, true);
    expect(history(harness.repository.get(id))).toEqual(history(expected));
  });
});

describe('scheduling an intervention at a checkpoint', () => {
  it('applies a future intervention on resume and records it in that round only', async () => {
    const harness = await setup();
    const baseline = await reference(harness);
    const id = await prepared(harness);
    await pauseAfter(harness, id, 2);
    const intervention = {
      round: 4,
      label: 'Assumed announcement of extended opening hours',
      stance: 1,
      strength: 1,
    };
    const response = await harness.app.inject({
      method: 'PUT',
      url: `/api/projects/${id}/intervention`,
      payload: intervention,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<ProjectDetail>().settings.intervention).toEqual(intervention);

    await runToEnd(harness, id, true);
    const result = harness.repository.get(id);
    expect(result.rounds.map((round) => round.intervention?.round ?? null)).toEqual([
      null,
      null,
      null,
      4,
      null,
      null,
    ]);
    expect(result.rounds[2]).toEqual(baseline.rounds[2]);
    expect(result.rounds[3]?.meanOpinion).not.toBe(baseline.rounds[3]?.meanOpinion);
  });

  it('rejects saved or out-of-range rounds, removal, and edits to a finished run', async () => {
    const harness = await setup();
    const id = await prepared(harness);
    const put = (payload: unknown) =>
      harness.app.inject({
        method: 'PUT',
        url: `/api/projects/${id}/intervention`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(payload),
      });
    const valid = { round: 5, label: 'Assumed change in outreach', stance: 0.5, strength: 0.5 };
    expect((await put(valid)).json().error.code).toBe('INTERVENTION_LOCKED');
    await pauseAfter(harness, id, 3);
    expect((await put({ ...valid, round: 3 })).json().error.code).toBe('INVALID_INTERVENTION');
    expect((await put({ ...valid, round: 7 })).statusCode).toBe(400);
    expect((await put({ ...valid, stance: 3 })).statusCode).toBe(400);
    expect((await put(valid)).statusCode).toBe(200);
    const removed = await put(null);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json<ProjectDetail>().settings.intervention).toBeNull();
    await runToEnd(harness, id, true);
    expect((await put(valid)).json().error.code).toBe('INTERVENTION_LOCKED');
  });
});

describe('branching from a checkpoint', () => {
  it('a no-change branch reproduces the parent exactly and compares as identical', async () => {
    const harness = await setup();
    const parent = await reference(harness);
    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/projects/${parent.id}/branches`,
      payload: { fromRound: 2 },
    });
    expect(created.statusCode, created.body).toBe(201);
    const branch = created.json<ProjectDetail>();
    expect(branch.id).not.toBe(parent.id);
    expect(branch.parentId).toBe(parent.id);
    expect(branch.status).toBe('ready');
    expect(branch.console?.steps).toMatchObject({
      knowledge: 'ready',
      environment: 'ready',
      simulation: 'paused',
      report: 'pending',
    });
    expect(branch.console?.branch).toMatchObject({
      parentId: parent.id,
      rootId: parent.id,
      fromRound: 2,
      changes: [],
    });
    expect(branch.rounds).toEqual(parent.rounds.slice(0, 2));
    expect(branch.console?.memories.every((memory) => memory.round <= 2)).toBe(true);
    expect(branch.report).toBeNull();
    expect(branch.documents).toEqual(parent.documents);
    expect(harness.repository.chunks(branch.id)).toEqual(harness.repository.chunks(parent.id));

    await runToEnd(harness, branch.id, true);
    const finished = harness.repository.get(branch.id);
    expect(history(finished)).toEqual(history(parent));

    harness.jobs.enqueueStep(branch.id, 'report');
    await harness.jobs.idle();
    const exported = await harness.app.inject({
      method: 'GET',
      url: `/api/projects/${branch.id}/export`,
    });
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.body).toContain('## Scenario lineage');
    expect(exported.body).toContain(parent.id);
    expect(exported.body).toContain('No assumption changes were declared');
    const lineageJson = await harness.app.inject({
      method: 'GET',
      url: `/api/projects/${branch.id}/export?format=json`,
    });
    expect(lineageJson.json().project.console.branch.fromRound).toBe(2);

    const comparison = await harness.app.inject({
      method: 'GET',
      url: `/api/projects/${parent.id}/compare?with=${branch.id}`,
    });
    expect(comparison.statusCode, comparison.body).toBe(200);
    expect(comparison.json()).toMatchObject({
      lineage: 'base-is-parent',
      identicalThroughRound: ROUNDS,
      declaredChanges: [],
    });
    expect(harness.repository.get(parent.id)).toEqual(parent);
  });

  it('records declared changes and diverges only after the branch point', async () => {
    const harness = await setup();
    const parent = await reference(harness);
    const intervention = {
      round: 4,
      label: 'Assumed community meeting before round four',
      stance: -1,
      strength: 0.8,
    };
    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/projects/${parent.id}/branches`,
      payload: { name: 'Meeting scenario', fromRound: 2, intervention },
    });
    expect(created.statusCode, created.body).toBe(201);
    const branch = created.json<ProjectDetail>();
    expect(branch.name).toBe('Meeting scenario');
    expect(branch.console?.branch?.changes).toEqual([
      { kind: 'intervention', from: null, to: intervention },
    ]);
    await runToEnd(harness, branch.id, true);
    const comparison = (
      await harness.app.inject({
        method: 'GET',
        url: `/api/projects/${branch.id}/compare?with=${parent.id}`,
      })
    ).json();
    expect(comparison.lineage).toBe('other-is-parent');
    expect(comparison.identicalThroughRound).toBe(3);
    expect(comparison.declaredChanges).toHaveLength(1);
    expect(comparison.rounds[3].delta.meanOpinion).not.toBe(0);
    expect(comparison.rounds[0].delta.meanOpinion).toBe(0);
    expect(comparison.notes.join(' ')).toContain('not forecasts');
  });

  it('applies proxy edits to future rounds only and leaves the parent untouched', async () => {
    const harness = await setup();
    const parent = await reference(harness);
    const target = parent.agents[0]!;
    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/projects/${parent.id}/branches`,
      payload: {
        fromRound: 3,
        agentEdits: [{ id: target.id, opinion: -1, influence: 2, openness: 0.9 }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const branch = created.json<ProjectDetail>();
    const fields = branch.console!.branch!.changes.map((change) =>
      change.kind === 'agent' ? change.field : change.kind,
    );
    expect(fields.sort()).toEqual(['influence', 'openness', 'opinion']);
    expect(branch.agents.find((agent) => agent.id === target.id)?.opinion).toBe(-1);
    expect(branch.console?.environment?.edited).toBe(true);
    await runToEnd(harness, branch.id, true);
    const finished = harness.repository.get(branch.id);
    expect(finished.rounds.slice(0, 3)).toEqual(parent.rounds.slice(0, 3));
    expect(finished.rounds[3]?.meanOpinion).not.toBe(parent.rounds[3]?.meanOpinion);
    expect(harness.repository.get(parent.id)).toEqual(parent);
  });

  it('branching from round zero starts a fresh run with edited assumptions', async () => {
    const harness = await setup();
    const parent = await reference(harness);
    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/projects/${parent.id}/branches`,
      payload: {
        fromRound: 0,
        agentEdits: [{ id: parent.agents[1]!.id, opinion: 0.9 }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const branch = created.json<ProjectDetail>();
    expect(branch.console?.steps.simulation).toBe('pending');
    expect(branch.rounds).toEqual([]);
    expect(branch.agents.find((agent) => agent.id === parent.agents[1]!.id)).toMatchObject({
      initialOpinion: 0.9,
      opinion: 0.9,
    });
    await runToEnd(harness, branch.id);
    const finished = harness.repository.get(branch.id);
    expect(finished.rounds).toHaveLength(ROUNDS);
    expect(finished.rounds[0]?.meanOpinion).not.toBe(parent.rounds[0]?.meanOpinion);
  });

  it('branches a paused run, keeps lineage roots across generations, and survives parent deletion', async () => {
    const harness = await setup();
    const id = await prepared(harness);
    await pauseAfter(harness, id, 3);
    const first = (
      await harness.app.inject({
        method: 'POST',
        url: `/api/projects/${id}/branches`,
        payload: { fromRound: 2 },
      })
    ).json<ProjectDetail>();
    const second = (
      await harness.app.inject({
        method: 'POST',
        url: `/api/projects/${first.id}/branches`,
        payload: { fromRound: 1 },
      })
    ).json<ProjectDetail>();
    expect(second.console?.branch).toMatchObject({ parentId: first.id, rootId: id, fromRound: 1 });
    const listed = (await harness.app.inject({ method: 'GET', url: '/api/projects' })).json<{
      projects: { id: string; parentId: string | null }[];
    }>();
    expect(listed.projects.find((item) => item.id === second.id)?.parentId).toBe(first.id);
    expect(listed.projects.find((item) => item.id === id)?.parentId).toBeNull();
    harness.repository.delete(id);
    expect(harness.repository.get(first.id).rounds).toHaveLength(2);
    const orphan = await harness.app.inject({
      method: 'GET',
      url: `/api/projects/${first.id}/compare?with=${id}`,
    });
    expect(orphan.statusCode).toBe(404);
  });

  it('rejects impossible or conflicting branch requests with actionable errors', async () => {
    const harness = await setup();
    const parent = await reference(harness);
    const post = (payload: object, id = parent.id) =>
      harness.app.inject({ method: 'POST', url: `/api/projects/${id}/branches`, payload });
    expect((await post({ fromRound: ROUNDS })).json().error.code).toBe('INVALID_BRANCH_ROUND');
    expect((await post({ fromRound: -1 })).statusCode).toBe(400);
    expect((await post({ fromRound: 1, agentEdits: [{ id: 'agent-1' }] })).statusCode).toBe(400);
    expect(
      (
        await post({
          fromRound: 1,
          agentEdits: [
            { id: 'agent-1', opinion: 0.1 },
            { id: 'agent-1', opinion: 0.2 },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await post({ fromRound: 1, agentEdits: [{ id: 'agent-99', opinion: 0.1 }] })).json().error
        .code,
    ).toBe('INVALID_POPULATION');
    expect(
      (
        await post({
          fromRound: 3,
          intervention: { round: 3, label: 'Too early to change the past', stance: 0, strength: 0 },
        })
      ).json().error.code,
    ).toBe('INVALID_INTERVENTION');

    const immature = await prepared(harness);
    expect((await post({ fromRound: 2 }, immature)).json().error.code).toBe('BRANCH_NOT_READY');

    const withEvent = await prepared(harness);
    await pauseAfter(harness, withEvent, 2);
    const scheduled = {
      round: 3,
      label: 'Assumed outreach event during round three',
      stance: 1,
      strength: 0.5,
    };
    await harness.app.inject({
      method: 'PUT',
      url: `/api/projects/${withEvent}/intervention`,
      payload: scheduled,
    });
    await runToEnd(harness, withEvent, true);
    const conflict = await post(
      { fromRound: 4, intervention: { ...scheduled, round: 5 } },
      withEvent,
    );
    expect(conflict.json().error.code).toBe('INTERVENTION_CONFLICT');
    const inherited = await post({ fromRound: 4 }, withEvent);
    expect(inherited.statusCode).toBe(201);
    expect(inherited.json<ProjectDetail>().settings.intervention).toEqual(scheduled);
  });
});

describe('comparison and persistence contracts', () => {
  it('compares unrelated runs honestly and rejects meaningless requests', async () => {
    const harness = await setup();
    const left = await reference(harness);
    const rightId = await prepared(harness, 7);
    const get = (id: string, other: string) =>
      harness.app.inject({ method: 'GET', url: `/api/projects/${id}/compare?with=${other}` });
    expect((await get(left.id, left.id)).json().error.code).toBe('COMPARE_SAME_RUN');
    expect((await get(left.id, rightId)).json().error.code).toBe('COMPARE_NO_ROUNDS');
    await runToEnd(harness, rightId);
    const result = (await get(left.id, rightId)).json();
    expect(result.lineage).toBe('unrelated');
    expect(result.notes.join(' ')).toContain('do not share a branch lineage');
    expect(result.identicalThroughRound).toBe(0);
    expect(result.rounds).toHaveLength(ROUNDS);
    expect((await get(left.id, 'not-a-uuid')).statusCode).toBe(400);
  });

  it('reads previously stored scenarios that predate branch metadata and the paused state', async () => {
    const harness = await setup();
    const legacy = await reference(harness);
    const without = (source: object, ...keys: string[]) =>
      Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
    const stored = without(legacy, 'events', 'parentId');
    const decoded = storedProjectSchema.parse({
      ...stored,
      console: without(legacy.console!, 'branch'),
    });
    expect(decoded.console?.branch).toBeNull();
    expect(decoded.console?.steps.simulation).toBe('ready');
  });

  it('only accepts resume on the simulation stage and validates the request body', async () => {
    const harness = await setup();
    const id = await prepared(harness);
    const post = (url: string, payload?: object) =>
      harness.app.inject({ method: 'POST', url: `/api/projects/${id}${url}`, payload });
    expect((await post('/steps/report', { resume: true })).json().error.code).toBe(
      'RESUME_UNSUPPORTED',
    );
    expect((await post('/steps/simulation', { resume: 'yes' })).statusCode).toBe(400);
    expect((await post('/steps/simulation', { resume: true, extra: 1 })).statusCode).toBe(400);
    expect((await post('/steps/simulation', { resume: true })).json().error.code).toBe(
      'NO_CHECKPOINT',
    );
    const started = await post('/steps/simulation');
    expect(started.statusCode).toBe(202);
    await harness.jobs.idle();
    expect((await post('/pause')).json().error.code).toBe('RUN_NOT_PAUSABLE');
  });
});
