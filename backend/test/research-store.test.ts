import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_RESEARCH_BUDGET,
  MAX_RESEARCH_PASSAGES,
  type ResearchRun,
  type ResearchSource,
} from '../../shared/research.js';
import { MAX_ARTIFACT_BYTES } from '../../shared/artifacts.js';
import { MAX_DOCUMENTS, MAX_TOTAL_CHARS, createProjectSchema } from '../../shared/types.js';
import { AppError } from '../src/errors.js';
import { hashText } from '../src/grounding/ledger.js';
import { PARSER_VERSION } from '../src/knowledge/retrieval.js';
import {
  MAX_EVENTS,
  MAX_SOURCES,
  ResearchStore,
  RunRecorder,
  capSources,
  isLive,
  newRun,
} from '../src/research/store.js';
import { jobLease } from '../src/storage/jobs.js';
import { Repository, type AddedDocument } from '../src/storage/repository.js';
import { fixtureInput } from './fixtures.js';
import { pageOf } from './support/research-synthetic.js';

const AT = '2026-06-01T09:00:00.000Z';

let repository: Repository;
let store: ResearchStore;
beforeAll(() => {
  repository = new Repository(':memory:');
  store = new ResearchStore(repository);
});
afterAll(() => repository.close());

/** A project as the Ask scene makes it: a question and no source. */
const questionOnly = (name = 'Question only'): string =>
  repository.create(
    fixtureInput({ name, workflow: 'guided', documents: [], research: { auto: true } }),
  ).id;

const aRun = (sequence = 1, changes: Partial<ResearchRun> = {}): ResearchRun => ({
  ...newRun({
    sequence,
    mode: 'discovery',
    intake: { auto: true },
    budget: DEFAULT_RESEARCH_BUDGET,
    discovery: { available: false, provider: null, message: 'No search provider is set up.' },
    at: AT,
  }),
  ...changes,
});

const sourceRecord = (number: number, changes: Partial<ResearchSource> = {}): ResearchSource =>
  pageOf(number, ['Text of the page.'], changes).source;

/** What an action threw, as its code and status, or an empty object when it threw nothing. */
const thrown = (action: () => unknown): Partial<Pick<AppError, 'code' | 'statusCode'>> => {
  try {
    action();
  } catch (error) {
    return error instanceof AppError
      ? { code: error.code, statusCode: error.statusCode }
      : { code: `not an AppError: ${String(error)}` };
  }
  return {};
};

const addition = (number: number, extra: Partial<AddedDocument> = {}): AddedDocument => ({
  name: `page-${number}.txt`,
  content:
    `Source number ${number} says that the berthing fee for coastal vessels is set once a year. `.repeat(
      3,
    ),
  provenance: {
    kind: 'url',
    url: `https://site${number}.example.org/fees?canary=secret-title-${number}`,
    title: `A title with canary ${number}`,
    fetchedByServer: true,
  },
  ...extra,
});

describe('research runs in storage', () => {
  it('are artifacts of their project, newest first, and only the newest that is live counts as live', () => {
    const projectId = questionOnly();
    expect(store.latest(projectId)).toBeNull();
    expect(store.count(projectId)).toBe(0);
    const first = store.create(projectId, aRun(1));
    expect(first.revision).toBe(1);
    expect(store.live(projectId)?.data.id).toBe(first.data.id);
    store.save(projectId, { ...first.data, status: 'completed' }, first.revision);
    expect(store.live(projectId)).toBeNull();
    expect(store.latest(projectId)?.data.id).toBe(first.data.id);
    const second = store.create(projectId, aRun(2));
    expect(store.latest(projectId)?.data.id).toBe(second.data.id);
    expect(store.live(projectId)?.data.id).toBe(second.data.id);
    expect(store.count(projectId)).toBe(2);
    expect(store.get(projectId, first.data.id)?.data.status).toBe('completed');
    expect(store.get(projectId, 'rr-9999-nothing')).toBeNull();
    expect(isLive({ status: 'paused' })).toBe(true);
    expect(isLive({ status: 'blocked' })).toBe(false);
  });

  it('refuse a write that is not from the revision last seen, so that two drivers cannot both win', () => {
    const projectId = questionOnly();
    const created = store.create(projectId, aRun(1));
    expect(thrown(() => store.create(projectId, created.data))).toMatchObject({
      code: 'ARTIFACT_CONFLICT',
    });
    const one = new RunRecorder(store, projectId, created, () => new Date(AT));
    const other = new RunRecorder(store, projectId, created, () => new Date(AT));
    one.reach('reading', 'Reading pages.');
    expect(thrown(() => other.reach('extracting-evidence'))).toMatchObject({
      code: 'ARTIFACT_CONFLICT',
    });
    // What the loser tried to write is not there: the record is a state the winner left.
    expect(store.latest(projectId)?.data.stage).toBe('reading');
  });

  it('are written whole by a recorder: each change moves the revision, the stage and the time', () => {
    const projectId = questionOnly();
    let now = Date.parse(AT);
    const recorder = new RunRecorder(
      store,
      projectId,
      store.create(projectId, aRun(1)),
      () => new Date((now += 1_000)),
    );
    expect(recorder.stored).toBe(1);
    recorder.reach('finding-sources', 'Looking for sources.');
    recorder.event('warn', 'x'.repeat(400));
    const run = recorder.update((current) => ({ ...current, status: 'running' }));
    expect(recorder.stored).toBe(4);
    expect(run).toMatchObject({ status: 'running', stage: 'finding-sources' });
    expect(run.events.map((event) => [event.stage, event.level])).toEqual([
      ['finding-sources', 'info'],
      ['finding-sources', 'warn'],
    ]);
    expect(run.events[1]?.message).toHaveLength(240);
    expect(Date.parse(run.updatedAt)).toBeGreaterThan(Date.parse(run.startedAt));
    expect(store.latest(projectId)?.data).toEqual(run);

    // A record written by the caller in a transaction of its own is taken up, and the next write goes from it.
    const record = store.save(projectId, { ...run, stage: 'checking-conflicts' }, recorder.stored);
    recorder.adopt(record);
    expect(recorder.stored).toBe(record.revision);
    expect(recorder.reach('ready').stage).toBe('ready');
  });

  it('hold the largest record the schema allows, which is far from the size an artifact is limited to', () => {
    const projectId = questionOnly();
    const long = (prefix: string) => `${prefix}${'a'.repeat(2_048 - prefix.length)}`;
    const sources = Array.from({ length: MAX_SOURCES }, (_, index) =>
      sourceRecord(index + 1, {
        requestedUrl: long('https://a.example.org/'),
        finalUrl: long('https://b.example.org/'),
        canonicalUrl: long('https://c.example.org/'),
        parentUrl: long('https://d.example.org/'),
        title: 'T'.repeat(300),
        relevance: 'R'.repeat(300),
        warnings: Array.from({ length: 8 }, () => 'W'.repeat(240)),
        outcome: 'used',
        documentId: 'D1',
        passageCount: 5,
      }),
    );
    const passages = Object.fromEntries(
      Array.from({ length: MAX_RESEARCH_PASSAGES }, (_, index) => [
        `S${index + 1}`,
        {
          sourceId: sources[0]?.id ?? 'rs-0000000001',
          headingPath: Array.from({ length: 6 }, () => 'H'.repeat(160)),
          kind: 'paragraph' as const,
        },
      ]),
    );
    const events = Array.from({ length: MAX_EVENTS }, () => ({
      at: AT,
      stage: 'reading' as const,
      level: 'info' as const,
      message: 'M'.repeat(240),
    }));
    const record = store.create(projectId, aRun(1, { sources, passages, events }));
    expect(record.data.sources).toHaveLength(MAX_SOURCES);
    const bytes = Buffer.byteLength(JSON.stringify(record.data), 'utf8');
    expect(bytes).toBeGreaterThan(1_000_000);
    expect(bytes).toBeLessThan(MAX_ARTIFACT_BYTES);
  });

  it('hold no more than the record can: the sources that matter most, in order, and the newest events', () => {
    const projectId = questionOnly();
    const outcomes = [
      'skipped',
      'duplicate',
      'failed',
      'blocked',
      'quarantined',
      'read',
      'used',
    ] as const;
    const sources = Array.from({ length: 100 }, (_, index) =>
      sourceRecord(index + 1, { outcome: outcomes[index % outcomes.length] ?? 'read' }),
    );
    const capped = capSources(sources);
    expect(capped).toHaveLength(MAX_SOURCES);
    expect(capped.filter((source) => source.outcome === 'used')).toHaveLength(
      sources.filter((source) => source.outcome === 'used').length,
    );
    expect(capped.map((source) => source.id)).toEqual(
      sources.filter((source) => capped.includes(source)).map((source) => source.id),
    );
    expect(capSources(sources.slice(0, 5))).toEqual(sources.slice(0, 5));

    const events = Array.from({ length: MAX_EVENTS + 20 }, (_, index) => ({
      at: AT,
      stage: 'reading' as const,
      level: 'info' as const,
      message: `Event ${index}`,
    }));
    const record = store.create(projectId, aRun(1, { sources, events }));
    expect(record.data.sources).toHaveLength(MAX_SOURCES);
    expect(record.data.events).toHaveLength(MAX_EVENTS);
    expect(record.data.events.at(-1)?.message).toBe(`Event ${MAX_EVENTS + 19}`);
    expect(record.data.events[0]?.message).toBe('Event 20');
  });

  it('are listed, every one that is not finished and no other, for the work done when the server starts', () => {
    const [a, b, c] = [questionOnly('List A'), questionOnly('List B'), questionOnly('List C')] as [
      string,
      string,
      string,
    ];
    const queued = store.create(a, aRun(1));
    store.create(b, aRun(1, { status: 'running' }));
    const finished = store.create(c, aRun(1, { status: 'running' }));
    store.save(c, { ...finished.data, status: 'failed' }, finished.revision);
    const live = store.liveRuns().filter((record) => [a, b, c].includes(record.projectId));
    expect(live.map((record) => [record.projectId, record.data.status]).sort()).toEqual(
      [
        [a, 'queued'],
        [b, 'running'],
      ].sort(),
    );
    expect(live.find((record) => record.projectId === a)?.data.id).toBe(queued.data.id);
  });

  it('are deleted with their project', () => {
    const projectId = questionOnly();
    store.create(projectId, aRun(1));
    repository.delete(projectId);
    expect(store.liveRuns().some((record) => record.projectId === projectId)).toBe(false);
    expect(store.count(projectId)).toBe(0);
  });

  it('are written for a job only while the job holds its lease', () => {
    const projectId = questionOnly();
    const record = store.create(projectId, aRun(1));
    const { job } = repository.jobs.enqueue({
      id: randomUUID(),
      projectId,
      kind: 'knowledge',
      idempotencyKey: 'lease-test',
    });
    expect(repository.jobs.claim('worker-a', 60_000)?.id).toBe(job.id);
    const under = (owner: string, action: () => unknown) =>
      jobLease.run({ jobId: job.id, owner }, () => thrown(action));

    const mine = under('worker-a', () =>
      store.save(projectId, { ...record.data, stage: 'reading' }, record.revision),
    );
    expect(mine).toEqual({});
    expect(store.latest(projectId)?.data.stage).toBe('reading');

    const latest = store.latest(projectId);
    expect(
      under('worker-b', () =>
        store.save(
          projectId,
          { ...record.data, stage: 'checking-conflicts' },
          latest?.revision ?? 0,
        ),
      ),
    ).toMatchObject({ code: 'LEASE_LOST' });
    expect(repository.jobs.complete(job.id, 'worker-a')).toBe(true);
    expect(
      under('worker-a', () =>
        store.save(
          projectId,
          { ...record.data, stage: 'checking-conflicts' },
          latest?.revision ?? 0,
        ),
      ),
    ).toMatchObject({ code: 'LEASE_LOST' });
    expect(store.latest(projectId)?.data.stage).toBe('reading');
  });
});

describe('adding sources to a project that exists', () => {
  it('numbers sources and passages on from the project’s own and leaves what is written as it was', () => {
    const created = repository.create(fixtureInput());
    const before = repository.chunks(created.id);
    expect(before.length).toBeGreaterThan(0);

    const added = repository.appendDocuments(created.id, [addition(1), addition(2)]);
    expect(added.documents.map((document) => document.id)).toEqual(['D2', 'D3']);
    expect(added.chunks[0]?.id).toBe(`S${before.length + 1}`);
    expect(added.chunks.map((chunk) => chunk.id)).toEqual(
      added.chunks.map((_chunk, index) => `S${before.length + index + 1}`),
    );
    const after = repository.chunks(created.id);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual(added.chunks);
    expect(repository.get(created.id).documents.map((document) => document.id)).toEqual([
      'D1',
      'D2',
      'D3',
    ]);
    expect(repository.get(created.id).documents[1]?.provenance?.title).toBe(
      'A title with canary 1',
    );
  });

  it('records on every new passage what it said, when it was cut and that nobody has reviewed it', () => {
    const projectId = questionOnly();
    const { chunks, documents } = repository.appendDocuments(projectId, [addition(3)]);
    expect(documents[0]?.id).toBe('D1');
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk).toMatchObject({
        documentId: 'D1',
        contentHash: hashText(chunk.text),
        parserVersion: PARSER_VERSION,
        reviewStatus: 'unreviewed',
      });
      expect(Number.isNaN(Date.parse(chunk.extractedAt ?? ''))).toBe(false);
    }
    expect(chunks[0]?.id).toBe('S1');
    expect(repository.chunks(projectId)).toEqual(chunks);
  });

  it('writes a line to the project’s log and an audit entry that hold counts and nothing of the sources', () => {
    const projectId = questionOnly();
    const { chunks } = repository.appendDocuments(projectId, [addition(4), addition(5)], {
      actor: 'system',
    });
    const messages = repository.get(projectId).events.map((event) => event.message);
    expect(messages).toContain('The question was saved. Sources are added by research, or by you.');
    expect(messages).toContain(
      `2 sources added from research and indexed as ${chunks.length} passages.`,
    );
    const entries = repository.audit.list({ projectId, limit: 50 });
    const entry = entries.find((candidate) => candidate.action === 'research.documents.added');
    expect(entry).toMatchObject({
      actor: 'system',
      detail: { documents: 2, passages: chunks.length },
    });
    const everything = JSON.stringify(entries);
    for (const canary of [
      'secret-title',
      'A title with canary',
      'site4.example.org',
      'Source number',
    ]) {
      expect(everything, canary).not.toContain(canary);
    }
  });

  it('adds nothing, and records nothing, when there is nothing to add', () => {
    const projectId = questionOnly();
    const entries = repository.audit.list({ projectId, limit: 50 }).length;
    expect(repository.appendDocuments(projectId, [])).toEqual({ documents: [], chunks: [] });
    expect(repository.audit.list({ projectId, limit: 50 })).toHaveLength(entries);
  });

  it('refuses more than the project may hold, and writes nothing when it refuses', () => {
    const projectId = questionOnly();
    repository.appendDocuments(projectId, [addition(6)]);
    const state = () => ({
      documents: repository.get(projectId).documents.length,
      chunks: repository.chunks(projectId).length,
      events: repository.get(projectId).events.length,
    });
    const held = state();

    const tooMany = Array.from({ length: MAX_DOCUMENTS }, (_, index) => addition(10 + index));
    expect(thrown(() => repository.appendDocuments(projectId, tooMany))).toEqual({
      code: 'DOCUMENT_LIMIT',
      statusCode: 409,
    });
    const huge = (number: number): AddedDocument => ({
      name: `huge-${number}.txt`,
      content: `Line ${number}. `.padEnd(40_000, 'x'),
    });
    expect(MAX_TOTAL_CHARS).toBeLessThan(6 * 40_000);
    expect(
      thrown(() => repository.appendDocuments(projectId, [1, 2, 3, 4, 5, 6].map(huge))),
    ).toEqual({ code: 'SOURCE_SIZE_LIMIT', statusCode: 409 });
    expect(state()).toEqual(held);
  });

  it('refuses a source that is not a document, and takes none of the others that came with it', () => {
    const projectId = questionOnly();
    const before = {
      documents: repository.get(projectId).documents.length,
      chunks: repository.chunks(projectId).length,
    };
    for (const bad of [
      addition(7, { name: 'no-extension' }),
      addition(7, { name: 'a/b.txt' }),
      addition(7, { content: 'Too short to be a source.' }),
      addition(7, { content: `${'A line of text that is long enough. '.repeat(4)}\u0000` }),
      addition(7, { content: 'x'.repeat(40_001) }),
    ]) {
      expect(thrown(() => repository.appendDocuments(projectId, [addition(8), bad]))).toEqual({
        code: 'DOCUMENT_INVALID',
        statusCode: 422,
      });
    }
    expect({
      documents: repository.get(projectId).documents.length,
      chunks: repository.chunks(projectId).length,
    }).toEqual(before);
  });

  it('joins the transaction of the caller, so that its failure takes the sources back with it', () => {
    const projectId = questionOnly();
    expect(() =>
      repository.atomic(() => {
        repository.appendDocuments(projectId, [addition(9)]);
        expect(repository.get(projectId).documents).toHaveLength(1);
        throw new Error('The rest of the transaction failed.');
      }),
    ).toThrow('The rest of the transaction failed.');
    expect(repository.get(projectId).documents).toHaveLength(0);
    expect(repository.chunks(projectId)).toEqual([]);
    const events = repository.get(projectId).events.map((event) => event.message);
    expect(events.some((message) => message.includes('added from research'))).toBe(false);
  });

  it('is refused to a job that lost its lease, and writes nothing', () => {
    const projectId = questionOnly();
    const { job } = repository.jobs.enqueue({
      id: randomUUID(),
      projectId,
      kind: 'knowledge',
      idempotencyKey: 'append-lease',
    });
    expect(repository.jobs.claim('worker-c', 60_000)?.id).toBe(job.id);
    expect(repository.jobs.complete(job.id, 'worker-c')).toBe(true);
    const stale = jobLease.run({ jobId: job.id, owner: 'worker-c' }, () =>
      thrown(() => repository.appendDocuments(projectId, [addition(12)])),
    );
    expect(stale).toMatchObject({ code: 'LEASE_LOST' });
    expect(repository.get(projectId).documents).toHaveLength(0);
    expect(repository.chunks(projectId)).toEqual([]);
  });

  it('works on the project it is given alone: another project, of another workspace, is as it was', () => {
    const mine = questionOnly('Mine');
    const theirs = repository.create(fixtureInput({ name: 'Theirs' }), {
      owner: { tenantId: `tenant-${randomUUID()}`, ownerId: 'someone-else' },
    });
    const theirChunks = repository.chunks(theirs.id);
    repository.appendDocuments(mine, [addition(13)]);
    expect(repository.get(theirs.id).documents).toEqual(theirs.documents);
    expect(repository.chunks(theirs.id)).toEqual(theirChunks);
    expect(thrown(() => repository.appendDocuments(randomUUID(), [addition(14)]))).toEqual({
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  });
});

describe('a project made from a question alone', () => {
  const body = (changes: Record<string, unknown>) => ({
    name: 'Berthing fees',
    question: 'What if the harbour authority raises berthing fees for coastal vessels?',
    workflow: 'guided',
    documents: [],
    ...changes,
  });

  it('needs automatic research to be asked for, and is refused as before otherwise', () => {
    expect(createProjectSchema.safeParse(body({ research: { auto: true } })).success).toBe(true);
    // Automatic research is the default for a person who gives an intake at all.
    expect(createProjectSchema.safeParse(body({ research: { guidance: 'EU only' } })).success).toBe(
      true,
    );
    for (const changes of [{}, { research: { auto: false } }]) {
      const refused = createProjectSchema.safeParse(body(changes));
      expect(refused.success).toBe(false);
      expect(refused.error?.issues).toMatchObject([
        { path: ['documents'], message: 'Too small: expected array to have >=1 items' },
      ]);
    }
  });

  it('needs the guided workflow, because that is where research finds the sources', () => {
    for (const workflow of [undefined, 'quick']) {
      const refused = createProjectSchema.safeParse(
        body({ research: { auto: true }, ...(workflow ? { workflow } : { workflow: undefined }) }),
      );
      expect(refused.success).toBe(false);
      expect(refused.error?.issues).toMatchObject([
        {
          path: ['workflow'],
          message:
            'A question with no source needs the guided workflow, where research finds sources.',
        },
      ]);
    }
    // A quick run that comes with a source is what it always was.
    expect(
      createProjectSchema.safeParse(
        body({
          workflow: 'quick',
          documents: [{ name: 'notes.txt', content: 'A source of the person’s own, '.repeat(6) }],
        }),
      ).success,
    ).toBe(true);
  });

  it('is stored with no source and no passage, and says in its log that research or a person adds them', () => {
    const created = repository.create(
      fixtureInput({ workflow: 'guided', documents: [], research: { auto: true } }),
    );
    expect(created.documents).toEqual([]);
    expect(repository.chunks(created.id)).toEqual([]);
    expect(created.status).toBe('draft');
    expect(created.events.map((event) => event.message)).toContain(
      'The question was saved. Sources are added by research, or by you.',
    );
  });

  it('keeps the limit on documents that it always had, for a question that comes with sources', () => {
    const eleven = Array.from({ length: MAX_DOCUMENTS + 1 }, (_, index) => ({
      name: `d${index}.txt`,
      content: `Source ${index}. `.repeat(10),
    }));
    expect(
      createProjectSchema.safeParse(body({ documents: eleven, research: { auto: true } })).success,
    ).toBe(false);
  });
});
