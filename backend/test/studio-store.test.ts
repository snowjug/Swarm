import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioDocument } from '../../shared/studio.js';
import { AppError } from '../src/errors.js';
import { LATEST_SCHEMA_VERSION, readSchemaVersion } from '../src/storage/migrations.js';
import { Repository } from '../src/storage/repository.js';
import { SqliteDatabase, type SqlDatabase } from '../src/storage/sql.js';
import { MAX_STUDIO_PAYLOAD } from '../src/storage/studio-store.js';
import { editSection, startDocument } from '../src/studio/model.js';
import { fixtureInput } from './fixtures.js';
import { generatedReport } from './support/studio-world.js';

// How a Report Studio document is kept: one row per project, saved only from the revision it started
// from, deleted with its project, and brought into an existing database by a migration that keeps
// what was already there.

const directories: string[] = [];
const repositories: Repository[] = [];
afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const open = (target: string): Repository => {
  const repository = new Repository(target);
  repositories.push(repository);
  return repository;
};
const rawOf = (repository: Repository): SqlDatabase =>
  (repository as unknown as { database: SqlDatabase }).database;

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'swarm-studio-store-'));
  directories.push(directory);
  return join(directory, 'swarm.sqlite');
}

const T0 = '2026-10-30T10:00:00.000Z';
const document = (): StudioDocument => startDocument(generatedReport(), 'author', T0);

describe('the studio document store', () => {
  it('keeps one document per project and reads back exactly what was stored', () => {
    const repository = open(':memory:');
    const project = repository.create(fixtureInput({ workflow: 'guided' }));
    expect(repository.studio.get(project.id)).toBeNull();
    const doc = document();
    expect(repository.studio.insert(project.id, doc)).toBe(true);
    expect(repository.studio.get(project.id)).toEqual(doc);
    // A second first document is refused, and the first is not touched.
    expect(repository.studio.insert(project.id, { ...doc, createdBy: 'someone-else' })).toBe(false);
    expect(repository.studio.get(project.id)!.createdBy).toBe('author');
  });

  it('saves only from the revision the change started from, so that nobody overwrites anybody', () => {
    const repository = open(':memory:');
    const project = repository.create(fixtureInput({ workflow: 'guided' }));
    const doc = document();
    repository.studio.insert(project.id, doc);
    const mine = editSection(
      doc,
      'S1',
      { body: 'My text.', expectedVersion: 1, reason: null },
      'me',
      T0,
    );
    const yours = editSection(
      doc,
      'S2',
      { body: 'Your text.', expectedVersion: 1, reason: null },
      'you',
      T0,
    );
    expect(repository.studio.save(project.id, mine, doc.revision)).toBe(true);
    // Yours started from the revision mine replaced: it is refused, and what is stored is mine.
    expect(repository.studio.save(project.id, yours, doc.revision)).toBe(false);
    const stored = repository.studio.get(project.id)!;
    expect(stored.sections.find((s) => s.id === 'S1')!.body).toBe('My text.');
    expect(stored.sections.find((s) => s.id === 'S2')!.body).not.toBe('Your text.');
    // Saving a document for a project that has none is not an insert in disguise.
    const other = repository.create(fixtureInput({ workflow: 'guided' }));
    expect(repository.studio.save(other.id, mine, 1)).toBe(false);
    expect(repository.studio.get(other.id)).toBeNull();
  });

  it('keeps the state and revision in columns of their own, as well as in the document', () => {
    const repository = open(':memory:');
    const project = repository.create(fixtureInput({ workflow: 'guided' }));
    const doc = document();
    repository.studio.insert(project.id, doc);
    expect(
      rawOf(repository)
        .prepare('SELECT revision, state, updated_at FROM studio_documents WHERE project_id = ?')
        .get(project.id),
    ).toEqual({ revision: 1, state: 'draft', updated_at: T0 });
  });

  it('refuses a state the database does not know, even if the application did not', () => {
    const repository = open(':memory:');
    const project = repository.create(fixtureInput({ workflow: 'guided' }));
    expect(() =>
      rawOf(repository)
        .prepare(
          "INSERT INTO studio_documents (project_id, revision, state, updated_at, payload) VALUES (?, 1, 'published', ?, '{}')",
        )
        .run(project.id, T0),
    ).toThrow();
  });

  it('is deleted with its project', () => {
    const repository = open(':memory:');
    const project = repository.create(fixtureInput({ workflow: 'guided' }));
    const kept = repository.create(fixtureInput({ workflow: 'guided' }));
    repository.studio.insert(project.id, document());
    repository.studio.insert(kept.id, document());
    repository.delete(project.id);
    expect(repository.studio.get(project.id)).toBeNull();
    expect(repository.studio.get(kept.id)).not.toBeNull();
    expect(rawOf(repository).prepare('SELECT COUNT(*) AS n FROM studio_documents').get()).toEqual({
      n: 1,
    });
  });

  it('refuses a document that has grown past its bound, and keeps the one it had', () => {
    const repository = open(':memory:');
    const project = repository.create(fixtureInput({ workflow: 'guided' }));
    const doc = document();
    repository.studio.insert(project.id, doc);
    const oversized: StudioDocument = {
      ...doc,
      revision: 2,
      sections: doc.sections.map((s) =>
        s.id === 'S1' ? { ...s, body: 'x'.repeat(MAX_STUDIO_PAYLOAD + 1) } : s,
      ),
    };
    let caught: unknown;
    try {
      repository.studio.save(project.id, oversized, 1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('STUDIO_TOO_LARGE');
    expect((caught as AppError).statusCode).toBe(413);
    expect(repository.studio.get(project.id)!.revision).toBe(1);
    // The same bound applies to the first document.
    const fresh = repository.create(fixtureInput({ workflow: 'guided' }));
    expect(() => repository.studio.insert(fresh.id, oversized)).toThrow(/too large/u);
    expect(repository.studio.get(fresh.id)).toBeNull();
  });
  it('fails loudly on a row that is not a document, rather than showing it', () => {
    const repository = open(':memory:');
    const project = repository.create(fixtureInput({ workflow: 'guided' }));
    rawOf(repository)
      .prepare(
        "INSERT INTO studio_documents (project_id, revision, state, updated_at, payload) VALUES (?, 1, 'draft', ?, ?)",
      )
      .run(project.id, T0, JSON.stringify({ schemaVersion: 1, sections: 'not a list' }));
    expect(() => repository.studio.get(project.id)).toThrow();
  });
});

describe('the migration that adds it', () => {
  it('brings the table into a database from before it, keeps everything that was there, and takes a backup first', () => {
    const path = databasePath();
    const first = open(path);
    const project = first.create(fixtureInput({ workflow: 'guided' }));
    first.close();
    repositories.splice(0);

    // Turn it back into the release before: version 6, with no studio table.
    const legacy = new DatabaseSync(path);
    legacy.exec('DROP TABLE studio_documents; PRAGMA user_version = 6;');
    legacy.close();

    const upgraded = open(path);
    expect(upgraded.migration.from).toBe(6);
    expect(upgraded.migration.to).toBe(LATEST_SCHEMA_VERSION);
    expect(upgraded.migration.applied).toHaveLength(LATEST_SCHEMA_VERSION - 6);
    expect(upgraded.migration.applied[0]).toMatch(/^7:/u);
    expect(upgraded.get(project.id).name).toBe(project.name);
    expect(upgraded.studio.get(project.id)).toBeNull();
    expect(upgraded.studio.insert(project.id, document())).toBe(true);

    const backup = upgraded.migration.backup;
    expect(backup).toBe(`${path}.v6.bak`);
    expect(existsSync(backup ?? '')).toBe(true);
    const copy = new DatabaseSync(backup ?? '', { readOnly: true });
    expect(readSchemaVersion(new SqliteDatabase(copy))).toBe(6);
    const names = copy
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String((row as { name: unknown }).name));
    expect(names).not.toContain('studio_documents');
    copy.close();
  });

  it('is one more step than the release before, and a second open applies nothing', () => {
    const path = databasePath();
    open(path).close();
    repositories.splice(0);
    const again = open(path);
    expect(again.migration).toMatchObject({
      from: LATEST_SCHEMA_VERSION,
      applied: [],
      backup: null,
    });
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(7);
  });
});
