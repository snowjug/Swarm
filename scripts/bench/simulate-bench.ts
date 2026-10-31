/**
 * Time and memory of the population simulator on a cast of the size the analysis will use.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/bench/simulate-bench.ts [--actors 20] [--members 30]
 *     [--rounds 24] [--runs 100] [--batches 5]
 *
 * The cast is built without any randomness, so the numbers are comparable from run to run: a ring of
 * cohorts that listen to their neighbours, with a competitor, a substitute, a regulator and a partner
 * among them. Each case runs the same seeds, in batches, with the aggregate signals and external
 * responders on and off, and with the spec validated on every run or once. Nothing here is a result
 * about any scenario; it measures the engine. The figures vary with whatever else the machine is
 * doing, so batches are reported as well as runs.
 */
import { cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import {
  simulationSpecSchema,
  type RunOutcome,
  type SimulationSpec,
} from '../../shared/analysis.js';
import { actorFixture } from '../../shared/lab-fixtures.js';
import type { Actor, StakeholderCategory } from '../../shared/stakeholders.js';
import { simulate, simulateValidated } from '../../backend/src/simulation/simulate.js';

function option(name: string, fallback: number): number {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? Number(process.argv[at + 1]) : fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} needs a whole number.`);
  return value;
}

const actorCount = option('actors', 20);
const members = option('members', 30);
const rounds = option('rounds', 24);
const runs = option('runs', 100);
const batches = option('batches', 5);

const CATEGORIES: StakeholderCategory[] = [
  'end-user',
  'cost-bearer',
  'beneficiary',
  'risk-bearer',
  'channel',
  'operations',
  'influencer',
  'governance',
];
const RESPONDERS: StakeholderCategory[] = ['competitor', 'substitute', 'regulator', 'partner'];

function cast(): { actors: Actor[]; relations: SimulationSpec['relations'] } {
  const firstResponder = Math.max(1, actorCount - RESPONDERS.length);
  const actors = Array.from({ length: actorCount }, (_, at): Actor => {
    const responder = at >= firstResponder;
    const category = responder
      ? (RESPONDERS[at - firstResponder] ?? 'competitor')
      : (CATEGORIES[at % CATEGORIES.length] ?? 'other');
    const actor = actorFixture(`actor-${at}`, category, {
      kind: 'cohort',
      size: 50 * (at + 1),
      sampleSize: members,
    });
    actor.traits.impact.value = responder ? 0 : -0.8 + (at % 5) * 0.3;
    actor.traits.sensitivity.value = 0.4 + (at % 4) * 0.15;
    actor.traits.switchingCost.value = 0.2 + (at % 6) * 0.12;
    actor.traits.riskTolerance.value = 0.2 + (at % 5) * 0.15;
    return actor;
  });
  const ring = actors.slice(0, firstResponder);
  const relations: SimulationSpec['relations'] = ring.map((actor, at) => ({
    from: actor.id,
    to: ring[(at + 1) % ring.length]?.id ?? actor.id,
    type: 'influences',
    strength: 0.4,
  }));
  actors.slice(firstResponder).forEach((responder, at) => {
    for (const target of [ring[at * 2], ring[at * 2 + 1]]) {
      if (target) {
        relations.push({ from: responder.id, to: target.id, type: 'competes-with', strength: 0.6 });
      }
    }
  });
  return { actors, relations };
}

const spec = simulationSpecSchema.parse({
  ...cast(),
  rounds,
  variant: {
    id: 'bench',
    label: 'Benchmark change',
    kind: 'alternative',
    round: 2,
    intensity: 0.7,
  },
});

// A handle on the garbage collector, so that heap figures are of live memory.
setFlagsFromString('--expose-gc');
const collect = runInNewContext('gc') as () => void;
const megabytes = (bytes: number): string => (bytes / 1_048_576).toFixed(1);

function percentile(sorted: number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
}

function bench(label: string, run: (seed: number) => RunOutcome): void {
  for (let seed = 1; seed <= 20; seed += 1) run(seed);
  collect();
  const heapBefore = process.memoryUsage().heapUsed;
  let peakHeap = heapBefore;
  const timings: number[] = [];
  const totals: number[] = [];
  let last: RunOutcome | null = null;
  for (let batch = 0; batch < batches; batch += 1) {
    const start = performance.now();
    for (let seed = 1; seed <= runs; seed += 1) {
      const began = performance.now();
      last = run(seed);
      timings.push(performance.now() - began);
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    }
    totals.push(performance.now() - start);
  }
  collect();
  const retained = process.memoryUsage().heapUsed - heapBefore;
  const sorted = [...timings].sort((a, b) => a - b);
  const byBatch = [...totals].sort((a, b) => a - b);
  const mean = timings.reduce((sum, value) => sum + value, 0) / timings.length;
  const median = percentile(sorted, 0.5);
  const ms = (value: number): string => value.toFixed(2);
  console.log(`\n${label}`);
  console.log(
    `  one run (ms), over ${timings.length} runs: median ${ms(median)}, mean ${ms(mean)}, p95 ${ms(percentile(sorted, 0.95))}, max ${ms(sorted[sorted.length - 1] ?? 0)}`,
  );
  console.log(
    `  ${runs} runs (ms), over ${batches} batches: fastest ${byBatch[0]?.toFixed(0)}, median ${percentile(byBatch, 0.5).toFixed(0)}, slowest ${byBatch[byBatch.length - 1]?.toFixed(0)}`,
  );
  console.log(
    `  work per run: ${last?.work.members} members, ${last?.work.updates} member updates, ${last?.events.length} events`,
  );
  console.log(
    `  throughput at the median: ${((last?.work.updates ?? 0) / median / 1000).toFixed(2)} million member updates per second`,
  );
  console.log(
    `  heap: peak growth ${megabytes(peakHeap - heapBefore)} MB, ${megabytes(retained)} MB retained after collection`,
  );
  console.log(`  one outcome as JSON: ${(JSON.stringify(last).length / 1024).toFixed(1)} KB`);
}

const machine = cpus();
console.log(
  `Cast: ${actorCount} actors x ${members} members x ${rounds} rounds, ${spec.relations.length} relations, ${runs} seeded runs per batch`,
);
console.log(
  `Machine: ${machine[0]?.model.trim()}, ${machine.length} logical cores, ${megabytes(totalmem())} MB memory, Node ${process.version}, ${process.platform}`,
);
bench('With signals and external responders (spec validated on every run)', (seed) =>
  simulate(spec, seed),
);
bench('Without signals (spec validated on every run)', (seed) =>
  simulate(spec, seed, { signals: false }),
);
bench('With signals, spec validated once (simulateValidated)', (seed) =>
  simulateValidated(spec, seed),
);

const parseStart = performance.now();
for (let at = 0; at < runs; at += 1) simulationSpecSchema.parse(spec);
console.log(
  `\nValidating the spec alone (done on every run by simulate): ${((performance.now() - parseStart) / runs).toFixed(2)} ms`,
);
