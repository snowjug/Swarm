import { afterEach, describe, expect, it, vi } from 'vitest';
import { Repository } from '../src/storage/repository.js';
import { fixtureInput } from './fixtures.js';

// A model call is held to the budget of its project whether or not the project has run the older
// pipeline: scenario work calls a model on a project that has no execution record at all.

const repositories: Repository[] = [];
afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
});
const open = (): Repository => {
  const repository = new Repository(':memory:');
  repositories.push(repository);
  return repository;
};

describe('the model use of a project with no execution record', () => {
  it('records each call in the budget, and tells the caller what was recorded', () => {
    const repository = open();
    const project = repository.create(fixtureInput());
    expect(project.execution).toBeNull();
    const heard = vi.fn();
    const use = repository.modelUse(project.id, heard);
    use({ inputTokens: 120, outputTokens: 30 });
    use({ inputTokens: 80, outputTokens: 20 });
    expect(repository.usage.get(project.id)).toMatchObject({
      calls: 2,
      inputTokens: 200,
      outputTokens: 50,
    });
    expect(heard).toHaveBeenCalledTimes(2);
    expect(repository.get(project.id).execution).toBeNull();
  });

  it('refuses the next call once the budget is used, and the audit log hears of it once', () => {
    const repository = open();
    const project = repository.create(fixtureInput());
    repository.usage.setLimits(project.id, { callLimit: 1, tokenLimit: null });
    const use = repository.modelUse(project.id);
    expect(() => use.admit!()).not.toThrow();
    use({ inputTokens: 10, outputTokens: 5 });
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(() => use.admit!()).toThrowError(expect.objectContaining({ code: 'PROJECT_BUDGET' }));
    }
    const exhausted = repository.audit
      .list({ projectId: project.id })
      .filter((entry) => entry.action === 'model.budget.exhausted');
    expect(exhausted).toHaveLength(1);
  });

  it('still keeps the run record in step when the project has one', () => {
    const repository = open();
    const project = repository.create(fixtureInput());
    repository.update(project.id, {
      execution: { provider: 'azure', model: 'm', modelCalls: 0, inputTokens: 0, outputTokens: 0 },
    });
    repository.modelUse(project.id)({ inputTokens: 40, outputTokens: 10 });
    expect(repository.get(project.id).execution).toMatchObject({
      modelCalls: 1,
      inputTokens: 40,
      outputTokens: 10,
    });
    expect(repository.usage.get(project.id)).toMatchObject({ calls: 1 });
  });
});
