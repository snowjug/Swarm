import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  actorSetFixture,
  analysisFixture,
  scenarioFixture,
  stakeholderSetFixture,
} from '../../shared/lab-fixtures.js';
import { BriefService } from '../src/brief/service.js';
import { copyDatabase, TABLES } from '../src/storage/copy.js';
import { Repository } from '../src/storage/repository.js';
import type { SqlDatabase, SqlRow } from '../src/storage/sql.js';
import { fixtureInput } from './fixtures.js';
import { critiquesFixture } from './support/brief-world.js';
import { around, sessionsSeen, writtenDuringRead } from './support/concurrent-database.js';
import { populated as populate, type Instance } from './support/populated-world.js';

const rawOf = (repository: Repository): SqlDatabase =>
  (repository as unknown as { database: SqlDatabase }).database;

const applications: Instance[] = [];
const repositories: Repository[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
  for (const repository of repositories.splice(0)) repository.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const populated = (): Promise<Repository> => populate(applications);

const keep = (repository: Repository): Repository => {
  repositories.push(repository);
  return repository;
};

const workDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'swarm-copy-'));
  directories.push(directory);
  return directory;
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
  ['project_usage', 'project_id'],
  ['project_artifacts', 'project_id, kind, artifact_key'],
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

describe('copying a database', () => {
  it('moves everything from SQLite to PostgreSQL, keeps the audit chain, and lets it carry on', async () => {
    const source = await populated();
    const destination = keep(new Repository('pglite:memory'));
    const report = copyDatabase(rawOf(source), rawOf(destination));

    expect(report.auditChainIntact).toBe(true);
    expect(report.tables.projects).toBe(2);
    expect(report.tables.audit_events).toBeGreaterThan(0);
    expect(report.tables.claim_records).toBeGreaterThan(0);
    expect(report.tables.project_usage).toBe(1);
    expect(report.tables.project_artifacts).toBe(1);
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
    const failing = around(real, (sql) =>
      /^INSERT INTO chunks/u.test(sql)
        ? {
            run: () => {
              inserts++;
              throw new Error('disk full');
            },
          }
        : undefined,
    );
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

describe('copying a database that is being written to', () => {
  // The application does not stop for a backup. A second connection to the same file stands for it
  // (another process, in life) and changes the database while the copy is being read.
  const inUse = () => {
    const path = join(workDirectory(), 'live.sqlite');
    return { application: keep(new Repository(path)), other: keep(new Repository(path)) };
  };
  const castOf = (name: string) => {
    const cast = actorSetFixture();
    return { ...cast, actors: cast.actors.map((actor) => ({ ...actor, name })) };
  };

  it('takes one moment of it: a change committed part-way is in the copy whole or not at all', () => {
    const { application, other } = inUse();
    const project = application.create(fixtureInput({ name: 'Before the change' }));
    application.artifacts.put(project.id, 'actors', 'default', castOf('Before the change'));
    const destination = keep(new Repository(':memory:'));

    const report = copyDatabase(
      writtenDuringRead(rawOf(application), () =>
        other.atomic(() => {
          other.update(project.id, { name: 'After the change' });
          other.artifacts.put(project.id, 'actors', 'default', castOf('After the change'));
          other.audit.record({
            actor: 'someone',
            action: 'project.edited',
            targetType: 'project',
            targetId: project.id,
            projectId: project.id,
          });
        }),
      ),
      rawOf(destination),
    );

    // The change was committed while the copy was being read, and the copy held nobody back...
    expect(application.get(project.id).name).toBe('After the change');
    expect(application.artifacts.get(project.id, 'actors')!.revision).toBe(2);
    // ...and what was copied is the moment before it: the project and its cast agree.
    expect(destination.get(project.id).name).toBe('Before the change');
    const cast = destination.artifacts.get(project.id, 'actors')!;
    expect(cast.revision).toBe(1);
    expect(cast.data.actors.map((actor) => actor.name)).toEqual(
      castOf('Before the change').actors.map((actor) => actor.name),
    );
    const actions = destination.audit.list({ limit: 100 }).map((event) => event.action);
    expect(actions).not.toContain('project.edited');
    expect(report.auditChainIntact).toBe(true);
  });

  it('copies a project that is deleted part-way as the whole project it was, not as an empty shell', () => {
    const { application, other } = inUse();
    const project = application.create(fixtureInput());
    application.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
    const destination = keep(new Repository(':memory:'));

    const report = copyDatabase(
      writtenDuringRead(rawOf(application), () => other.delete(project.id)),
      rawOf(destination),
    );

    // The deletion went through, with everything that belongs to the project, while it was copied...
    expect(application.count()).toBe(0);
    expect(rawOf(application).prepare('SELECT COUNT(*) AS count FROM chunks').get()).toEqual({
      count: 0,
    });
    expect(application.artifacts.get(project.id, 'actors')).toBeNull();
    // ...and the copy has the project as it was a moment before, and all of it.
    expect(destination.count()).toBe(1);
    expect(destination.chunks(project.id).length).toBeGreaterThan(0);
    expect(destination.artifacts.get(project.id, 'actors')).not.toBeNull();
    expect(report.tables.project_members).toBe(1);
    expect(report.auditChainIntact).toBe(true);
  });
});

describe('copying a PostgreSQL database', () => {
  it('reads every table of it inside one read-only repeatable-read transaction', async () => {
    const postgres = keep(new Repository('pglite:memory'));
    copyDatabase(rawOf(await populated()), rawOf(postgres));
    const { database, seen } = sessionsSeen(rawOf(postgres));
    // A file, so that the destination has a connection of its own whichever database the tests run on.
    const backup = keep(new Repository(join(workDirectory(), 'swarm.sqlite')));
    copyDatabase(database, rawOf(backup));

    expect(seen).toHaveLength(TABLES.length);
    for (const state of seen) {
      expect(state).toMatchObject({ isolation: 'repeatable read', read_only: 'on' });
    }
    // One snapshot: it did not move between the first table and the last.
    expect(new Set(seen.map((state) => state.snapshot)).size).toBe(1);
  });
});

describe('copying what a project carries', () => {
  const KINDS = ['scenario', 'stakeholders', 'actors', 'analysis', 'critiques', 'brief'] as const;

  it('moves every kind of lab artifact with its revision and times, in either direction, and deleting the project takes them', () => {
    const from = keep(new Repository(':memory:'));
    const project = from.create(fixtureInput({ workflow: 'guided' }));
    from.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
    from.artifacts.put(project.id, 'stakeholders', 'default', stakeholderSetFixture());
    from.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
    from.artifacts.put(project.id, 'analysis', 'analysis-1', analysisFixture({ id: 'analysis-1' }));
    from.artifacts.put(project.id, 'critiques', 'default', critiquesFixture());
    new BriefService(from).generate(project.id);
    // One of them has been written twice, so that a revision other than the first has to travel.
    from.artifacts.put(project.id, 'actors', 'default', actorSetFixture());

    const there = keep(new Repository('pglite:memory'));
    const back = keep(new Repository(join(workDirectory(), 'back.sqlite')));
    expect(copyDatabase(rawOf(from), rawOf(there)).tables.project_artifacts).toBe(KINDS.length);
    copyDatabase(rawOf(there), rawOf(back));

    for (const kind of KINDS) {
      const original = from.artifacts.list(project.id, kind);
      expect(original, kind).not.toEqual([]);
      expect(there.artifacts.list(project.id, kind), kind).toEqual(original);
      expect(back.artifacts.list(project.id, kind), kind).toEqual(original);
    }
    expect(back.artifacts.get(project.id, 'actors')!.revision).toBe(2);

    back.delete(project.id);
    there.delete(project.id);
    for (const kind of KINDS) {
      expect(back.artifacts.list(project.id, kind), kind).toEqual([]);
      expect(there.artifacts.list(project.id, kind), kind).toEqual([]);
    }
  });
});
