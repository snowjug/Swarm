import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { copyDatabase, TABLES } from '../src/storage/copy.js';
import {
  differingTables,
  rehearseRestore,
  rehearseRestoreOf,
  tableDigest,
} from '../src/storage/drill.js';
import { LATEST_SCHEMA_VERSION } from '../src/storage/migrations.js';
import { Repository } from '../src/storage/repository.js';
import { SqliteDatabase, type SqlDatabase } from '../src/storage/sql.js';
import { fixtureInput } from './fixtures.js';
import { populated as populate, type Instance } from './support/populated-world.js';

// The rehearsal of losing a database and getting it back: that it proves what it says it proves, that
// it notices damage, and that it never changes the database it is run on.

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

const populated = () => populate(applications);
const workDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'swarm-drill-'));
  directories.push(directory);
  return directory;
};
const keep = (repository: Repository): Repository => {
  repositories.push(repository);
  return repository;
};
const table = (name: string) => TABLES.find((candidate) => candidate.name === name)!;

describe('what a table holds, as a digest', () => {
  it('is the same for the same rows and different when one cell is not, in either database', async () => {
    const source = await populated();
    const postgres = keep(new Repository('pglite:memory'));
    copyDatabase(rawOf(source), rawOf(postgres));

    for (const { name } of TABLES) {
      expect(tableDigest(rawOf(postgres), table(name)), name).toBe(
        tableDigest(rawOf(source), table(name)),
      );
    }
    const before = tableDigest(rawOf(postgres), table('chunks'));
    rawOf(postgres)
      .prepare(
        "UPDATE chunks SET payload = payload || ' ' WHERE (project_id, id) IN (SELECT project_id, id FROM chunks LIMIT 1)",
      )
      .run();
    expect(tableDigest(rawOf(postgres), table('chunks'))).not.toBe(before);
  });

  it('leaves out the identities that a copy makes afresh', async () => {
    const source = await populated();
    // With the first event gone, the ids of the rest start at 2 here and at 1 in a copy.
    rawOf(source).prepare('DELETE FROM events WHERE id = (SELECT MIN(id) FROM events)').run();
    const copy = keep(new Repository(':memory:'));
    copyDatabase(rawOf(source), rawOf(copy));
    const firstId = (database: SqlDatabase) =>
      Number(database.prepare('SELECT MIN(id) AS first FROM events').get()?.first);
    expect(firstId(rawOf(source))).toBeGreaterThan(1);
    expect(firstId(rawOf(copy))).toBe(1);
    expect(tableDigest(rawOf(copy), table('events'))).toBe(
      tableDigest(rawOf(source), table('events')),
    );
  });

  it('names the tables that differ, and none when they do not', () => {
    const same = Object.fromEntries(TABLES.map((t) => [t.name, 'a']));
    expect(differingTables(same, { ...same })).toEqual([]);
    expect(differingTables(same, { ...same, chunks: 'b', audit_events: 'c' })).toEqual([
      'chunks',
      'audit_events',
    ]);
    expect(differingTables(same, { ...same, chunks: undefined as unknown as string })).toEqual([
      'chunks',
    ]);
  });
});

describe('rehearsing a restore', () => {
  it('backs a database up, restores it from the backup alone, and shows that the two are the same', async () => {
    const source = await populated();
    const report = rehearseRestore(rawOf(source), workDirectory());

    expect(report.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(report.differing).toEqual([]);
    expect(report.auditChainIntact).toBe(true);
    expect(report.carriesOn).toBe(true);
    expect(report.projectsRead).toBe(2);
    expect(report.rows.projects).toBe(2);
    expect(report.rows.chunks).toBeGreaterThan(0);
    expect(report.rows.events).toBeGreaterThan(0);
    expect(report.rows.messages).toBeGreaterThan(0);
    expect(report.rows.claim_records).toBeGreaterThan(0);
    expect(report.rows.ledger_state).toBe(1);
    expect(report.rows.studio_documents).toBe(1);
    expect(report.rows.project_usage).toBe(1);
    expect(report.rows.project_artifacts).toBe(1);
    expect(report.rows.audit_events).toBeGreaterThan(0);
    // The colleague, and the owner who added them.
    expect(report.rows.workspace_members).toBe(2);
    expect(report.rows.project_members).toBe(2);
    for (const milliseconds of Object.values(report.milliseconds)) {
      expect(milliseconds).toBeGreaterThan(0);
    }
  });

  it('reads a PostgreSQL database and restores it as a SQLite file, with the same digests', async () => {
    const original = await populated();
    const postgres = keep(new Repository('pglite:memory'));
    copyDatabase(rawOf(original), rawOf(postgres));

    const report = rehearseRestore(rawOf(postgres), workDirectory());
    expect(report.differing).toEqual([]);
    expect(report.auditChainIntact).toBe(true);
    expect(report.carriesOn).toBe(true);
    expect(report.projectsRead).toBe(2);
  });

  it('notices a cell that comes back changed, not only a row that is missing', async () => {
    const source = await populated();
    const report = rehearseRestore(rawOf(source), workDirectory(), {
      afterRestore: (restored) =>
        restored
          .prepare(
            "UPDATE projects SET status = 'tampered' WHERE id = (SELECT MIN(id) FROM projects)",
          )
          .run(),
    });
    expect(report.differing).toEqual(['projects']);
  });

  it('notices a row that does not come back', async () => {
    const source = await populated();
    const report = rehearseRestore(rawOf(source), workDirectory(), {
      afterRestore: (restored) => restored.prepare('DELETE FROM chunks').run(),
    });
    expect(report.differing).toEqual(['chunks']);
  });

  it('notices a history that was rewritten, and says the chain no longer carries on', async () => {
    const source = await populated();
    const report = rehearseRestore(rawOf(source), workDirectory(), {
      afterRestore: (restored) => {
        restored.exec('DROP TRIGGER audit_events_no_update');
        restored.prepare("UPDATE audit_events SET actor = 'forged' WHERE seq = 1").run();
      },
    });
    expect(report.differing).toEqual(['audit_events']);
    expect(report.auditChainIntact).toBe(false);
    expect(report.carriesOn).toBe(false);
  });

  it('refuses a database that is not at the schema version of this release, and writes nothing', () => {
    const path = join(workDirectory(), 'old.sqlite');
    keep(new Repository(path)).close();
    repositories.splice(0);
    const legacy = new DatabaseSync(path);
    legacy.exec('DROP TABLE studio_documents; PRAGMA user_version = 6;');
    const directory = workDirectory();
    expect(() => rehearseRestore(new SqliteDatabase(legacy), directory)).toThrow(
      /schema version 6/u,
    );
    expect(readdirSync(directory)).toEqual([]);
    legacy.close();
  });
});

describe('rehearsing on a database that is in use', () => {
  it('sees what is only in the write-ahead log, and leaves the database and its folder as they were', () => {
    const folder = workDirectory();
    const path = join(folder, 'swarm.sqlite');
    // The application is running: it holds the file open, and what it has written is in the log.
    const live = keep(new Repository(path));
    live.create(fixtureInput({ name: 'First' }));
    live.create(fixtureInput({ name: 'Second' }));
    expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);

    const before = {
      files: readdirSync(folder).sort(),
      main: readFileSync(path),
      projects: live.count(),
    };
    const report = rehearseRestoreOf(path, workDirectory());

    expect(report.projectsRead).toBe(2);
    expect(report.rows.projects).toBe(2);
    expect(report.differing).toEqual([]);
    expect(readdirSync(folder).sort()).toEqual(before.files);
    expect(readFileSync(path).equals(before.main)).toBe(true);
    expect(live.count()).toBe(before.projects);
  });

  it('upgrades an older database inside its snapshot only, so the original is not changed', () => {
    const folder = workDirectory();
    const path = join(folder, 'old.sqlite');
    const first = new Repository(path);
    first.create(fixtureInput({ name: 'Kept' }));
    first.close();
    const legacy = new DatabaseSync(path);
    legacy.exec('DROP TABLE studio_documents; PRAGMA user_version = 6;');
    legacy.close();
    const before = readFileSync(path);

    const report = rehearseRestoreOf(path, workDirectory());

    expect(report.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(report.differing).toEqual([]);
    expect(report.projectsRead).toBe(1);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(folder).filter((name) => name.endsWith('.bak'))).toEqual([]);
  });

  it('refuses an in-memory database, and a file that is not there, without making one', () => {
    expect(() => rehearseRestoreOf(':memory:', workDirectory())).toThrow(/database file/u);
    const folder = workDirectory();
    expect(() => rehearseRestoreOf(join(folder, 'missing.sqlite'), workDirectory())).toThrow();
    expect(readdirSync(folder)).toEqual([]);
  });

  it('reads a PostgreSQL database by name', async () => {
    const original = await populated();
    const postgres = keep(new Repository('pglite:drilled'));
    copyDatabase(rawOf(original), rawOf(postgres));
    const report = rehearseRestoreOf('pglite:drilled', workDirectory());
    expect(report.differing).toEqual([]);
    expect(report.projectsRead).toBe(2);
  });
});
