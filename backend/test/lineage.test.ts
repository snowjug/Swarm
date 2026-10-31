import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPARISON_INPUTS_UNRECORDED,
  UNRECORDED_INPUTS_ADVICE,
  type Analysis,
} from '../../shared/analysis.js';
import type { BriefView, DecisionBrief } from '../../shared/brief.js';
import type { CritiquesView } from '../../shared/critique.js';
import { actorSetFixture } from '../../shared/lab-fixtures.js';
import type { ScenarioView } from '../../shared/scenario.js';
import type { ActorsView, StakeholdersView } from '../../shared/stakeholders.js';
import { AnalysisService } from '../src/analysis/service.js';
import { buildApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import { Repository } from '../src/storage/repository.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { stubSimulator } from './support/stub-simulator.js';

// What each document of the lab was made from, and what a person is told when that has changed: a
// comparison records the scenario, the stakeholders and the actors it ran on, the brief and the review
// are judged against that record, and nothing that rests on an earlier version looks current.

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The condition was not reached in time.');
}

const SMALL = { runsPerVariant: 5, rounds: 3, sensitivity: false };

/** A project that went through intake, stakeholders and actors by the routes the pages use. */
async function world() {
  const instance = await buildApp({
    config: testConfig({ LOG_LEVEL: 'silent', RATE_LIMIT_SCALE: '100' }),
  });
  applications.push(instance);
  const { app } = instance;
  const input = fixtureInput({ workflow: 'guided' });
  const parsed = await app.inject({
    method: 'POST',
    url: '/api/scenario/parse',
    payload: { question: input.question },
  });
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { ...input, scenario: parsed.json().frame },
  });
  expect(created.statusCode, created.body).toBe(201);
  const project = created.json() as { id: string };
  const base = `/api/projects/${project.id}`;
  const post = (path: string, payload: object = {}) =>
    app.inject({ method: 'POST', url: `${base}${path}`, payload });
  const put = (path: string, payload: object) =>
    app.inject({ method: 'PUT', url: `${base}${path}`, payload });
  const read = async <T>(path: string): Promise<T> =>
    (await app.inject(`${base}${path}`)).json() as T;

  const found = await post('/stakeholders/discover');
  expect(found.statusCode, found.body).toBe(201);
  const approved = await post('/stakeholders/approve', {
    expectedRevision: (found.json() as StakeholdersView).revision,
  });
  expect(approved.statusCode, approved.body).toBe(200);
  expect((await post('/actors/generate')).statusCode).toBe(201);

  const compare = async (): Promise<Analysis> => {
    const started = await post('/analysis', SMALL);
    expect(started.statusCode, started.body).toBe(202);
    const id = (started.json().analysis as Analysis).id;
    const done = await until(
      async () => (await read<{ analysis: Analysis }>(`/analysis/${id}`)).analysis,
      (analysis) => !['running', 'queued'].includes(analysis.status),
    );
    expect(done.status, JSON.stringify(done.error)).toBe('completed');
    return done;
  };
  /** Everything after the comparison: the independent review and the brief. */
  const reviewAndWrite = async () => {
    expect((await post('/critiques/run')).statusCode).toBe(200);
    const written = await post('/brief');
    expect(written.statusCode, written.body).toBe(201);
    return written.json() as BriefView;
  };
  /** The scenario with its decision replaced, as a person editing it would save it. */
  const changeScenario = async (decision: string) => {
    const current = await read<ScenarioView>('/scenario');
    const saved = await put('/scenario', {
      expectedRevision: current.revision,
      scenario: { ...current.scenario, decision, origin: 'user' },
    });
    expect(saved.statusCode, saved.body).toBe(200);
  };
  /** The stakeholders as they are saved by someone who changes one of them. */
  const reviseStakeholders = async (change: (names: StakeholdersView) => object) => {
    const view = await read<StakeholdersView>('/stakeholders');
    const saved = await put('/stakeholders', {
      expectedRevision: view.revision,
      relations: view.stakeholders!.relations,
      ...change(view),
    });
    expect(saved.statusCode, saved.body).toBe(200);
    return saved.json() as StakeholdersView;
  };
  return {
    ...instance,
    project,
    base,
    post,
    put,
    read,
    compare,
    reviewAndWrite,
    changeScenario,
    reviseStakeholders,
  };
}

describe('starting a comparison from a cast that no longer matches the stakeholders', () => {
  it.each(['were found again', 'had one of them removed'] as const)(
    'is refused in plain words when the stakeholders %s after the actors were made, and nothing is saved',
    async (change) => {
      const { post, read, reviseStakeholders } = await world();
      if (change === 'were found again') {
        expect((await post('/stakeholders/discover', { confirm: true })).statusCode).toBe(201);
      } else {
        await reviseStakeholders((view) => ({
          stakeholders: view.stakeholders!.stakeholders.map((stakeholder, index) =>
            index === 0 ? { ...stakeholder, status: 'removed' } : stakeholder,
          ),
        }));
      }
      // The pages already say so: the actors are out of date and the list is no longer approved.
      expect((await read<ActorsView>('/actors')).stale).toBe(true);
      expect((await read<StakeholdersView>('/stakeholders')).stakeholders?.approvedAt).toBeNull();

      const refused = await post('/analysis', SMALL);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().error.code).toBe('STAKEHOLDERS_NOT_APPROVED');
      expect(refused.json().error.message).toContain('Approve them and make the actors again');
      expect((await read<{ analyses: unknown[] }>('/analysis')).analyses).toEqual([]);
    },
  );

  it('is refused when the list was approved again but the actors were not made again from it', async () => {
    const { post, read } = await world();
    const found = await post('/stakeholders/discover', { confirm: true });
    expect(found.statusCode).toBe(201);
    const approved = await post('/stakeholders/approve', {
      expectedRevision: (found.json() as StakeholdersView).revision,
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const refused = await post('/analysis', SMALL);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.code).toBe('ACTORS_OUT_OF_DATE');
    expect(refused.json().error.message).toContain('Make the actors again');
    // Making them again from the approved list is what lets it start.
    expect((await post('/actors/generate', { confirm: true })).statusCode).toBe(201);
    expect((await post('/analysis', SMALL)).statusCode).toBe(202);
    expect((await read<{ analyses: unknown[] }>('/analysis')).analyses).toHaveLength(1);
  });

  it('records what it was made from, and still has it when it has finished', async () => {
    const { post, read } = await world();
    const scenario = await read<ScenarioView>('/scenario');
    const stakeholders = await read<StakeholdersView>('/stakeholders');
    const actors = await read<ActorsView>('/actors');
    const expected = {
      scenario: scenario.revision,
      stakeholders: stakeholders.revision,
      actors: actors.revision,
    };
    const started = await post('/analysis', SMALL);
    const id = (started.json().analysis as Analysis).id;
    expect((started.json().analysis as Analysis).inputRevisions).toEqual(expected);
    const finished = await until(
      async () => (await read<{ analysis: Analysis }>(`/analysis/${id}`)).analysis,
      (analysis) => analysis.status !== 'running',
    );
    expect(finished.status).toBe('completed');
    expect(finished.inputRevisions).toEqual(expected);
  });
});

describe('a brief and a review of a comparison that predates a change', () => {
  const CLOSURE = 'Close the existing service entirely rather than run the proposed pilot';

  it('keeps saying what changed when the brief is written again, and says so in the brief itself', async () => {
    const { read, post, compare, reviewAndWrite, changeScenario } = await world();
    const first = await compare();
    await reviewAndWrite();
    expect((await read<BriefView>('/brief')).changedSince).toEqual([]);

    await changeScenario(CLOSURE);
    expect((await read<BriefView>('/brief')).changedSince).toEqual(['scenario']);

    // Writing it again from the same comparison does not make it describe the new decision.
    const again = (await post('/brief')).json() as BriefView;
    expect(again.brief?.analysisId).toBe(first.id);
    expect(again.changedSince).toEqual(['scenario']);
    expect(again.brief?.methodology.notes.at(-1)).toContain(
      'The comparison this brief rests on was run before the scenario changed',
    );
    const review = await read<CritiquesView>('/critiques');
    expect(review.changedSince).toEqual(['scenario']);
    expect(review.critiques?.analysisId).toBe(first.id);

    // Running the comparison again, and then the review and the brief, brings all three up to date.
    const second = await compare();
    expect(second.inputRevisions?.scenario).toBeGreaterThan(first.inputRevisions!.scenario!);
    const current = await (async () => {
      expect((await post('/critiques/run')).statusCode).toBe(200);
      return (await post('/brief')).json() as BriefView;
    })();
    expect(current.brief?.analysisId).toBe(second.id);
    expect(current.changedSince).toEqual([]);
    expect(current.brief?.methodology.notes.join(' ')).not.toContain('was run before');
    expect((await read<CritiquesView>('/critiques')).changedSince).toEqual([]);
  });

  it('tells a review that was run on it what it reads two versions of', async () => {
    const { post, compare, changeScenario } = await world();
    await compare();
    await changeScenario(CLOSURE);
    const run = await post('/critiques/run');
    expect(run.statusCode, run.body).toBe(200);
    const view = run.json() as CritiquesView;
    expect(view.changedSince).toEqual(['scenario']);
    expect(view.critiques?.notes?.join(' ')).toContain(
      'This comparison was run before the scenario changed',
    );
  });

  it('says a newer comparison exists, and does not ask for another when that one is current', async () => {
    const { read, compare, reviewAndWrite, changeScenario } = await world();
    await compare();
    await reviewAndWrite();
    await changeScenario(CLOSURE);
    await compare();
    // Both rest on the first comparison, which predates the change: the newer one does not.
    expect((await read<BriefView>('/brief')).changedSince).toEqual([
      'scenario',
      'a newer analysis exists',
    ]);
    expect((await read<CritiquesView>('/critiques')).changedSince).toEqual([
      'scenario',
      'a newer analysis exists',
    ]);
  });
});

describe('a comparison saved before it recorded what it was made from', () => {
  const CLOSURE = 'Close the existing service entirely rather than run the proposed pilot';
  /** The comparison as an earlier version stored it: with nothing of what it was made from. */
  const asEarlierVersion = (instance: Awaited<ReturnType<typeof world>>, analysis: Analysis) => {
    const stored = instance.repository.artifacts.get(instance.project.id, 'analysis', analysis.id)!;
    const earlier: Analysis = { ...stored.data };
    delete earlier.inputRevisions;
    instance.repository.artifacts.put(instance.project.id, 'analysis', analysis.id, earlier);
  };

  it('is never called current, however often the brief and the review are made from it again', async () => {
    const instance = await world();
    const { read, post, compare, reviewAndWrite, changeScenario } = instance;
    const first = await compare();
    asEarlierVersion(instance, first);
    await reviewAndWrite();
    expect((await read<BriefView>('/brief')).changedSince).toEqual([COMPARISON_INPUTS_UNRECORDED]);
    expect((await read<CritiquesView>('/critiques')).changedSince).toEqual([
      COMPARISON_INPUTS_UNRECORDED,
    ]);

    // The decision was changed after the comparison; writing the brief and the review again must not clear it.
    await changeScenario(CLOSURE);
    expect((await read<BriefView>('/brief')).changedSince).toEqual([
      'scenario',
      COMPARISON_INPUTS_UNRECORDED,
    ]);
    const again = (await post('/brief')).json() as BriefView;
    expect(again.changedSince).toEqual([COMPARISON_INPUTS_UNRECORDED]);
    expect(again.brief?.methodology.notes.at(-1)).toContain(UNRECORDED_INPUTS_ADVICE);
    const review = (await post('/critiques/run')).json() as CritiquesView;
    expect(review.changedSince).toEqual([COMPARISON_INPUTS_UNRECORDED]);
    expect(review.critiques?.notes?.join(' ')).toContain(
      'saved before Swarm recorded what a comparison is made from',
    );

    // Every export says so before anything else.
    for (const format of ['md', 'html', 'json']) {
      const { body } = await instance.app.inject(`${instance.base}/brief/export?format=${format}`);
      expect(body, format).toContain('may be out of date');
      expect(body, format).toContain('saved before Swarm recorded what a comparison is made from');
    }

    // A comparison that records what it was made from, and a review and a brief of it, are current.
    await compare();
    expect((await post('/critiques/run')).statusCode).toBe(200);
    const current = (await post('/brief')).json() as BriefView;
    expect(current.changedSince).toEqual([]);
    expect((await read<CritiquesView>('/critiques')).changedSince).toEqual([]);
  });
});

describe('handing a brief over after what it rests on has changed', () => {
  const RENAMED = 'Architecture renamed group';
  /** The export as text; Markdown has the backslashes it escapes punctuation with taken out, to read as written. */
  const exportOf = async (instance: Awaited<ReturnType<typeof world>>, format: string) => {
    const { body } = await instance.app.inject(`${instance.base}/brief/export?format=${format}`);
    return format === 'md' ? body.replace(/\\([^A-Za-z0-9\s])/gu, '$1') : body;
  };

  /** A finished brief, then one of its stakeholders renamed by someone else. */
  async function renamed() {
    const instance = await world();
    await instance.compare();
    await instance.reviewAndWrite();
    const original = await instance.read<BriefView>('/brief');
    const first = (await instance.read<StakeholdersView>('/stakeholders')).stakeholders!
      .stakeholders[0]!;
    const revised = await instance.reviseStakeholders((view) => ({
      stakeholders: view.stakeholders!.stakeholders.map((stakeholder) =>
        stakeholder.id === first.id ? { ...stakeholder, name: RENAMED } : stakeholder,
      ),
    }));
    return { ...instance, original, first, revised };
  }

  it('warns in every format, and prints the charts the brief was made with, not the project as it is now', async () => {
    const instance = await renamed();
    const { original, first, revised, read } = instance;
    const shown = await read<BriefView>('/brief');
    expect(shown.changedSince).toEqual(['stakeholders']);
    expect(shown.visualsFrom).toBe('snapshot');
    expect(shown.visuals).toEqual(original.visuals);
    expect(shown.brief).toEqual(original.brief);

    const json = JSON.parse(await exportOf(instance, 'json'));
    expect(json.brief).toEqual(original.brief);
    expect(json.data).toEqual(original.visuals);
    expect(json.changedSince).toEqual(['stakeholders']);
    expect(json.warning).toContain('This brief may be out of date.');
    expect(json.provenance.dataFrom).toBe('snapshot');
    // The revisions it was made from, beside the ones the project holds now.
    expect(json.provenance.inputRevisions.stakeholders).toBe((revised.revision as number) - 1);
    expect(json.provenance.currentRevisions.stakeholders).toBe(revised.revision);
    expect(JSON.stringify(json.data)).toContain(first.name);
    expect(JSON.stringify(json)).not.toContain(RENAMED);

    const markdown = await exportOf(instance, 'md');
    const html = await exportOf(instance, 'html');
    for (const [format, text] of [
      ['markdown', markdown],
      ['html', html],
    ] as const) {
      expect(text, format).toContain('This brief may be out of date.');
      expect(text, format).toContain('Since it was made, this has changed: stakeholders.');
      expect(text, format).toContain(
        'The comparison it rests on was run before the stakeholders changed',
      );
      expect(text, format).not.toContain(RENAMED);
    }
    expect(html).toContain('<p class="alert"><strong>This brief may be out of date.</strong>');
    expect(markdown).toMatch(/^> \*\*This brief may be out of date\.\*\*/mu);
  });

  it('asks for the comparison to be run again when that is what it rests on, and says nothing when nothing changed', async () => {
    const instance = await world();
    await instance.compare();
    await instance.reviewAndWrite();
    const clean = JSON.parse(await exportOf(instance, 'json'));
    expect(clean.changedSince).toEqual([]);
    expect(clean.warning).toBeNull();
    expect(await exportOf(instance, 'md')).not.toContain('out of date');

    await instance.changeScenario('Close the existing service entirely');
    const markdown = await exportOf(instance, 'md');
    expect(markdown).toContain('Since it was made, this has changed: scenario.');
    expect(markdown).toContain(
      'The comparison it rests on was run before the scenario changed, so the brief describes the project as it was. Run the comparison again, then write the brief again.',
    );
  });

  it('asks only for the brief to be written again when only the review has changed since', async () => {
    const instance = await world();
    await instance.compare();
    await instance.reviewAndWrite();
    const review = await instance.read<CritiquesView>('/critiques');
    const answered = await instance.put(
      `/critiques/${review.critiques!.critiques[0]!.id}/response`,
      {
        text: 'Accepted after reading the evidence again.',
        status: 'accepted',
        expectedRevision: review.revision,
      },
    );
    expect(answered.statusCode, answered.body).toBe(200);

    expect((await instance.read<BriefView>('/brief')).changedSince).toEqual(['critiques']);
    const markdown = await exportOf(instance, 'md');
    expect(markdown).toContain('Since it was made, this has changed: critiques.');
    expect(markdown).toContain('Write the brief again to bring it up to date.');
    expect(markdown).not.toContain('Run the comparison again');
  });

  it('says that the tables show the project as it is when the brief was stored without the data behind them', async () => {
    const instance = await world();
    await instance.compare();
    await instance.reviewAndWrite();
    const stored = instance.repository.artifacts.get(instance.project.id, 'brief')!;
    expect(stored.data.snapshot).toBeDefined();
    const older: DecisionBrief = { ...stored.data };
    delete older.snapshot;
    instance.repository.artifacts.put(instance.project.id, 'brief', 'default', older);

    const view = await instance.read<BriefView>('/brief');
    expect(view.visualsFrom).toBe('current');
    expect(view.visuals?.analysisId).toBe(stored.data.analysisId);
    const json = JSON.parse(await exportOf(instance, 'json'));
    expect(json.provenance.dataFrom).toBe('current');
    expect(await exportOf(instance, 'md')).toContain('The tables show the project as it is now.');
    expect(await exportOf(instance, 'html')).toContain('The tables show the project as it is now.');
  });
});

describe('two people answering one review', () => {
  async function reviewed() {
    const instance = await world();
    await instance.compare();
    expect((await instance.post('/critiques/run')).statusCode).toBe(200);
    const answer = (id: string, text: string, status: string, expectedRevision?: number) =>
      instance.put(`/critiques/${id}/response`, {
        text,
        status,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      });
    return { ...instance, answer };
  }

  it('keeps the first answer and refuses the second, which was written about a review that had changed', async () => {
    const { read, answer } = await reviewed();
    const tabA = await read<CritiquesView>('/critiques');
    const tabB = await read<CritiquesView>('/critiques');
    expect(tabB).toEqual(tabA);
    expect(tabA.revision).toBeGreaterThan(0);
    const id = tabA.critiques!.critiques[0]!.id;

    const first = await answer(
      id,
      'First reviewer accepts this objection.',
      'accepted',
      tabA.revision!,
    );
    expect(first.statusCode, first.body).toBe(200);
    expect((first.json() as CritiquesView).revision).toBe(tabA.revision! + 1);

    const second = await answer(id, 'Second reviewer disputes it.', 'disputed', tabB.revision!);
    expect(second.statusCode, second.body).toBe(409);
    expect(second.json().error.code).toBe('CRITIQUES_CHANGED');
    expect(second.json().error.message).toContain('Reload the review');
    const kept = (await read<CritiquesView>('/critiques')).critiques!.critiques.find(
      (critique) => critique.id === id,
    );
    expect(kept?.status).toBe('accepted');
    expect(kept?.response?.text).toBe('First reviewer accepts this objection.');

    // Having reloaded, the same words are taken.
    const reloaded = await read<CritiquesView>('/critiques');
    const retry = await answer(id, 'Second reviewer disputes it.', 'disputed', reloaded.revision!);
    expect(retry.statusCode, retry.body).toBe(200);
  });

  it('refuses an answer to a review that was run again since it was read', async () => {
    const { read, post, answer } = await reviewed();
    const seen = await read<CritiquesView>('/critiques');
    expect((await post('/critiques/run')).statusCode).toBe(200);
    const late = await answer(
      seen.critiques!.critiques[0]!.id,
      'Answered from before the review was run again.',
      'responded',
      seen.revision!,
    );
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('CRITIQUES_CHANGED');
  });

  it('needs to be told which review the answer is about', async () => {
    const { read, answer, repository, project } = await reviewed();
    const view = await read<CritiquesView>('/critiques');
    const missing = await answer(
      view.critiques!.critiques[0]!.id,
      'No revision given.',
      'responded',
    );
    expect(missing.statusCode).toBe(400);
    const stored = repository.artifacts.get(project.id, 'critiques')!;
    expect(stored.revision).toBe(view.revision);
    expect(stored.data.critiques.every((critique) => critique.response === null)).toBe(true);
  });
});

describe('starting a comparison that cannot be recorded', () => {
  it('leaves nothing behind that looks as if it were running, when its start cannot be recorded', async () => {
    const { repository, post, read } = await world();
    const real = repository.audit.record.bind(repository.audit);
    vi.spyOn(repository.audit, 'record').mockImplementation((entry, now) => {
      if (entry.action === 'analysis.started') {
        throw new AppError(503, 'STORAGE_UNAVAILABLE', 'The storage did not answer.');
      }
      return real(entry, now);
    });
    const refused = await post('/analysis', SMALL);
    expect(refused.statusCode, refused.body).toBe(503);
    expect(refused.json().error.code).toBe('STORAGE_UNAVAILABLE');
    expect((await read<{ analyses: unknown[] }>('/analysis')).analyses).toEqual([]);

    // Once the storage answers, the same request starts a comparison, and its start is on record.
    vi.restoreAllMocks();
    expect((await post('/analysis', SMALL)).statusCode).toBe(202);
    expect(
      repository.audit.list({ limit: 500 }).filter((entry) => entry.action === 'analysis.started'),
    ).toHaveLength(1);
  });

  it('ends the saved comparison as failed, and frees the project, when it cannot be launched', async () => {
    const repository = new Repository(':memory:');
    const project = repository.create(fixtureInput({ workflow: 'guided' }));
    repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
    const service = new AnalysisService(repository, { simulator: stubSimulator });
    const launch = vi
      .spyOn(service as unknown as { launch: () => void }, 'launch')
      .mockImplementation(() => {
        throw new Error('No task could be created.');
      });
    expect(() => service.start(project.id, SMALL, 'tester')).toThrowError(
      expect.objectContaining({ code: 'ANALYSIS_NOT_STARTED', statusCode: 503 }),
    );
    const [saved, ...others] = repository.artifacts.list(project.id, 'analysis');
    expect(others).toEqual([]);
    expect(saved?.data.status).toBe('failed');
    expect(saved?.data.error?.code).toBe('ANALYSIS_NOT_STARTED');

    launch.mockRestore();
    const next = service.start(project.id, SMALL, 'tester');
    expect(next.status).toBe('running');
    await service.stop();
    repository.close();
  });
});
