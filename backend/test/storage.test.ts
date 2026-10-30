import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { LedgerService } from '../src/grounding/service.js';
import { sanitizeDetail } from '../src/storage/audit.js';
import {
  LATEST_SCHEMA_VERSION,
  migrate,
  readSchemaVersion,
  type Migration,
} from '../src/storage/migrations.js';
import { Repository } from '../src/storage/repository.js';
import { SqliteDatabase } from '../src/storage/sql.js';
import { fixtureInput } from './fixtures.js';

const directories: string[] = [];
function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'swarm-storage-'));
  directories.push(directory);
  return join(directory, 'swarm.sqlite');
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function tables(database: DatabaseSync): string[] {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String((row as { name: unknown }).name));
}

describe('schema migrations', () => {
  it('creates the whole schema on a new database', () => {
    const repository = new Repository(':memory:');
    expect(repository.migration).toMatchObject({
      from: 0,
      to: LATEST_SCHEMA_VERSION,
      backup: null,
    });
    expect(repository.migration.applied).toHaveLength(LATEST_SCHEMA_VERSION);
    repository.close();
  });

  it('upgrades a database from before migrations existed, keeps its data and takes a backup first', () => {
    const path = databasePath();
    const first = new Repository(path);
    const project = first.create(fixtureInput({ workflow: 'guided' }));
    first.close();

    // Turn it back into what the previous release wrote: version 1, no ledger or audit tables, and
    // passages without provenance.
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      DROP TRIGGER audit_events_no_update; DROP TRIGGER audit_events_no_delete;
      DROP TABLE claim_records; DROP TABLE source_conflicts; DROP TABLE ledger_state; DROP TABLE audit_events;
      UPDATE chunks SET payload = json_remove(payload, '$.contentHash', '$.extractedAt', '$.parserVersion', '$.reviewStatus');
      PRAGMA user_version = 1;
    `);
    legacy.close();

    const upgraded = new Repository(path);
    expect(upgraded.migration.from).toBe(1);
    expect(upgraded.migration.to).toBe(LATEST_SCHEMA_VERSION);
    expect(upgraded.migration.applied[0]).toMatch(/^2:/u);
    expect(upgraded.get(project.id).name).toBe(project.name);
    const [passage] = upgraded.chunks(project.id);
    expect(passage?.contentHash).toBeUndefined();

    // A project that predates the ledger still gets one, with the hash worked out on demand.
    const ledger = new LedgerService(upgraded).get(project.id);
    expect(ledger.claims).toEqual([]);

    const backup = upgraded.migration.backup;
    expect(backup).toBe(`${path}.v1.bak`);
    expect(existsSync(backup ?? '')).toBe(true);
    const copy = new DatabaseSync(backup ?? '', { readOnly: true });
    expect(readSchemaVersion(new SqliteDatabase(copy))).toBe(1);
    expect(tables(copy)).not.toContain('audit_events');
    copy.close();
    upgraded.close();

    const reopened = new Repository(path);
    expect(reopened.migration).toMatchObject({
      from: LATEST_SCHEMA_VERSION,
      applied: [],
      backup: null,
    });
    reopened.close();
  });

  it('refuses a database written by a newer release and leaves it untouched', () => {
    const path = databasePath();
    new Repository(path).close();
    const database = new DatabaseSync(path);
    database.exec('PRAGMA user_version = 99');
    const before = tables(database);
    database.close();

    expect(() => new Repository(path)).toThrow(/newer application version/u);

    const after = new DatabaseSync(path);
    expect(readSchemaVersion(new SqliteDatabase(after))).toBe(99);
    expect(tables(after)).toEqual(before);
    after.close();
  });

  it('rolls back a step that fails and says which one', () => {
    const database = new DatabaseSync(':memory:');
    const sql = new SqliteDatabase(database);
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
    expect(() => migrate(sql, { path: ':memory:', migrations })).toThrow(
      /Migration 2 \(second\) failed and was rolled back/u,
    );
    expect(readSchemaVersion(sql)).toBe(1);
    expect(tables(database)).toContain('kept');
    expect(tables(database)).not.toContain('lost');
    database.close();
  });
});

describe('the audit log', () => {
  it('chains every entry to the one before it and verifies', () => {
    const repository = new Repository(':memory:');
    const first = repository.audit.record({
      actor: 'a',
      action: 'x.one',
      targetType: 't',
      targetId: '1',
    });
    const second = repository.audit.record({
      actor: 'a',
      action: 'x.two',
      targetType: 't',
      targetId: '2',
    });
    expect(second.prevHash).toBe(first.hash);
    expect(repository.audit.verify()).toEqual({ ok: true, checked: 2, brokenAt: null });
    expect(repository.audit.list().map((event) => event.action)).toEqual(['x.one', 'x.two']);
    repository.close();
  });

  it('refuses to update or delete an entry', () => {
    const path = databasePath();
    const repository = new Repository(path);
    repository.audit.record({ actor: 'a', action: 'x', targetType: 't', targetId: '1' });
    const raw = new DatabaseSync(path);
    expect(() => raw.exec("UPDATE audit_events SET actor = 'someone else'")).toThrow(
      /append-only/u,
    );
    expect(() => raw.exec('DELETE FROM audit_events')).toThrow(/append-only/u);
    raw.close();
    repository.close();
  });

  it('notices an entry that was altered by someone who removed the protection', () => {
    const path = databasePath();
    const repository = new Repository(path);
    for (const id of ['1', '2', '3']) {
      repository.audit.record({ actor: 'a', action: 'x', targetType: 't', targetId: id });
    }
    const raw = new DatabaseSync(path);
    raw.exec('DROP TRIGGER audit_events_no_update');
    raw.exec("UPDATE audit_events SET actor = 'forged' WHERE seq = 2");
    raw.close();
    expect(repository.audit.verify()).toEqual({ ok: false, checked: 1, brokenAt: 2 });
    repository.close();
  });

  it('keeps what happened to a deleted project, and none of its content', () => {
    const repository = new Repository(':memory:');
    const project = repository.create(fixtureInput({ name: 'Confidential ferry plan' }));
    repository.delete(project.id);
    const events = repository.audit.list({ projectId: project.id });
    // What happened to it, from its creation to its deletion, survives the project itself.
    expect(events.map((event) => event.action)).toEqual(['project.created', 'project.deleted']);
    expect(events[1]).toMatchObject({ action: 'project.deleted', targetId: project.id });
    expect(JSON.stringify(events)).not.toContain('Confidential');
    expect(JSON.stringify(events)).not.toContain(project.question);
    expect(repository.audit.verify().ok).toBe(true);
    repository.close();
  });

  it('bounds what an entry can carry so it stays metadata', () => {
    const clean = sanitizeDetail({
      long: 'x'.repeat(5_000),
      ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])),
    });
    expect(Object.keys(clean).length).toBeLessThanOrEqual(12);
    expect(String(clean.long).length).toBe(200);
  });

  it('keeps the ledger of a deleted project from outliving it', () => {
    const repository = new Repository(':memory:');
    const project = repository.create(fixtureInput());
    new LedgerService(repository).get(project.id);
    expect(repository.ledger.state(project.id)).not.toBeNull();
    repository.delete(project.id);
    expect(repository.ledger.state(project.id)).toBeNull();
    expect(repository.ledger.claims(project.id)).toEqual([]);
    repository.close();
  });
});
