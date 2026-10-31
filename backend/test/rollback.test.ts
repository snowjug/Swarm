import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrate,
  readSchemaVersion,
  type Migration,
} from '../src/storage/migrations.js';
import { Repository } from '../src/storage/repository.js';
import { SqliteDatabase } from '../src/storage/sql.js';
import { fixtureInput } from './fixtures.js';

// Going back to the release before an upgrade: what the upgrade leaves behind, what the release
// before makes of an upgraded database, and that putting the copy back really returns to where it
// was. The release before is the one that knew the first six migrations.

const BEFORE = 6;
const RELEASE_BEFORE: readonly Migration[] = MIGRATIONS.filter(
  (migration) => migration.version <= BEFORE,
);

const directories: string[] = [];
const repositories: Repository[] = [];
afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const open = (path: string): Repository => {
  const repository = new Repository(path);
  repositories.push(repository);
  return repository;
};

function newDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'swarm-rollback-'));
  directories.push(directory);
  return join(directory, 'swarm.sqlite');
}

/** A database as the release before left it: one project, version 6, and no studio table. */
function databaseOfTheReleaseBefore(path: string): { id: string; name: string } {
  const first = new Repository(path);
  const project = first.create(fixtureInput({ workflow: 'guided' }));
  first.close();
  const legacy = new DatabaseSync(path);
  legacy.exec(`DROP TABLE studio_documents; PRAGMA user_version = ${BEFORE};`);
  legacy.close();
  return { id: project.id, name: project.name };
}

/** What the release before does at start: it migrates with the migrations it knows. */
function startReleaseBefore(path: string) {
  const raw = new DatabaseSync(path);
  try {
    const report = migrate(new SqliteDatabase(raw), { path, migrations: RELEASE_BEFORE });
    return { report, raw };
  } catch (error) {
    raw.close();
    throw error;
  }
}

/** The steps the runbook gives for putting a copy back: stop, clear the journal files, copy over. */
function putCopyBack(backup: string, path: string): void {
  for (const leftover of [`${path}-wal`, `${path}-shm`]) rmSync(leftover, { force: true });
  copyFileSync(backup, path);
}

function read<T>(path: string, read: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return read(database);
  } finally {
    database.close();
  }
}

const projectNames = (path: string): string[] =>
  read(path, (database) =>
    database
      .prepare("SELECT json_extract(payload, '$.name') AS name FROM projects ORDER BY created_at")
      .all()
      .map((row) => String((row as { name: unknown }).name)),
  );
const tablesOf = (path: string): string[] =>
  read(path, (database) =>
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String((row as { name: unknown }).name)),
  );
const versionOf = (path: string): number =>
  read(path, (database) => readSchemaVersion(new SqliteDatabase(database)));
const backupsBeside = (path: string): string[] =>
  readdirSync(dirname(path))
    .filter((file) => file.endsWith('.bak'))
    .sort();

describe('rolling a release back', () => {
  it('returns to the release before by putting back the copy the upgrade took, and the upgrade can be tried again', () => {
    const path = newDatabasePath();
    const { id, name } = databaseOfTheReleaseBefore(path);

    const upgraded = open(path);
    const backup = upgraded.migration.backup ?? '';
    expect(backup).toBe(`${path}.v${BEFORE}.bak`);
    expect(upgraded.migration.to).toBe(LATEST_SCHEMA_VERSION);
    upgraded.close();
    repositories.splice(0);

    // The release before cannot read what the newer one wrote, and leaves it as it found it.
    expect(() => startReleaseBefore(path)).toThrow(/newer application version/u);
    expect(versionOf(path)).toBe(LATEST_SCHEMA_VERSION);
    expect(projectNames(path)).toEqual([name]);

    // Putting the copy back returns to where it was: the release before opens it and finds its data.
    putCopyBack(backup, path);
    const before = startReleaseBefore(path);
    expect(before.report).toMatchObject({ from: BEFORE, to: BEFORE, applied: [] });
    before.raw.close();
    expect(projectNames(path)).toEqual([name]);
    expect(tablesOf(path)).not.toContain('studio_documents');

    // And the release that was rolled back can try again, losing nothing.
    const again = open(path);
    expect(again.migration).toMatchObject({ from: BEFORE, to: LATEST_SCHEMA_VERSION });
    expect(again.get(id).name).toBe(name);
  });

  it('takes a new copy when the database has changed since the last one, and keeps the older', () => {
    const path = newDatabasePath();
    const { name } = databaseOfTheReleaseBefore(path);

    const first = open(path);
    const firstBackup = first.migration.backup ?? '';
    first.close();
    repositories.splice(0);
    putCopyBack(firstBackup, path);

    // The release before carries on for a while, and the people using it change things.
    const edit = new DatabaseSync(path);
    edit.exec("UPDATE projects SET payload = json_set(payload, '$.name', 'Edited after rollback')");
    edit.close();

    // The next try at the upgrade must not report the first copy as its backup: it is out of date,
    // and restoring it would lose the edit.
    const second = open(path);
    const secondBackup = second.migration.backup ?? '';
    second.close();
    repositories.splice(0);
    expect(secondBackup).toBe(`${path}.v${BEFORE}.bak`);
    expect(projectNames(secondBackup)).toEqual(['Edited after rollback']);

    // The first copy is not overwritten: it stays, named for when it was last written.
    const kept = backupsBeside(path).filter((file) => file !== `swarm.sqlite.v${BEFORE}.bak`);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(/^swarm\.sqlite\.v6\.\d{8}T\d{6}Z\.bak$/u);
    expect(projectNames(join(dirname(path), kept[0] ?? ''))).toEqual([name]);
  });

  it('keeps the one copy when an upgrade that failed is tried again on a database that did not change', () => {
    const path = newDatabasePath();
    const migrations: Migration[] = [
      { version: 1, name: 'first', up: (db) => db.exec('CREATE TABLE kept (id INTEGER)') },
      {
        version: 2,
        name: 'second',
        up: (db) => {
          db.exec('CREATE TABLE lost (id INTEGER)');
          throw new Error('boom');
        },
      },
    ];
    const attempt = () => {
      const raw = new DatabaseSync(path);
      try {
        return migrate(new SqliteDatabase(raw), { path, migrations });
      } finally {
        raw.close();
      }
    };

    // A container that restarts again and again must not fill the disk with identical copies.
    for (let tries = 0; tries < 5; tries++) {
      expect(attempt).toThrow(/Migration 2 \(second\) failed and was rolled back/u);
    }
    expect(backupsBeside(path)).toEqual(['swarm.sqlite.v1.bak']);
    expect(existsSync(`${path}.v1.bak`)).toBe(true);
    expect(versionOf(path)).toBe(1);
  });
});
