import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GroundingReview } from '../../shared/grounding.js';
import { buildApp } from '../src/app.js';
import { LedgerService } from '../src/grounding/service.js';
import { StudioService } from '../src/studio/service.js';
import { copyDatabase } from '../src/storage/copy.js';
import { Repository } from '../src/storage/repository.js';
import type { SqlDatabase, SqlRow, SqlStatement } from '../src/storage/sql.js';
import { fixtureInput, testConfig } from './fixtures.js';

const rawOf = (repository: Repository): SqlDatabase =>
  (repository as unknown as { database: SqlDatabase }).database;

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
const repositories: Repository[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
  for (const repository of repositories.splice(0)) repository.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const keep = (repository: Repository): Repository => {
  repositories.push(repository);
  return repository;
};

const DATA_TABLES = [
  ['projects', 'created_at, id'],
  ['chunks', 'project_id, id'],
  ['events', 'created_at, project_id, message'],
  ['messages', 'project_id, id'],
  ['claim_records', 'project_id, id'],
  ['source_conflicts', 'project_id, id'],
  ['ledger_state', 'project_id'],
  ['studio_documents', 'project_id'],
  ['workspace_members', 'tenant_id, principal_id'],
  ['project_members', 'project_id, principal_id'],
  ['audit_events', 'seq'],
] as const;

/** The columns that are only an ordering, and are made afresh in the copy. */
const identity: Record<string, string> = { events: 'id', messages: 'seq' };

/** Every row of every data table, without the identities that are only an ordering. */
function dump(database: SqlDatabase): Record<string, SqlRow[]> {
  const result: Record<string, SqlRow[]> = {};
  for (const [table, order] of DATA_TABLES) {
    result[table] = database
      .prepare(`SELECT * FROM ${table} ORDER BY ${order}`)
      .all()
      .map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => key !== identity[table])),
      );
  }
  return result;
}

/** A finished guided experiment with a conversation, members and a ledger, written by the local engine. */
const statement = (id: string, text: string, kind: 'source-fact' | 'ai-hypothesis') => ({
  id,
  section: 'Findings',
  text,
  kind,
  sourceIds: kind === 'source-fact' ? ['S1'] : [],
  memoryIds: [],
  quote: null,
  verdict: kind === 'source-fact' ? ('supported' as const) : ('unchecked' as const),
  checks: { quote: null, overlap: 0.9, numbers: null, entailment: null },
  reason: 'Checked against the cited passage.',
});

const grounding: GroundingReview = {
  checkedAt: '2026-01-01T00:00:00.000Z',
  method: 'deterministic',
  claims: [
    statement('C1', 'Neighborhood groups ask for accessible stops.', 'source-fact'),
    statement('C2', 'Residents may switch to transit if fares fall.', 'ai-hypothesis'),
  ],
  counts: { supported: 1, partial: 0, unsupported: 0, contradicted: 0, unchecked: 1 },
  unverifiedFigures: [],
  notes: [],
};

async function populated(): Promise<Repository> {
  const instance = await buildApp({ config: testConfig() });
  applications.push(instance);
  const { repository, jobs, interaction } = instance;
  const created = repository.create(fixtureInput({ workflow: 'guided' }));
  for (const step of ['knowledge', 'environment', 'simulation', 'report'] as const) {
    jobs.enqueueStep(created.id, step);
    await jobs.idle();
  }
  // Give the report a grounding review, so that the ledger has statements to hold.
  const report = repository.get(created.id).report!;
  repository.update(created.id, { report: { ...report, grounding } });
  new LedgerService(repository).get(created.id);
  // A person has worked on the report: a document with an edit, so that it has something to carry.
  const studio = new StudioService(repository, new LedgerService(repository));
  studio.start(created.id, { confirm: false }, 'local-user');
  studio.editSection(
    created.id,
    'summary',
    { body: 'A summary as a person wrote it.', expectedVersion: 1, reason: null },
    'local-user',
  );
  await interaction.reply(
    created.id,
    'report',
    'What do the sources say about transit?',
    new AbortController().signal,
  );
  repository.members.setWorkspaceMember({
    tenantId: 'local',
    principalId: 'colleague-1',
    role: 'admin',
    actor: { id: 'local-user', workspaceRole: 'owner' },
  });
  repository.create(fixtureInput({ name: 'A second experiment' }));
  return repository;
}

describe('copying a database', () => {
  it('moves everything from SQLite to PostgreSQL, keeps the audit chain, and lets it carry on', async () => {
    const source = await populated();
    const destination = keep(new Repository('pglite:memory'));
    const report = copyDatabase(rawOf(source), rawOf(destination));

    expect(report.auditChainIntact).toBe(true);
    expect(report.tables.projects).toBe(2);
    expect(report.tables.audit_events).toBeGreaterThan(0);
    expect(report.tables.claim_records).toBeGreaterThan(0);
    expect(dump(rawOf(destination))).toEqual(dump(rawOf(source)));

    // The copy is usable, not just equal: it reads, and the next audit entry follows the last.
    const [first] = destination.list(10, 0, 'local').projects;
    expect(destination.get(first!.id).name).toBe(first!.name);
    const before = destination.audit.list({ limit: 500 }).at(-1)!.seq;
    const next = destination.audit.record({
      actor: 'someone',
      action: 'copy.checked',
      targetType: 'test',
      targetId: '1',
    });
    expect(next.seq).toBe(before + 1);
    expect(destination.audit.verify().ok).toBe(true);
  });

  it('takes a backup from PostgreSQL into a SQLite file, and the file opens as a database of its own', async () => {
    const original = await populated();
    const postgres = keep(new Repository('pglite:memory'));
    copyDatabase(rawOf(original), rawOf(postgres));

    const directory = mkdtempSync(join(tmpdir(), 'swarm-copy-'));
    directories.push(directory);
    const path = join(directory, 'backup', 'swarm.sqlite');
    const backup = new Repository(path);
    copyDatabase(rawOf(postgres), rawOf(backup));
    expect(dump(rawOf(backup))).toEqual(dump(rawOf(original)));
    backup.close();

    const restored = keep(new Repository(path));
    expect(restored.dialect).toBe('sqlite');
    expect(restored.migration).toMatchObject({ applied: [] });
    expect(restored.audit.verify().ok).toBe(true);
    expect(restored.count()).toBe(2);
  });

  it('refuses a destination that already holds data, and leaves it exactly as it was', async () => {
    const source = await populated();
    const destination = keep(new Repository('pglite:memory'));
    destination.create(fixtureInput({ name: 'Already here' }));
    const before = dump(rawOf(destination));
    expect(() => copyDatabase(rawOf(source), rawOf(destination))).toThrow(/already holds data/u);
    expect(dump(rawOf(destination))).toEqual(before);
  });

  it('keeps nothing when the copy fails part-way', async () => {
    const source = await populated();
    const destination = keep(new Repository('pglite:memory'));
    const real = rawOf(destination);
    let inserts = 0;
    const failing: SqlDatabase = {
      get dialect() {
        return real.dialect;
      },
      get inTransaction() {
        return real.inTransaction;
      },
      get broken() {
        return real.broken;
      },
      exec: (sql) => real.exec(sql),
      transaction: (operation) => real.transaction(operation),
      close: () => real.close(),
      prepare: (sql): SqlStatement => {
        const statement = real.prepare(sql);
        if (!/^INSERT INTO chunks/u.test(sql)) return statement;
        return {
          ...statement,
          run: () => {
            inserts++;
            throw new Error('disk full');
          },
        };
      },
    };
    expect(() => copyDatabase(rawOf(source), failing)).toThrow('disk full');
    expect(inserts).toBe(1);
    for (const rows of Object.values(dump(real))) expect(rows).toEqual([]);
  });

  it('refuses a source whose audit chain does not verify, and keeps nothing', async () => {
    const source = await populated();
    const raw = rawOf(source);
    // Someone with the file alters history: the trigger is dropped and an entry is rewritten.
    raw.exec(
      raw.dialect === 'postgres'
        ? 'DROP TRIGGER audit_events_no_update ON audit_events'
        : 'DROP TRIGGER audit_events_no_update',
    );
    raw.prepare("UPDATE audit_events SET actor = 'forged' WHERE seq = 1").run();
    const destination = keep(new Repository('pglite:memory'));
    expect(() => copyDatabase(raw, rawOf(destination))).toThrow(/audit chain does not verify/u);
    for (const rows of Object.values(dump(rawOf(destination)))) expect(rows).toEqual([]);
  });

  it('does not copy sign-in state, which is meant to be lost', async () => {
    const source = await populated();
    source.sessions.createLogin({
      state: 's'.repeat(43),
      binding: 'b'.repeat(43),
      nonce: 'n',
      verifier: 'v',
      returnTo: '/',
    });
    const destination = keep(new Repository('pglite:memory'));
    copyDatabase(rawOf(source), rawOf(destination));
    expect(
      rawOf(destination).prepare('SELECT COUNT(*) AS count FROM login_attempts').get(),
    ).toEqual({
      count: 0,
    });
  });
});
