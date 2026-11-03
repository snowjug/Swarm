import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { simulate } from '../src/simulation/simulate.js';
import { digest, exampleWorlds } from './support/constraint-world.js';
import { GOLDEN_SEEDS, goldenTable, specsOf } from './support/print-constraint-golden.js';

/**
 * The engine's outputs on the five worked examples, as they were before constraints existed, kept as
 * fingerprints of the whole outcome (every round, every actor, every event). `constraints-golden.json`
 * was made by `print-constraint-golden.ts` on the engine as it stood at the premium baseline, and is
 * not to be made again unless the engine itself is meant to change: it is what makes "no constraints,
 * nothing moves" a fact that is checked and not a claim.
 */
const golden = JSON.parse(
  readFileSync(new URL('./support/constraints-golden.json', import.meta.url), 'utf8'),
) as Record<string, string>;

describe('with no constraints, the engine gives what it always gave', () => {
  it('is byte-identical to the baseline on every worked example, scenario and seed, with and without its second-order parts, and for a whole comparison', async () => {
    const table = await goldenTable();
    expect(Object.keys(table).sort()).toEqual(Object.keys(golden).sort());
    const differing = Object.keys(golden).filter((name) => table[name] !== golden[name]);
    expect(differing).toEqual([]);
    // 5 examples, each with its scenarios on 3 seeds, a run without signals, an explained run and a comparison.
    expect(Object.keys(golden).length).toBeGreaterThan(45);
  });

  it('is not moved by an empty list of constraints either', async () => {
    for (const world of await exampleWorlds()) {
      for (const spec of specsOf(world)) {
        for (const seed of GOLDEN_SEEDS) {
          expect(
            digest(simulate({ ...spec, constraints: [] }, seed)),
            `${world.pack.id}/${spec.variant.id}/${seed}`,
          ).toBe(golden[`${world.pack.id}/${spec.variant.id}/${seed}`]);
        }
      }
    }
  });

  it('writes no constraint field into an outcome that had none', async () => {
    const [world] = await exampleWorlds();
    const [spec] = specsOf(world!);
    const outcome = simulate(spec!, 7);
    expect(Object.keys(outcome)).not.toContain('constraintEvents');
    expect(JSON.stringify(outcome)).not.toContain('constraint');
  });
});
