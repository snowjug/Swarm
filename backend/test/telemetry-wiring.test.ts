import { metrics } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Analysis } from '../../shared/analysis.js';
import type { ConstraintsView, GateView } from '../../shared/constraints.js';
import { actorSetFixture, scenarioFixture } from '../../shared/lab-fixtures.js';
import type { StakeholdersView } from '../../shared/stakeholders.js';
import { AnalysisService, type AnalysisServiceOptions } from '../src/analysis/service.js';
import { buildApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import { Repository } from '../src/storage/repository.js';
import {
  GATE_STATUSES,
  PARTICIPANT_ISSUE_CODES,
  PROPOSAL_ORIGINS,
  WORK_OUTCOMES,
  productSignals,
} from '../src/telemetry/product-signals.js';
import { fixtureInput, testConfig } from './fixtures.js';
import {
  NOTES,
  SCENARIO,
  ScriptedGateway,
  passagesOf,
  proposal,
} from './support/participants-world.js';
import { stubSimulator } from './support/stub-simulator.js';
import { telemetryHarness, type Point } from './support/telemetry-harness.js';

// What the product tells its operators about participants, constraints and comparisons is recorded by
// the code that does the work, not by a caller that remembers to. These tests drive the real routes and
// the real service, and read both what a recorder was told and what the exporters hold: a recorder
// fires once for each thing that was done, with an enumeration or a number and nothing the work was about.
const telemetry = telemetryHarness();

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
const repositories: Repository[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
  for (const repository of repositories.splice(0)) repository.close();
});

const CANARY = 'zq-canary-5521';
const MODEL = {
  AI_PROVIDER: 'openai',
  AI_MODEL: 'fixture-model',
  OPENAI_API_KEY: 'test-placeholder-only',
};
const NOTES_OF_THE_PROJECT = `${NOTES} Canary: ${CANARY}.`;
const LIMITS = [
  'The fee rise needs the regulator’s approval before it can take effect.',
  'Spending on the notification campaign is capped at $40,000 by the finance office.',
  'Resellers cannot absorb more than ten extra cases a week.',
  'Counsel has not yet said whether the contract allows a mid-term change.',
  'The subscriber records must stay inside the region under the privacy law.',
].join('\n');
const SMALL = { runsPerVariant: 5, sensitivity: false };

async function build(options: {
  documents: { name: string; content: string }[];
  gateway?: ScriptedGateway;
}) {
  const instance = await buildApp({
    config: testConfig({ RATE_LIMIT_SCALE: '50', ...(options.gateway ? MODEL : {}) }),
    ...(options.gateway ? { modelFactory: () => options.gateway! } : {}),
  });
  applications.push(instance);
  const project = instance.repository.create(
    fixtureInput({
      workflow: 'guided',
      name: `Night bus ${CANARY}`,
      question: `What could happen if the night bus route moves? ${CANARY}`,
      documents: options.documents,
      settings: options.gateway
        ? { mode: 'llm', agentCount: 4, rounds: 3 }
        : { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
    }),
  );
  const call = (method: 'GET' | 'POST', path: string, payload?: object) =>
    instance.app.inject({
      method,
      url: `/api/projects/${project.id}${path}`,
      ...(payload === undefined ? {} : { payload }),
    });
  return { ...instance, project, call };
}
type World = Awaited<ReturnType<typeof build>>;

/** The notes of a transit office, which the participants of a proposal are read from. */
async function participantsWorld(gateway?: ScriptedGateway): Promise<World> {
  const world = await build({
    gateway,
    documents: [{ name: 'notes.md', content: NOTES_OF_THE_PROJECT }],
  });
  world.repository.artifacts.put(world.project.id, 'scenario', 'default', SCENARIO);
  return world;
}

/** Limits in the sources, a cast and a scenario: what the constraints are read from. */
async function constraintsWorld(gateway?: ScriptedGateway): Promise<World> {
  const world = await build({ gateway, documents: [{ name: 'limits.md', content: LIMITS }] });
  world.repository.artifacts.put(world.project.id, 'actors', 'default', actorSetFixture());
  world.repository.artifacts.put(world.project.id, 'scenario', 'default', scenarioFixture());
  return world;
}

/** How much a metric grew between two readings, for the attributes given. */
const grew = (
  before: Point[],
  after: Point[],
  metric: string,
  attributes: Record<string, unknown> = {},
): number =>
  telemetry.total(after, metric, attributes) - telemetry.total(before, metric, attributes);

/** The metrics of this file: every attribute of every point is a value of an enumeration, never "other". */
const ENUMERATIONS: Record<string, readonly string[]> = {
  'swarm.proposal.origin': PROPOSAL_ORIGINS,
  'swarm.issue.code': PARTICIPANT_ISSUE_CODES,
  'swarm.gate.status': GATE_STATUSES,
  'swarm.sim.outcome': WORK_OUTCOMES,
};
async function expectOnlyEnumerations(): Promise<void> {
  const points = (await telemetry.measurements()).filter((point) =>
    /^swarm\.(?:actors|constraints|sim)\./u.test(point.name),
  );
  expect(points.length).toBeGreaterThan(0);
  for (const point of points) {
    for (const [key, value] of Object.entries(point.attributes)) {
      const allowed = ENUMERATIONS[key];
      expect(allowed, `${point.name} carries ${key}`).toBeDefined();
      expect(allowed, `${point.name} ${key}=${String(value)}`).toContain(value);
    }
  }
}

/** Nothing the work was about is in anything that would leave the process. */
async function expectNothingAboutTheWork(...words: string[]): Promise<void> {
  const exported = await telemetry.everythingExported();
  for (const word of [CANARY, 'Night bus', 'night bus', ...words]) {
    expect(exported, word).not.toContain(word);
  }
}

describe('proposing participants', () => {
  const propose = (world: World, payload: object = {}) =>
    world.call('POST', '/stakeholders/propose', payload);

  /** What the review the person was shown says, worked out here from the answer and not from the code. */
  function reviewed(view: StakeholdersView) {
    const live = view.stakeholders!.stakeholders.filter((item) => item.status !== 'removed');
    const blocked = new Set(
      view
        .review!.issues.filter((issue) => issue.severity === 'blocking' && issue.participantId)
        .map((issue) => issue.participantId),
    );
    const issues: Record<string, number> = {};
    for (const issue of view.review!.issues) issues[issue.code] = (issues[issue.code] ?? 0) + 1;
    return { proposed: live.length, valid: live.length - blocked.size, issues };
  }

  it('records one proposal made by rules: the participants, how many passed the review, and the rules it broke', async () => {
    const world = await participantsWorld();
    const spy = vi.spyOn(productSignals, 'actorProposal');
    const before = await telemetry.measurements();
    const response = await propose(world);
    expect(response.statusCode, response.body).toBe(201);
    const { proposed, valid, issues } = reviewed(response.json() as StakeholdersView);
    expect(proposed).toBeGreaterThanOrEqual(2);
    // The rules’ list has something for the review to say, so that the codes below are not an empty check.
    expect(Object.keys(issues).length).toBeGreaterThan(0);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ origin: 'rules', proposed, valid, issues });
    const after = await telemetry.measurements();
    const origin = { 'swarm.proposal.origin': 'rules' };
    expect(grew(before, after, 'swarm.actors.proposals', origin)).toBe(1);
    expect(grew(before, after, 'swarm.actors.proposed', origin)).toBe(proposed);
    expect(grew(before, after, 'swarm.actors.valid', origin)).toBe(valid);
    for (const [code, times] of Object.entries(issues)) {
      expect(grew(before, after, 'swarm.actors.issues', { 'swarm.issue.code': code }), code).toBe(
        times,
      );
    }
    expect(grew(before, after, 'swarm.actors.issues', { 'swarm.issue.code': 'other' })).toBe(0);
    await expectOnlyEnumerations();
    await expectNothingAboutTheWork(
      'transit office',
      'Residents of the old corridor',
      world.project.id,
    );
  });

  it('records a proposal that a model made, and one that rules made after the model could not be used', async () => {
    const spy = vi.spyOn(productSignals, 'actorProposal');
    const used = await participantsWorld(
      new ScriptedGateway([proposal(passagesOf(NOTES_OF_THE_PROJECT))]),
    );
    expect((await propose(used, { mode: 'model' })).statusCode).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ origin: 'model' });

    spy.mockClear();
    // A reply that names a participant "Staff" is refused by the server's checks, and rules answer.
    const bad = JSON.parse(JSON.stringify(proposal(passagesOf(NOTES_OF_THE_PROJECT)))) as {
      participants: { name: string }[];
    };
    bad.participants[0]!.name = 'Staff';
    const unusable = await participantsWorld(new ScriptedGateway([bad]));
    const response = await propose(unusable, { mode: 'model' });
    expect(response.statusCode, response.body).toBe(201);
    expect((response.json() as StakeholdersView).stakeholders!.discovery.mode).toBe('rules');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ origin: 'fallback' });

    const points = await telemetry.measurements();
    for (const origin of ['model', 'fallback']) {
      expect(
        telemetry.total(points, 'swarm.actors.proposals', { 'swarm.proposal.origin': origin }),
        origin,
      ).toBeGreaterThanOrEqual(1);
    }
    await expectOnlyEnumerations();
  });

  it('records once for each proposal that was kept, and for none that was refused', async () => {
    const world = await participantsWorld();
    const spy = vi.spyOn(productSignals, 'actorProposal');
    expect((await propose(world)).statusCode).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);

    const { revision } = (await world.call('GET', '/stakeholders')).json() as StakeholdersView;
    expect(
      (await world.call('POST', '/stakeholders/accept', { expectedRevision: revision })).statusCode,
    ).toBe(200);
    // Replacing a list that has been reviewed needs a confirmation: refused, so nothing was proposed.
    const refused = await propose(world);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('STAKEHOLDERS_REVIEWED');
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await propose(world, { confirm: true })).statusCode).toBe(201);
    expect(spy).toHaveBeenCalledTimes(2);

    // No model on a project that runs without one: refused.
    expect((await propose(world, { mode: 'model' })).statusCode).toBe(409);
    expect(spy).toHaveBeenCalledTimes(2);

    // A model that refuses: answered as a refusal, nothing stored, nothing recorded.
    const refusing = await participantsWorld(
      new ScriptedGateway([new AppError(409, 'MODEL_REFUSED', 'The model declined.')]),
    );
    const declined = await propose(refusing, { mode: 'model' });
    expect(declined.statusCode).toBe(409);
    expect(declined.json().error.code).toBe('MODEL_REFUSED');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('proposing constraints', () => {
  const propose = (world: World, payload: object = {}) =>
    world.call('POST', '/constraints/propose', payload);

  it('records one proposal made by rules, with the constraints it added', async () => {
    const world = await constraintsWorld();
    const spy = vi.spyOn(productSignals, 'constraintProposal');
    const before = await telemetry.measurements();
    const response = await propose(world);
    expect(response.statusCode, response.body).toBe(201);
    const added = (response.json() as ConstraintsView).constraints!.constraints.length;
    expect(added).toBeGreaterThan(0);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ origin: 'rules', count: added });
    const after = await telemetry.measurements();
    const origin = { 'swarm.proposal.origin': 'rules' };
    expect(grew(before, after, 'swarm.constraints.proposals', origin)).toBe(1);
    expect(grew(before, after, 'swarm.constraints.proposed', origin)).toBe(added);
    await expectOnlyEnumerations();
    await expectNothingAboutTheWork('regulator', 'finance office', 'privacy law', world.project.id);
  });

  it('records the origin: the model when its reply is used, the fallback when it is not', async () => {
    const spy = vi.spyOn(productSignals, 'constraintProposal');
    const used = await constraintsWorld(
      new ScriptedGateway([
        {
          constraints: [
            {
              category: 'budget',
              statement:
                'The notification campaign cannot spend more than the finance office allows.',
              evidence: [],
              hardness: 'soft',
              affectedActors: [],
              affectedAlternatives: [],
              window: '',
            },
          ],
          questions: [],
        },
      ]),
    );
    const response = await propose(used, { mode: 'model' });
    expect(response.statusCode, response.body).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ origin: 'model' });
    expect(spy.mock.calls[0]?.[0].count).toBeGreaterThan(0);

    spy.mockClear();
    const unusable = await constraintsWorld(new ScriptedGateway([{ constraints: 'not a list' }]));
    const fallback = await propose(unusable, { mode: 'model' });
    expect(fallback.statusCode, fallback.body).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ origin: 'fallback' });
  });

  it('records nothing for a proposal that was asked of a model that is not there', async () => {
    const world = await constraintsWorld();
    const spy = vi.spyOn(productSignals, 'constraintProposal');
    const response = await propose(world, { mode: 'model' });
    expect(response.statusCode).toBe(409);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the constraint gate', () => {
  it('is recorded for the page that asks for the gate and for the page that offers the next comparison, and not for a read of the constraints', async () => {
    const world = await constraintsWorld();
    expect((await world.call('POST', '/constraints/propose', {})).statusCode).toBe(201);
    const spy = vi.spyOn(productSignals, 'constraintGate');
    const before = await telemetry.measurements();

    // Reading the constraints works the gate out too, and tells nobody.
    expect((await world.call('GET', '/constraints')).statusCode).toBe(200);
    expect(spy).not.toHaveBeenCalled();

    const gate = await world.call('GET', '/constraints/gate');
    expect(gate.statusCode, gate.body).toBe(200);
    const status = (gate.json() as GateView).gate!.status;
    expect(GATE_STATUSES).toContain(status);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(status);

    const readiness = await world.call('GET', '/analysis');
    expect(readiness.statusCode, readiness.body).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(status);

    const after = await telemetry.measurements();
    expect(grew(before, after, 'swarm.constraints.gate', { 'swarm.gate.status': status })).toBe(2);
    for (const other of GATE_STATUSES.filter((item) => item !== status)) {
      expect(grew(before, after, 'swarm.constraints.gate', { 'swarm.gate.status': other })).toBe(0);
    }
    await expectOnlyEnumerations();
  });

  it('says nothing for a project that has no constraints', async () => {
    const world = await constraintsWorld();
    const spy = vi.spyOn(productSignals, 'constraintGate');
    expect((await world.call('GET', '/constraints/gate')).statusCode).toBe(200);
    expect((await world.call('GET', '/analysis')).statusCode).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});

/** Holds a comparison still after some runs, so that a test can act while it runs. */
function gateAfter(after: number) {
  let runs = 0;
  let release: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  return {
    yieldNow: async () => {
      runs += 1;
      if (runs === after) {
        held = true;
        await opened;
      }
    },
    open: () => release(),
    reached: () => held,
  };
}

async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('The condition was not reached in time.');
}

function comparisons(options: AnalysisServiceOptions = {}) {
  const repository = new Repository(':memory:');
  repositories.push(repository);
  const project = repository.create(fixtureInput({ workflow: 'guided', name: `Ferry ${CANARY}` }));
  repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
  const service = new AnalysisService(repository, {
    simulator: stubSimulator,
    progressEvery: { runs: 1, ms: 0 },
    ...options,
  });
  const finished = (id: string): Promise<Analysis> =>
    until(
      () => service.get(project.id, id),
      (value) => !['running', 'queued'].includes(value.status),
    );
  return { project, service, finished };
}

describe('comparing scenarios', () => {
  it('records how long a comparison took, once, when it completed', async () => {
    const { service, project, finished } = comparisons();
    const spy = vi.spyOn(productSignals, 'simulationDuration');
    const before = await telemetry.measurements();
    const started = service.start(project.id, SMALL, 'someone');
    expect((await finished(started.id)).status).toBe('completed');

    expect(spy).toHaveBeenCalledTimes(1);
    const { durationMs, outcome } = spy.mock.calls[0]![0];
    expect(outcome).toBe('completed');
    expect(Number.isInteger(durationMs) && durationMs >= 0).toBe(true);
    const after = await telemetry.measurements();
    expect(grew(before, after, 'swarm.sim.duration', { 'swarm.sim.outcome': 'completed' })).toBe(1);
    await expectOnlyEnumerations();
    await expectNothingAboutTheWork('Ferry');
  });

  it('records a comparison that a person cancelled, and one that failed, each once and by how it ended', async () => {
    const gate = gateAfter(3);
    const held = comparisons({ yieldNow: gate.yieldNow });
    const spy = vi.spyOn(productSignals, 'simulationDuration');
    const cancellations = vi.spyOn(productSignals, 'cancellation');
    const before = await telemetry.measurements();
    const started = held.service.start(
      held.project.id,
      { runsPerVariant: 10, sensitivity: false },
      'someone',
    );
    await until(
      () => gate.reached(),
      (reached) => reached,
    );
    held.service.cancel(held.project.id, started.id, 'someone');
    // The person's stop is counted when they ask for it, and the length of the comparison not until it has ended.
    expect(cancellations).toHaveBeenCalledTimes(1);
    expect(cancellations).toHaveBeenCalledWith('simulation');
    expect(spy).not.toHaveBeenCalled();
    gate.open();
    expect((await held.finished(started.id)).status).toBe('cancelled');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].outcome).toBe('cancelled');
    // A request to stop what has already ended is refused, and is not a stop.
    expect(() => held.service.cancel(held.project.id, started.id, 'someone')).toThrow();
    expect(cancellations).toHaveBeenCalledTimes(1);
    const after = await telemetry.measurements();
    expect(grew(before, after, 'swarm.cancellations', { 'swarm.cancel.scope': 'simulation' })).toBe(
      1,
    );

    spy.mockClear();
    const failing = comparisons({
      simulator: () => {
        throw new Error(`secret detail ${CANARY} from deep inside`);
      },
    });
    const broken = failing.service.start(failing.project.id, SMALL, 'someone');
    expect((await failing.finished(broken.id)).status).toBe('failed');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].outcome).toBe('failed');
    await expectOnlyEnumerations();
    await expectNothingAboutTheWork('secret detail');
  });

  it('records nothing for a comparison that the server stopped: it is marked interrupted, and did not end', async () => {
    const gate = gateAfter(2);
    const { service, project } = comparisons({ yieldNow: gate.yieldNow });
    const spy = vi.spyOn(productSignals, 'simulationDuration');
    const started = service.start(project.id, SMALL, 'someone');
    await until(
      () => gate.reached(),
      (reached) => reached,
    );
    const stopping = service.stop();
    gate.open();
    await stopping;
    expect(service.get(project.id, started.id).status).toBe('interrupted');
    expect(spy).not.toHaveBeenCalled();
  });

  it('measures with a clock of its own: the injected clock, which a test may set anywhere, is not what the duration is', async () => {
    let reads = 0;
    // An hour passes at every read of this clock.
    const { service, project, finished } = comparisons({
      now: () => 1_700_000_000_000 + ++reads * 3_600_000,
    });
    const spy = vi.spyOn(productSignals, 'simulationDuration');
    await finished(service.start(project.id, SMALL, 'someone').id);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].durationMs).toBeLessThan(60_000);
  });
});

describe('with a meter that cannot make the product instruments', () => {
  it('serves every request and finishes every comparison as it would, and records nothing', async () => {
    // Only the instruments of these signals fail; the application's own request metrics work.
    const failing = {
      getMeter: (name: string, version?: string) => {
        const meter = telemetry.meterProvider.getMeter(name, version);
        return new Proxy(meter, {
          get(target, property) {
            const value = Reflect.get(target, property) as unknown;
            if (typeof value !== 'function') return value;
            return (...input: unknown[]) => {
              if (/^swarm\.(?:actors|constraints|sim)\./u.test(String(input[0]))) {
                throw new Error('the exporter is down');
              }
              return (value as (...args: unknown[]) => unknown).apply(target, input);
            };
          },
        });
      },
    };
    const participants = await participantsWorld();
    const constraints = await constraintsWorld();
    const made = comparisons();
    const before = await telemetry.measurements();
    metrics.disable();
    metrics.setGlobalMeterProvider(failing as never);
    try {
      expect((await participants.call('POST', '/stakeholders/propose', {})).statusCode).toBe(201);
      expect((await constraints.call('POST', '/constraints/propose', {})).statusCode).toBe(201);
      expect((await constraints.call('GET', '/constraints/gate')).statusCode).toBe(200);
      expect((await constraints.call('GET', '/analysis')).statusCode).toBe(200);
      const started = made.service.start(made.project.id, SMALL, 'someone');
      expect((await made.finished(started.id)).status).toBe('completed');
    } finally {
      metrics.disable();
      metrics.setGlobalMeterProvider(telemetry.meterProvider);
    }
    const after = await telemetry.measurements();
    for (const metric of [
      'swarm.actors.proposals',
      'swarm.constraints.proposals',
      'swarm.constraints.gate',
      'swarm.sim.duration',
    ]) {
      expect(grew(before, after, metric), metric).toBe(0);
    }
  });
});
