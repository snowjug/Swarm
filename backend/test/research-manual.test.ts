import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ResearchView } from '../../shared/research.js';
import {
  MAX_DOCUMENT_CHARS,
  MAX_DOCUMENTS,
  MAX_TOTAL_CHARS,
  type ProjectDetail,
} from '../../shared/types.js';
import { AppError } from '../src/errors.js';
import { hashText } from '../src/grounding/ledger.js';
import { failStage } from '../src/guided/state.js';
import { fixtureInput } from './fixtures.js';
import { HARBOUR, QUESTION, researchApp, type ResearchApp } from './support/research-app.js';

const failure = (response: { json(): unknown }) =>
  (response.json() as { error: { code: string; message: string } }).error;

const LINE =
  'The harbour board reviews the berthing fee each spring, and coastal vessels pay by the metre of hull. ';

/** Text that is `characters` long, as a source is: it reads as sentences, and neither starts nor ends with a space. */
const text = (characters: number): string =>
  `${LINE.repeat(Math.ceil(characters / LINE.length)).slice(0, characters - 1)}.`;

/** A source of a person's own: long enough to be one, and told from the others by its number. */
const note = (number: number, extra: Record<string, unknown> = {}) => ({
  name: `notes-${number}.txt`,
  content: `Note ${number}: ${text(120)}`,
  ...extra,
});

/** Adds sources to a project, as the page does. */
const add = (
  app: ResearchApp,
  id: string,
  documents: unknown,
  headers: Record<string, string> = {},
) =>
  app.app.inject({
    method: 'POST',
    url: `/api/projects/${id}/evidence/documents`,
    headers,
    payload: { documents } as object,
  });

/** A project that research could find no source for: the question, a run that is blocked, and nothing else. */
async function blocked(app: ResearchApp): Promise<string> {
  const id = await app.create();
  await app.post(id, '', {});
  await app.settle();
  expect(app.run(id)).toMatchObject({
    status: 'blocked',
    stoppedBecause: 'discovery-unconfigured',
  });
  return id;
}

/** What a project holds, to show that a request that was refused changed nothing at all. */
const held = (app: ResearchApp, id: string) => {
  const project = app.repository.get(id);
  return {
    status: project.status,
    knowledge: project.console?.steps.knowledge,
    documents: project.documents,
    chunks: app.repository.chunks(id),
    events: project.events.length,
    jobs: app.repository.jobs.recent(id).length,
    audit: app.actions(id),
  };
};

/** What a request would have added to a project, for one that may be refused while work on it goes on. */
const contents = (app: ResearchApp, id: string) => ({
  documents: app.repository.get(id).documents,
  chunks: app.repository.chunks(id),
  added: app.actions(id).filter((action) => action === 'evidence.documents.added').length,
});

const COUNCIL =
  'Annual ferry ridership reached 412,000 passengers in 2024 according to the island council. ' +
  'The council supports the electric ferry plan for the island route this winter.';
const OPERATOR =
  'Annual ferry ridership was 365,000 passengers in 2024 according to the ferry operator. ' +
  'The operator reports it will deliver the island route plan with the current diesel vessel.';

describe('text a person adds to a question that research found no source for', () => {
  it('is added, queues the stage that grounds the project, and leaves the project ready, with research as it was', async () => {
    const app = await researchApp();
    const id = await blocked(app);
    const before = app.run(id);
    const revision = (await app.view(id)).revision;
    expect(app.repository.get(id)).toMatchObject({ status: 'draft', documents: [] });
    expect(app.repository.get(id).console?.steps.knowledge).toBe('pending');

    const response = await add(app, id, [note(1, { provenance: { kind: 'paste' } })]);
    expect(response.statusCode, response.body).toBe(202);
    // The answer is the project, as it is for a stage that was started.
    const queued = response.json<ProjectDetail>();
    expect(queued).toMatchObject({ id, status: 'queued' });
    expect(queued.console?.steps.knowledge).toBe('queued');
    expect(queued.documents.map((document) => document.id)).toEqual(['D1']);

    await app.settle();
    const project = app.repository.get(id);
    expect(project).toMatchObject({ status: 'ready', error: null });
    expect(project.console?.steps.knowledge).toBe('ready');
    expect(project.documents).toEqual([
      {
        id: 'D1',
        name: 'notes-1.txt',
        content: note(1).content,
        provenance: { kind: 'paste' },
      },
    ]);
    const chunks = app.repository.chunks(id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map((chunk) => chunk.id)).toEqual(chunks.map((_chunk, index) => `S${index + 1}`));
    for (const chunk of chunks) {
      expect(chunk).toMatchObject({
        documentId: 'D1',
        contentHash: hashText(chunk.text),
        reviewStatus: 'unreviewed',
      });
    }

    // Research did not read it, plan from it or change its run, and nothing was asked of the web.
    expect(app.run(id)).toEqual(before);
    expect(app.research.store.count(id)).toBe(1);
    expect((await app.view(id)).revision).toBe(revision);
    expect(app.network.calls).toEqual([]);

    // The log says who added it, and the audit trail what was added, in counts only.
    const passages = `${chunks.length} passage${chunks.length === 1 ? '' : 's'}`;
    expect(project.events.map((event) => event.message)).toContain(
      `1 source added by a person and indexed as ${passages}.`,
    );
    expect(app.actions(id)).toEqual([
      'project.created',
      'research.started',
      'research.ended',
      'evidence.documents.added',
    ]);
    const entry = app.repository.audit
      .list({ projectId: id, limit: 50 })
      .find((candidate) => candidate.action === 'evidence.documents.added');
    expect(entry).toMatchObject({ targetType: 'project', targetId: id });
    expect(entry?.detail).toEqual({
      documents: 1,
      passages: chunks.length,
      characters: project.documents[0]?.content.length,
    });
    expect(JSON.stringify(app.repository.audit.list({ projectId: id, limit: 50 }))).not.toContain(
      'notes-1',
    );
    // And it is over: there is nothing left to start, add to or stop.
    expect((await app.view(id)).may).toEqual({ start: false, pause: false, cancel: false });
  });

  it('does as much for a project that research was never run for', async () => {
    const app = await researchApp();
    const id = await app.create();
    expect(app.run(id)).toBeNull();
    const response = await add(app, id, [note(1), note(2, { provenance: { kind: 'upload' } })]);
    expect(response.statusCode, response.body).toBe(202);
    await app.settle();
    expect(app.repository.get(id)).toMatchObject({ status: 'ready' });
    expect(app.repository.get(id).documents.map((document) => document.id)).toEqual(['D1', 'D2']);
    expect(app.run(id)).toBeNull();
    expect(app.research.store.count(id)).toBe(0);
    expect(app.network.calls).toEqual([]);
  });

  it('is not research: it works as well on a server where research is turned off', async () => {
    const app = await researchApp({ environment: { RESEARCH_ENABLED: 'off' } });
    const id = await app.create();
    const response = await add(app, id, [note(1)]);
    expect(response.statusCode, response.body).toBe(202);
    await app.settle();
    expect(app.repository.get(id)).toMatchObject({ status: 'ready' });
    expect(app.run(id)).toBeNull();
    expect((await app.view(id)).run).toBeNull();
    expect(app.network.calls).toEqual([]);
  });

  it.each([
    ['cancelled', new AppError(409, 'RUN_CANCELLED', 'Cancelled before processing started.')],
    ['failed', new AppError(500, 'KNOWLEDGE_FAILED', 'The stage failed.')],
  ] as const)('goes on from a stage that was %s, with more text', async (ended, error) => {
    const app = await researchApp();
    const id = await app.create();
    expect((await add(app, id, [note(1)])).statusCode).toBe(202);
    await app.settle();
    // As a stage that did not complete leaves the project, with the sources it had.
    failStage(app.repository, id, 'knowledge', error);
    app.repository.update(id, { status: ended, error: error.message });
    expect(app.repository.get(id).console?.steps.knowledge).toBe(ended);

    const more = await add(app, id, [note(2)]);
    expect(more.statusCode, more.body).toBe(202);
    await app.settle();
    expect(app.repository.get(id)).toMatchObject({ status: 'ready', error: null });
    expect(app.repository.get(id).documents.map((document) => document.id)).toEqual(['D1', 'D2']);
    expect(new Set(app.repository.chunks(id).map((chunk) => chunk.documentId))).toEqual(
      new Set(['D1', 'D2']),
    );
  });

  it('keeps the passages that were written as they were, and numbers the new ones on from them', async () => {
    const app = await researchApp();
    const id = await app.create(QUESTION, { documents: [note(1), note(2)] });
    const before = app.repository.chunks(id);
    expect(before.length).toBeGreaterThan(0);
    expect((await add(app, id, [note(3)])).statusCode).toBe(202);
    await app.settle();
    const after = app.repository.chunks(id);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length).map((chunk) => chunk.id)).toEqual(
      after.slice(before.length).map((_chunk, index) => `S${before.length + index + 1}`),
    );
    expect(after.slice(before.length).every((chunk) => chunk.documentId === 'D3')).toBe(true);
  });

  it('lets a ledger that was built before the text was added learn of the conflicts it brings', async () => {
    const app = await researchApp();
    const id = await app.create(QUESTION, {
      documents: [{ name: 'council-note.md', content: COUNCIL }],
    });
    expect((await app.app.inject({ url: `/api/projects/${id}/ledger` })).statusCode).toBe(200);
    expect(app.repository.ledger.state(id)).not.toBeNull();
    expect(app.repository.ledger.contradictions(id)).toEqual([]);

    const response = await add(app, id, [{ name: 'operator-memo.md', content: OPERATOR }]);
    expect(response.statusCode, response.body).toBe(202);
    expect(app.repository.ledger.contradictions(id)).toMatchObject([
      { id: 'X1', kind: 'numeric', status: 'detected' },
    ]);
    const found = app.repository.audit
      .list({ projectId: id, limit: 50 })
      .filter((entry) => entry.action === 'ledger.conflicts.found');
    expect(found.map((entry) => entry.detail)).toEqual([{ added: 1, conflicts: 1 }]);
    await app.settle();
    expect(app.repository.get(id)).toMatchObject({ status: 'ready' });
  });
});

describe('what a person says about where their text came from', () => {
  it('is kept as they said it for pasted text and a file, left out when they said nothing, and never a claim that the server fetched it', async () => {
    const app = await researchApp();
    const id = await app.create();
    const response = await add(app, id, [
      note(1),
      note(2, { provenance: { kind: 'paste' } }),
      note(3, {
        pageCount: 3,
        provenance: {
          kind: 'upload',
          title: 'Board minutes',
          license: 'Internal',
          asOf: '2026-03-01',
        },
      }),
      // What is not a document's own to say is dropped, as it is when a project is made.
      note(4, { id: 'D99', reviewStatus: 'accepted', chunks: [{ id: 'S1' }], admin: true }),
    ]);
    expect(response.statusCode, response.body).toBe(202);
    const documents = app.repository.get(id).documents;
    expect(documents.map((document) => document.id)).toEqual(['D1', 'D2', 'D3', 'D4']);
    expect('provenance' in documents[0]!).toBe(false);
    expect(documents[1]?.provenance).toEqual({ kind: 'paste' });
    expect(documents[2]).toMatchObject({
      pageCount: 3,
      provenance: {
        kind: 'upload',
        title: 'Board minutes',
        license: 'Internal',
        asOf: '2026-03-01',
      },
    });
    expect(Object.keys(documents[3]!).sort()).toEqual(['content', 'id', 'name']);
    expect(JSON.stringify(documents)).not.toContain('fetchedByServer');
    expect(app.repository.chunks(id).every((chunk) => chunk.reviewStatus === 'unreviewed')).toBe(
      true,
    );
  });

  const PROVENANCE: [string, unknown][] = [
    ['a claim that the server fetched it', { kind: 'paste', fetchedByServer: true }],
    ['a denial of it', { kind: 'paste', fetchedByServer: false }],
    ['a page', { kind: 'url', url: `${HARBOUR}/`, fetchedByServer: true }],
    ['an address on pasted text', { kind: 'paste', url: `${HARBOUR}/` }],
    ['an address after a redirect', { kind: 'upload', finalUrl: `${HARBOUR}/` }],
    ['a hash', { kind: 'paste', sha256: 'a'.repeat(64) }],
    ['a time of retrieval', { kind: 'upload', retrievedAt: '2026-01-01T00:00:00.000Z' }],
    ['a kind of content', { kind: 'upload', contentType: 'text/html' }],
    ['a kind that is a sample', { kind: 'sample' }],
    ['a kind that is a historical record', { kind: 'historical' }],
    ['a kind that does not exist', { kind: 'wiki' }],
    ['no kind', { title: 'Minutes' }],
    ['nothing', null],
    ['a date that is not one', { kind: 'paste', asOf: 'last spring' }],
    ['a title that is too long', { kind: 'paste', title: 't'.repeat(301) }],
  ];

  it.each(PROVENANCE)('refuses %s, and adds nothing', async (_what, provenance) => {
    const app = await researchApp();
    const id = await app.create();
    const before = held(app, id);
    const response = await add(app, id, [note(1), note(2, { provenance })]);
    expect(response.statusCode, response.body).toBe(400);
    expect(failure(response).code).toBe('INVALID_INPUT');
    expect(held(app, id)).toEqual(before);
  });
});

describe('text that is hostile', () => {
  const documentsWith = (change: Record<string, unknown>) => ({
    documents: [note(1), note(2, change)],
  });
  const REFUSED: [string, unknown][] = [
    ['no documents', { documents: [] }],
    [
      `more than ${MAX_DOCUMENTS} at once`,
      { documents: Array.from({ length: MAX_DOCUMENTS + 1 }, (_, index) => note(index + 1)) },
    ],
    ['documents that are not a list', { documents: note(1) }],
    ['a document that is nothing', { documents: [null] }],
    ['a document that is only text', { documents: [text(200)] }],
    ['a key that the request does not have', { documents: [note(1)], fetchedByServer: true }],
    ['a list of them with no body around it', [note(1)]],
    ['a name that is a path', documentsWith({ name: '../../etc/passwd.txt' })],
    ['a name with a backslash', documentsWith({ name: 'notes\\one.txt' })],
    ['a name that is not a kind of file', documentsWith({ name: 'notes.exe' })],
    ['a name with a control character', documentsWith({ name: 'notes\u0000.txt' })],
    ['a name that is too long', documentsWith({ name: `${'a'.repeat(120)}.txt` })],
    ['no name', documentsWith({ name: undefined })],
    ['a name that is a number', documentsWith({ name: 5 })],
    ['text that is too short to be a source', documentsWith({ content: text(79) })],
    ['text that is not text', documentsWith({ content: 5 })],
    ['text that is a list', documentsWith({ content: [text(100)] })],
    [
      `text of more than ${MAX_DOCUMENT_CHARS.toLocaleString('en-GB')} characters`,
      documentsWith({ content: text(MAX_DOCUMENT_CHARS + 1) }),
    ],
    ['a null character', documentsWith({ content: `${text(100)}\u0000${text(100)}` })],
    ['an escape character', documentsWith({ content: `${text(100)}\u001b[31m${text(100)}` })],
    ['a bell', documentsWith({ content: `${text(100)}\u0007${text(100)}` })],
    ['a delete character', documentsWith({ content: `${text(100)}\u007f${text(100)}` })],
    ['a page count of nought', documentsWith({ pageCount: 0 })],
    ['a page count of forty-one', documentsWith({ pageCount: 41 })],
    ['a page count that is a fraction', documentsWith({ pageCount: 1.5 })],
    ['a page count that is text', documentsWith({ pageCount: '3' })],
  ];

  it.each(REFUSED)('refuses %s, and adds nothing', async (_what, body) => {
    const app = await researchApp();
    const id = await app.create();
    const before = held(app, id);
    const response = await app.app.inject({
      method: 'POST',
      url: `/api/projects/${id}/evidence/documents`,
      payload: body as object,
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(failure(response).code).toBe('INVALID_INPUT');
    expect(held(app, id)).toEqual(before);
  });

  it('refuses a request that is not a request, and adds nothing', async () => {
    const app = await researchApp();
    const id = await app.create();
    const before = held(app, id);
    const url = `/api/projects/${id}/evidence/documents`;
    const json = { 'content-type': 'application/json' };
    for (const [what, request] of [
      ['no body at all', { method: 'POST', url }],
      ['a body that is null', { method: 'POST', url, headers: json, payload: 'null' }],
      ['a body that is not JSON', { method: 'POST', url, headers: json, payload: '{"documents":' }],
      [
        'a key that would change what every object is',
        {
          method: 'POST',
          url,
          headers: json,
          payload: `{"documents":${JSON.stringify([note(1)])},"__proto__":{"admin":true}}`,
        },
      ],
      [
        'a body that is not JSON by its type',
        {
          method: 'POST',
          url,
          headers: { 'content-type': 'text/plain' },
          payload: JSON.stringify({ documents: [note(1)] }),
        },
      ],
    ] as const) {
      const response = await app.app.inject(request);
      expect([400, 415], `${what}: ${response.body}`).toContain(response.statusCode);
    }
    expect(held(app, id)).toEqual(before);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it('refuses what is too large before it reads it, and what a project cannot hold once it has', async () => {
    const app = await researchApp();
    const id = await app.create();
    const before = held(app, id);
    const huge = await add(app, id, [{ name: 'huge.txt', content: 'x'.repeat(700_000) }]);
    expect(huge.statusCode).toBe(413);
    // Ten sources of the most each may be are small enough for a request, and more than a project holds.
    const many = Array.from({ length: MAX_DOCUMENTS }, (_, index) => ({
      name: `big-${index + 1}.txt`,
      content: text(MAX_DOCUMENT_CHARS),
    }));
    expect(MAX_DOCUMENTS * MAX_DOCUMENT_CHARS).toBeGreaterThan(MAX_TOTAL_CHARS);
    const refused = await add(app, id, many);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(failure(refused).code).toBe('DOCUMENT_LIMIT');
    expect(held(app, id)).toEqual(before);
  });

  it('takes text in every script, with marks that change how it reads, and keeps it exactly as it was written', async () => {
    const app = await researchApp();
    const id = await app.create();
    const strange = [
      `Tab\there, a new line\nand a return\r\n and a mixed script: 港口费用 ${text(100)}`,
      `Right to left override \u202e and a zero width space \u200b and an emoji 😀 and a lone surrogate \ud800 ${text(100)}`,
    ].map((content, index) => ({ name: `strange-${index + 1}.md`, content }));
    const response = await add(app, id, strange);
    expect(response.statusCode, response.body).toBe(202);
    expect(app.repository.get(id).documents.map((document) => document.content)).toEqual(
      strange.map((document) => document.content),
    );
    await app.settle();
    expect(app.repository.get(id)).toMatchObject({ status: 'ready' });
  });

  it('does not repeat what a person typed, in a refusal, in the log or in the audit trail', async () => {
    const app = await researchApp();
    const id = await app.create();
    const canary = 'zq-canary-7733';
    const refused = await add(app, id, [
      note(1, { name: `${canary}.exe`, content: `${canary} ${text(100)}` }),
    ]);
    expect(refused.statusCode).toBe(400);
    expect(refused.body).not.toContain(canary);
    const accepted = await add(app, id, [
      note(2, {
        name: `${canary}.txt`,
        content: `${canary} ${text(100)}`,
        provenance: { kind: 'upload', title: `${canary} title`, license: `${canary} licence` },
      }),
    ]);
    expect(accepted.statusCode, accepted.body).toBe(202);
    await app.settle();
    const said = JSON.stringify([
      app.repository.audit.list({ projectId: id, limit: 100 }),
      app.repository.get(id).events,
    ]);
    expect(said).not.toContain(canary);
  });
});

describe('what a project can take', () => {
  it('refuses more sources than a project holds, as a conflict, and takes what fits after', async () => {
    const app = await researchApp();
    const start = Array.from({ length: MAX_DOCUMENTS - 2 }, (_, index) => note(index + 1));
    const id = await app.create(QUESTION, { documents: start });
    const before = held(app, id);

    const refused = await add(app, id, [note(11), note(12), note(13)]);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(failure(refused).code).toBe('DOCUMENT_LIMIT');
    expect(held(app, id)).toEqual(before);

    const fits = await add(app, id, [note(11), note(12)]);
    expect(fits.statusCode, fits.body).toBe(202);
    expect(app.repository.get(id).documents).toHaveLength(MAX_DOCUMENTS);
    await app.settle();
    expect(app.repository.get(id)).toMatchObject({ status: 'ready' });
  });

  it('refuses more characters than a project holds, to the character, and takes what fits after', async () => {
    const app = await researchApp();
    const four = Array.from({ length: 4 }, (_, index) => ({
      name: `big-${index + 1}.txt`,
      content: text(MAX_DOCUMENT_CHARS),
    }));
    const id = await app.create(QUESTION, { documents: four });
    const before = held(app, id);

    const over = await add(app, id, [
      { name: 'more.txt', content: text(MAX_DOCUMENT_CHARS) },
      { name: 'little.txt', content: text(80) },
    ]);
    expect(over.statusCode, over.body).toBe(409);
    expect(failure(over).code).toBe('DOCUMENT_LIMIT');
    expect(failure(over).message).toContain('200,000');
    expect(held(app, id)).toEqual(before);

    // Exactly as many characters as a project may hold is not too many.
    const exact = await add(app, id, [{ name: 'more.txt', content: text(MAX_DOCUMENT_CHARS) }]);
    expect(exact.statusCode, exact.body).toBe(202);
    expect(
      app.repository.get(id).documents.reduce((sum, document) => sum + document.content.length, 0),
    ).toBe(MAX_TOTAL_CHARS);
    await app.settle();
    expect(app.repository.get(id)).toMatchObject({ status: 'ready' });
  });
});

describe('when the stage cannot be queued', () => {
  it('takes the text back with it, so that the same request can be sent again', async () => {
    const app = await researchApp();
    const id = await app.create();
    const before = held(app, id);
    // Three runs are waiting, which is all the queue holds.
    const waiting = [1, 2, 3].map(
      (number) =>
        app.repository.jobs.enqueue({
          id: randomUUID(),
          projectId: app.repository.create(fixtureInput({ name: `Waiting ${number}` })).id,
          kind: 'knowledge',
          idempotencyKey: `waiting-${number}`,
        }).job.id,
    );

    const refused = await add(app, id, [note(1)]);
    expect(refused.statusCode, refused.body).toBe(429);
    expect(failure(refused).code).toBe('QUEUE_FULL');
    const after = held(app, id);
    expect(after.documents).toEqual(before.documents);
    expect(after.chunks).toEqual([]);
    expect(after.events).toBe(before.events);
    expect(after.audit).toEqual(before.audit);
    // Nothing of the attempt remains: not the sources, not a job, not the key that a retry would meet.
    expect(app.repository.jobs.recent(id)).toEqual([]);

    for (const job of waiting) app.repository.jobs.requestCancel(job);
    const again = await add(app, id, [note(1)]);
    expect(again.statusCode, again.body).toBe(202);
    expect(app.repository.get(id).documents).toHaveLength(1);
    expect(app.repository.jobs.recent(id)).toHaveLength(1);
    await app.settle();
    expect(app.repository.get(id)).toMatchObject({ status: 'ready' });
  });

  it('takes the text back with it when the model that the project needs is not set up', async () => {
    const app = await researchApp();
    const id = await app.create(QUESTION, {
      settings: { mode: 'llm', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
    });
    const before = held(app, id);
    const refused = await add(app, id, [note(1)]);
    expect(refused.statusCode, refused.body).toBe(503);
    expect(failure(refused).code).toBe('MODEL_NOT_CONFIGURED');
    expect(held(app, id)).toEqual(before);
  });
});

describe('text added to a project that cannot take it', () => {
  it('is refused while the stage that grounds the project is queued, running or done, and nothing is added', async () => {
    const app = await researchApp();
    const id = await app.create();
    expect((await add(app, id, [note(1)])).statusCode).toBe(202);
    const queued = contents(app, id);

    // The stage is queued, or has begun.
    const early = await add(app, id, [note(2)]);
    expect(early.statusCode, early.body).toBe(409);
    expect(failure(early).code).toBe('STEP_ALREADY_STARTED');
    expect(contents(app, id)).toEqual(queued);

    // And once it is done.
    await app.settle();
    expect(app.repository.get(id).console?.steps.knowledge).toBe('ready');
    const done = held(app, id);
    const late = await add(app, id, [note(2)]);
    expect(late.statusCode, late.body).toBe(409);
    expect(failure(late).code).toBe('STEP_ALREADY_STARTED');
    expect(held(app, id)).toEqual(done);
  });

  it('is refused while research is running, which is adding sources of its own', async () => {
    const app = await researchApp();
    const id = await app.create();
    expect((await app.post(id, '/sources', { url: 'harbour.example.org' })).statusCode).toBe(202);
    const before = contents(app, id);
    const response = await add(app, id, [note(1)]);
    expect(response.statusCode, response.body).toBe(409);
    expect(failure(response).code).toBe('RESEARCH_ACTIVE');
    expect(contents(app, id)).toEqual(before);
    await app.settle();
    expect(app.repository.get(id).documents.map((document) => document.provenance?.kind)).toEqual(
      expect.arrayContaining(['url']),
    );
    expect(app.actions(id)).not.toContain('evidence.documents.added');
  });

  it('is refused for a project that is not a guided one, or is complete, or is not there', async () => {
    const app = await researchApp();
    const quick = await app.create(QUESTION, {
      workflow: 'quick',
      documents: [note(1)],
      research: undefined,
    });
    const refusedQuick = await add(app, quick, [note(2)]);
    expect(refusedQuick.statusCode, refusedQuick.body).toBe(409);
    expect(failure(refusedQuick).code).toBe('GUIDED_PROJECT_REQUIRED');
    expect(app.repository.get(quick).documents).toHaveLength(1);

    const complete = await app.create();
    app.repository.update(complete, { status: 'completed' });
    const refusedComplete = await add(app, complete, [note(1)]);
    expect(refusedComplete.statusCode, refusedComplete.body).toBe(409);
    expect(failure(refusedComplete).code).toBe('PROJECT_READ_ONLY');
    expect(app.repository.get(complete).documents).toEqual([]);

    const missing = await add(app, randomUUID(), [note(1)]);
    expect(missing.statusCode).toBe(404);
    expect(failure(missing).code).toBe('PROJECT_NOT_FOUND');
    const notAnId = await add(app, 'not-an-id', [note(1)]);
    expect(notAnId.statusCode).toBe(400);
  });
});

describe('the same request sent twice', () => {
  it('is one request, whether the second follows at once, comes with the first, or comes when the project is ready', async () => {
    const app = await researchApp();
    const id = await app.create();
    const [first, second] = await Promise.all([add(app, id, [note(1)]), add(app, id, [note(1)])]);
    expect([first.statusCode, second.statusCode]).toEqual([202, 202]);
    const third = await add(app, id, [note(1)]);
    expect(third.statusCode, third.body).toBe(202);
    expect(third.json<ProjectDetail>().documents.map((document) => document.id)).toEqual(['D1']);

    const once = held(app, id);
    expect(once.documents).toHaveLength(1);
    expect(once.jobs).toBe(1);
    expect(once.audit.filter((action) => action === 'evidence.documents.added')).toHaveLength(1);

    await app.settle();
    // A reply that was lost is asked for again after the stage is done: the project, and nothing more.
    const late = await add(app, id, [note(1)]);
    expect(late.statusCode, late.body).toBe(202);
    expect(late.json<ProjectDetail>().console?.steps.knowledge).toBe('ready');
    const done = held(app, id);
    expect(done.documents).toEqual(once.documents);
    expect(done.jobs).toBe(1);
    expect(done.audit.filter((action) => action === 'evidence.documents.added')).toHaveLength(1);
  });

  it('is told from another by what it holds, and the other is refused while the first is under way', async () => {
    const app = await researchApp();
    const id = await app.create();
    expect((await add(app, id, [note(1), note(2)])).statusCode).toBe(202);
    const other = await add(app, id, [note(2), note(1)]);
    expect(other.statusCode).toBe(409);
    expect(failure(other).code).toBe('STEP_ALREADY_STARTED');
    expect(app.repository.get(id).documents).toHaveLength(2);
  });

  it('is one request by the key it carries, whatever it holds, and a key is a project’s own', async () => {
    const app = await researchApp();
    const first = await app.create();
    const second = await app.create();
    const headers = { 'idempotency-key': 'paste-0001' };
    expect((await add(app, first, [note(1)], headers)).statusCode).toBe(202);
    // The key names the request: what a later one holds is not looked at.
    const again = await add(app, first, [note(2)], headers);
    expect(again.statusCode, again.body).toBe(202);
    expect(app.repository.get(first).documents.map((document) => document.name)).toEqual([
      'notes-1.txt',
    ]);
    // The same key on another project is another request.
    expect((await add(app, second, [note(3)], headers)).statusCode).toBe(202);
    expect(app.repository.get(second).documents.map((document) => document.name)).toEqual([
      'notes-3.txt',
    ]);
    expect(app.repository.jobs.recent(first)).toHaveLength(1);
    expect(app.repository.jobs.recent(second)).toHaveLength(1);
  });

  it.each(['short', 'has spaces in it', 'semi;colon-key-01', `${'k'.repeat(129)}`])(
    'refuses a key that is not one (%s), and adds nothing',
    async (key) => {
      const app = await researchApp();
      const id = await app.create();
      const before = held(app, id);
      const response = await add(app, id, [note(1)], { 'idempotency-key': key });
      expect(response.statusCode, response.body).toBe(400);
      expect(held(app, id)).toEqual(before);
    },
  );
});

describe('the research of a project that was given text', () => {
  it('can still be asked for, and says what it did before', async () => {
    const app = await researchApp();
    const id = await blocked(app);
    expect((await add(app, id, [note(1)])).statusCode).toBe(202);
    await app.settle();
    const view = (
      await app.app.inject({ url: `/api/projects/${id}/research` })
    ).json<ResearchView>();
    expect(view.run).toMatchObject({ status: 'blocked', stoppedBecause: 'discovery-unconfigured' });
    // The project is grounded: a person goes on to the next stage, and research has nothing left to start.
    expect(view.may.start).toBe(false);
    const started = await app.post(id, '/sources', { url: 'harbour.example.org' });
    expect(started.statusCode, started.body).toBe(409);
    expect(failure(started).code).toBe('STEP_ALREADY_STARTED');
  });
});
