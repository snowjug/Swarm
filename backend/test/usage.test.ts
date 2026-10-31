import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_BUDGET_LIMIT } from '../../shared/budget.js';
import { budgetState } from '../src/storage/usage.js';
import { Repository } from '../src/storage/repository.js';
import { fixtureInput } from './fixtures.js';

// The model budget of a project: what it has used, what it may use, and when the next call is refused.

const repositories: Repository[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const open = (target = ':memory:'): Repository => {
  const repository = new Repository(target);
  repositories.push(repository);
  return repository;
};
/** A project that has begun, so that it has execution metadata to record usage against. */
const begun = (repository: Repository) => {
  const project = repository.create(
    fixtureInput({ settings: { mode: 'llm', agentCount: 4, rounds: 3 } }),
  );
  repository.update(project.id, {
    execution: { provider: 'azure', model: 'm', modelCalls: 0, inputTokens: 0, outputTokens: 0 },
  });
  return project.id;
};
/** Asks as a model client of the project would, before a call. */
const admit = (repository: Repository, id: string): void => repository.modelUse(id).admit!();
const use = (repository: Repository, id: string, calls: number, input = 10, output = 5) => {
  for (let call = 0; call < calls; call++) repository.recordUsage(id, input, output);
};

describe('what a project has used', () => {
  it('starts at nothing, with no limit unless the deployment sets one', () => {
    const repository = open();
    const id = begun(repository);
    expect(repository.usage.get(id)).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      own: { callLimit: null, tokenLimit: null },
      limits: { callLimit: 0, tokenLimit: 0 },
      defaults: { callLimit: 0, tokenLimit: 0 },
    });
  });

  it('adds up every call and its tokens, in step with the execution record, and keeps them across a restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'swarm-usage-'));
    directories.push(directory);
    const path = join(directory, 'swarm.sqlite');
    const first = open(path);
    const id = begun(first);
    use(first, id, 3, 100, 40);
    expect(first.usage.get(id)).toMatchObject({ calls: 3, inputTokens: 300, outputTokens: 120 });
    expect(first.get(id).execution).toMatchObject({
      modelCalls: 3,
      inputTokens: 300,
      outputTokens: 120,
    });
    first.close();
    repositories.splice(0);

    const second = open(path);
    expect(second.usage.get(id)).toMatchObject({ calls: 3, inputTokens: 300, outputTokens: 120 });
  });

  it('keeps counting when the execution record is started again, because that is what a run does', () => {
    const repository = open();
    const id = begun(repository);
    use(repository, id, 2);
    // A new run starts its own counters at zero; what the project has spent does not go back.
    repository.update(id, {
      execution: { provider: 'azure', model: 'm', modelCalls: 0, inputTokens: 0, outputTokens: 0 },
    });
    use(repository, id, 1);
    expect(repository.get(id).execution?.modelCalls).toBe(1);
    expect(repository.usage.get(id).calls).toBe(3);
  });

  it("counts one project's calls and never another's", () => {
    const repository = open();
    const a = begun(repository);
    const b = begun(repository);
    use(repository, a, 4);
    use(repository, b, 1);
    expect(repository.usage.get(a).calls).toBe(4);
    expect(repository.usage.get(b).calls).toBe(1);
  });

  it('is deleted with its project', () => {
    const repository = open();
    const id = begun(repository);
    use(repository, id, 2);
    repository.delete(id);
    expect(repository.usage.get(id).calls).toBe(0);
  });
});

describe('the limits that apply', () => {
  it('are the deployment default until the project sets its own, and 0 lifts them', () => {
    const repository = open();
    repository.usage.setDefaults({ callLimit: 50, tokenLimit: 9_000 });
    const id = begun(repository);
    expect(repository.usage.get(id).limits).toEqual({ callLimit: 50, tokenLimit: 9_000 });

    repository.usage.setLimits(id, { callLimit: 5, tokenLimit: null });
    expect(repository.usage.get(id)).toMatchObject({
      own: { callLimit: 5, tokenLimit: null },
      limits: { callLimit: 5, tokenLimit: 9_000 },
      defaults: { callLimit: 50, tokenLimit: 9_000 },
    });

    repository.usage.setLimits(id, { callLimit: 0, tokenLimit: 0 });
    expect(repository.usage.get(id).limits).toEqual({ callLimit: 0, tokenLimit: 0 });

    repository.usage.setLimits(id, { callLimit: null, tokenLimit: null });
    expect(repository.usage.get(id).limits).toEqual({ callLimit: 50, tokenLimit: 9_000 });
  });

  it('are set without disturbing what has been used, and used without disturbing the limits', () => {
    const repository = open();
    const id = begun(repository);
    use(repository, id, 2, 10, 5);
    repository.usage.setLimits(id, { callLimit: 7, tokenLimit: 700 });
    expect(repository.usage.get(id)).toMatchObject({ calls: 2, inputTokens: 20, outputTokens: 10 });
    use(repository, id, 1, 10, 5);
    expect(repository.usage.get(id)).toMatchObject({
      calls: 3,
      own: { callLimit: 7, tokenLimit: 700 },
    });
  });

  it('are whole numbers, no larger than a person could mean', () => {
    const repository = open();
    const id = begun(repository);
    for (const bad of [-1, 1.5, MAX_BUDGET_LIMIT + 1, Number.NaN]) {
      expect(() => repository.usage.setLimits(id, { callLimit: bad, tokenLimit: null })).toThrow();
      expect(() => repository.usage.setLimits(id, { callLimit: null, tokenLimit: bad })).toThrow();
    }
    expect(repository.usage.get(id).own).toEqual({ callLimit: null, tokenLimit: null });
    repository.usage.setLimits(id, { callLimit: MAX_BUDGET_LIMIT, tokenLimit: 0 });
    expect(repository.usage.get(id).own).toEqual({ callLimit: MAX_BUDGET_LIMIT, tokenLimit: 0 });
  });
});

describe('when the next call is refused', () => {
  const refusal = { code: 'PROJECT_BUDGET', statusCode: 429 };

  it('is the call after the one that reaches a call limit, and not before', () => {
    const repository = open();
    const id = begun(repository);
    repository.usage.setLimits(id, { callLimit: 3, tokenLimit: null });
    for (let call = 1; call <= 3; call++) {
      expect(() => admit(repository, id), `call ${call}`).not.toThrow();
      use(repository, id, 1);
    }
    expect(() => admit(repository, id)).toThrowError(
      expect.objectContaining({
        ...refusal,
        message: expect.stringContaining('3 of 3 model calls'),
      }),
    );
  });

  it('is the call after the tokens reach a token limit, however few calls were made', () => {
    const repository = open();
    const id = begun(repository);
    repository.usage.setLimits(id, { callLimit: null, tokenLimit: 100 });
    use(repository, id, 1, 60, 30);
    expect(() => admit(repository, id)).not.toThrow();
    use(repository, id, 1, 6, 4);
    expect(() => admit(repository, id)).toThrowError(
      expect.objectContaining({
        ...refusal,
        message: expect.stringContaining('100 of 100 tokens'),
      }),
    );
  });

  it('never happens without a limit, however much has been used', () => {
    const repository = open();
    const id = begun(repository);
    use(repository, id, 50, 1_000, 1_000);
    expect(() => admit(repository, id)).not.toThrow();
  });

  it('applies the deployment default to a project that sets none, and the project’s own over it', () => {
    const repository = open();
    repository.usage.setDefaults({ callLimit: 2, tokenLimit: 0 });
    const id = begun(repository);
    use(repository, id, 2);
    expect(() => admit(repository, id)).toThrowError(expect.objectContaining(refusal));
    repository.usage.setLimits(id, { callLimit: 3, tokenLimit: null });
    expect(() => admit(repository, id)).not.toThrow();
    repository.usage.setLimits(id, { callLimit: 0, tokenLimit: null });
    use(repository, id, 10);
    expect(() => admit(repository, id)).not.toThrow();
  });

  it('is reported once for a client however many of its calls are refused', () => {
    const repository = open();
    const id = begun(repository);
    repository.usage.setLimits(id, { callLimit: 1, tokenLimit: null });
    use(repository, id, 1);
    const reports = () =>
      repository.audit
        .list({ projectId: id, limit: 500 })
        .filter((entry) => entry.action === 'model.budget.exhausted').length;
    // A round asks for several calls at once, and all of them are refused: that is one event.
    const client = repository.modelUse(id);
    for (let call = 0; call < 4; call++) expect(() => client.admit!()).toThrow();
    expect(reports()).toBe(1);
    // Another client, another operation, is another.
    expect(() => repository.modelUse(id).admit!()).toThrow();
    expect(reports()).toBe(2);
  });

  it('records that it happened, with counts and no content, and records nothing when it does not', () => {
    const repository = open();
    const id = begun(repository);
    repository.usage.setLimits(id, { callLimit: 1, tokenLimit: null });
    const before = repository.audit.list({ projectId: id, limit: 500 }).length;
    admit(repository, id);
    expect(repository.audit.list({ projectId: id, limit: 500 })).toHaveLength(before);

    use(repository, id, 1, 7, 3);
    expect(() => admit(repository, id)).toThrow();
    const entry = repository.audit.list({ projectId: id, limit: 500 }).at(-1)!;
    expect(entry).toMatchObject({
      action: 'model.budget.exhausted',
      targetType: 'project',
      targetId: id,
      detail: { calls: 1, callLimit: 1, tokens: 10, tokenLimit: 0 },
    });
    expect(repository.audit.verify().ok).toBe(true);
  });
});

describe('the state of a budget', () => {
  const state = (calls: number, tokens: number, callLimit: number, tokenLimit: number) =>
    budgetState({
      calls,
      inputTokens: tokens,
      outputTokens: 0,
      own: { callLimit: null, tokenLimit: null },
      limits: { callLimit, tokenLimit },
      defaults: { callLimit, tokenLimit },
    });

  it('is none without a limit, ok below four fifths, a warning from there, and exhausted at the limit', () => {
    expect(state(999, 999, 0, 0)).toBe('none');
    expect(state(79, 0, 100, 0)).toBe('ok');
    expect(state(80, 0, 100, 0)).toBe('warning');
    expect(state(99, 0, 100, 0)).toBe('warning');
    expect(state(100, 0, 100, 0)).toBe('exhausted');
    expect(state(250, 0, 100, 0)).toBe('exhausted');
  });

  it('is the worse of the calls and the tokens, and ignores a measure that has no limit', () => {
    expect(state(10, 95, 100, 100)).toBe('warning');
    expect(state(100, 5, 100, 100)).toBe('exhausted');
    expect(state(5, 100, 100, 100)).toBe('exhausted');
    expect(state(5, 5, 100, 100)).toBe('ok');
    expect(state(500, 85, 0, 100)).toBe('warning');
    expect(state(85, 500, 100, 0)).toBe('warning');
  });
});
