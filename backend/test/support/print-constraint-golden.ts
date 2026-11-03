import { analysisSchema, type SimulationSpec } from '../../../shared/analysis.js';
import { runAnalysis } from '../../src/analysis/runset.js';
import { simulate, simulateEachSpecOnce } from '../../src/simulation/simulate.js';
import { digest, exampleWorlds, type ExampleWorld } from './constraint-world.js';

/**
 * The engine's outputs on the worked examples, as fingerprints, so that a test can hold every later
 * change to the engine to "with no constraints, nothing moves". It prints the table that
 * `constraints-golden.test.ts` compares with.
 *
 * Make it again only when the engine itself is meant to change:
 * `npx tsx backend/test/support/print-constraint-golden.ts`.
 */
export const GOLDEN_SEEDS = [1, 7, 42] as const;
export const GOLDEN_ROUNDS = 10;
export const GOLDEN_ANALYSIS = {
  runsPerVariant: 6,
  baseSeed: 100,
  rounds: 10,
  sensitivity: true,
} as const;

export const specsOf = (world: ExampleWorld): SimulationSpec[] =>
  world.variants.map((variant) => ({
    actors: world.actors.actors,
    relations: world.actors.relations,
    rounds: GOLDEN_ROUNDS,
    variant,
  }));

export async function goldenTable(): Promise<Record<string, string>> {
  const table: Record<string, string> = {};
  for (const world of await exampleWorlds()) {
    const id = world.pack.id;
    for (const spec of specsOf(world)) {
      for (const seed of GOLDEN_SEEDS) {
        table[`${id}/${spec.variant.id}/${seed}`] = digest(simulate(spec, seed));
      }
    }
    const proposed = specsOf(world).find((spec) => spec.variant.kind === 'alternative');
    if (proposed) {
      table[`${id}/${proposed.variant.id}/7/no-signals`] = digest(
        simulate(proposed, 7, { signals: false }),
      );
      table[`${id}/${proposed.variant.id}/7/explained`] = digest(
        simulate(proposed, 7, { explain: true }),
      );
    }
    const analysis = await runAnalysis(
      {
        id: 'golden',
        createdAt: '2026-01-15T10:00:00.000Z',
        actors: world.actors.actors,
        relations: world.actors.relations,
        variants: world.variants,
        ...GOLDEN_ANALYSIS,
      },
      simulateEachSpecOnce(),
      { now: () => 1_700_000_000_000 },
    );
    table[`${id}/analysis`] = digest(
      analysisSchema.parse({
        ...analysis,
        completedAt: null,
        cost: { ...analysis.cost, wallMs: 0 },
      }),
    );
  }
  return table;
}

if (process.argv[1]?.endsWith('print-constraint-golden.ts')) {
  console.log(JSON.stringify(await goldenTable(), null, 2));
}
