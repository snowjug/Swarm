import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { LedgerService } from '../src/grounding/service.js';
import { Repository, type Owner } from '../src/storage/repository.js';
import { fixtureInput, testConfig } from './fixtures.js';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
async function setup() {
  const instance = await buildApp({ config: testConfig() });
  applications.push(instance);
  return instance;
}
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

type Harness = Awaited<ReturnType<typeof setup>>;
interface Exported {
  schemaVersion: number;
  project: Record<string, unknown> & { id: string };
  evidence: unknown[];
  messages: unknown[];
  ledger: unknown;
}

/** A finished guided experiment with a conversation, written by the local engine. */
async function finished(harness: Harness): Promise<string> {
  const { repository, jobs, interaction } = harness;
  const created = repository.create(fixtureInput({ workflow: 'guided' }));
  for (const step of ['knowledge', 'environment', 'simulation', 'report'] as const) {
    jobs.enqueueStep(created.id, step);
    await jobs.idle();
  }
  const reply = await interaction.reply(
    created.id,
    'report',
    'What do the sources say about transit support?',
    new AbortController().signal,
  );
  expect(reply.length).toBeGreaterThan(0);
  return created.id;
}

async function exported(harness: Harness, id: string): Promise<Exported> {
  const response = await harness.app.inject(`/api/projects/${id}/export?format=json`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as Exported;
}

const OTHER: Owner = { tenantId: 'other-workspace', ownerId: 'someone-else' };

describe('restoring an exported experiment', () => {
  it('rebuilds the experiment, its passages, its conversation and its ledger exactly', async () => {
    const source = await setup();
    const id = await finished(source);
    const snapshot = await exported(source, id);
    expect(snapshot.messages.length).toBeGreaterThanOrEqual(2);

    const target = new Repository(':memory:');
    expect(target.importSnapshot(snapshot)).toEqual({ id, replaced: false });

    const restored = target.get(id);
    const original = source.repository.get(id);
    expect({ ...restored, events: [] }).toEqual({ ...original, events: [] });
    expect(restored.events.map(({ stage, message }) => ({ stage, message }))).toEqual(
      original.events.map(({ stage, message }) => ({ stage, message })),
    );
    expect(target.chunks(id)).toEqual(source.repository.chunks(id));
    expect(target.allMessages(id)).toEqual(source.repository.allMessages(id));

    const rebuilt = new LedgerService(target).get(id);
    const first = new LedgerService(source.repository).get(id);
    expect(rebuilt.contradictions).toEqual(first.contradictions);
    expect(rebuilt.sufficiency).toEqual(first.sufficiency);
    expect(rebuilt.claims.map((claim) => claim.id)).toEqual(first.claims.map((claim) => claim.id));
    target.close();
  });

  it('replaces an earlier copy, so restoring twice leaves one experiment and one conversation', async () => {
    const source = await setup();
    const id = await finished(source);
    const snapshot = await exported(source, id);
    const target = new Repository(':memory:');

    expect(target.importSnapshot(snapshot).replaced).toBe(false);
    target.appendMessages(id, [
      {
        id: crypto.randomUUID(),
        target: 'report',
        role: 'user',
        content: 'A question asked after the restore.',
        sourceIds: [],
        mode: 'local',
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(target.importSnapshot(snapshot).replaced).toBe(true);

    expect(target.count()).toBe(1);
    // Back to the recorded conversation: the question asked after the first restore is gone.
    expect(target.allMessages(id)).toHaveLength(snapshot.messages.length);
    const entries = target.audit
      .list({ projectId: id })
      .filter((e) => e.action === 'project.imported');
    expect(entries.map((entry) => entry.detail.replaced)).toEqual([false, true]);
    expect(target.audit.verify().ok).toBe(true);
    target.close();
  });

  it('keeps a branch and its parent consistent, so the comparison still works', async () => {
    const source = await setup();
    const parent = await finished(source);
    const branched = await source.app.inject({
      method: 'POST',
      url: `/api/projects/${parent}/branches`,
      payload: { name: 'Restored branch', fromRound: 1 },
    });
    expect(branched.statusCode, branched.body).toBe(201);
    const child = (branched.json() as { id: string }).id;

    const target = await setup();
    target.repository.importSnapshot(await exported(source, parent));
    target.repository.importSnapshot(await exported(source, child));
    expect(target.repository.get(child).parentId).toBe(parent);

    const compared = await target.app.inject(`/api/projects/${child}/compare?with=${parent}`);
    expect(compared.statusCode, compared.body).toBe(200);
  });

  it('refuses to overwrite an experiment that belongs to another workspace', async () => {
    const source = await setup();
    const id = await finished(source);
    const snapshot = await exported(source, id);
    const target = new Repository(':memory:');
    target.importSnapshot(snapshot, { owner: OTHER });

    expect(() => target.importSnapshot(snapshot)).toThrow(/another workspace/u);
    expect(target.ownership(id)).toEqual(OTHER);
    expect(target.audit.list().filter((entry) => entry.action === 'project.imported')).toHaveLength(
      1,
    );
    target.close();
  });

  it('stores nothing from a snapshot that is not a finished guided export', async () => {
    const source = await setup();
    const id = await finished(source);
    const good = await exported(source, id);
    const target = new Repository(':memory:');

    const broken: [string, unknown][] = [
      ['not an object', 'text'],
      ['an older export version', { ...good, schemaVersion: 1 }],
      [
        'a project that was still running',
        { ...good, project: { ...good.project, status: 'running' } },
      ],
      [
        'a project with a damaged field',
        { ...good, project: { ...good.project, progress: 'lots' } },
      ],
      [
        'an identifier that is not a UUID',
        { ...good, project: { ...good.project, id: 'demo-one' } },
      ],
      ['a passage with no text', { ...good, evidence: [{ id: 'S1' }] }],
      [
        'a repeated message identifier',
        { ...good, messages: [good.messages[0], good.messages[0]] },
      ],
      [
        'more messages than a conversation may hold',
        {
          ...good,
          messages: Array.from({ length: 61 }, () => ({
            ...(good.messages[0] as object),
            id: crypto.randomUUID(),
          })),
        },
      ],
    ];
    for (const [label, candidate] of broken) {
      expect(() => target.importSnapshot(candidate), label).toThrow(
        /can restore|not an experiment/u,
      );
    }
    expect(target.count()).toBe(0);
    expect(target.audit.list()).toEqual([]);
    target.close();
  });

  it('rolls the whole restore back when a later row cannot be written', async () => {
    const source = await setup();
    const id = await finished(source);
    const snapshot = await exported(source, id);
    const target = new Repository(':memory:');
    target.importSnapshot(snapshot);

    // A different experiment whose conversation reuses a message identifier already stored.
    const clash = JSON.parse(JSON.stringify(snapshot)) as Exported;
    clash.project.id = crypto.randomUUID();
    expect(() => target.importSnapshot(clash)).toThrow();

    expect(target.count()).toBe(1);
    expect(() => target.get(clash.project.id)).toThrow(/does not exist/u);
    expect(target.allMessages(id)).toHaveLength(snapshot.messages.length);
    expect(target.audit.verify().ok).toBe(true);
    target.close();
  });
});
