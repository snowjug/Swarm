import { describe, expect, it } from 'vitest';
import type { OperationTrace } from '../../../../shared/guided';
import type { SceneInfo } from '../../app/scenes';
import { projectFixture } from '../../test/project';
import {
  SEARCH_LIMIT,
  describeSearch,
  documentFacts,
  elapsedSeconds,
  elapsedText,
  failureReason,
  groundStage,
  knowledgePhases,
  momentOf,
  nextStep,
  parseView,
  sampleNote,
} from './model';

const trace = (overrides: Partial<OperationTrace>): OperationTrace => ({
  id: 'trace-1',
  step: 'knowledge',
  kind: 'review',
  name: 'Ontology definition',
  status: 'running',
  startedAt: '2026-01-01T00:00:10.000Z',
  completedAt: null,
  input: null,
  output: null,
  error: null,
  ...overrides,
});

const event = (message: string, createdAt: string, id = 1) => ({
  id,
  projectId: 'p',
  stage: 'knowledge' as const,
  message,
  createdAt,
});

function withStatus(status: 'pending' | 'queued' | 'running' | 'ready' | 'failed' | 'cancelled') {
  const project = projectFixture();
  project.console!.steps.knowledge = status;
  return project;
}

describe('groundStage', () => {
  it('reads the step the engine reports', () => {
    expect(groundStage(withStatus('pending'))).toBe('idle');
    expect(groundStage(withStatus('queued'))).toBe('queued');
    expect(groundStage(withStatus('running'))).toBe('running');
    expect(groundStage(withStatus('ready'))).toBe('ready');
    expect(groundStage(withStatus('failed'))).toBe('failed');
    expect(groundStage(withStatus('cancelled'))).toBe('stopped');
  });

  it('treats a record the guided flow did not make as a read-only record', () => {
    const project = projectFixture();
    project.console = null;
    project.workflow = 'quick';
    expect(groundStage(project)).toBe('record');
  });
});

describe('knowledgePhases', () => {
  it('says only what the traces say: running is active, completed is done, the rest waits', () => {
    const project = withStatus('running');
    project.console!.traces = [
      trace({ status: 'completed', completedAt: '2026-01-01T00:00:12.000Z' }),
    ];
    const [types, graph] = knowledgePhases(project);
    expect(types?.state).toBe('done');
    expect(graph?.state).toBe('active');
  });

  it('starts at the first phase when the engine has begun and recorded nothing yet', () => {
    const [types, graph] = knowledgePhases(withStatus('running'));
    expect([types?.state, graph?.state]).toEqual(['active', 'waiting']);
  });

  it('does not carry an earlier attempt’s failure into a new attempt that has only been queued', () => {
    const project = withStatus('queued');
    project.events = [
      event('knowledge started. This stage runs independently', '2026-01-01T00:00:09.000Z', 1),
      event('knowledge queued for the bounded local worker.', '2026-01-01T00:05:00.000Z', 2),
    ];
    project.console!.traces = [
      trace({
        status: 'failed',
        error: 'The model did not answer.',
        completedAt: '2026-01-01T00:00:30.000Z',
      }),
    ];
    expect(knowledgePhases(project).map((phase) => phase.state)).toEqual(['waiting', 'waiting']);
  });

  it('shows the failed phase of the attempt that failed', () => {
    const project = withStatus('failed');
    project.events = [event('knowledge started.', '2026-01-01T00:00:09.000Z')];
    project.console!.traces = [trace({ status: 'failed', error: 'No answer.' })];
    expect(knowledgePhases(project)[0]?.state).toBe('failed');
  });

  it('is complete when the step is ready', () => {
    expect(knowledgePhases(withStatus('ready')).every((phase) => phase.state === 'done')).toBe(
      true,
    );
  });
});

describe('momentOf', () => {
  it('is reading until the engine is building the graph, then extracting', () => {
    expect(momentOf('running', knowledgePhases(withStatus('running')), false)).toBe('reading');
    const project = withStatus('running');
    project.console!.traces = [
      trace({ status: 'completed', completedAt: '2026-01-01T00:00:12.000Z' }),
    ];
    expect(momentOf('running', knowledgePhases(project), false)).toBe('extracting');
  });

  it('is checking while the conflicts of a finished graph are still being looked for, and only then ready', () => {
    const phases = knowledgePhases(withStatus('ready'));
    expect(momentOf('ready', phases, true)).toBe('checking');
    expect(momentOf('ready', phases, false)).toBe('ready');
    expect(momentOf('record', phases, true)).toBe('checking');
  });

  it('keeps the words of the stages that are not under way', () => {
    const phases = knowledgePhases(withStatus('pending'));
    for (const stage of ['idle', 'queued', 'failed', 'stopped'] as const) {
      expect(momentOf(stage, phases, false)).toBe(stage);
    }
  });
});

describe('failureReason', () => {
  it('prefers the project’s own message and falls back to the failed trace', () => {
    const project = withStatus('failed');
    project.console!.traces = [trace({ status: 'failed', error: 'From the trace.' })];
    expect(failureReason(project)).toBe('From the trace.');
    project.error = 'From the project.';
    expect(failureReason(project)).toBe('From the project.');
  });

  it('is nothing when the step did not fail', () => {
    expect(failureReason(withStatus('ready'))).toBeNull();
  });
});

describe('nextStep', () => {
  const info = (id: SceneInfo['id'], state: SceneInfo['state']): SceneInfo => ({
    id,
    label: id,
    state,
    current: false,
  });

  it('offers Map when it is open, and the next open scene when it is not', () => {
    expect(nextStep([info('map', 'ready'), info('simulate', 'ready')])?.scene).toBe('map');
    expect(nextStep([info('map', 'locked'), info('simulate', 'ready')])?.scene).toBe('simulate');
    expect(
      nextStep([info('map', 'locked'), info('simulate', 'locked'), info('decide', 'done')])?.scene,
    ).toBe('decide');
    expect(nextStep([info('map', 'locked')])).toBeNull();
  });
});

describe('parseView', () => {
  it('knows its views and the names other places may use for them', () => {
    expect(parseView('conflicts')).toBe('conflicts');
    expect(parseView('ledger')).toBe('statements');
    expect(parseView('evidence')).toBe('sources');
    expect(parseView('nonsense')).toBeNull();
    expect(parseView(null)).toBeNull();
  });
});

describe('documentFacts', () => {
  it('labels a sample as synthetic and reads the host of a fetched page', () => {
    const sample = documentFacts(
      {
        id: 'D1',
        name: 'a.md',
        content: 'x'.repeat(10),
        provenance: { kind: 'sample', title: 'Illustrative' },
      },
      0,
    );
    expect(sample.synthetic).toBe(true);
    expect(sample.shortKind).toBe('Sample');

    const page = documentFacts(
      {
        id: 'D2',
        name: 'page.md',
        content: 'y',
        provenance: {
          kind: 'url',
          url: 'https://example.org/a?b=1',
          retrievedAt: '2026-01-01T00:00:00.000Z',
          fetchedByServer: true,
        },
      },
      1,
    );
    expect(page.host).toBe('example.org');
    expect(page.fetchedByServer).toBe(true);
    expect(page.synthetic).toBe(false);
  });

  it('is honest about text whose origin the record does not give', () => {
    expect(documentFacts({ id: 'D3', name: 'c.md', content: 'z' }, 2).kind).toBeNull();
  });

  it('does not make a link of an address that is not a web address', () => {
    const odd = documentFacts(
      {
        id: 'D4',
        name: 'd.md',
        content: 'z',
        provenance: { kind: 'url', url: 'javascript:alert(1)' },
      },
      3,
    );
    expect(odd.host).toBeNull();
  });
});

describe('sampleNote', () => {
  const sample = { synthetic: true };
  const real = { synthetic: false };

  it('says the sources are synthetic samples when every one is, and that some are when some are', () => {
    expect(sampleNote([sample, sample])).toBe('Synthetic samples');
    expect(sampleNote([sample, real])).toBe('Includes synthetic samples');
    expect(sampleNote([real, sample, real])).toBe('Includes synthetic samples');
  });

  it('says nothing for real sources, or for none', () => {
    expect(sampleNote([real, real])).toBeNull();
    expect(sampleNote([])).toBeNull();
  });
});

describe('elapsed time', () => {
  const now = Date.parse('2026-01-01T00:01:05.000Z');
  it('counts seconds from the engine’s own start, and refuses a clock that disagrees', () => {
    expect(elapsedSeconds('2026-01-01T00:00:00.000Z', now)).toBe(65);
    expect(elapsedSeconds('2026-01-01T00:05:00.000Z', now)).toBeNull();
    expect(elapsedSeconds(null, now)).toBeNull();
    expect(elapsedText(65)).toBe('1 min 05 s');
    expect(elapsedText(9)).toBe('9 s');
  });
});

describe('describeSearch', () => {
  it('counts a short answer, which is every passage that matches', () => {
    expect(describeSearch(1, 'delivery')).toBe('1 match for “delivery”');
    expect(describeSearch(SEARCH_LIMIT - 1, 'delivery')).toBe(
      `${SEARCH_LIMIT - 1} matches for “delivery”`,
    );
  });

  it('says it is the best of them when the answer is as long as the server gives, and does not count what it has not seen', () => {
    const said = describeSearch(SEARCH_LIMIT, 'delivery');
    expect(said).toBe(`The best ${SEARCH_LIMIT} matches for “delivery”. There may be more.`);
    expect(said).not.toMatch(/\b(of|out of|total)\b/u);
    expect(describeSearch(SEARCH_LIMIT + 3, 'delivery')).toContain('There may be more.');
  });

  it('says there is none, not zero matches', () => {
    expect(describeSearch(0, 'delivery')).toBe('No match for “delivery”');
  });
});
