import { afterEach, describe, expect, it } from 'vitest';
import { analysisSchema } from '../../shared/analysis.js';
import { MAX_ARTIFACT_BYTES, artifactSchemas } from '../../shared/artifacts.js';
import { FIXTURE_VARIANTS, analysisFixture } from '../../shared/lab-fixtures.js';
import { AppError } from '../src/errors.js';
import { Repository } from '../src/storage/repository.js';
import type { SqlDatabase } from '../src/storage/sql.js';
import { fixtureInput } from './fixtures.js';

const repositories: Repository[] = [];
afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
});

function repository(): Repository {
  const made = new Repository(':memory:');
  repositories.push(made);
  return made;
}

const rawOf = (value: Repository): SqlDatabase =>
  (value as unknown as { database: SqlDatabase }).database;

const frame = (decision: string) =>
  artifactSchemas.scenario.parse({
    decision,
    system: 'A regional service',
    baseline: 'Nothing changes.',
    origin: 'user',
  });

async function failure(action: () => unknown): Promise<AppError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('Expected the action to be refused.');
}

describe('project artifacts', () => {
  it('stores a validated document, reads it back, and numbers its revisions from 1', () => {
    const store = repository();
    const project = store.create(fixtureInput());
    expect(store.artifacts.get(project.id, 'scenario')).toBeNull();

    const first = store.artifacts.put(project.id, 'scenario', 'default', frame('Change the price'));
    expect(first.revision).toBe(1);
    expect(first.data.decision).toBe('Change the price');
    expect(first.data.alternatives).toEqual([]);

    const second = store.artifacts.put(project.id, 'scenario', 'default', frame('Change it twice'));
    expect(second.revision).toBe(2);
    expect(second.createdAt).toBe(first.createdAt);
    expect(store.artifacts.get(project.id, 'scenario')?.data.decision).toBe('Change it twice');
  });

  it('refuses a write made against a revision that has since moved, and one that expects a document that is not there', async () => {
    const store = repository();
    const project = store.create(fixtureInput());
    store.artifacts.put(project.id, 'scenario', 'default', frame('One'), { expectedRevision: 0 });
    store.artifacts.put(project.id, 'scenario', 'default', frame('Two'), { expectedRevision: 1 });

    const stale = await failure(() =>
      store.artifacts.put(project.id, 'scenario', 'default', frame('Stale'), {
        expectedRevision: 1,
      }),
    );
    expect(stale).toMatchObject({ statusCode: 409, code: 'ARTIFACT_CONFLICT' });

    const missing = await failure(() =>
      store.artifacts.put(project.id, 'scenario', 'other', frame('Nope'), { expectedRevision: 3 }),
    );
    expect(missing.code).toBe('ARTIFACT_CONFLICT');
    expect(store.artifacts.get(project.id, 'scenario')?.data.decision).toBe('Two');
    expect(store.artifacts.get(project.id, 'scenario', 'other')).toBeNull();
  });

  it('checks a document against its kind before it is stored, and stores nothing when it fails', () => {
    const store = repository();
    const project = store.create(fixtureInput());
    const invalid = { ...frame('Valid'), origin: 'guess' } as unknown as ReturnType<typeof frame>;
    expect(() => store.artifacts.put(project.id, 'scenario', 'default', invalid)).toThrow();
    expect(store.artifacts.get(project.id, 'scenario')).toBeNull();
  });

  it('refuses a key that is not plain', async () => {
    const store = repository();
    const project = store.create(fixtureInput());
    const key = await failure(() =>
      store.artifacts.put(project.id, 'scenario', '../escape', frame('Key')),
    );
    expect(key.code).toBe('ARTIFACT_KEY_INVALID');
    expect(store.artifacts.list(project.id, 'scenario')).toEqual([]);
  });

  describe('a document that is too large', () => {
    const rowShares = {
      adopt: 0.123456789,
      'accept-with-conditions': 0.234567891,
      wait: 0.345678912,
      'adapt-defensively': 0.123456789,
      switch: 0.111111111,
      resist: 0.062345679,
    };
    /**
     * A comparison that the schema accepts: `variants` options of 100 seeded runs each, and `rows`
     * rows of actor detail spread over the runs, 60 to a run. Whatever `fill` is goes in the
     * caveats, which may hold text of any width.
     */
    const comparison = (variants: number, rows: number, fill = '') => {
      const base = analysisFixture();
      const ids = Array.from({ length: variants }, (_, index) => `option-${index + 1}`);
      let left = rows;
      const run = (seed: number) => {
        const here = Math.min(60, left);
        left -= here;
        return {
          seed,
          stanceMean: -0.123456789,
          responseShares: rowShares,
          byActor: Array.from({ length: here }, (_, at) => ({
            actorId: `a${String(at).padStart(2, '0')}`,
            members: 10,
            stanceMean: 0.123456789,
            responseShares: rowShares,
          })),
        };
      };
      return analysisSchema.parse({
        ...base,
        config: {
          ...base.config,
          runsPerVariant: 100,
          variants: ids.map((id, index) => ({
            ...FIXTURE_VARIANTS[index === 0 ? 0 : 1]!,
            id,
            label: `Option ${index + 1}`,
          })),
        },
        variants: ids.map((variantId) => ({
          variantId,
          runs: Array.from({ length: 100 }, (_, index) => run(index + 1)),
          trajectory: base.variants[0]!.trajectory,
        })),
        findings: [],
        sensitivity: [],
        fidelity: {
          ...base.fidelity,
          caveats: fill === '' ? [] : (fill.match(/[^]{1,300}/gu) ?? []),
        },
      });
    };
    const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

    /** A comparison of exactly this many bytes, its last stretch made of 3-byte characters. */
    const exactly = (bytes: number) => {
      const empty = bytesOf(comparison(3, 0));
      const perRow = (bytesOf(comparison(3, 1_200)) - empty) / 1_200;
      const rows = Math.floor((bytes - empty - 4_500) / perRow);
      let pad = bytes - bytesOf(comparison(3, rows));
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const wide = Math.floor(pad / 3);
        const made = comparison(3, rows, `${'€'.repeat(wide)}${'x'.repeat(pad - 3 * wide)}`);
        const size = bytesOf(made);
        if (size === bytes) return { made, characters: JSON.stringify(made).length };
        pad += bytes - size;
      }
      throw new Error(`Could not make a comparison of ${bytes} bytes.`);
    };

    it('is refused with a 413 and stored nowhere: three options of 100 runs, each run with 60 actors', async () => {
      const store = repository();
      const project = store.create(fixtureInput());
      const huge = comparison(3, 3 * 100 * 60);
      expect(bytesOf(huge)).toBeGreaterThan(2 * MAX_ARTIFACT_BYTES);
      const refused = await failure(() =>
        store.artifacts.put(project.id, 'analysis', 'huge', huge),
      );
      expect(refused).toMatchObject({ statusCode: 413, code: 'ARTIFACT_TOO_LARGE' });
      expect(store.artifacts.get(project.id, 'analysis', 'huge')).toBeNull();
      expect(store.artifacts.list(project.id, 'analysis')).toEqual([]);
    });

    it('does not replace what is stored: a refused write leaves the earlier revision as it was', async () => {
      const store = repository();
      const project = store.create(fixtureInput());
      store.artifacts.put(project.id, 'analysis', 'run', comparison(3, 60));
      const refused = await failure(() =>
        store.artifacts.put(project.id, 'analysis', 'run', comparison(3, 3 * 100 * 60)),
      );
      expect(refused.code).toBe('ARTIFACT_TOO_LARGE');
      const kept = store.artifacts.get(project.id, 'analysis', 'run');
      expect(kept?.revision).toBe(1);
      expect(kept?.data.variants[0]?.runs[0]?.byActor).toHaveLength(60);
    });

    it('counts bytes, not characters: the limit itself is allowed and one byte more is not', async () => {
      const store = repository();
      const project = store.create(fixtureInput());
      const at = exactly(MAX_ARTIFACT_BYTES);
      // Most of the text is wide characters, so a count of characters would be well under the limit.
      expect(at.characters).toBeLessThan(MAX_ARTIFACT_BYTES - 1_000);
      expect(store.artifacts.put(project.id, 'analysis', 'at-limit', at.made).revision).toBe(1);
      expect(
        store.artifacts.get(project.id, 'analysis', 'at-limit')?.data.fidelity.caveats[0],
      ).toMatch(/^€+/u);

      const over = exactly(MAX_ARTIFACT_BYTES + 1);
      expect(over.characters).toBeLessThan(MAX_ARTIFACT_BYTES);
      const refused = await failure(() =>
        store.artifacts.put(project.id, 'analysis', 'over-limit', over.made),
      );
      expect(refused).toMatchObject({ statusCode: 413, code: 'ARTIFACT_TOO_LARGE' });
      expect(store.artifacts.get(project.id, 'analysis', 'over-limit')).toBeNull();
    });
  });

  it('keeps one document per key and lists a kind oldest first', () => {
    const store = repository();
    const project = store.create(fixtureInput());
    store.artifacts.put(project.id, 'scenario', 'b', frame('B'));
    store.artifacts.put(project.id, 'scenario', 'a', frame('A'));
    const listed = store.artifacts.list(project.id, 'scenario');
    expect(listed).toHaveLength(2);
    expect(new Set(listed.map((record) => record.key))).toEqual(new Set(['a', 'b']));
    expect(store.artifacts.list(project.id, 'stakeholders')).toEqual([]);
  });

  it('is private to its project, and goes when the project goes', () => {
    const store = repository();
    const first = store.create(fixtureInput({ name: 'First project' }));
    const second = store.create(fixtureInput({ name: 'Second project' }));
    store.artifacts.put(first.id, 'scenario', 'default', frame('Mine'));
    expect(store.artifacts.get(second.id, 'scenario')).toBeNull();

    store.delete(first.id);
    const left = rawOf(store)
      .prepare('SELECT COUNT(*) AS count FROM project_artifacts WHERE project_id = ?')
      .get(first.id);
    expect(Number(left?.count)).toBe(0);
  });

  it('copies documents to another project, each as a new document at revision 1', () => {
    const store = repository();
    const from = store.create(fixtureInput({ name: 'Original' }));
    const to = store.create(fixtureInput({ name: 'Branch' }));
    store.artifacts.put(from.id, 'scenario', 'default', frame('One'));
    store.artifacts.put(from.id, 'scenario', 'default', frame('Two'));
    expect(store.artifacts.copy(from.id, to.id, ['scenario', 'stakeholders'])).toBe(1);
    const copy = store.artifacts.get(to.id, 'scenario');
    expect(copy).toMatchObject({ revision: 1 });
    expect(copy?.data.decision).toBe('Two');
  });

  it('says plainly when a stored document no longer matches its schema', async () => {
    const store = repository();
    const project = store.create(fixtureInput());
    store.artifacts.put(project.id, 'scenario', 'default', frame('Fine'));
    rawOf(store)
      .prepare('UPDATE project_artifacts SET payload = ? WHERE project_id = ?')
      .run('{"decision": 7}', project.id);
    const broken = await failure(() => store.artifacts.get(project.id, 'scenario'));
    expect(broken).toMatchObject({ statusCode: 500, code: 'ARTIFACT_INVALID' });
  });

  it('lists a kind across every project for maintenance, leaving out what it cannot read', () => {
    const store = repository();
    const first = store.create(fixtureInput({ name: 'First project' }));
    const second = store.create(fixtureInput({ name: 'Second project' }));
    store.artifacts.put(first.id, 'scenario', 'a', frame('A'));
    store.artifacts.put(second.id, 'scenario', 'b', frame('B'));
    store.artifacts.put(second.id, 'scenario', 'broken', frame('C'));
    rawOf(store)
      .prepare('UPDATE project_artifacts SET payload = ? WHERE artifact_key = ?')
      .run('{"decision": 7}', 'broken');
    const all = store.artifacts.listAll('scenario');
    expect(
      all
        .map((record) => [record.projectId, record.key])
        .sort((a, b) => a[1]!.localeCompare(b[1]!)),
    ).toEqual([
      [first.id, 'a'],
      [second.id, 'b'],
    ]);
    expect(store.artifacts.listAll('stakeholders')).toEqual([]);
    const some = store.artifacts.listAll('scenario', {
      matching: (payload) => payload.includes('"decision":"B"'),
    });
    expect(some.map((record) => record.key)).toEqual(['b']);
  });
});
