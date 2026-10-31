import { MAX_ARTIFACT_BYTES } from '../../../shared/artifacts.js';
import {
  MAX_RUNS_PER_VARIANT,
  MAX_TOTAL_RUNS,
  MAX_VARIANTS,
  MIN_RUNS_PER_VARIANT,
  planRuns,
  type RunPlan,
} from '../../../shared/analysis-plan.js';
import {
  MAX_ROUNDS,
  type ActorOutcome,
  type Analysis,
  type ResponseShares,
  type RunOutcome,
  type RunSummary,
  type SimulationSpec,
  type Simulator,
  type Variant,
  type VariantResult,
} from '../../../shared/analysis.js';
import type { Actor, ActorRelation } from '../../../shared/stakeholders.js';
import { AppError } from '../errors.js';
import { generateFindings, type RunRecord } from './findings.js';
import { headlineShare, planPerturbations, runSensitivity } from './sensitivity.js';
import { mean, quantile, round4 } from './stats.js';

/**
 * Runs every variant on the same seeds, once each seed, and turns the runs into an `Analysis`: the
 * spread of the outcomes, the findings with their repeatability, and the sensitivity of the proposed
 * change to the assumptions behind it. The simulator is passed in, so this never knows which engine
 * it is driving; it only needs the contract that the same spec and seed give the same outcome.
 */

export interface AnalysisInputs {
  id: string;
  createdAt: string;
  actors: Actor[];
  relations: ActorRelation[];
  variants: Variant[];
  runsPerVariant: number;
  baseSeed: number;
  rounds: number;
  sensitivity: boolean;
  /** The share in switch or resist that a threshold finding tests for. */
  adverseThreshold?: number;
}

export interface AnalysisHooks {
  /** Called after every run. The caller decides how often to save it. */
  onProgress?: (progress: { completedRuns: number; totalRuns: number }) => void;
  /** Asked before every run; true stops the analysis there. */
  shouldCancel?: () => boolean;
  /** Awaited after every run, so that the server stays responsive while a long analysis runs. */
  yieldNow?: () => Promise<void>;
  now?: () => number;
}

/** Leaves room beneath the artifact limit for what the document carries besides the runs. */
export const SIZE_BUDGET_BYTES = Math.floor(MAX_ARTIFACT_BYTES * 0.9);

const DETAIL_DROPPED =
  'The per-actor results of each individual run were not stored, because the document would be too large; per-actor totals over the runs are kept, and every finding was counted from the full results while the runs were in memory.';

const invalid = (message: string): AppError => new AppError(400, 'ANALYSIS_INPUT_INVALID', message);

/** What a request must satisfy, said in words a person can act on. */
export function validateInputs(inputs: AnalysisInputs): { plan: RunPlan; perturbations: number } {
  const { variants, actors } = inputs;
  if (
    inputs.runsPerVariant < MIN_RUNS_PER_VARIANT ||
    inputs.runsPerVariant > MAX_RUNS_PER_VARIANT
  ) {
    throw invalid(
      `Choose between ${MIN_RUNS_PER_VARIANT} and ${MAX_RUNS_PER_VARIANT} seeded runs for each scenario.`,
    );
  }
  if (variants.length < 2 || variants.length > MAX_VARIANTS) {
    throw invalid(
      `Compare between 2 and ${MAX_VARIANTS} scenarios: a baseline and at least one alternative.`,
    );
  }
  if (new Set(variants.map((variant) => variant.id)).size !== variants.length) {
    throw invalid('Each scenario needs an id of its own.');
  }
  if (
    variants.filter((variant) => variant.kind === 'baseline').length !== 1 ||
    !variants.some((variant) => variant.kind === 'alternative')
  ) {
    throw invalid(
      'Include exactly one baseline scenario (where nothing changes) and at least one alternative.',
    );
  }
  if (actors.length < 1) throw invalid('There are no actors to simulate.');
  if (inputs.rounds < 3 || inputs.rounds > MAX_ROUNDS) {
    throw invalid(`A run has between 3 and ${MAX_ROUNDS} rounds.`);
  }
  const known = new Set(actors.map((actor) => actor.id));
  for (const variant of variants) {
    if (variant.round > inputs.rounds) {
      throw invalid(
        `“${variant.label}” starts its change in round ${variant.round}, but a run has only ${inputs.rounds} rounds.`,
      );
    }
    const named = [
      ...Object.keys(variant.impactOverrides),
      ...variant.traitEdits.map((edit) => edit.actorId),
    ];
    if (named.some((id) => !known.has(id))) {
      throw invalid(`“${variant.label}” refers to an actor that is not in the cast.`);
    }
  }
  if (inputs.baseSeed + inputs.runsPerVariant - 1 > 2_147_483_647) {
    throw invalid('The seeds would run past 2,147,483,647. Choose a smaller first seed.');
  }
  const proposed = variants.find((variant) => variant.kind === 'alternative');
  const perturbations = planPerturbations(actors, proposed).length;
  const plan = planRuns({
    variants: variants.length,
    runsPerVariant: inputs.runsPerVariant,
    sensitivity: inputs.sensitivity,
    perturbations,
  });
  if (plan.totalRuns > MAX_TOTAL_RUNS) {
    throw invalid(
      `This would take ${plan.totalRuns.toLocaleString('en-GB')} simulated runs and the limit is ${MAX_TOTAL_RUNS.toLocaleString('en-GB')}. Use fewer runs for each scenario or fewer scenarios, or turn sensitivity off.`,
    );
  }
  return { plan, perturbations };
}

function recordOf(outcome: RunOutcome, seed: number): RunRecord {
  let peak = headlineShare(outcome.final.responseShares);
  for (const round of outcome.rounds) peak = Math.max(peak, headlineShare(round.responseShares));
  return {
    summary: {
      seed,
      stanceMean: outcome.final.stanceMean,
      responseShares: outcome.final.responseShares,
      byActor: outcome.final.byActor,
    },
    actors: new Map(outcome.final.byActor.map((actor) => [actor.actorId, actor])),
    rounds: outcome.rounds.map((round) => ({ round: round.round, stanceMean: round.stanceMean })),
    eventKinds: [...new Set(outcome.events.map((event) => event.kind))].sort(),
    peakAdverse: peak,
  };
}

function roundShares(shares: ResponseShares): ResponseShares {
  return {
    adopt: round4(shares.adopt),
    'accept-with-conditions': round4(shares['accept-with-conditions']),
    wait: round4(shares.wait),
    'adapt-defensively': round4(shares['adapt-defensively']),
    switch: round4(shares.switch),
    resist: round4(shares.resist),
  };
}

function compactSummary(summary: RunSummary): RunSummary {
  return {
    seed: summary.seed,
    stanceMean: round4(summary.stanceMean),
    responseShares: roundShares(summary.responseShares),
    byActor: summary.byActor.map((actor): ActorOutcome => ({
      actorId: actor.actorId,
      members: actor.members,
      stanceMean: round4(actor.stanceMean),
      responseShares: roundShares(actor.responseShares),
    })),
  };
}

function trajectoryOf(records: readonly RunRecord[]): VariantResult['trajectory'] {
  const byRound = new Map<number, number[]>();
  for (const record of records) {
    for (const { round, stanceMean } of record.rounds) {
      byRound.set(round, [...(byRound.get(round) ?? []), stanceMean]);
    }
  }
  return [...byRound]
    .sort((a, b) => a[0] - b[0])
    .map(([round, stances]) => ({
      round,
      p10: round4(quantile(stances, 0.1)),
      p50: round4(quantile(stances, 0.5)),
      p90: round4(quantile(stances, 0.9)),
    }));
}

function actorTotals(
  actors: readonly Actor[],
  records: readonly RunRecord[],
): NonNullable<VariantResult['actors']> {
  const totals: NonNullable<VariantResult['actors']> = [];
  for (const actor of actors) {
    const outcomes = records
      .map((record) => record.actors.get(actor.id))
      .filter((outcome): outcome is ActorOutcome => outcome !== undefined);
    const first = outcomes[0];
    if (!first) continue;
    const shares = roundShares({
      adopt: mean(outcomes.map((outcome) => outcome.responseShares.adopt)),
      'accept-with-conditions': mean(
        outcomes.map((outcome) => outcome.responseShares['accept-with-conditions']),
      ),
      wait: mean(outcomes.map((outcome) => outcome.responseShares.wait)),
      'adapt-defensively': mean(
        outcomes.map((outcome) => outcome.responseShares['adapt-defensively']),
      ),
      switch: mean(outcomes.map((outcome) => outcome.responseShares.switch)),
      resist: mean(outcomes.map((outcome) => outcome.responseShares.resist)),
    });
    totals.push({
      actorId: actor.id,
      members: first.members,
      stanceMean: round4(mean(outcomes.map((outcome) => outcome.stanceMean))),
      responseShares: shares,
    });
  }
  return totals;
}

/** The run whose overall final stance is nearest the median; the lowest seed when two are as near. */
function nearestMedian(records: readonly RunRecord[]): RunRecord | undefined {
  const median = quantile(
    records.map((record) => record.summary.stanceMean),
    0.5,
  );
  let best = records[0];
  for (const record of records) {
    if (
      best &&
      Math.abs(record.summary.stanceMean - median) <
        Math.abs(best.summary.stanceMean - median) - 1e-12
    ) {
      best = record;
    }
  }
  return best;
}

const sizeOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

export async function runAnalysis(
  inputs: AnalysisInputs,
  simulator: Simulator,
  hooks: AnalysisHooks = {},
): Promise<Analysis> {
  const { plan } = validateInputs(inputs);
  const now = hooks.now ?? Date.now;
  const yieldNow = hooks.yieldNow ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
  const startedAt = now();
  const { variants } = inputs;
  const proposed = variants.find((variant) => variant.kind === 'alternative');
  const specs = new Map<string, SimulationSpec>(
    variants.map((variant) => [
      variant.id,
      { actors: inputs.actors, relations: inputs.relations, rounds: inputs.rounds, variant },
    ]),
  );
  const seeds = Array.from(
    { length: inputs.runsPerVariant },
    (_, index) => inputs.baseSeed + index,
  );
  const records = new Map<string, RunRecord[]>(variants.map((variant) => [variant.id, []]));
  let completedRuns = 0;
  let simulatedRuns = 0;
  let simulatedMembers = 0;
  const counted = (members: number): void => {
    simulatedRuns += 1;
    simulatedMembers += members;
  };
  const advance = (): void => {
    completedRuns += 1;
    hooks.onProgress?.({ completedRuns, totalRuns: plan.totalRuns });
  };

  const caveats = [
    'Outcomes are a mechanical consequence of the declared assumptions; no model decided any actor’s behaviour.',
    'Run-to-run variation of a model is not measured.',
    `Each seeded run differs only through the simulator’s own randomness (seeds ${seeds[0]} to ${seeds.at(-1)}, the same for every scenario). Repeatability describes that randomness, not how likely anything is in the world.`,
  ];
  if (inputs.runsPerVariant < 10) {
    caveats.push(
      `Only ${inputs.runsPerVariant} seeded runs for each scenario: with fewer than 10 runs no finding is called repeatable, however many of them agree.`,
    );
  }

  const assemble = (
    status: 'completed' | 'cancelled',
    extra: Partial<Analysis> = {},
  ): Analysis => ({
    id: inputs.id,
    status,
    createdAt: inputs.createdAt,
    completedAt: new Date(now()).toISOString(),
    config: {
      runsPerVariant: inputs.runsPerVariant,
      baseSeed: inputs.baseSeed,
      rounds: inputs.rounds,
      variants,
      sensitivity: inputs.sensitivity,
    },
    actors: inputs.actors,
    relations: inputs.relations,
    fidelity: {
      engine: 'rules',
      keyActors: 'rules',
      cohorts: 'rules',
      repeatedRuns: inputs.runsPerVariant,
      modelRepeats: 0,
      label: 'Rules: outcomes follow from the declared assumptions',
      caveats,
    },
    progress: { completedRuns, totalRuns: plan.totalRuns },
    variants: [],
    findings: [],
    sensitivity: [],
    representativeRun: null,
    crossCheck: null,
    cost: {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      simulatedRuns,
      simulatedMembers,
      wallMs: Math.max(0, Math.round(now() - startedAt)),
    },
    error: null,
    ...extra,
  });

  // One seed at a time across every variant, so that a stop part way leaves the same seeds in each.
  for (const seed of seeds) {
    for (const variant of variants) {
      if (hooks.shouldCancel?.()) return assemble('cancelled');
      const outcome = simulator(specs.get(variant.id)!, seed);
      counted(outcome.work.members);
      records.get(variant.id)!.push(recordOf(outcome, seed));
      advance();
      await yieldNow();
    }
  }

  let sensitivity: Analysis['sensitivity'] = [];
  const proposedSpec = proposed ? specs.get(proposed.id) : undefined;
  if (inputs.sensitivity) {
    if (proposed && proposedSpec && plan.sensitivitySeeds > 0) {
      const used = seeds.slice(0, plan.sensitivitySeeds);
      const result = await runSensitivity({
        spec: proposedSpec,
        seeds: used,
        baseValues: records
          .get(proposed.id)!
          .slice(0, used.length)
          .map((record) => headlineShare(record.summary.responseShares)),
        simulator,
        perturbations: planPerturbations(inputs.actors, proposed),
        ...(hooks.shouldCancel ? { shouldCancel: hooks.shouldCancel } : {}),
        onRun: (members) => {
          counted(members);
          advance();
        },
        yieldNow,
      });
      if (!result) return assemble('cancelled');
      sensitivity = result.rows;
      caveats.push(
        `Sensitivity moved one assumption at a time, on the first ${used.length} seeds, and compared each run with the unmoved run of the same seed. Interactions between assumptions were not explored.`,
      );
    } else {
      caveats.push(
        'Sensitivity was not run because there was no assumption of the proposed change to move.',
      );
    }
  }

  let representativeRun: RunOutcome | null = null;
  const typical = proposed ? nearestMedian(records.get(proposed.id)!) : undefined;
  if (proposedSpec && typical) {
    representativeRun = simulator(proposedSpec, typical.summary.seed);
    counted(representativeRun.work.members);
  }

  const findings = generateFindings({
    actors: inputs.actors,
    variants,
    records,
    ...(inputs.adverseThreshold === undefined ? {} : { adverseThreshold: inputs.adverseThreshold }),
  });

  const results: VariantResult[] = variants.map((variant) => {
    const runs = records.get(variant.id)!;
    return {
      variantId: variant.id,
      runs: runs.map((record) => compactSummary(record.summary)),
      trajectory: trajectoryOf(runs),
      actors: actorTotals(inputs.actors, runs),
    };
  });

  completedRuns = plan.totalRuns;
  let analysis = assemble('completed', {
    variants: results,
    findings,
    sensitivity,
    representativeRun,
  });
  if (sizeOf(analysis) > SIZE_BUDGET_BYTES) {
    caveats.push(DETAIL_DROPPED);
    analysis = assemble('completed', {
      variants: results.map((result) => ({
        ...result,
        runs: result.runs.map((run) => ({ ...run, byActor: [] })),
      })),
      findings,
      sensitivity,
      representativeRun,
    });
  }
  return analysis;
}
