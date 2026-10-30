import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PROJECTS } from '../../../shared/demo.js';
import { buildApp } from '../../../backend/src/app.js';
import { Repository } from '../../../backend/src/storage/repository.js';
import { fixtureInput, testConfig } from '../../../backend/test/fixtures.js';
import { httpApi } from './api.js';
import { checkContract, recordDemo, STORY, type Recording } from './record-flow.js';
import { MANIFEST_FILE, readSeed, removeDemo, seedDemo } from './seed.js';

// The recording is run for real against a server on a local port, with the local engine standing
// in for the model (allowLocal), so that the whole path (create, run, branch, ask, compare, export,
// rename, restore) is tested without spending a model call. The committed seed is checked
// separately, in seed-data.test.ts.
const PACK = 'docs/demo/larkholm-ferry';
const [BASE, GUARANTEE, NO_NOTICE] = DEMO_PROJECTS;

let recording: Recording;
let directory: string;
let server: Awaited<ReturnType<typeof buildApp>>;
let story: { question: string; sources: { name: string; content: string }[] };

function write(dir: string, recorded: Recording): void {
  for (const file of recorded.files) {
    writeFileSync(join(dir, file.file), JSON.stringify(file.snapshot, null, 2));
  }
  writeFileSync(
    join(dir, MANIFEST_FILE),
    JSON.stringify({
      version: 1,
      recordedAt: recorded.recordedAt,
      provider: recorded.provider,
      model: recorded.model,
      projects: DEMO_PROJECTS.map((demo) => ({
        id: demo.id,
        slug: demo.slug,
        file: `${demo.slug}.json`,
      })),
    }),
  );
}

beforeAll(async () => {
  server = await buildApp({ config: testConfig({ RATE_LIMIT_SCALE: '20' }) });
  await server.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = server.app.server.address() as AddressInfo;
  const catalogue = JSON.parse(readFileSync('docs/demo/demos.json', 'utf8')) as {
    demos: { slug: string; question: string; files: string[] }[];
  };
  const pack = catalogue.demos.find((demo) => demo.slug === 'larkholm-ferry')!;
  story = {
    question: pack.question,
    sources: pack.files.map((name) => ({ name, content: readFileSync(join(PACK, name), 'utf8') })),
  };
  recording = await recordDemo(httpApi(`http://127.0.0.1:${port}`), {
    ...story,
    allowLocal: true,
    pollMs: 25,
  });
  directory = mkdtempSync(join(tmpdir(), 'swarm-seed-'));
  write(directory, recording);
}, 240_000);

afterAll(async () => {
  await server.app.close();
  rmSync(directory, { recursive: true, force: true });
});

const fresh = (): Repository => new Repository(':memory:');

describe('recording the demonstration', () => {
  it('records the base run and both branches under their fixed identifiers', () => {
    expect(recording.files.map((file) => file.slug)).toEqual(
      DEMO_PROJECTS.map((demo) => demo.slug),
    );
    const [base, guarantee, noNotice] = recording.files.map(
      (file) =>
        (file.snapshot as { project: { id: string; name: string; parentId: string | null } })
          .project,
    );
    expect(base).toMatchObject({ id: BASE!.id, name: BASE!.title, parentId: null });
    expect(guarantee).toMatchObject({
      id: GUARANTEE!.id,
      name: GUARANTEE!.title,
      parentId: BASE!.id,
    });
    expect(noNotice).toMatchObject({
      id: NO_NOTICE!.id,
      name: NO_NOTICE!.title,
      parentId: BASE!.id,
    });
  });

  it('leaves no identifier of the recording server in the files', () => {
    const text = recording.files.map((file) => JSON.stringify(file.snapshot)).join('\n');
    const demo = new Set(DEMO_PROJECTS.map((project) => project.id));
    for (const match of text.matchAll(/"(?:id|projectId|parentId|rootId)":"([0-9a-f-]{36})"/gu)) {
      // Message identifiers are UUIDs too; project references must be demonstration identifiers.
      if (/"(?:projectId|parentId|rootId)"/u.test(match[0])) expect(demo.has(match[1]!)).toBe(true);
    }
    expect(text).not.toContain('"ledger":{');
  });

  it('puts three actors, scheduled and replaced interventions and a conversation in the recording', () => {
    interface Recorded {
      project: { agents: unknown[]; settings: { intervention: { round: number } | null } };
      messages: unknown[];
    }
    const [base, guarantee, noNotice] = recording.files.map(
      (file) => file.snapshot as unknown as Recorded,
    );
    expect(base!.project.agents.length).toBeGreaterThanOrEqual(3);
    expect(base!.project.settings.intervention).toMatchObject({ round: STORY.notice.round });
    expect(guarantee!.project.settings.intervention).toMatchObject({
      round: STORY.guarantee.round,
    });
    expect(noNotice!.project.settings.intervention).toBeNull();
    expect(base!.messages.length).toBe(6);
    expect(recording.notes.length).toBe(3);
  });

  it('refuses a server that is not using a real model, unless the test says so', async () => {
    const { port } = server.app.server.address() as AddressInfo;
    await expect(
      recordDemo(httpApi(`http://127.0.0.1:${port}`), { question: 'q', sources: [] }),
    ).rejects.toThrow(/needs a real model/u);
  });

  it('fails a recording that does not keep the demonstration contract', () => {
    const problems = checkContract({
      strict: true,
      rounds: 6,
      base: {
        project: {
          status: 'failed',
          agents: [],
          rounds: [],
          settings: { intervention: null },
          report: null,
          documents: [],
        },
        ledger: { claims: [], contradictions: [] },
        messages: [],
      } as never,
      branches: [
        { project: { status: 'completed', parentId: 'x', report: null } },
        { project: { status: 'completed', parentId: 'x', report: null } },
      ] as never,
      comparisons: {
        againstBase: { identicalThroughRound: 6, lineage: 'base-is-parent' },
        againstOther: { identicalThroughRound: 3, lineage: 'base-is-parent' },
        siblings: { identicalThroughRound: 3, lineage: 'unrelated' },
      } as never,
      replies: {
        answerable: { role: 'assistant', content: 'x', sourceIds: [] },
        unsupported: { role: 'assistant', content: 'A confident answer.' },
        actor: { role: 'assistant', content: '' },
      } as never,
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'the base run did not complete',
        'the base run has fewer than three actors',
        'the base run has no scheduled intervention',
        'the base run has no report',
        'the guarantee branch never diverged from its parent',
        'the two branches are not siblings',
        'the base report has no checked statements',
        'no conflict between sources was found, although two are planted',
        'the answerable question was answered without citing a source',
        'the unsupported question was not answered with the abstention sentence',
        'the actor gave no reply',
      ]),
    );
  });
});

describe('resuming an interrupted recording', () => {
  it('finishes what is incomplete, makes nothing again and asks nothing twice', async () => {
    const { port } = server.app.server.address() as AddressInfo;
    const all = server.repository.list().projects;
    const base = all.find((project) => project.parentId === null)!;
    const [first, second] = all.filter((project) => project.parentId === base.id);
    // As if the machine had gone to sleep in the middle of the second branch's report.
    const interrupted = server.repository.get(second!.id);
    server.repository.update(second!.id, {
      status: 'failed',
      error: 'The run exceeded its 15-minute resource budget.',
      console: {
        ...interrupted.console!,
        steps: { ...interrupted.console!.steps, report: 'failed' },
      },
    });
    const held = server.repository.allMessages(base.id).length;

    const resumed = await recordDemo(httpApi(`http://127.0.0.1:${port}`), {
      ...story,
      allowLocal: true,
      pollMs: 25,
      resume: { base: base.id, guarantee: first!.id, noNotice: second!.id },
    });

    expect(server.repository.count()).toBe(3);
    expect(server.repository.allMessages(base.id)).toHaveLength(held);
    expect(server.repository.get(second!.id).status).toBe('completed');
    expect(resumed.files.map((file) => file.slug)).toEqual(DEMO_PROJECTS.map((demo) => demo.slug));
    expect((resumed.files[0]!.snapshot as { messages: unknown[] }).messages).toHaveLength(held);
  });
});

describe('restoring the demonstration', () => {
  it('restores all three, then restores them again to the same state', () => {
    const repository = fresh();
    const first = seedDemo(repository, { directory });
    expect(first.map((line) => line.outcome)).toEqual(['restored', 'restored', 'restored']);
    const before = repository.get(BASE!.id);
    repository.appendMessages(BASE!.id, [
      {
        id: crypto.randomUUID(),
        target: 'report',
        role: 'user',
        content: 'A question asked during a rehearsal.',
        sourceIds: [],
        mode: 'local',
        createdAt: new Date().toISOString(),
      },
    ]);
    const again = seedDemo(repository, { directory });
    expect(again.map((line) => line.outcome)).toEqual(['replaced', 'replaced', 'replaced']);
    expect(repository.count()).toBe(3);
    expect(repository.allMessages(BASE!.id)).toHaveLength(6);
    expect({ ...repository.get(BASE!.id), events: [] }).toEqual({ ...before, events: [] });
    repository.close();
  });

  it('touches nothing but the demonstration experiments', () => {
    const repository = fresh();
    const mine = repository.create(fixtureInput({ workflow: 'guided', name: 'My own work' }));
    const snapshot = JSON.stringify(repository.get(mine.id));
    seedDemo(repository, { directory });
    seedDemo(repository, { directory });
    removeDemo(repository);
    expect(repository.count()).toBe(1);
    expect(JSON.stringify(repository.get(mine.id))).toBe(snapshot);
    repository.close();
  });

  it('writes nothing on a dry run and says what it would do', () => {
    const repository = fresh();
    expect(seedDemo(repository, { directory, dryRun: true }).map((line) => line.outcome)).toEqual([
      'would restore',
      'would restore',
      'would restore',
    ]);
    expect(repository.count()).toBe(0);
    expect(repository.audit.list()).toEqual([]);
    seedDemo(repository, { directory });
    expect(seedDemo(repository, { directory, dryRun: true })[0]!.outcome).toBe('would replace');
    repository.close();
  });

  it('removes the demonstration, and reports when it was not there', () => {
    const repository = fresh();
    seedDemo(repository, { directory });
    expect(removeDemo(repository)).toHaveLength(3);
    expect(repository.count()).toBe(0);
    expect(removeDemo(repository)).toEqual([]);
    repository.close();
  });

  it('keeps the lineage, so a restored branch still compares with its parent', async () => {
    const repository = fresh();
    seedDemo(repository, { directory });
    const app = await buildApp({ config: testConfig(), repository });
    const compared = await app.app.inject(
      `/api/projects/${GUARANTEE!.id}/compare?with=${BASE!.id}`,
    );
    expect(compared.statusCode, compared.body).toBe(200);
    expect((compared.json() as { identicalThroughRound: number }).identicalThroughRound).toBe(
      STORY.branchFromRound,
    );
    expect((compared.json() as { lineage: string }).lineage).toBe('other-is-parent');
    await app.app.close();
  });

  it('refuses to replace another workspace’s experiment, and then writes nothing at all', () => {
    const repository = fresh();
    const other = { tenantId: 'someone-else', ownerId: 'them' };
    seedDemo(repository, { directory, owner: other });
    // Only the last of the three is still theirs: a seed that wrote as it went would restore the
    // first two before reaching it.
    repository.delete(BASE!.id);
    repository.delete(GUARANTEE!.id);
    const before = repository.audit.list().length;
    expect(() => seedDemo(repository, { directory })).toThrow(/another workspace/u);
    expect(repository.count()).toBe(1);
    expect(repository.ownership(BASE!.id)).toBeNull();
    expect(repository.audit.list()).toHaveLength(before);
    expect(repository.ownership(NO_NOTICE!.id)).toEqual(other);
    expect(removeDemo(repository)).toEqual([]);
    repository.close();
  });

  it('rejects a seed that has been tampered with, before writing anything', () => {
    const repository = fresh();
    const copy = mkdtempSync(join(tmpdir(), 'swarm-seed-bad-'));
    try {
      for (const name of readdirSync(directory)) {
        writeFileSync(join(copy, name), readFileSync(join(directory, name)));
      }
      const manifest = JSON.parse(readFileSync(join(copy, MANIFEST_FILE), 'utf8')) as {
        projects: { id: string; slug: string; file: string }[];
      };

      const pointsOutside = structuredClone(manifest);
      pointsOutside.projects[0]!.file = '../outside.json';
      writeFileSync(join(copy, MANIFEST_FILE), JSON.stringify(pointsOutside));
      expect(() => seedDemo(repository, { directory: copy })).toThrow();

      const reordered = structuredClone(manifest);
      reordered.projects.reverse();
      writeFileSync(join(copy, MANIFEST_FILE), JSON.stringify(reordered));
      expect(() => readSeed(copy)).toThrow(/does not list the demonstration projects/u);

      writeFileSync(join(copy, MANIFEST_FILE), JSON.stringify(manifest));
      const wrong = JSON.parse(readFileSync(join(copy, manifest.projects[1]!.file), 'utf8')) as {
        project: { id: string };
      };
      wrong.project.id = crypto.randomUUID();
      writeFileSync(join(copy, manifest.projects[1]!.file), JSON.stringify(wrong));
      expect(() => seedDemo(repository, { directory: copy })).toThrow(/not de300001/u);
      expect(repository.count()).toBe(0);
    } finally {
      rmSync(copy, { recursive: true, force: true });
      repository.close();
    }
  });
});
