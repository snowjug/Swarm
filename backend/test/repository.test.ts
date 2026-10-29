import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_PROJECTS, type ChatMessage } from '../../shared/types.js';
import { Repository } from '../src/storage/repository.js';
import { fixtureInput } from './fixtures.js';
import { randomUUID } from 'node:crypto';

describe('SQLite persistence', () => {
  const repositories: Repository[] = [];
  const directories: string[] = [];
  const memory = () => {
    const repository = new Repository(':memory:');
    repositories.push(repository);
    return repository;
  };
  afterEach(() => {
    for (const repository of repositories.splice(0)) repository.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
  });

  it('persists source chunks and state across actual database reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'swarm-lab-storage-test-'));
    directories.push(directory);
    const path = join(directory, 'test.sqlite');
    const first = new Repository(path);
    const created = first.create(fixtureInput());
    first.update(created.id, { status: 'running', stage: 'simulation', progress: 35 });
    first.close();
    const reopened = new Repository(path);
    repositories.push(reopened);
    expect(reopened.get(created.id).documents).toEqual(created.documents);
    expect(reopened.chunks(created.id)[0]!.text).toContain('fictional scenario');
    reopened.recoverInterrupted();
    const recovered = reopened.get(created.id);
    expect(recovered.status).toBe('failed');
    expect(recovered.error).toContain('backend restarted');
    expect(recovered.events.at(-1)!.message).toContain('backend restarted');
    expect(recovered.report).toBeNull();
  });

  it('parameterizes untrusted strings and scopes evidence to its project', () => {
    const repository = memory();
    const input = fixtureInput();
    const first = repository.create({ ...input, name: "Robert'); DROP TABLE projects;--" });
    const second = repository.create({
      ...input,
      documents: [
        {
          name: "quoted';--.md",
          content: 'Telescopes observe distant galaxies and nebulae. '.repeat(4),
        },
      ],
    });
    expect(repository.count()).toBe(2);
    expect(repository.get(first.id).name).toContain('DROP TABLE');
    expect(repository.chunks(second.id).some((chunk) => chunk.text.includes('transit'))).toBe(
      false,
    );
    repository.delete(first.id);
    expect(repository.count()).toBe(1);
    expect(() => repository.chunks(first.id)).toThrow('does not exist');
    expect(repository.chunks(second.id)).toHaveLength(1);
  });

  it('enforces exactly 100 projects without silently dropping history', () => {
    const repository = memory();
    for (let index = 0; index < MAX_PROJECTS; index += 1) repository.create(fixtureInput());
    expect(repository.count()).toBe(MAX_PROJECTS);
    expect(() => repository.create(fixtureInput())).toThrow('at most 100');
    expect(repository.list(10, 10).projects).toHaveLength(10);
    expect(repository.list().total).toBe(100);
  });

  // The limit is per tenant, so the whole database can hold many more than one page of projects. A
  // run that was interrupted by a restart must be recovered wherever it sits in that list, or it
  // stays "running" for ever: it cannot be deleted, cancelled or restarted, and it keeps counting
  // against its tenant's allowance.
  it('recovers every interrupted run, however many experiments the database holds', () => {
    const repository = memory();
    const ids: string[] = [];
    for (const tenantId of ['tenant-a', 'tenant-b']) {
      for (let index = 0; index < MAX_PROJECTS; index += 1) {
        const created = repository.create(fixtureInput(), { owner: { tenantId, ownerId: 'user' } });
        repository.update(created.id, { status: 'running', stage: 'simulation', progress: 35 });
        ids.push(created.id);
      }
    }
    expect(repository.count()).toBe(2 * MAX_PROJECTS);

    repository.recoverInterrupted();

    const stillRunning = ids.filter((id) => repository.get(id).status === 'running');
    expect(stillRunning).toEqual([]);
    expect(repository.get(ids[0]!).status).toBe('failed');
    expect(repository.get(ids.at(-1)!).status).toBe('failed');
  });

  it('enforces the exchange limit atomically and cascades deletion', () => {
    const repository = memory();
    const project = repository.create(fixtureInput());
    const message = (): ChatMessage => ({
      id: randomUUID(),
      target: 'report',
      role: 'user',
      content: 'A test question',
      sourceIds: [],
      mode: 'local',
      createdAt: new Date().toISOString(),
    });
    repository.appendMessages(project.id, Array.from({ length: 60 }, message));
    expect(() => repository.appendMessages(project.id, [message(), message()])).toThrow(
      '30 follow-up',
    );
    expect(repository.messageCount(project.id)).toBe(60);
    repository.delete(project.id);
    expect(repository.messageCount(project.id)).toBe(0);
  });
});
