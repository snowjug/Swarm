import { afterEach, describe, expect, it } from 'vitest';
import { analysisSchema, type Analysis } from '../../shared/analysis.js';
import type { AnalysisList } from '../../shared/analysis-plan.js';
import {
  counterfactualSetSchema,
  constraintSetSchema,
  type ConstraintsView,
  type CounterfactualsView,
  type GateView,
} from '../../shared/constraints.js';
import { actorSetFixture, scenarioFixture } from '../../shared/lab-fixtures.js';
import type { AnalysisServiceOptions } from '../src/analysis/service.js';
import { buildApp } from '../src/app.js';
import { ROUTE_POLICY } from '../src/auth/policy.js';
import { TokenVerifier } from '../src/auth/tokens.js';
import { changedInputs, inputRevisionsNow } from '../src/lab/lineage.js';
import { fixtureInput, testConfig } from './fixtures.js';
import {
  TENANT_A,
  TENANT_B,
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

/** What a source says about limits, in the words a person would paste into one. */
const LIMITS = [
  'The fee rise needs the regulator’s approval before it can take effect.',
  'Spending on the notification campaign is capped at $40,000 by the finance office.',
  'Resellers cannot absorb more than ten extra cases a week.',
  'Counsel has not yet said whether the contract allows a mid-term change.',
  'The subscriber records must stay inside the region under the privacy law.',
].join('\n');

const SMALL = { runsPerVariant: 8, rounds: 12, sensitivity: false };

/** The page's gate is worked out at each read, so the moment it was worked out is the one thing that differs between two. */
const withoutMoment = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (key, item: unknown) => (key === 'evaluatedAt' ? null : item)));

async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The condition was not reached in time.');
}

async function world(analysis: AnalysisServiceOptions = {}, rateScale = '50', withCast = true) {
  const instance = await buildApp({
    config: testConfig({ LOG_LEVEL: 'silent', RATE_LIMIT_SCALE: rateScale }),
    analysis: { progressEvery: { runs: 1, ms: 0 }, ...analysis },
  });
  applications.push(instance);
  const { app, repository } = instance;
  const project = repository.create(
    fixtureInput({ workflow: 'guided', documents: [{ name: 'limits.md', content: LIMITS }] }),
  );
  if (withCast) {
    repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
    repository.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
  }
  const base = `/api/projects/${project.id}`;
  const get = (path: string) => app.inject({ method: 'GET', url: `${base}${path}` });
  const post = (path: string, payload: object = {}) =>
    app.inject({ method: 'POST', url: `${base}${path}`, payload });
  const put = (path: string, payload: object) =>
    app.inject({ method: 'PUT', url: `${base}${path}`, payload });
  const view = async () => (await get('/constraints')).json() as ConstraintsView;
  const propose = (payload: object = {}) => post('/constraints/propose', payload);
  /** One thing a person does, against the revision they are looking at. */
  const act = async (action: Record<string, unknown>) => {
    const { revision } = await view();
    return post('/constraints/review', { expectedRevision: revision, ...action });
  };
  const idOf = async (match: (statement: string) => boolean) => {
    const found = (await view()).constraints?.constraints.find((item) => match(item.statement));
    if (!found) throw new Error('No such constraint.');
    return found.id;
  };
  /** Settles the constraints as a careful person would: the high-stakes ones are confirmed, the rest accepted. */
  const settle = async () => {
    for (const word of ['regulator', 'privacy law']) {
      const id = await idOf((statement) => statement.includes(word));
      expect((await act({ action: 'confirm', id })).statusCode).toBe(200);
    }
    const waiting = (await view()).constraints!.constraints.filter(
      (item) => item.review === 'proposed',
    );
    if (waiting.length > 0) {
      expect(
        (await act({ action: 'accept', ids: waiting.map((item) => item.id) })).statusCode,
      ).toBe(200);
    }
    expect((await act({ action: 'confirm-set' })).statusCode).toBe(200);
  };
  const start = (payload: object = SMALL) => post('/analysis', payload);
  const readAnalysis = async (id: string) =>
    (await get(`/analysis/${id}`)).json().analysis as Analysis;
  const finished = (id: string) =>
    until(
      () => readAnalysis(id),
      (value) => !['running', 'queued'].includes(value.status),
    );
  const compare = async (payload: object = SMALL) => {
    const started = await start(payload);
    expect(started.statusCode, started.body).toBe(202);
    const done = await finished((started.json().analysis as Analysis).id);
    expect(done.status, JSON.stringify(done.error)).toBe('completed');
    return { started: started.json().analysis as Analysis, done };
  };
  const readiness = async () => (await get('/analysis')).json().readiness;
  return {
    ...instance,
    project,
    base,
    get,
    post,
    put,
    view,
    propose,
    act,
    idOf,
    settle,
    start,
    finished,
    compare,
    readiness,
  };
}

describe('proposing and reviewing constraints', () => {
  it('has nothing to show for a project that has not looked, and says what it has to work with', async () => {
    const { view } = await world();
    const empty = await view();
    expect(empty).toMatchObject({
      constraints: null,
      revision: null,
      gate: null,
      open: [],
      stale: { scenario: false, actors: false },
      may: { edit: true, run: true },
    });
    expect(empty.alternatives.map((option) => option.id)).toEqual([
      'proposed-change',
      'smaller-rise',
    ]);
    expect(empty.actors.map((option) => option.id)).toContain('regulator');
    expect(empty.model.available).toBe(false);
    expect(empty.model.reason).toBeTruthy();
  });

  it('reads the sources by rules, keeps every proposal as proposed, and quotes the sources exactly', async () => {
    const { propose, view, repository, project } = await world();
    const response = await propose();
    expect(response.statusCode, response.body).toBe(201);
    const proposed = response.json() as ConstraintsView;
    expect(proposed.revision).toBe(1);
    expect(() => constraintSetSchema.parse(proposed.constraints)).not.toThrow();
    const { constraints, mode, model } = proposed.constraints!;
    expect([mode, model]).toEqual(['rules', null]);
    expect(constraints.length).toBeGreaterThan(3);
    for (const constraint of constraints) {
      expect(constraint.review).toBe('proposed');
      expect(constraint.validation).toBe('unvalidated');
      expect(
        constraint.enforcement === 'enforced' || constraint.enforcement === 'interpretive',
      ).toBe(true);
      for (const ref of constraint.evidenceRefs) expect(LIMITS).toContain(ref.quote);
    }
    // What a source says is labelled as the source's, and what only follows from who is involved is a suggestion.
    expect(constraints.filter((item) => item.source === 'extracted').length).toBeGreaterThan(2);
    // Counsel has not yet said is an open question, not a constraint.
    expect(proposed.open.map((question) => question.category)).toContain('contractual');
    expect(constraints.some((item) => item.statement.startsWith('Counsel has not yet said'))).toBe(
      false,
    );
    expect(withoutMoment(await view())).toEqual(withoutMoment(proposed));
    // The audit entry holds counts and a status, never a statement or a quote.
    const entry = repository.audit
      .list({ projectId: project.id, limit: 20 })
      .find((item) => item.action === 'constraints.proposed');
    expect(entry?.detail).toMatchObject({
      asked: 'rules',
      mode: 'rules',
      fellBack: false,
      live: constraints.length,
      waiting: constraints.length,
      status: 'blocked',
    });
    expect(JSON.stringify(entry)).not.toMatch(/regulator|40,000|reseller|privacy|statement/iu);
    expect(repository.audit.verify().ok).toBe(true);
  });

  it('reads again and adds only what is new, and never undoes what a person decided', async () => {
    const { propose, act, view, idOf } = await world();
    await propose();
    const id = await idOf((statement) => statement.includes('capped'));
    expect((await act({ action: 'confirm', id })).statusCode).toBe(200);
    expect(
      (await act({ action: 'remove', id: await idOf((s) => s.includes('absorb')) })).statusCode,
    ).toBe(200);
    const before = await view();
    const again = await propose();
    expect(again.statusCode).toBe(201);
    const after = again.json() as ConstraintsView;
    expect(after.constraints!.constraints).toEqual(before.constraints!.constraints);
    expect(after.constraints!.constraints.find((item) => item.id === id)).toMatchObject({
      validation: 'confirmed',
      review: 'accepted',
    });
    expect(after.constraints!.note).toContain('0 constraints and 0 questions added');
  });

  it('will not ask a model the project does not have, and says why', async () => {
    const { propose, view } = await world();
    const response = await propose({ mode: 'model' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('MODEL_NOT_AVAILABLE');
    expect((await view()).constraints).toBeNull();
  });

  it('refuses a change made to a version of the constraints that is no longer the latest, and changes nothing', async () => {
    const { propose, post, put, view, idOf } = await world();
    await propose();
    const id = await idOf((statement) => statement.includes('capped'));
    const before = await view();
    const stale = await post('/constraints/review', {
      action: 'confirm',
      id,
      expectedRevision: (before.revision ?? 0) + 5,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('ARTIFACT_CONFLICT');
    const everything = before.constraints!.constraints.map((item) => ({
      id: item.id,
      category: item.category,
      statement: item.statement,
    }));
    const staleAll = await put('/constraints', { constraints: everything, expectedRevision: 0 });
    expect(staleAll.statusCode).toBe(409);
    expect(staleAll.json().error.code).toBe('ARTIFACT_CONFLICT');
    expect(withoutMoment(await view())).toEqual(withoutMoment(before));
  });

  it('wants every constraint in a put, so that what became of one can be told, and refuses what it does not understand', async () => {
    const { propose, put, view } = await world();
    await propose();
    const { constraints, revision } = await view();
    const all = constraints!.constraints.map((item) => ({
      id: item.id,
      category: item.category,
      statement: item.statement,
      hardness: item.hardness,
    }));
    const left = await put('/constraints', {
      constraints: all.slice(1),
      expectedRevision: revision,
    });
    expect(left.statusCode).toBe(400);
    expect(left.json().error.code).toBe('CONSTRAINTS_OMITTED');
    const extra = await put('/constraints', {
      constraints: [...all, { category: 'time', statement: 'The board meets in March.' }],
      expectedRevision: revision,
    });
    expect(extra.statusCode, extra.body).toBe(200);
    const next = extra.json() as ConstraintsView;
    expect(next.revision).toBe((revision ?? 0) + 1);
    expect(next.constraints!.constraints.at(-1)).toMatchObject({
      source: 'user',
      review: 'added',
      validation: 'confirmed',
    });
    // A request that tries to say where a constraint came from, or that it is enforced, is not understood.
    for (const forged of [
      { source: 'extracted' },
      { enforcement: 'enforced' },
      { evidenceRefs: [] },
      { review: 'accepted' },
    ]) {
      const refused = await put('/constraints', {
        constraints: [...all, { category: 'time', statement: 'Another limit.', ...forged }],
        expectedRevision: next.revision,
      });
      expect(refused.statusCode, JSON.stringify(forged)).toBe(400);
    }
    expect((await view()).revision).toBe(next.revision);
  });

  it('answers a question with a constraint, leaves one unknown, or writes the assumption down', async () => {
    const { propose, act, view } = await world();
    await propose();
    const asked = (await view()).constraints!.clarifications;
    expect(asked.length).toBeGreaterThanOrEqual(2);
    const [first, second] = asked;
    const answered = await act({
      action: 'answer',
      clarificationId: first!.id,
      constraint: {
        category: first!.category,
        statement: 'The vendor contract needs ninety days of notice.',
        hardness: 'hard',
      },
    });
    expect(answered.statusCode, answered.body).toBe(200);
    const assumed = await act({ action: 'use-assumption', clarificationId: second!.id });
    expect(assumed.statusCode, assumed.body).toBe(200);
    const next = (assumed.json() as ConstraintsView).constraints!;
    expect(next.clarifications.map((question) => question.status)).toEqual(['answered', 'assumed']);
    expect(next.constraints.filter((item) => item.review === 'added')).toHaveLength(2);
    expect(next.constraints.find((item) => item.validation === 'assumed')?.source).toBe('user');
  });

  it('asks at most ten times a minute for a reading, and says when to come back', async () => {
    const { propose } = await world({}, '1');
    for (let at = 0; at < 10; at += 1) expect((await propose()).statusCode).toBe(201);
    const refused = await propose();
    expect(refused.statusCode).toBe(429);
  });

  it('validates what it is sent', async () => {
    const { propose, post, put } = await world();
    expect((await propose({ mode: 'sometimes' })).statusCode).toBe(400);
    expect((await propose({ extra: true })).statusCode).toBe(400);
    expect(
      (await post('/constraints/review', { action: 'dance', expectedRevision: 0 })).statusCode,
    ).toBe(400);
    expect(
      (await put('/constraints', { constraints: 'many', expectedRevision: 0 })).statusCode,
    ).toBe(400);
    const missing = await post('/constraints/review', {
      action: 'confirm',
      id: 'c-none',
      expectedRevision: 0,
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error.code).toBe('CONSTRAINTS_NOT_FOUND');
  });
});

describe('the gate, and starting a comparison', () => {
  it('leaves a project that has no constraints exactly as it was: no gate, no record, nothing refused', async () => {
    const { readiness, compare, get, project, repository } = await world();
    expect((await readiness()).constraints).toBeUndefined();
    const { started, done } = await compare();
    expect(started.progress.totalRuns).toBe(24);
    expect(done.constraints).toBeUndefined();
    expect(done.inputRevisions).not.toHaveProperty('constraints');
    expect(done.fidelity.caveats.join(' ')).not.toMatch(/constraint/iu);
    expect(analysisSchema.parse(done).constraints).toBeUndefined();
    const listed = ((await get('/analysis')).json() as AnalysisList).analyses[0]!;
    expect(listed.constraints).toBeUndefined();
    expect(
      repository.audit
        .list({ projectId: project.id, limit: 50 })
        .find((entry) => entry.action === 'analysis.started')?.detail,
    ).not.toHaveProperty('constraints');
  });

  it('stops a comparison while a hard legal or regulatory limit is unsettled, in words that say what to do, and saves nothing', async () => {
    const { propose, readiness, start, get } = await world();
    await propose();
    const state = await readiness();
    expect(state.constraints).toMatchObject({ status: 'blocked' });
    expect(state.constraints.message).toMatch(
      /confirm it, set it aside, mark it unknown or choose to assume it/u,
    );
    expect(state.warnings.join(' ')).toMatch(/hard regulatory constraint is not settled/u);
    const refused = await start();
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('CONSTRAINTS_BLOCKED');
    expect(refused.json().error.message).toMatch(/Open the Map, go to Constraints and settle it/u);
    expect(((await get('/analysis')).json() as AnalysisList).analyses).toEqual([]);
  });

  it('asks that the constraints be reviewed once nothing blocks, and counts what still waits', async () => {
    const { propose, act, idOf, readiness, start, get } = await world();
    await propose();
    for (const word of ['regulator', 'privacy law']) {
      await act({ action: 'confirm', id: await idOf((statement) => statement.includes(word)) });
    }
    const state = await readiness();
    expect(state.constraints).toMatchObject({ status: 'unreviewed' });
    const refused = await start();
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('CONSTRAINTS_UNREVIEWED');
    expect(refused.json().error.message).toMatch(/still waiting for your decision/u);
    expect(((await get('/analysis')).json() as AnalysisList).analyses).toEqual([]);
  });

  it('runs a provisional comparison once a person has been through them, and says so on the comparison itself', async () => {
    const { propose, settle, readiness, compare, view, get, repository, project } = await world();
    await propose();
    await settle();
    const state = await readiness();
    expect(state.constraints).toMatchObject({ status: 'provisional' });
    expect(state.warnings).toContain(state.constraints.message);
    const { done } = await compare();
    const { constraints } = done;
    expect(constraints).toMatchObject({ status: 'provisional', revision: (await view()).revision });
    expect(constraints?.label).toMatch(/^Provisional/u);
    expect(constraints?.reasons.length).toBeGreaterThan(0);
    // The caveats carry the label, so that whatever is made from the comparison carries it.
    expect(done.fidelity.caveats).toContain(constraints?.label);
    expect(done.inputRevisions?.constraints).toBe((await view()).revision);
    const listed = ((await get('/analysis')).json() as AnalysisList).analyses[0]!;
    expect(listed.constraints).toMatchObject({ status: 'provisional' });
    const entry = repository.audit
      .list({ projectId: project.id, limit: 50 })
      .find((item) => item.action === 'analysis.started');
    expect(entry?.detail).toMatchObject({ provisional: true });
  });

  it('records which constraints the simulation applied and which it only read, with the reason for each', async () => {
    const { propose, settle, act, idOf, compare, readiness } = await world();
    await propose();
    await settle();
    const reseller = await idOf((statement) => statement.includes('absorb'));
    const edited = await act({
      action: 'edit',
      id: reseller,
      patch: { effects: [{ kind: 'add-cost', target: 'adoption', amount: 0.2 }] },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    const extra = (await readiness()).constraints.extraRuns as number;
    expect(extra).toBeGreaterThan(0);
    const { started, done } = await compare();
    expect(started.progress.totalRuns).toBe(24 + extra);
    const { applied, notApplied, impacts } = done.constraints!;
    expect(applied.map((item) => item.effect.kind).sort()).toEqual([
      'add-cost',
      'require-approval',
    ]);
    expect(applied.find((item) => item.effect.kind === 'add-cost')).toMatchObject({
      constraintId: reseller,
      actorIds: ['resellers'],
      source: 'extracted',
    });
    // The rest were read and not run, each with its reason, so that none is mistaken for one that was.
    expect(notApplied.length).toBeGreaterThan(0);
    for (const item of notApplied) expect(item.reason).toBe('interpretive');
    expect(new Set(applied.map((item) => item.constraintId)).size).toBe(2);
    expect(notApplied.some((item) => item.constraintId === reseller)).toBe(false);
    // Taking each applied constraint away in turn, on the same seeds, for each scenario of the change.
    expect(impacts.length).toBe(2 * 2);
    for (const impact of impacts) {
      expect(impact.seeds).toBe(8);
      expect(['material', 'negligible', 'inconclusive']).toContain(impact.classification);
    }
    expect(done.fidelity.caveats.join(' ')).toMatch(/applied 2 constraints and only read \d+/u);
    expect(done.fidelity.caveats.join(' ')).toMatch(/taken away in turn/u);
    expect(done.progress.completedRuns).toBe(24 + extra);
    // The run itself says what held back whom, in the simulation's words.
    expect(done.representativeRun?.constraintEvents?.length ?? 0).toBeGreaterThan(0);
  });

  it('changes nothing in the runs when every constraint is only read, which is the comparison without constraints', async () => {
    const plain = await world();
    const { done: without } = await plain.compare();

    const reading = await world();
    await reading.propose();
    await reading.settle();
    // The approval is an effect; set it aside so that nothing the simulation can apply is left.
    const approval = await reading.idOf((statement) => statement.includes('regulator'));
    expect((await reading.act({ action: 'exclude', id: approval })).statusCode).toBe(200);
    const { done: withReading } = await reading.compare();

    expect(withReading.constraints?.applied).toEqual([]);
    expect(withReading.variants).toEqual(without.variants);
    expect(withReading.representativeRun).toEqual(without.representativeRun);
    expect(withReading.findings.map((finding) => finding.statement)).toEqual(
      without.findings.map((finding) => finding.statement),
    );
  });

  it('tells a comparison from the constraints it was made from: any change to them after it ran is said', async () => {
    const { propose, settle, compare, act, idOf, repository, project } = await world();
    await propose();
    await settle();
    const { done } = await compare();
    const now = () => inputRevisionsNow(repository.artifacts, project.id);
    expect(changedInputs(done.inputRevisions, undefined, now())).toEqual([]);
    const id = await idOf((statement) => statement.includes('capped'));
    expect(
      (await act({ action: 'edit', id, patch: { note: 'Checked with finance.' } })).statusCode,
    ).toBe(200);
    expect(changedInputs(done.inputRevisions, undefined, now())).toEqual(['constraints']);
  });

  it('says a comparison made before there were constraints is out of date once there are some', async () => {
    const { propose, compare, repository, project } = await world();
    const { done } = await compare();
    const now = () => inputRevisionsNow(repository.artifacts, project.id);
    expect(changedInputs(done.inputRevisions, undefined, now())).toEqual([]);
    await propose();
    expect(changedInputs(done.inputRevisions, undefined, now())).toEqual(['constraints']);
  });

  it('is challenged by the independent review for what it leaned on, and says where each constraint was taken into account', async () => {
    const { propose, settle, act, idOf, compare, post, view } = await world();
    await propose();
    await settle();
    await act({
      action: 'edit',
      id: await idOf((statement) => statement.includes('absorb')),
      patch: { effects: [{ kind: 'add-cost', target: 'adoption', amount: 0.2 }] },
    });
    const { done } = await compare();
    const before = (await view()).constraints!.constraints;
    // Before the review is run, the comparison's record is where an interpretive constraint was taken into account.
    expect(before.find((item) => item.statement.includes('capped'))?.consideredIn).toEqual([
      'gate',
      'analysis-record',
    ]);
    const reviewed = await post('/critiques/run');
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    const raised = (reviewed.json().critiques.critiques as { id: string; role: string }[]).filter(
      (item) => item.id.startsWith('constraints-'),
    );
    expect(raised.map((item) => item.id)).toEqual(
      expect.arrayContaining(['constraints-provisional', 'constraints-hard-not-modelled']),
    );
    for (const item of raised) expect(['assumption', 'methodology']).toContain(item.role);
    const after = (await view()).constraints!.constraints;
    expect(after.find((item) => item.statement.includes('capped'))?.consideredIn).toEqual([
      'gate',
      'analysis-record',
      'critic',
    ]);
    // What the simulation applied did not need to be said to be taken into account: it was run.
    expect(after.find((item) => item.statement.includes('absorb'))).toMatchObject({
      enforcement: 'enforced',
      consideredIn: [],
    });
    expect(done.constraints?.notApplied.some((item) => item.statement.includes('capped'))).toBe(
      true,
    );
  });

  it('works the gate out on request, with the constraint whose removal moves the headline share the most', async () => {
    const { propose, settle, act, idOf, get } = await world();
    expect(((await get('/constraints/gate')).json() as GateView).gate).toBeNull();
    await propose();
    await settle();
    const reseller = await idOf((statement) => statement.includes('absorb'));
    await act({
      action: 'edit',
      id: reseller,
      patch: { effects: [{ kind: 'add-cost', target: 'adoption', amount: 0.3 }] },
    });
    const gate = (await get('/constraints/gate')).json() as GateView;
    expect(gate.gate?.status).toBe('provisional');
    expect(gate.gate?.largestSensitivity).toMatchObject({ variantId: 'proposed-change', seeds: 8 });
    const stored = (await get('/constraints')).json() as ConstraintsView;
    // The page's own copy of the gate does not run a simulation; this route is where it is measured.
    expect(stored.gate?.largestSensitivity).toBeNull();
    expect(withoutMoment((await get('/constraints/gate')).json())).toEqual(withoutMoment(gate));
  });

  it('is provisional again once the scenario changes after the constraints were read against it', async () => {
    const { propose, settle, repository, project, view } = await world();
    await propose();
    await settle();
    expect((await view()).stale).toEqual({ scenario: false, actors: false });
    expect((await view()).gate?.status).toBe('provisional');
    repository.artifacts.put(
      project.id,
      'scenario',
      'default',
      scenarioFixture({ decision: 'Whether the provider should lower the fee' }),
    );
    const next = await view();
    expect(next.stale.scenario).toBe(true);
    expect(next.gate?.reasons.join(' ')).toMatch(/earlier version of the scenario/u);
  });
});

describe('counterfactual views', () => {
  it('needs actors and constraints, and says so', async () => {
    const bare = await world({}, '50', false);
    const refused = await bare.post('/constraints/counterfactuals');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('COUNTERFACTUALS_NOT_READY');
    const { post, get } = await world();
    expect((await post('/constraints/counterfactuals')).statusCode).toBe(409);
    const none = (await get('/constraints/counterfactuals')).json() as CounterfactualsView;
    expect(none).toMatchObject({ counterfactuals: null, current: false, may: { run: true } });
  });

  it('runs the views of the proposed change against the constraints, keeps them, and says when they no longer hold', async () => {
    const { propose, settle, act, idOf, post, get, repository, project } = await world();
    await propose();
    await settle();
    await act({
      action: 'edit',
      id: await idOf((statement) => statement.includes('absorb')),
      patch: { effects: [{ kind: 'add-cost', target: 'adoption', amount: 0.2 }] },
    });
    const ran = await post('/constraints/counterfactuals');
    expect(ran.statusCode, ran.body).toBe(201);
    const view = ran.json() as CounterfactualsView;
    expect(view.current).toBe(true);
    expect(() => counterfactualSetSchema.parse(view.counterfactuals)).not.toThrow();
    const set = view.counterfactuals!;
    expect(set.variantId).toBe('proposed-change');
    expect(set.views.map((item) => item.id)).toEqual([
      'without-budget',
      'delayed-implementation',
      'stronger-regulation',
      'lower-adoption',
      'higher-capacity',
      'different-decision-owner',
      'dependency-fails',
    ]);
    for (const item of set.views) {
      if (item.applicable) {
        expect(item.deltaVsBase, item.id).not.toBeNull();
        expect(item.classification, item.id).not.toBeNull();
      } else {
        // A view that does not apply says why and carries no difference.
        expect(item.deltaVsBase, item.id).toBeNull();
        expect(item.reason?.length, item.id).toBeGreaterThan(10);
      }
    }
    expect(set.views.filter((item) => item.applicable).length).toBeGreaterThan(2);
    expect(
      ((await get('/constraints/counterfactuals')).json() as CounterfactualsView).counterfactuals,
    ).toEqual(set);
    const entry = repository.audit
      .list({ projectId: project.id, limit: 50 })
      .find((item) => item.action === 'constraints.counterfactuals.run');
    expect(entry?.detail).toMatchObject({ views: 7, seeds: 12 });
    expect(JSON.stringify(entry)).not.toMatch(/regulator|reseller|capped/iu);
    // Changing the constraints makes them a description of the project as it was.
    await act({
      action: 'edit',
      id: await idOf((s) => s.includes('capped')),
      patch: { note: 'Moved.' },
    });
    expect(
      ((await get('/constraints/counterfactuals')).json() as CounterfactualsView).current,
    ).toBe(false);
  });
});

// Who may do what, for every kind of person: written out in full, as in membership.test.ts.
describe('who may use the constraint routes', () => {
  const ID = {
    owner: 'c1000001-0000-4000-8000-000000000001',
    lead: 'c1000003-0000-4000-8000-000000000003',
    analyst: 'c1000004-0000-4000-8000-000000000004',
    reviewer: 'c1000005-0000-4000-8000-000000000005',
    viewer: 'c1000006-0000-4000-8000-000000000006',
    member: 'c1000007-0000-4000-8000-000000000007',
    foreignOwner: 'd1000001-0000-4000-8000-000000000001',
  } as const;
  type Actor = keyof typeof ID | 'anonymous';
  const TOKENS: Record<keyof typeof ID, Minted> = {
    owner: { oid: ID.owner, roles: ['Swarm.User'] },
    lead: { oid: ID.lead, roles: ['Swarm.User'] },
    analyst: { oid: ID.analyst, roles: ['Swarm.User'] },
    reviewer: { oid: ID.reviewer, roles: ['Swarm.User'] },
    viewer: { oid: ID.viewer, roles: ['Swarm.User'] },
    member: { oid: ID.member, roles: ['Swarm.User'] },
    foreignOwner: { tid: TENANT_B, oid: ID.foreignOwner, roles: ['Swarm.User'] },
  };
  type Capability = 'read' | 'run' | 'edit';
  const CAN: Record<Actor, readonly Capability[]> = {
    owner: ['read', 'run', 'edit'],
    lead: ['read', 'run', 'edit'],
    analyst: ['read', 'run', 'edit'],
    reviewer: ['read'],
    viewer: ['read'],
    member: [],
    foreignOwner: [],
    anonymous: [],
  };

  // Requests the handler refuses, so that nothing is changed or run by checking who may.
  const routes = [
    {
      name: 'read the constraints',
      policy: 'GET /api/projects/:id/constraints',
      capability: 'read',
      method: 'GET',
      path: '/constraints',
    },
    {
      name: 'change the constraints',
      policy: 'PUT /api/projects/:id/constraints',
      capability: 'edit',
      method: 'PUT',
      path: '/constraints',
      payload: { invalid: true },
    },
    {
      name: 'ask for a reading',
      policy: 'POST /api/projects/:id/constraints/propose',
      capability: 'run',
      method: 'POST',
      path: '/constraints/propose',
      payload: { mode: 'sometimes' },
    },
    {
      name: 'review the constraints',
      policy: 'POST /api/projects/:id/constraints/review',
      capability: 'edit',
      method: 'POST',
      path: '/constraints/review',
      payload: { invalid: true },
    },
    {
      name: 'read the gate',
      policy: 'GET /api/projects/:id/constraints/gate',
      capability: 'read',
      method: 'GET',
      path: '/constraints/gate',
    },
    {
      name: 'read the views',
      policy: 'GET /api/projects/:id/constraints/counterfactuals',
      capability: 'read',
      method: 'GET',
      path: '/constraints/counterfactuals',
    },
    {
      name: 'run the views',
      policy: 'POST /api/projects/:id/constraints/counterfactuals',
      capability: 'run',
      method: 'POST',
      path: '/constraints/counterfactuals',
      payload: {},
    },
  ] as const;

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
      principalId: ID.owner,
      role: 'owner',
      actor: setup,
    });
    repository.members.setWorkspaceMember({
      tenantId: TENANT_A,
      principalId: ID.member,
      role: 'member',
      actor: setup,
    });
    repository.members.setWorkspaceMember({
      tenantId: TENANT_B,
      principalId: ID.foreignOwner,
      role: 'owner',
      actor: setup,
    });
    const shared = repository.create(fixtureInput({ workflow: 'guided' }), {
      owner: { tenantId: TENANT_A, ownerId: ID.lead },
    });
    for (const [principalId, role] of [
      [ID.analyst, 'analyst'],
      [ID.reviewer, 'reviewer'],
      [ID.viewer, 'viewer'],
    ] as const) {
      repository.members.setProjectMember({
        projectId: shared.id,
        tenantId: TENANT_A,
        principalId,
        role,
        actor: { id: ID.lead },
      });
    }
    return { ...instance, shared: shared.id };
  }

  const call = async (
    instance: Awaited<ReturnType<typeof secured>>,
    as: Actor,
    route: (typeof routes)[number],
    projectId: string,
  ) =>
    instance.app.inject({
      method: route.method,
      url: `/api/projects/${projectId}${route.path}`,
      headers: as === 'anonymous' ? {} : await authorization(TOKENS[as]),
      ...('payload' in route ? { payload: route.payload } : {}),
    });

  const outcome = (response: { statusCode: number; json: () => { error?: { code?: string } } }) => {
    if (response.statusCode === 401) return 'unauthenticated';
    const code = response.statusCode >= 400 ? response.json().error?.code : undefined;
    if (code === 'PROJECT_NOT_FOUND') return 'hidden';
    if (response.statusCode === 403 && code === 'FORBIDDEN') return 'forbidden';
    return 'allowed';
  };

  const expected = (actor: Actor, capability: Capability) => {
    if (actor === 'anonymous') return 'unauthenticated';
    if (CAN[actor].length === 0) return 'hidden';
    return CAN[actor].includes(capability) ? 'allowed' : 'forbidden';
  };

  it('is the policy table: reading needs read, a reading and the views need run, changing and reviewing need edit', () => {
    for (const route of routes) {
      expect(ROUTE_POLICY[route.policy], route.policy).toEqual({
        kind: 'project',
        capability: route.capability,
      });
    }
  });

  it.each(Object.keys(CAN) as Actor[])('does what the table says for %s', async (actor) => {
    const instance = await secured();
    const seen: string[] = [];
    for (const route of routes) {
      const response = await call(instance, actor, route, instance.shared);
      const got = outcome(response);
      const want = expected(actor, route.capability);
      if (got !== want) seen.push(`${actor} may ${route.name}: expected ${want}, got ${got}`);
      if (want === 'hidden') {
        // A project a person may not see answers as one that does not exist, word for word.
        const absent = await call(instance, actor, route, '99999999-9999-4999-8999-999999999999');
        expect(response.json().error, `${actor} ${route.name}`).toMatchObject({
          code: absent.json().error.code,
          message: absent.json().error.message,
        });
      }
    }
    expect(seen).toEqual([]);
  });

  it('keeps another workspace out of the constraints, and this one out of theirs', async () => {
    const instance = await secured();
    for (const route of routes) {
      expect(
        outcome(await call(instance, 'foreignOwner', route, instance.shared)),
        route.name,
      ).toBe('hidden');
    }
  });

  it('tells a person what they may do, so that the page can say so instead of failing', async () => {
    const instance = await secured();
    const read = async (as: 'viewer' | 'analyst') =>
      (
        await instance.app.inject({
          method: 'GET',
          url: `/api/projects/${instance.shared}/constraints`,
          headers: await authorization(TOKENS[as]),
        })
      ).json() as ConstraintsView;
    expect((await read('viewer')).may).toEqual({ edit: false, run: false });
    expect((await read('analyst')).may).toEqual({ edit: true, run: true });
  });
});
